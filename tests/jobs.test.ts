import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  listFounders,
  getAgentByKey,
  createMission,
  transitionMissionState,
  assignAgent,
  startStage,
  getMission,
  listStages,
  listActivity,
} from "@/lib/db/repositories";
import { reapStaleResearchingMissions } from "@/lib/jobs/stuckMissionWatchdog";

vi.mock("@/lib/inngest/client", () => ({
  // stuckMissionWatchdog.ts calls inngest.createFunction(...) at module
  // load time for both its exported functions, regardless of which one a
  // test actually imports — createFunction must be mocked too, not just
  // send, or importing the module at all throws before any test runs.
  inngest: { send: vi.fn(), createFunction: vi.fn() },
  MISSION_APPROVED_EVENT: "mission/approved",
  MISSION_FOLLOWUP_NEEDED_EVENT: "mission/followup_needed",
}));

async function backdateStageStart(stageId: string, when: Date) {
  const db = await getDb();
  await db
    .update(schema.missionStages)
    .set({ started_at: when.toISOString() })
    .where(eq(schema.missionStages.id, stageId));
}

describe("stuck-mission watchdog", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
  });

  it("reaps a mission that has been researching for over 10 minutes with no progress", async () => {
    const scout = (await getAgentByKey("scout"))!;
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Stuck mission",
      brief: "A mission whose research job crashed and never finished.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "researching");
    await assignAgent(mission.id, scout.id, "lead");
    const stage = await startStage(mission.id, "scout_research", "Scout is researching the opportunity.");
    await backdateStageStart(stage.id, new Date(Date.now() - 15 * 60 * 1000));

    const result = await reapStaleResearchingMissions();

    expect(result.reaped).toBe(1);
    const settled = await getMission(mission.id);
    expect(settled?.state).toBe("failed");
    expect(settled?.failure_reason).toMatch(/timed out/i);

    const stages = await listStages(mission.id);
    expect(stages[0]?.status).toBe("failed");

    const actions = (await listActivity(mission.id)).map((a) => a.action);
    expect(actions).toContain("research_failed");
  });

  it("leaves a mission alone if it's researching but still within the timeout window", async () => {
    const scout = (await getAgentByKey("scout"))!;
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Still working",
      brief: "A mission whose research just started — not stuck yet.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "researching");
    await assignAgent(mission.id, scout.id, "lead");
    await startStage(mission.id, "scout_research", "Scout is researching the opportunity.");
    // started just now — well within the 10-minute window, no backdating.

    const result = await reapStaleResearchingMissions();

    expect(result.reaped).toBe(0);
    const untouched = await getMission(mission.id);
    expect(untouched?.state).toBe("researching");
  });

  it("does not touch a mission that already settled on its own", async () => {
    const scout = (await getAgentByKey("scout"))!;
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Already done",
      brief: "A mission that finished normally before the watchdog ran.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "researching");
    await assignAgent(mission.id, scout.id, "lead");
    const stage = await startStage(mission.id, "scout_research", "Scout is researching the opportunity.");
    await backdateStageStart(stage.id, new Date(Date.now() - 15 * 60 * 1000));
    // Settles for real before the watchdog runs — the stage row stays
    // "in_progress" is unrealistic in practice (completeStage always
    // updates it), so mark it completed too, matching a real settlement.
    await transitionMissionState(mission.id, ["researching"], "ready_for_founders_review");

    const result = await reapStaleResearchingMissions();

    expect(result.reaped).toBe(0);
    const stillSettled = await getMission(mission.id);
    expect(stillSettled?.state).toBe("ready_for_founders_review");
  });

  it("reaps a mission stuck researching on its follow-up (pass 2) stage too, not just the original stage", async () => {
    // Regression: listStaleResearchingMissions originally hardcoded the
    // "scout_research" stage name, which would have silently never
    // matched a crashed pass 2 (stage_name "scout_followup_research").
    const scout = (await getAgentByKey("scout"))!;
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Stuck on the follow-up pass",
      brief: "A mission whose second research pass crashed and never finished.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "awaiting_evidence", { research_pass_count: 1 });
    await transitionMissionState(mission.id, ["awaiting_evidence"], "researching", { research_pass_count: 2 });
    await assignAgent(mission.id, scout.id, "lead");
    const stage = await startStage(mission.id, "scout_followup_research", "Scout is doing a targeted follow-up pass.");
    await backdateStageStart(stage.id, new Date(Date.now() - 15 * 60 * 1000));

    const result = await reapStaleResearchingMissions();

    expect(result.reaped).toBe(1);
    const settled = await getMission(mission.id);
    expect(settled?.state).toBe("failed");
  });
});

describe("follow-up dispatch self-healing watchdog", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  async function backdateMissionUpdatedAt(missionId: string, when: Date) {
    const db = await getDb();
    await db.update(schema.missions).set({ updated_at: when.toISOString() }).where(eq(schema.missions.id, missionId));
  }

  async function makeAwaitingEvidenceMission(passCount: number) {
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Stuck awaiting evidence",
      brief: "A mission whose follow-up dispatch event send is presumed to have failed.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "awaiting_evidence", { research_pass_count: passCount });
    return mission;
  }

  it("re-sends the follow-up event for a mission stuck in awaiting_evidence past the threshold", async () => {
    const { resendStaleFollowupDispatches } = await import("@/lib/jobs/stuckMissionWatchdog");
    const inngestModule = await import("@/lib/inngest/client");
    const mission = await makeAwaitingEvidenceMission(1);
    await backdateMissionUpdatedAt(mission.id, new Date(Date.now() - 3 * 60 * 1000));

    const result = await resendStaleFollowupDispatches();

    expect(result.resent).toBe(1);
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
    expect(inngestModule.inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `mission-followup-${mission.id}`, // same deterministic id as the original send — Inngest-level dedup backstop
        name: "mission/followup_needed",
        data: { missionId: mission.id },
      }),
    );
    const actions = (await listActivity(mission.id)).map((a) => a.action);
    expect(actions).toContain("followup_dispatch_resent");
  });

  it("leaves a mission alone if it just entered awaiting_evidence — well within the threshold", async () => {
    const { resendStaleFollowupDispatches } = await import("@/lib/jobs/stuckMissionWatchdog");
    const inngestModule = await import("@/lib/inngest/client");
    await makeAwaitingEvidenceMission(1);
    // No backdating — updated_at is "now".

    const result = await resendStaleFollowupDispatches();

    expect(result.resent).toBe(0);
    expect(inngestModule.inngest.send).not.toHaveBeenCalled();
  });

  it("leaves a mission alone once it has already moved past awaiting_evidence (the dispatch actually worked)", async () => {
    const { resendStaleFollowupDispatches } = await import("@/lib/jobs/stuckMissionWatchdog");
    const inngestModule = await import("@/lib/inngest/client");
    const mission = await makeAwaitingEvidenceMission(1);
    await backdateMissionUpdatedAt(mission.id, new Date(Date.now() - 3 * 60 * 1000));
    // The follow-up dispatch actually succeeded and pass 2 already started.
    await transitionMissionState(mission.id, ["awaiting_evidence"], "researching", { research_pass_count: 2 });

    const result = await resendStaleFollowupDispatches();

    expect(result.resent).toBe(0);
    expect(inngestModule.inngest.send).not.toHaveBeenCalled();
  });

  it("never resends for a mission already at the research-pass cap, even if it somehow sat in awaiting_evidence", async () => {
    const { resendStaleFollowupDispatches } = await import("@/lib/jobs/stuckMissionWatchdog");
    const inngestModule = await import("@/lib/inngest/client");
    const mission = await makeAwaitingEvidenceMission(2); // at MAX_RESEARCH_PASSES already
    await backdateMissionUpdatedAt(mission.id, new Date(Date.now() - 3 * 60 * 1000));

    const result = await resendStaleFollowupDispatches();

    expect(result.resent).toBe(0);
    expect(inngestModule.inngest.send).not.toHaveBeenCalled();
  });
});
