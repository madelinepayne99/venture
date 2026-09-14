import { beforeEach, describe, expect, it } from "vitest";
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
});
