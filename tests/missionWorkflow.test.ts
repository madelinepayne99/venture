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
  getMission,
  createMission,
  transitionMissionState,
} from "@/lib/db/repositories";
import { makeScoutReport } from "./testUtils";

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

describe("mission workflow", () => {
  let founderId: string;

  beforeEach(async () => {
    resetDbForTests();
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
    founderId = listFounders()[0]!.id;
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockReset();
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
  });

  it("rejects an invalid mission before it ever reaches the database", async () => {
    const { createAndSubmitMission, MissionValidationError } = await import(
      "@/lib/domain/missionWorkflow"
    );
    await expect(
      createAndSubmitMission({ founderId, projectId: null, title: "", brief: "" }),
    ).rejects.toBeInstanceOf(MissionValidationError);
  });

  it("runs Scout only after explicit founder approval, and records the full trail", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
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

    const approved = await approveMission(created.id, founderId);

    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(1);
    expect(approved.state).toBe("ready_for_founders_review");
    expect(approved.final_status).toBe("ready_for_founders_review");
    expect(approved.interpreted_mission).toBe(report.interpreted_mission);

    expect(listDeliverables(created.id)).toHaveLength(1);
    expect(listEvidence(created.id)).toHaveLength(1);
    expect(listCosts(created.id)).toHaveLength(1);

    const actions = listActivity(created.id).map((a) => a.action);
    expect(actions).toContain("mission_created");
    expect(actions).toContain("mission_approved");
    expect(actions).toContain("research_completed");
  });

  it("moves a mission to awaiting_evidence when Scout's evidence is too weak to decide", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
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
    const approved = await approveMission(created.id, founderId);

    expect(approved.state).toBe("awaiting_evidence");
  });

  it("rejects a mission outright when Scout concludes it isn't worth pursuing", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
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
    const approved = await approveMission(created.id, founderId);

    expect(approved.state).toBe("rejected");
  });

  it("marks a mission failed — never fabricates a ready state — when Scout errors after real token usage, and still records its cost", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
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
    const approved = await approveMission(created.id, founderId);

    expect(approved.state).toBe("failed");
    expect(approved.failure_reason).toMatch(/not valid JSON/);
    expect(listCosts(created.id)).toHaveLength(1);
    expect(listCosts(created.id)[0]?.usd_cost).toBeGreaterThan(0);
    expect(listDeliverables(created.id)).toHaveLength(0);
  });

  it("settles a mission as failed even when the spent tokens can't be priced, preserving the real failure reason and never inventing a cost", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
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
    const settled = await approveMission(created.id, founderId);

    // Never stuck in researching, and the ORIGINAL failure reason survives
    // — not a pricing error swallowing it.
    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toMatch(/missing field 'verdict'/);

    const costs = listCosts(created.id);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.input_tokens).toBe(640);
    expect(costs[0]?.output_tokens).toBe(120);
    expect(costs[0]?.usd_cost).toBeNull();

    // An unknown dollar amount must never appear in the ledger as an
    // invented $0 (or any other) charge.
    const entries = listLedgerEntries().filter((e) => e.mission_id === created.id);
    expect(entries).toHaveLength(0);
  });

  it("never revives a mission the founder cancelled while Scout was still researching, but still records the real cost", async () => {
    const { createAndSubmitMission, approveMission, cancelMission } = await import(
      "@/lib/domain/missionWorkflow"
    );
    const scoutModule = await import("@/lib/agents/scout");
    const usage = { model: "claude-sonnet-5", inputTokens: 1100, outputTokens: 400, usdCost: 0.0069 };

    vi.mocked(scoutModule.runScoutResearch).mockImplementation(async (mission) => {
      // By the time this mock runs, the real workflow has already flipped
      // the mission to "researching" — simulate a concurrent cancel
      // request landing while Scout is still "in flight" for it, using the
      // exact same code path a real second HTTP request would use.
      expect(getMission(mission.id)?.state).toBe("researching");
      await cancelMission(mission.id, founderId, "Changed my mind mid-research.");
      return { report: makeScoutReport(), usage, evidence: [] };
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Cancelled mid-research",
      brief: "A mission the founder cancels while Scout is still working on it.",
    });

    const settled = await approveMission(created.id, founderId);

    expect(settled.state).toBe("cancelled");
    expect(getMission(created.id)?.state).toBe("cancelled");

    // The API cost was genuinely incurred and must still be recorded...
    const costs = listCosts(created.id);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.usd_cost).toBeCloseTo(usage.usdCost, 6);

    // ...but the report itself must never be applied to a cancelled mission.
    expect(listDeliverables(created.id)).toHaveLength(0);
    expect(listEvidence(created.id)).toHaveLength(0);

    const actions = listActivity(created.id).map((a) => a.action);
    expect(actions).toContain("mission_cancelled");
    expect(actions).toContain("research_discarded_after_state_change");
    expect(actions).not.toContain("research_completed");
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
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

    const mission = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Auto-approved mission",
      brief: "This mission should skip the manual approval click.",
    });

    expect(mission.state).toBe("ready_for_founders_review");
    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(1);
    process.env.REQUIRE_FOUNDER_APPROVAL = "true";
  });

  it("cannot approve a mission that was never submitted for approval", async () => {
    const { approveMission } = await import("@/lib/domain/missionWorkflow");
    await expect(approveMission("does-not-exist", founderId)).rejects.toThrow(/not found/);
  });

  it("enforces the approval gate — a mission still in draft cannot be approved directly", async () => {
    const { approveMission } = await import("@/lib/domain/missionWorkflow");
    const { IllegalMissionTransitionError } = await import("@/lib/domain/missionStates");

    // Bypass the workflow to land a mission in "draft" (the workflow itself
    // never leaves one there), simulating any caller that skips the gate.
    const draftMission = createMission({
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

  it("refuses a repeated approval attempt once a mission has already moved on", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Approve me once",
      brief: "A mission that should refuse a second approval attempt.",
    });
    const first = await approveMission(created.id, founderId);
    expect(first.state).toBe("ready_for_founders_review");

    await expect(approveMission(created.id, founderId)).rejects.toThrow();

    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(1);
    expect(listCosts(created.id)).toHaveLength(1);
    expect(listLedgerEntries().filter((e) => e.mission_id === created.id)).toHaveLength(1);
  });

  it("prevents a genuinely concurrent double-approval from running Scout twice or charging the ledger twice", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const { MissionConcurrencyError, IllegalMissionTransitionError } = await import(
      "@/lib/domain/missionStates"
    );
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 200, usdCost: 0.003 },
      evidence: [],
    });

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

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Whichever guard caught the loser — the in-memory state-machine check
    // (today, safe only because better-sqlite3 is synchronous) or the
    // atomic conditional database update (the guarantee that will still
    // hold once the database is asynchronous) — it must be one of these
    // two, never a silent double success.
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      reason instanceof MissionConcurrencyError || reason instanceof IllegalMissionTransitionError,
    ).toBe(true);

    expect(scoutModule.runScoutResearch).toHaveBeenCalledTimes(1);
    expect(listCosts(created.id)).toHaveLength(1);
    expect(listLedgerEntries().filter((e) => e.mission_id === created.id)).toHaveLength(1);
  });

  it("transitionMissionState lets only one of two racing conditional updates for the same fromState succeed", async () => {
    const mission = createMission({
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
    // Both callers see the same, final, correct state regardless of which
    // one actually performed the write.
    expect(a.mission.state).toBe("awaiting_founder_approval");
    expect(b.mission.state).toBe("awaiting_founder_approval");
  });

  it("records every dollar spent into the shared ledger, as an expense", async () => {
    const { createAndSubmitMission, approveMission } = await import("@/lib/domain/missionWorkflow");
    const scoutModule = await import("@/lib/agents/scout");
    vi.mocked(scoutModule.runScoutResearch).mockResolvedValue({
      report: makeScoutReport(),
      usage: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 500, usdCost: 0.007 },
      evidence: [],
    });

    const before = ledgerTotalUsd();
    const created = await createAndSubmitMission({
      founderId,
      projectId: null,
      title: "Ledger check",
      brief: "Confirm this mission's cost lands in the shared business ledger.",
    });
    await approveMission(created.id, founderId);
    const after = ledgerTotalUsd();

    expect(after).toBeLessThan(before);
    const entries = listLedgerEntries();
    expect(entries[0]?.amount_usd).toBeLessThan(0);
  });
});
