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
import { makeScoutReport, makeServiceBusinessReport, makeProductionRecommendation } from "./testUtils";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

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
    const organization = await getActiveOrganizationForFounder(founderId);
    const mission = await createMission({
      founderId,
      organizationId: organization.id,
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

  it("a normal first-time queued mission still gets exactly one Scout assignment", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "First run", brief: "A normal first-time mission." });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect(await listAssignments(created.id)).toHaveLength(1);
  });

  it("re-approving a resubmitted mission that already has a Scout/lead assignment does not duplicate it or crash — the real bug a retried Acceptance 5 would have hit", async () => {
    const { runScoutPipeline, createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const { getAgentByKey, assignAgent } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");

    // Pass 1 fails technically (no valid pass-1 report to fall back on),
    // leaving the mission "failed" with a real Scout/lead assignment row
    // already on record — exactly Acceptance 5's real, live state.
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(
      new scoutModule.ScoutResearchError("400 invalid_request_error", {
        model: "claude-sonnet-5",
        inputTokens: 100,
        outputTokens: 0,
      }),
    );

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Resubmitted after failure", brief: "A mission whose first attempt failed technically." });
    await approveMission(created.id, founderId);
    const firstAttempt = await runScoutPipeline(created.id);
    expect(firstAttempt.state).toBe("failed");
    const scout = (await getAgentByKey("scout"))!;
    expect(await listAssignments(created.id)).toHaveLength(1); // the real, already-existing assignment

    // The sanctioned resubmit path: failed -> awaiting_founder_approval is
    // explicitly allowed (missionStates.ts), clearing only the technical
    // failure/attempt fields — never deleting the assignment or stage history.
    const resubmitted = await transitionMissionState(created.id, ["failed"], "awaiting_founder_approval", {
      failure_reason: null,
      research_pass_count: 0,
    });
    expect(resubmitted.ok).toBe(true);

    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });
    await approveMission(created.id, founderId);

    // Before the fix, this unconditional second assignAgent() call would
    // throw a real Postgres unique-violation on
    // agent_assignments_mission_agent_role_unique (mission_id, agent_id,
    // role) — a hard crash, not a silent duplicate. It must not throw, and
    // the retry must genuinely continue through Scout rather than silently
    // stopping.
    const resettled = await runScoutPipeline(created.id);

    expect(resettled.state).toBe("ready_for_founders_review"); // the retry genuinely ran Scout, not a no-op
    const assignments = await listAssignments(created.id);
    expect(assignments).toHaveLength(1); // still exactly one — never duplicated
    expect(assignments[0]?.agent_id).toBe(scout.id);
    expect(await listStages(created.id)).toHaveLength(2); // the original failed stage, preserved, plus the new retry's stage
  });

  it("skips cleanly and spends nothing when the research job runs for a mission that already moved on", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");

    const organization = await getActiveOrganizationForFounder(founderId);
    const mission = await createMission({
      founderId,
      organizationId: organization.id,
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

    const orgForDraft = await getActiveOrganizationForFounder(founderId);
    const draftMission = await createMission({
      founderId,
      organizationId: orgForDraft.id,
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

    const organization = await getActiveOrganizationForFounder(founderId);
    const mission = await createMission({
      founderId,
      organizationId: organization.id,
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
    const organization = await getActiveOrganizationForFounder(founderId);
    const mission = await createMission({
      founderId,
      organizationId: organization.id,
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

    const orgForProject = await getActiveOrganizationForFounder(founderId);
    const project = await createProject({ name: "Hair & Beauty Clients", organizationId: orgForProject.id, workspaceType: "service_business" });

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

describe("failed follow-up pass falls back to founder review on pass 1 (narrow degraded fallback)", () => {
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

  const pass1Usage = { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.0058 };

  async function createAndApprove(title: string) {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title,
      brief: "A mission whose first pass is inconclusive.",
    });
    await approveMission(created.id, founderId);
    return created;
  }

  async function failingScoutError(message: string) {
    const scoutModule = await import("@/lib/agents/scout");
    return new scoutModule.ScoutResearchError(message, {
      model: "claude-sonnet-5",
      inputTokens: 172_372,
      outputTokens: 874,
    });
  }

  it("valid pass 1 + failed pass 2 -> ready_for_founders_review, pass 1 preserved exactly, follow-up failure visible", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const pass1Report = makeScoutReport({
      verdict: "investigate_further",
      unresolved_questions: ["Is there genuine search volume for this term?"],
    });
    const pass1Evidence = [
      { sourceUrl: "https://example.com/a", sourceTitle: "A", sourceDate: "2026-01-01", snippet: "s", isVerifiedFact: true },
    ];
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: pass1Report,
      usage: pass1Usage,
      evidence: pass1Evidence,
    });
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(await failingScoutError("Scout's report was not valid JSON."));

    const created = await createAndApprove("Pass 2 fails technically");
    await runScoutPipeline(created.id); // pass 1 -> awaiting_evidence
    const beforeDeliverables = await listDeliverables(created.id);
    const beforeEvidence = await listEvidence(created.id);

    const settled = await runScoutPipeline(created.id); // pass 2 -> technical failure

    expect(settled.state).toBe("ready_for_founders_review");
    expect(settled.final_status).toBe("investigate_further"); // pass 1's real verdict, never upgraded
    expect(settled.failure_reason).toBeNull(); // not a failed mission
    expect(settled.research_pass_count).toBe(2);

    // Pass 1's deliverable and evidence are byte-for-byte unchanged.
    const afterDeliverables = await listDeliverables(created.id);
    expect(afterDeliverables).toEqual(beforeDeliverables);
    expect(afterDeliverables[0]?.content).toEqual(pass1Report);
    expect(await listEvidence(created.id)).toEqual(beforeEvidence);

    // The degraded state is visible from real records: a failed follow-up stage + activity.
    const stages = await listStages(created.id);
    const followupStage = stages.find((s) => s.stage_name === "scout_followup_research");
    expect(followupStage?.status).toBe("failed");
    expect(followupStage?.detail).toBe("Scout's report was not valid JSON.");
    const activity = await listActivity(created.id);
    const failedActivity = activity.find((a) => a.action === "followup_research_failed");
    expect(failedActivity?.detail).toMatch(/not valid JSON/);
    expect(failedActivity?.detail).toMatch(/first-pass report alone/);
    expect(activity.some((a) => a.action === "research_failed")).toBe(false);
  });

  it("does not fabricate a pass 2 deliverable or any pass 2 evidence", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: pass1Usage,
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(await failingScoutError("Scout's report was not valid JSON."));

    const created = await createAndApprove("No fabricated pass 2");
    await runScoutPipeline(created.id);
    await runScoutPipeline(created.id);

    const deliverables = await listDeliverables(created.id);
    expect(deliverables.map((d) => d.kind)).toEqual(["scout_research_report"]);
    expect(deliverables.some((d) => d.kind === "scout_followup_report")).toBe(false);
    expect(await listEvidence(created.id)).toHaveLength(0);
  });

  it("still records the failed pass's real cost, on top of pass 1's, and does not re-dispatch a third pass", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: pass1Usage,
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(await failingScoutError("Scout's report was not valid JSON."));

    const created = await createAndApprove("Cost still recorded");
    await runScoutPipeline(created.id);
    await runScoutPipeline(created.id);

    const costs = await listCosts(created.id);
    expect(costs).toHaveLength(2);
    expect(costs.some((c) => c.input_tokens === 172_372 && c.output_tokens === 874)).toBe(true);
    expect(costs.every((c) => c.usd_cost !== null && c.usd_cost > 0)).toBe(true);

    const followupSends = vi
      .mocked(inngestModule.inngest.send)
      .mock.calls.filter(([evt]) => (evt as { name?: string }).name === "mission/followup_needed");
    expect(followupSends).toHaveLength(1);
  });

  it("a pass 1 failure still fails the mission normally (fallback never applies)", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(await failingScoutError("Scout's report was not valid JSON."));

    const created = await createAndApprove("Pass 1 fails");
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toBe("Scout's report was not valid JSON.");
    const activity = await listActivity(created.id);
    expect(activity.some((a) => a.action === "research_failed")).toBe(true);
    expect(activity.some((a) => a.action === "followup_research_failed")).toBe(false);
  });

  it("a failed pass 2 with no valid pass 1 report to fall back on still fails (fallback requires a schema-valid stored pass 1)", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: pass1Usage,
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(await failingScoutError("Scout's report was not valid JSON."));

    const created = await createAndApprove("Corrupt pass 1");
    await runScoutPipeline(created.id);
    // Corrupt the stored pass 1 deliverable so it no longer satisfies the schema.
    const { getDb } = await import("@/lib/db/client");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.execute(sql`UPDATE deliverables SET content = '{"verdict":"investigate_further"}'::jsonb WHERE mission_id = ${created.id}`);

    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("failed");
  });

  it("a successful pass 2 behaves exactly as before (no degraded fallback involved)", async () => {
    const { runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "investigate_further" }),
      usage: pass1Usage,
      evidence: [],
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 700, outputTokens: 300, usdCost: 0.0045 },
      evidence: [],
    });

    const created = await createAndApprove("Pass 2 succeeds");
    await runScoutPipeline(created.id);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect(settled.final_status).toBe("ready_for_founders_review");
    const stages = await listStages(created.id);
    expect(stages.every((s) => s.status === "completed")).toBe(true);
    const deliverables = await listDeliverables(created.id);
    expect(deliverables.map((d) => d.kind).sort()).toEqual(["scout_followup_report", "scout_research_report"]);
    expect((await listActivity(created.id)).some((a) => a.action === "followup_research_failed")).toBe(false);
  });
});

describe("Scout failure diagnostics reach the activity log without touching founder-facing text", () => {
  it("appends safe run diagnostics to the research_failed activity, leaving failure_reason clean", async () => {
    await resetDbForTests();
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
    const founderId = (await listFounders())[0]!.id;
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const error = new scoutModule.ScoutResearchError("Scout's report was not valid JSON.", {
      model: "claude-sonnet-5",
      inputTokens: 153_688,
      outputTokens: 681,
    });
    (error as unknown as { diagnostics: unknown }).diagnostics = {
      calls: [{ stopReason: "tool_use", blocks: { tool_use: 1 }, clientToolNames: ["x"], inputTokens: 1, outputTokens: 1 }],
      nudged: true,
      recovered: false,
      usedSubmitTool: false,
      failureKind: "no_report",
    };
    vi.mocked(scoutModule.runScoutResearch).mockReset();
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(error);

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Diagnostics", brief: "A mission whose research fails technically." });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toBe("Scout's report was not valid JSON.");
    const failed = (await listActivity(created.id)).find((a) => a.action === "research_failed");
    expect(failed?.detail).toMatch(/^Scout's report was not valid JSON\. \[scout diagnostics: \{/);
    expect(failed?.detail).toMatch(/"failureKind":"no_report"/);
    const stage = (await listStages(created.id)).find((x) => x.stage_name === "scout_research");
    expect(stage?.detail).toBe("Scout's report was not valid JSON.");
  });
});

describe("mission/approved event id — scoped to the specific approval, not just the mission", () => {
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

  function approvedSends(calls: unknown[]) {
    return calls
      .map(([evt]: any) => evt)
      .filter((evt: any) => evt.name === "mission/approved");
  }

  it("a normal first approval dispatches exactly once, with an id scoped to the transition's real updated_at", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const inngestModule = await import("@/lib/inngest/client");

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Normal approval", brief: "A normal single-approval mission." });
    const approved = await approveMission(created.id, founderId);

    const sends = approvedSends(vi.mocked(inngestModule.inngest.send).mock.calls);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      id: `mission-approved-${created.id}-${approved.updated_at}`,
      name: "mission/approved",
      data: { missionId: created.id },
    });
  });

  it("a duplicate/retried call for the SAME approval sends no second event at all — the strongest form of dedup, and what a retried id would reproduce anyway", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const inngestModule = await import("@/lib/inngest/client");

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Retried approval", brief: "An approval whose HTTP request gets retried." });
    await approveMission(created.id, founderId);
    // Simulates the client retrying the same approve request after a
    // timeout — the mission is already "queued", so this must be a pure
    // no-op: no second recordApproval, no second event.
    const second = await approveMission(created.id, founderId);

    expect(second.state).toBe("queued");
    expect(approvedSends(vi.mocked(inngestModule.inngest.send).mock.calls)).toHaveLength(1);
  });

  it("THE FIX: a failed mission, legitimately resubmitted and re-approved, gets a DIFFERENT event id and genuinely dispatches Scout again — the real Acceptance 5 bug", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { getAgentByKey } = await import("@/lib/db/repositories");
    const inngestModule = await import("@/lib/inngest/client");
    const scoutModule = await import("@/lib/agents/scout");

    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(
      new scoutModule.ScoutResearchError("400 invalid_request_error", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 0 }),
    );

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Resubmit and re-approve", brief: "A mission that fails, is resubmitted, and re-approved." });
    const firstApproval = await approveMission(created.id, founderId);
    const firstRun = await runScoutPipeline(created.id);
    expect(firstRun.state).toBe("failed");

    // The sanctioned resubmit path.
    const resubmitted = await transitionMissionState(created.id, ["failed"], "awaiting_founder_approval", {
      failure_reason: null,
      research_pass_count: 0,
    });
    expect(resubmitted.ok).toBe(true);

    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });
    const secondApproval = await approveMission(created.id, founderId);

    const sends = approvedSends(vi.mocked(inngestModule.inngest.send).mock.calls);
    expect(sends).toHaveLength(2);
    expect(sends[0]!.id).not.toBe(sends[1]!.id); // THE bug, fixed: distinct ids for distinct approvals
    expect(sends[0]!.id).toBe(`mission-approved-${created.id}-${firstApproval.updated_at}`);
    expect(sends[1]!.id).toBe(`mission-approved-${created.id}-${secondApproval.updated_at}`);

    // And the second approval genuinely dispatches Scout again — this is
    // what a real Inngest instance would deliver, since the id no longer
    // collides with the first send's.
    const secondRun = await runScoutPipeline(created.id);
    expect(secondRun.state).toBe("ready_for_founders_review");
    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(2);

    // The existing assignment-idempotency fix still holds: exactly one
    // Scout/lead assignment, never duplicated across the retry.
    const scout = (await getAgentByKey("scout"))!;
    const assignments = await listAssignments(created.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.agent_id).toBe(scout.id);
  });
});

describe("recoverStuckQueuedMission — narrow recovery for a genuine dispatch failure", () => {
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

  async function createStuckQueuedMission(title: string) {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const created = await createAndSubmitMission({ founderId, projectId: null, title, brief: "A mission whose dispatch event never reached the research job." });
    // Approved, genuinely queued — but runScoutPipeline is never invoked,
    // simulating exactly the real bug: the event was dropped/lost.
    return approveMission(created.id, founderId);
  }

  it("1. recovers a genuinely stuck queued mission back to awaiting_founder_approval", async () => {
    const { recoverStuckQueuedMission } = await import("@/lib/domain/missionWorkflow");
    const stuck = await createStuckQueuedMission("Stuck 1");

    const recovered = await recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 3 * 60 * 1000) });

    expect(recovered.state).toBe("awaiting_founder_approval");
    expect(recovered.research_pass_count).toBe(0);
  });

  it("2. records a clear recovery activity explaining why the mission moved backwards", async () => {
    const { recoverStuckQueuedMission } = await import("@/lib/domain/missionWorkflow");
    const stuck = await createStuckQueuedMission("Stuck 2");

    await recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 3 * 60 * 1000) });

    const activity = await listActivity(stuck.id);
    const recovery = activity.find((a) => a.action === "queued_dispatch_recovered");
    expect(recovery).toBeTruthy();
    expect(recovery?.actor).toBe("system");
    expect(recovery?.detail).toMatch(/stuck "queued"/i);
    expect(recovery?.detail).toMatch(/preserved, not deleted/i);
  });

  it("3. preserves all historical assignment/stage/activity — nothing is deleted or fabricated", async () => {
    const { recoverStuckQueuedMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockRejectedValueOnce(
      new scoutModule.ScoutResearchError("400 invalid_request_error", { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 0 }),
    );
    const created = await createStuckQueuedMission("Stuck 3 — failed then resubmitted then stuck again");
    await runScoutPipeline(created.id); // fails technically, real history created
    await transitionMissionState(created.id, ["failed"], "awaiting_founder_approval", { failure_reason: null, research_pass_count: 0 });
    const { approveMission } = await import("@/lib/domain/missionWorkflow");
    const reApproved = await approveMission(created.id, founderId); // queued again, but stuck this time

    const beforeActivity = await listActivity(created.id);
    const beforeAssignments = await listAssignments(created.id);
    const beforeStages = await listStages(created.id);
    expect(beforeAssignments).toHaveLength(1); // the original, real assignment
    expect(beforeStages).toHaveLength(1); // the original, real failed stage

    await recoverStuckQueuedMission(reApproved.id, { now: new Date(Date.parse(reApproved.updated_at) + 3 * 60 * 1000) });

    const afterActivity = await listActivity(created.id);
    // Compare by id rather than array position: listActivity orders by
    // created_at with no tiebreaker, so rows inserted within the same
    // millisecond (as several of these synchronous test steps are) have no
    // guaranteed stable relative order across two separate queries — a
    // pre-existing property of listActivity, not something this test
    // should assert on. What actually matters (nothing rewritten or
    // deleted) is fully proven by id-keyed equality instead.
    const beforeById = new Map(beforeActivity.map((a) => [a.id, a]));
    for (const row of beforeById.values()) {
      expect(afterActivity.find((a) => a.id === row.id)).toEqual(row);
    }
    expect(afterActivity).toHaveLength(beforeActivity.length + 1);
    const added = afterActivity.find((a) => !beforeById.has(a.id));
    expect(added?.action).toBe("queued_dispatch_recovered");
    expect(await listAssignments(created.id)).toEqual(beforeAssignments);
    expect(await listStages(created.id)).toEqual(beforeStages);
    expect(afterActivity.some((a) => a.action === "research_failed")).toBe(true); // the real failure is still on record
  });

  it("4. a subsequent founder approval after recovery generates a fresh, distinct event id", async () => {
    const { recoverStuckQueuedMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const inngestModule = await import("@/lib/inngest/client");
    const stuck = await createStuckQueuedMission("Stuck 4");
    const firstSend = vi.mocked(inngestModule.inngest.send).mock.calls.find(([e]: any) => e.name === "mission/approved")![0] as any;

    await recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 3 * 60 * 1000) });
    const reApproved = await approveMission(stuck.id, founderId);

    const sends = vi.mocked(inngestModule.inngest.send).mock.calls.map(([e]: any) => e).filter((e: any) => e.name === "mission/approved");
    expect(sends).toHaveLength(2);
    expect(sends[1]!.id).not.toBe(firstSend.id);
    expect(sends[1]!.id).toBe(`mission-approved-${stuck.id}-${reApproved.updated_at}`);
  });

  it("5. the Scout pipeline can start normally after a recovered-and-re-approved mission", async () => {
    const { recoverStuckQueuedMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });
    const stuck = await createStuckQueuedMission("Stuck 5");

    await recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 3 * 60 * 1000) });
    await approveMission(stuck.id, founderId);
    const settled = await runScoutPipeline(stuck.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(1);
  });

  it("6. no duplicate Scout assignment after recovery, re-approval and a real pipeline run", async () => {
    const { recoverStuckQueuedMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const { getAgentByKey } = await import("@/lib/db/repositories");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });
    const stuck = await createStuckQueuedMission("Stuck 6");
    // A first dispatch DID reach the job before it got "stuck" in a later
    // sense would be unusual, but the realistic case (matching Acceptance
    // 5) is: an earlier failed attempt already created the assignment.
    const scout = (await getAgentByKey("scout"))!;

    await recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 3 * 60 * 1000) });
    await approveMission(stuck.id, founderId);
    await runScoutPipeline(stuck.id);

    const assignments = await listAssignments(stuck.id);
    expect(assignments.filter((a) => a.agent_id === scout.id)).toHaveLength(1);
  });

  it("7. normal healthy first-run behavior is unaffected: a fresh approval that dispatches promptly is untouched", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });
    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Healthy run", brief: "A completely normal mission." });
    const approved = await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect((await listActivity(created.id)).some((a) => a.action === "queued_dispatch_recovered")).toBe(false);
    expect(approved.state).toBe("queued");
  });

  it("8a. refuses a mission that has NOT been stuck long enough — protects a legitimately pending dispatch", async () => {
    const { recoverStuckQueuedMission, MissionNotStuckError } = await import("@/lib/domain/missionWorkflow");
    const stuck = await createStuckQueuedMission("Not stuck yet");

    await expect(
      recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 5 * 1000) }),
    ).rejects.toBeInstanceOf(MissionNotStuckError);

    const mission = await getMission(stuck.id);
    expect(mission?.state).toBe("queued"); // untouched
  });

  it("8b. refuses to recover a mission whose dispatch genuinely worked in the meantime (researching)", async () => {
    const { recoverStuckQueuedMission } = await import("@/lib/domain/missionWorkflow");
    const { MissionConcurrencyError: MCE } = await import("@/lib/domain/missionStates");
    const stuck = await createStuckQueuedMission("Actually working");
    await transitionMissionState(stuck.id, ["queued"], "researching", { research_pass_count: 1 });

    // The function reads the mission fresh, so it already sees "researching"
    // and refuses structurally (IllegalMissionTransitionError) before the
    // atomic write is even attempted — a stronger, earlier guarantee than
    // the write-time MissionConcurrencyError race check, which only
    // matters for a read-then-write gap this single-threaded test can't
    // construct against the public API. Either way: never yanked backwards.
    let caught: unknown;
    try {
      await recoverStuckQueuedMission(stuck.id, { now: new Date(Date.parse(stuck.updated_at) + 3 * 60 * 1000) });
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("IllegalMissionTransitionError");
    void MCE;
  });

  it("8c. still refuses recovery from any state other than queued (structural rejection)", async () => {
    const { recoverStuckQueuedMission } = await import("@/lib/domain/missionWorkflow");
    const { createAndSubmitMission } = await import("@/lib/domain/missionWorkflow");
    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Never queued", brief: "A mission still in draft/awaiting approval." });

    // assertTransition itself must reject queued->awaiting_founder_approval
    // being attempted from a state that was never "queued" in the first
    // place — draft has no such edge in ALLOWED_TRANSITIONS at all except
    // via "queued", so this exercises assertTransition's own structural
    // check (IllegalMissionTransitionError), not just the staleness gate.
    let caught: unknown;
    try {
      await recoverStuckQueuedMission(created.id, { now: new Date(Date.now() + 10 * 60 * 1000) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("IllegalMissionTransitionError");
  });
});

describe("production_recommendation inconsistency — preserved research, no fabrication, no rejection", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
    founderId = (await listFounders())[0]!.id;
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockReset();
  });

  it("a report whose prose recommends production without production_recommendation is DELIVERED, not rejected — the real paid research is preserved", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      recommended_next_action: "Produce one pilot ~30-second video and post it to TikTok and YouTube Shorts.",
    });
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report,
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.02 },
      evidence: [{ sourceUrl: "https://example.com/a", sourceTitle: "A", sourceDate: "2026-01-01", snippet: "s", isVerifiedFact: true }],
    });

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Viral short", brief: "Find one strong short-form video opportunity." });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    expect(settled.state).toBe("ready_for_founders_review");
    expect(settled.failure_reason).toBeNull();
    const deliverables = await listDeliverables(created.id);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.content).toEqual(report); // byte-for-byte, nothing added/removed
    expect(await listEvidence(created.id)).toHaveLength(1); // real evidence preserved too
  });

  it("records the real production_recommendation_inconsistent activity flag, never fabricating the missing object", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({
        verdict: "ready_for_founders_review",
        verdict_rationale: "The evidence is strong enough to recommend a pilot.",
      }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.02 },
      evidence: [],
    });

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Viral short 2", brief: "Find one strong short-form video opportunity." });
    await approveMission(created.id, founderId);
    const settled = await runScoutPipeline(created.id);

    const flagged = (await listActivity(created.id)).find((a) => a.action === "production_recommendation_inconsistent");
    expect(flagged).toBeTruthy();
    expect(flagged?.detail).toMatch(/recommend a pilot/i);
    expect(flagged?.detail).toMatch(/research itself is unaffected and preserved/i);

    // Never fabricated downstream.
    const deliverable = (await listDeliverables(created.id))[0];
    expect((deliverable?.content as { production_recommendation?: unknown }).production_recommendation).toBeUndefined();

    // The mission stayed exactly ready_for_founders_review — no new state, no
    // silent conversion into (or away from) production.
    expect(settled.state).toBe("ready_for_founders_review");
  });

  it("no flag at all when the report genuinely has nothing inconsistent (normal path unaffected)", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({ verdict: "ready_for_founders_review" }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.02 },
      evidence: [],
    });

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Clean run", brief: "A normal mission." });
    await approveMission(created.id, founderId);
    await runScoutPipeline(created.id);

    expect((await listActivity(created.id)).some((a) => a.action === "production_recommendation_inconsistent")).toBe(false);
  });

  it("a report WITH a valid production_recommendation is never flagged, even if its prose also uses directive language", async () => {
    const { createAndSubmitMission, approveMission, runScoutPipeline } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValueOnce({
      report: makeScoutReport({
        verdict: "ready_for_founders_review",
        recommended_next_action: "Produce one pilot video immediately.",
        production_recommendation: makeProductionRecommendation(),
      }),
      usage: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 400, usdCost: 0.02 },
      evidence: [],
    });

    const created = await createAndSubmitMission({ founderId, projectId: null, title: "Real recommendation", brief: "A mission with a genuine recommendation." });
    await approveMission(created.id, founderId);
    await runScoutPipeline(created.id);

    expect((await listActivity(created.id)).some((a) => a.action === "production_recommendation_inconsistent")).toBe(false);
  });
});
