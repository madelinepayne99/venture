import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  listCosts,
  listLedgerEntries,
  ledgerTotalUsd,
  listActivity,
  listEvidence,
  listDeliverables,
  listStages,
  listAssignments,
  getMission,
  createMission,
  transitionMissionState,
} from "@/lib/db/repositories";
import { makeScoutReport, makeServiceBusinessReport } from "./testUtils";

vi.mock("@/lib/agents/scout", () => {
  return {
    runScoutResearch: vi.fn(),
    ScoutResearchError: class ScoutResearchError extends Error {
      usage: { model: string; inputTokens: number; outputTokens: number };
      constructor(message: string, usage: { model: string; inputTokens: number; outputTokens: number }) {
        super(message);
        this.name = "ScoutResearchError";
        this.usage = usage;
      }
    },
  };
});

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  MISSION_APPROVED_EVENT: "mission/approved",
  MISSION_FOLLOWUP_NEEDED_EVENT: "mission/followup_needed",
}));

describe("mission workflow", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
    founderId = (await listFounders())[0]!.id;
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockReset();
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  it("creates a mission and stops it at the founders' approval gate", async () => {
    const { createAndSubmitMission } = await import("@/lib/domain/missionWorkflow");
    const mission = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Preschool counting worksheets",
      brief: "Research demand for printable counting worksheets on Etsy.",
    });

    expect(mission.state).toBe("awaiting_founder_approval");
    const scoutModule = await import("@/lib/agents/scout");
    expect(scoutModule.runScoutResearch).not.toHaveBeenCalled();
    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).not.toHaveBeenCalled();
  });

  it("rejects an invalid mission before it ever reaches the database", async () => {
    const { createAndSubmitMission, MissionValidationError } = await import(
      "@/lib/domain/missionWorkflow"
    );
    await expect(
      createAndSubmitMission({ founderId, projectId: null, title: "", brief: "" }),
    ).rejects.toBeInstanceOf(MissionValidationError);
  });

  it("approving a mission queues it and dispatches the research job — it does not run Scout inline", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const inngestModule = await import("@/lib/inngest/client");

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Preschool counting worksheets",
      brief: "Research demand for printable counting worksheets on Etsy.",
    });

    const approved = await approveMission(created.id, founderId);

    // approveMission must return immediately — control comes back to the
    // caller with the mission "queued," not with Scout's eventual result.
    expect(approved.state).toBe("queued");
    expect(scoutModule.runScoutResearch).not.toHaveBeenCalled();
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
    expect(inngestModule.inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mission/approved", data: { missionId: created.id } }),
    );
  });

  it("runs Scout and records the full trail once the research job actually executes", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    const report = makeScoutReport();
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report,
      usage: { model: "claude-sonnet-5", inputTokens: 1200, outputTokens: 600, usdCost: 0.0084 },
      evidence: [
        { sourceUrl: "https://example.com", sourceTitle: "Example", sourceDate: null, snippet: "fact", isVerifiedFact: true },
      ],
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Preschool counting worksheets",
      brief: "Research demand for printable counting worksheets on Etsy.",
    });
    await approveMission(created.id, founderId);

    // This is what the Inngest job (lib/jobs/scoutResearchJob.ts) actually
    // calls once the "mission/approved" event is delivered.
    const settled = await runScoutPipeline(created.id);

    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(1);
    expect(settled.state).toBe("ready_for_founders_review");
    expect(settled.final_status).toBe("ready_for_founders_review");
    expect(settled.interpreted_mission).toBe(report.interpreted_mission);

    expect(await listDeliverables(created.id)).toHaveLength(1);
    expect(await listEvidence(created.id)).toHaveLength(1);
    expect(await listCosts(created.id)).toHaveLength(1);

    const actions = (await listActivity(created.id)).map((a) => a.action);
    expect(actions).toContain("mission_created");
    expect(actions).toContain("mission_approved");
    expect(actions).toContain("research_completed");
  });

  it("moves a mission to awaiting_evidence when Scout's evidence is too weak to decide", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport({ verdict: "investigate_further", sources: [], verified_facts: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Niche craft kit",
      brief: "Research demand for a very niche seasonal craft kit idea.",
    });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("awaiting_evidence");
  });

  it("rejects a mission outright when Scout concludes it isn't worth pursuing", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport({ verdict: "reject" }),
      usage: { model: "claude-sonnet-5", inputTokens: 800, outputTokens: 300, usdCost: 0.0046 },
      evidence: [],
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Saturated niche idea",
      brief: "Research demand for a well-worn, saturated printable niche.",
    });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("rejected");
  });

  it("marks a mission failed — never fabricates a ready state — when Scout errors after real token usage, and still records its cost", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    const { ScoutResearchError } = scoutModule as unknown as {
      ScoutResearchError: new (message: string, usage: { model: string; inputTokens: number; outputTokens: number }) => Error;
    };
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValue(
      new ScoutResearchError("Scout's report was not valid JSON.", {
        model: "claude-sonnet-5",
        inputTokens: 700,
        outputTokens: 50,
      }),
    );

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Broken run",
      brief: "This run is set up to fail in the test double.",
    });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toMatch(/not valid JSON/);
    const costs = await listCosts(created.id);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.usd_cost).toBeGreaterThan(0);
    expect(await listDeliverables(created.id)).toHaveLength(0);
  });

  it("settles a mission as failed even when the spent tokens can't be priced, preserving the real failure reason and never inventing a cost", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    const { ScoutResearchError } = scoutModule as unknown as {
      ScoutResearchError: new (message: string, usage: { model: string; inputTokens: number; outputTokens: number }) => Error;
    };
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValue(
      new ScoutResearchError("Scout's report failed structural validation: missing field 'verdict'.", {
        model: "some-future-model-not-in-the-pricing-table",
        inputTokens: 640,
        outputTokens: 120,
      }),
    );

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Unpriceable model run",
      brief: "This run fails with a model that has no entry in the pricing table.",
    });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toMatch(/missing field 'verdict'/);

    const costs = await listCosts(created.id);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.input_tokens).toBe(640);
    expect(costs[0]?.output_tokens).toBe(120);
    expect(costs[0]?.usd_cost).toBeNull();

    const entries = (await listLedgerEntries()).filter((e) => e.mission_id === created.id);
    expect(entries).toHaveLength(0);
  });

  it("never revives a mission the founder cancelled while Scout was still researching, but still records the real cost", async () => {
    const { createAndSubmitMission, approveMission, cancelMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    const usage = { model: "claude-sonnet-5", inputTokens: 1100, outputTokens: 400, usdCost: 0.0069 };

    vi.mocked(scoutModule.runScoutResearch).mockImplementation(async (mission) => {
      // By the time this mock runs, runScoutPipeline has already flipped
      // the mission to "researching" — simulate a concurrent cancel
      // request landing while Scout is still "in flight" for it, using
      // the exact same code path a real second HTTP request would use.
      expect((await getMission(mission.id))?.state).toBe("researching");
      await cancelMission(mission.id, founderId, "Changed my mind mid-research.");
      return { report: makeScoutReport(), usage, evidence: [] };
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Cancelled mid-research",
      brief: "A mission the founder cancels while Scout is still working on it.",
    });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("cancelled");
    expect((await getMission(created.id))?.state).toBe("cancelled");

    const costs = await listCosts(created.id);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.usd_cost).toBeCloseTo(usage.usdCost, 6);

    expect(await listDeliverables(created.id)).toHaveLength(0);
    expect(await listEvidence(created.id)).toHaveLength(0);

    const actions = (await listActivity(created.id)).map((a) => a.action);
    expect(actions).toContain("mission_cancelled");
    expect(actions).toContain("research_discarded_after_state_change");
    expect(actions).not.toContain("research_completed");
  });

  it("resumes into the existing stage and assignment instead of duplicating them when the job is retried after a crash", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { getAgentByKey, assignAgent, startStage } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

    // Simulate a mission whose first attempt got as far as "researching"
    // plus the assignment/stage rows, then the process died before
    // calling Scout — exactly the state a real crash would leave behind.
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Crashed mid-flight",
      brief: "A mission whose first research attempt crashed before finishing.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "researching");
    const scout = (await getAgentByKey("scout"))!;
    await assignAgent(mission.id, scout.id, "lead");
    await startStage(mission.id, "scout_research", "Scout is researching the opportunity.");

    // The retried job call — this is the "resume" path, not a fresh start.
    const settled = await runScoutPipeline(mission.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect(await listAssignments(mission.id)).toHaveLength(1);
    expect(await listStages(mission.id)).toHaveLength(1);
  });

  it("skips cleanly and spends nothing when the research job runs for a mission that already moved on", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");

    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Never approved",
      brief: "A mission the research job somehow runs for before it was ever approved.",
    });
    // Still in "draft" — never queued at all.

    const result = await runScoutPipeline(mission.id);

    expect(result.state).toBe("draft");
    expect(scoutModule.runScoutResearch).not.toHaveBeenCalled();
  });

  it("lets a founder cancel a mission before Scout ever runs", async () => {
    const { createAndSubmitMission, cancelMission } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Second thoughts",
      brief: "A mission the founder changes their mind about immediately.",
    });
    const cancelled = await cancelMission(created.id, founderId, "Changed priorities.");

    expect(cancelled.state).toBe("cancelled");
    expect(scoutModule.runScoutResearch).not.toHaveBeenCalled();
  });

  it("refuses to cancel a mission that has already reached a terminal state", async () => {
    const { createAndSubmitMission, cancelMission } = await import("@/lib/domain/missionWorkflow");

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Already cancelled",
      brief: "A mission that gets cancelled twice in a row.",
    });
    await cancelMission(created.id, founderId);

    await expect(cancelMission(created.id, founderId)).rejects.toThrow();
  });

  it("auto-approves when the founder approval gate is disabled by configuration", async () => {
    process.env.REQUIRE_FOUNDER_APPROVAL = "false";
    const { createAndSubmitMission } = await import("@/lib/domain/missionWorkflow");
    const inngestModule = await import("@/lib/inngest/client");

    const mission = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Auto-approved mission",
      brief: "This mission should skip the manual approval click.",
    });

    expect(mission.state).toBe("queued");
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
  });

  it("cannot approve a mission that was never submitted for approval", async () => {
    const { approveMission } = await import("@/lib/domain/missionWorkflow");
    await expect(approveMission("does-not-exist", founderId)).rejects.toThrow(/not found/);
  });

  it("enforces the approval gate — a mission still in draft cannot be approved directly", async () => {
    const { approveMission } = await import("@/lib/domain/missionWorkflow");
    const { IllegalMissionTransitionError } = await import("@/lib/domain/missionStates");

    const draftMission = await createMission({
      founderId,
      projectId: null,
      title: "Skips the gate",
      brief: "An attempt to approve a mission that never asked the founders.",
    });

    await expect(approveMission(draftMission.id, founderId)).rejects.toBeInstanceOf(
      IllegalMissionTransitionError,
    );
    const scoutModule = await import("@/lib/agents/scout");
    expect(scoutModule.runScoutResearch).not.toHaveBeenCalled();
  });

  it("regression: a second observed approval attempt on an already-queued mission is an idempotent no-op, not a queued-to-queued crash", async () => {
    // Reproduces a real production failure: a founder's (or a retried
    // request's) second approval call landed after the mission was
    // already "queued", and `assertTransition("queued", "queued")` threw
    // `Cannot move a mission from "queued" to "queued".` instead of
    // recognizing the mission was already approved and dispatched.
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const inngestModule = await import("@/lib/inngest/client");

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Find an original children's activity-pack opportunity",
      brief: "A mission approved twice — the second call must not error.",
    });
    const first = await approveMission(created.id, founderId);
    expect(first.state).toBe("queued");

    // The exact reported case: the mission is already "queued" by the time
    // this second, later call reads it — not a tight race.
    const second = await approveMission(created.id, founderId);
    expect(second.state).toBe("queued");
    expect(second.id).toBe(first.id);

    // Dispatched — and charged, once real research runs — exactly once.
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);

    const approvals = await listActivity(created.id);
    const approvalEvents = approvals.filter((a) => a.action === "mission_approved");
    expect(approvalEvents).toHaveLength(1);
  });

  it("prevents a genuinely concurrent double-approval from dispatching the research job twice", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const inngestModule = await import("@/lib/inngest/client");

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Race to approve",
      brief: "Two requests approving the same mission at once.",
    });

    const results = await Promise.allSettled([
      approveMission(created.id, founderId),
      approveMission(created.id, founderId),
    ]);

    // Both are idempotent successes now — neither request should ever see
    // an error just because it lost a race it had no way to avoid. The
    // property that actually matters (Scout dispatched, and later charged,
    // exactly once) is asserted below, not which request "won".
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(0);
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect((result.value as { state: string }).state).toBe("queued");
      }
    }

    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
  });

  it("prevents a genuinely concurrent double-dispatch of the research job itself from settling a mission twice", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { MissionConcurrencyError } = await import("@/lib/domain/missionStates");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Race to research",
      brief: "Two job triggers for the same freshly-queued mission at once.",
    });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");

    const results = await Promise.allSettled([runScoutPipeline(mission.id), runScoutPipeline(mission.id)]);

    // Depending on real timing, the loser either finds the mission already
    // past "queued" and throws MissionConcurrencyError, or finds it already
    // settled by the winner and no-ops cleanly (the "moved on, nothing to
    // do" branch) — both are correct outcomes. What must always hold: any
    // rejection is specifically a MissionConcurrencyError, the mission
    // reaches its one real settled state, and Scout was only ever actually
    // called (and only ever billed) once.
    const rejected = results.filter((r) => r.status === "rejected");
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(MissionConcurrencyError);
    }
    const settled = await getMission(mission.id);
    expect(settled?.state).toBe("ready_for_founders_review");
    expect(await listCosts(mission.id)).toHaveLength(1);
  });

  it("transitionMissionState lets only one of two racing conditional updates for the same fromState succeed", async () => {
    const mission = await createMission({
      founderId,
      projectId: null,
      title: "Race target",
      brief: "Used to test the atomic transition guard directly, independent of higher-level timing.",
    });

    const [a, b] = await Promise.all([
      transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval"),
      transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval"),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    expect(successes).toHaveLength(1);
    expect(a.mission.state).toBe("awaiting_founder_approval");
    expect(b.mission.state).toBe("awaiting_founder_approval");
  });

  it("records every dollar spent into the shared ledger, as an expense", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 500, usdCost: 0.007 },
      evidence: [],
    });

    const before = await ledgerTotalUsd();
    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Ledger check",
      brief: "Confirm this mission's cost lands in the shared business ledger.",
    });
    await approveMission(created.id, founderId);
    await runScoutPipeline(created.id);
    const after = await ledgerTotalUsd();

    expect(after).toBeLessThan(before);
    const entries = await listLedgerEntries();
    expect(entries[0]?.amount_usd).toBeLessThan(0);
  });

  it("resolves a mission's project workspace type and passes it to Scout", async () => {
    const { createProject } = await import("@/lib/db/repositories");
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeServiceBusinessReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });

    const project = await createProject({ name: "Hair & Beauty Clients", workspaceType: "service_business" });

    const created = await createAndSubmitMission({
      founderId,
      projectId: project.id,
      title: "Client retention plan",
      brief: "Research a client-retention plan for a UK independent hairdresser.",
    });
    await approveMission(created.id, founderId);
    await runScoutPipeline(created.id);

    expect(scoutModule.runScoutResearch).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      expect.objectContaining({ workspaceType: "service_business" }),
    );
  });

  it("defaults to the commerce workspace type for a mission with no project", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "No-project mission",
      brief: "A mission with no project attached should default to the commerce workspace.",
    });
    await approveMission(created.id, founderId);
    await runScoutPipeline(created.id);

    expect(scoutModule.runScoutResearch).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      expect.objectContaining({ workspaceType: "commerce" }),
    );
  });
});

describe("two-pass evidence loop (awaiting_evidence -> automatic follow-up)", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
    founderId = (await listFounders())[0]!.id;
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockReset();
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  async function createAndApprove(title: string) {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title,
      brief: "A mission whose first pass comes back inconclusive.",
    });
    await approveMission(created.id, founderId);
    return created;
  }

  it("pass 1 investigate_further settles to awaiting_evidence, pass_count 1, and dispatches exactly one automatic follow-up", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport({
        verdict: "investigate_further",
        verdict_rationale: "The one source found doesn't confirm real demand.",
        unresolved_questions: ["Is there genuine search volume for this term?"],
      }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });

    const created = await createAndApprove("Inconclusive pass 1");
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("awaiting_evidence");
    expect(settled.research_pass_count).toBe(1);
    expect(settled.final_status).toBe("investigate_further");

    const followupSends = vi
      .mocked(inngestModule.inngest.send)
      .mock.calls.filter(([evt]) => (evt as { name?: string }).name === "mission/followup_needed");
    expect(followupSends).toHaveLength(1);
    expect(followupSends[0]![0]).toMatchObject({ data: { missionId: created.id } });
  });

  it("dispatching the follow-up increments research_pass_count to 2, starts a distinct follow-up stage, and re-assigns Scout idempotently", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { listStages, listAssignments } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Two-pass mission");
    await runScoutPipeline(created.id); // pass 1 -> awaiting_evidence

    // Simulate the Inngest job picking up mission/followup_needed.
    const settled = await runScoutPipeline(created.id); // pass 2

    expect(settled.research_pass_count).toBe(2);
    expect(settled.state).toBe("ready_for_founders_review");

    const stageNames = (await listStages(created.id)).map((s) => s.stage_name);
    expect(stageNames).toEqual(["scout_research", "scout_followup_research"]);

    // Scout was already assigned during pass 1 — pass 2 must not create a
    // second assignment row for the same mission/agent pair.
    expect(await listAssignments(created.id)).toHaveLength(1);
  });

  it("builds pass 2's follow-up context from pass 1's own unresolved_questions, verdict_rationale, verified_facts, and sources", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const pass1Report = makeScoutReport({
      verdict: "investigate_further",
      verdict_rationale: "Only one weak source was found for demand.",
      unresolved_questions: ["Does this term have real monthly search volume?", "Are competitors actually selling well?"],
      verified_facts: [{ statement: "Etsy supports digital downloads in this category.", source_url: "https://example.com/etsy-trends" }],
      sources: [
        { url: "https://example.com/etsy-trends", title: "Etsy seller trends report", published_date: "2026-01-15", accessed_date: "2026-09-13" },
      ],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: pass1Report,
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Follow-up context mission");
    await runScoutPipeline(created.id);
    await runScoutPipeline(created.id);

    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(2);
    const secondCallArgs = vi.mocked(scoutModule.runScoutResearch).mock.calls[1]!;
    expect(secondCallArgs[1]).toMatchObject({
      followupContext: {
        passNumber: 2,
        maxPasses: 2,
        priorVerdictRationale: pass1Report.verdict_rationale,
        unresolvedQuestions: pass1Report.unresolved_questions,
        priorVerifiedFacts: pass1Report.verified_facts,
        priorSources: [{ url: "https://example.com/etsy-trends", title: "Etsy seller trends report" }],
      },
    });

    // Pass 1's own call must never have received a followupContext.
    const firstCallArgs = vi.mocked(scoutModule.runScoutResearch).mock.calls[0]!;
    expect(firstCallArgs[1]).toMatchObject({ followupContext: undefined });
  });

  it("never overwrites pass 1's deliverable, and records pass 2 as a separate scout_followup_report", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { listDeliverables } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    const pass1Report = makeScoutReport({ verdict: "investigate_further", verdict_rationale: "Pass 1 rationale." });
    const pass2Report = makeScoutReport({ verdict: "ready_for_founders_review", verdict_rationale: "Pass 2 rationale." });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: pass1Report,
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: pass2Report,
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Preserve both reports");
    await runScoutPipeline(created.id);

    const afterPass1 = await listDeliverables(created.id);
    expect(afterPass1).toHaveLength(1);
    expect(afterPass1[0]?.kind).toBe("scout_research_report");
    expect(afterPass1[0]?.content).toEqual(pass1Report);

    await runScoutPipeline(created.id);

    const afterPass2 = await listDeliverables(created.id);
    expect(afterPass2).toHaveLength(2);
    const original = afterPass2.find((d) => d.kind === "scout_research_report");
    const followup = afterPass2.find((d) => d.kind === "scout_followup_report");
    // Pass 1's row must be byte-for-byte unchanged by pass 2 running.
    expect(original?.content).toEqual(pass1Report);
    expect(original?.id).toBe(afterPass1[0]?.id);
    expect(followup?.content).toEqual(pass2Report);
  });

  it("pass 2 ready_for_founders_review settles cleanly, with no further automatic dispatch", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Pass 2 resolves positively");
    await runScoutPipeline(created.id);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect(settled.final_status).toBe("ready_for_founders_review");

    const followupSends = vi
      .mocked(inngestModule.inngest.send)
      .mock.calls.filter(([evt]) => (evt as { name?: string }).name === "mission/followup_needed");
    expect(followupSends).toHaveLength(1); // only the original one dispatch, never a second
  });

  it("pass 2 reject settles the mission as rejected", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "reject", verdict_rationale: "Pass 2 confirms this isn't viable." }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Pass 2 resolves negatively");
    await runScoutPipeline(created.id);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("rejected");
    expect(settled.final_status).toBe("reject");
  });

  it("pass 2 still investigate_further stops automatic research: settles to ready_for_founders_review with the genuine investigate_further final_status preserved, and never dispatches a third pass", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const inngestModule = await import("@/lib/inngest/client");
    const pass2Rationale = "Even after a targeted follow-up, genuine uncertainty remains.";
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further", verdict_rationale: pass2Rationale }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Still inconclusive after two passes");
    await runScoutPipeline(created.id);
    const settled = await runScoutPipeline(created.id);

    // Never silently upgraded to look resolved — the real verdict is kept.
    expect(settled.state).toBe("ready_for_founders_review");
    expect(settled.final_status).toBe("investigate_further");
    expect(settled.research_pass_count).toBe(2);

    // No third dispatch — settling into ready_for_founders_review (not
    // awaiting_evidence a second time) means the "fire on awaiting_evidence"
    // trigger never runs again for this mission.
    const followupSends = vi
      .mocked(inngestModule.inngest.send)
      .mock.calls.filter(([evt]) => (evt as { name?: string }).name === "mission/followup_needed");
    expect(followupSends).toHaveLength(1);

    // The pass 2 report itself is still fully preserved for the founder to read.
    const { listDeliverables } = await import("@/lib/db/repositories");
    const followup = (await listDeliverables(created.id)).find((d) => d.kind === "scout_followup_report");
    expect((followup?.content as { verdict_rationale: string }).verdict_rationale).toBe(pass2Rationale);
  });

  it("layer 2 defense: refuses to dispatch a third pass even if a mission somehow re-enters awaiting_evidence at the pass cap", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { transitionMissionState, getMission } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");

    const created = await createAndApprove("Forced past the cap");
    // Force the mission directly to the state this should never legally
    // reach on its own (nextStateForVerdict never produces it) — proving
    // the dispatch-time guard is a real, independent backstop and not
    // just untested reasoning about the first layer.
    await transitionMissionState(created.id, ["queued"], "awaiting_evidence", { research_pass_count: 2 });

    const result = await runScoutPipeline(created.id);

    expect(result.state).toBe("awaiting_evidence");
    expect(result.research_pass_count).toBe(2);
    expect(scoutModule.runScoutResearch).not.toHaveBeenCalled();

    const actions = (await listActivity(created.id)).map((a) => a.action);
    expect(actions).toContain("followup_skipped_pass_cap");

    const untouched = await getMission(created.id);
    expect(untouched?.state).toBe("awaiting_evidence");
  });

  it("duplicate follow-up dispatch events cannot cause a duplicate pass 2 or a duplicate charge", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { MissionConcurrencyError } = await import("@/lib/domain/missionStates");
    const { listCosts } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Duplicate follow-up dispatch race");
    await runScoutPipeline(created.id); // pass 1 -> awaiting_evidence

    // Two genuinely concurrent triggers for the same mission/followup_needed.
    const results = await Promise.allSettled([runScoutPipeline(created.id), runScoutPipeline(created.id)]);

    const rejected = results.filter((r) => r.status === "rejected");
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(MissionConcurrencyError);
    }

    const { getMission } = await import("@/lib/db/repositories");
    const settled = await getMission(created.id);
    expect(settled?.state).toBe("ready_for_founders_review");
    expect(settled?.research_pass_count).toBe(2);

    // Scout was called once for pass 1, and exactly once more for pass 2 —
    // never twice for the same pass.
    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(2);
    expect(await listCosts(created.id)).toHaveLength(2);
  });

  it("cancelling a mission while pass 2 is researching discards the pass-2 report but keeps pass 1's, and still records real cost", async () => {
    const { runScoutPipeline, cancelMission } = await import("@/lib/domain/missionWorkflow");
    const { getMission, listDeliverables } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    const pass2Usage = { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 };

    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 },
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockImplementationOnce(async (mission) => {
      expect((await getMission(mission.id))?.state).toBe("researching");
      await cancelMission(mission.id, founderId, "Changed my mind during the follow-up.");
      return { report: makeScoutReport({ verdict: "ready_for_founders_review" }), usage: pass2Usage, evidence: [] };
    });

    const created = await createAndApprove("Cancelled during pass 2");
    await runScoutPipeline(created.id); // pass 1 settles to awaiting_evidence
    const settled = await runScoutPipeline(created.id); // pass 2, cancelled mid-flight

    expect(settled.state).toBe("cancelled");
    expect((await getMission(created.id))?.state).toBe("cancelled");

    // Pass 1's real deliverable survives; pass 2's report was discarded,
    // never stored, exactly like a cancelled pass 1 always has been.
    const deliverables = await listDeliverables(created.id);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.kind).toBe("scout_research_report");

    const costs = await listCosts(created.id);
    expect(costs).toHaveLength(2); // pass 1's real cost, plus pass 2's real cost — both genuinely spent
    expect(costs[1]?.usd_cost).toBeCloseTo(pass2Usage.usdCost, 6);
  });

  it("recovers pass 2 into its own existing stage (not pass 1's) after a simulated crash mid-follow-up", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { transitionMissionState, getAgentByKey, assignAgent, startStage, listStages, recordDeliverable } =
      await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

    const created = await createAndApprove("Crashed mid-follow-up");
    const scoutForDeliverable = (await getAgentByKey("scout"))!;
    // Simulate: pass 1 genuinely ran and completed (real deliverable
    // recorded, state at awaiting_evidence, pass_count 1), then the
    // follow-up dispatch got as far as "researching" + pass_count 2 + a
    // fresh stage row, then the process died before ever calling Scout
    // for pass 2 — a real crash-recovery scenario always has pass 1's
    // report already on record, which is what pass 2 needs to resume into.
    await recordDeliverable({
      missionId: created.id,
      agentId: scoutForDeliverable.id,
      kind: "scout_research_report",
      content: makeScoutReport({ verdict: "investigate_further" }),
    });
    await transitionMissionState(created.id, ["queued"], "awaiting_evidence", { research_pass_count: 1 });
    await transitionMissionState(created.id, ["awaiting_evidence"], "researching", { research_pass_count: 2 });
    const scout = (await getAgentByKey("scout"))!;
    await assignAgent(created.id, scout.id, "lead");
    await startStage(created.id, "scout_followup_research", "Scout is doing a targeted follow-up pass.");

    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("ready_for_founders_review");
    const stages = await listStages(created.id);
    // Must resume into the one existing follow-up stage, never duplicate it.
    expect(stages.filter((s) => s.stage_name === "scout_followup_research")).toHaveLength(1);
  });
});
