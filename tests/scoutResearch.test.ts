import { describe, expect, it } from "vitest";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import type { Mission } from "@/lib/db/types";
import { fakeAnthropicClient, fakeAnthropicMessage, makeScoutReport } from "./testUtils";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    project_id: null,
    founder_id: "founder-1",
    title: "Preschool counting worksheets",
    brief: "Research demand for printable counting worksheets for 3-5 year olds on Etsy.",
    interpreted_mission: null,
    state: "researching",
    final_status: null,
    failure_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("runScoutResearch — structured response", () => {
  it("returns a fully structured, schema-valid report", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.interpreted_mission).toBe(report.interpreted_mission);
    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    expect(outcome.report.sources.length).toBeGreaterThan(0);
    expect(outcome.usage.model).toBe("claude-sonnet-5");
    expect(outcome.usage.inputTokens).toBe(1000);
    expect(outcome.usage.outputTokens).toBe(500);
    expect(outcome.usage.usdCost).toBeGreaterThan(0);
  });

  it("separates verified facts from Scout's own inferences", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verified_facts[0]?.source_url).toBeTruthy();
    expect(outcome.report.inferences[0]).toMatch(/may reward/i);
    // Facts and inferences must never be the same array or overlap in content.
    const factStatements = outcome.report.verified_facts.map((f) => f.statement);
    expect(factStatements).not.toContain(outcome.report.inferences[0]);
  });

  it("produces evidence rows for both cited facts and consulted sources", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.evidence.some((e) => e.isVerifiedFact)).toBe(true);
  });

  it("downgrades a verdict and flags the report when it contains guaranteed-outcome language", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      evidence_of_demand: "This product is guaranteed to sell well on Etsy.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("investigate_further");
    expect(outcome.report.unresolved_questions.some((q) => q.includes("guardrail"))).toBe(true);
  });

  it("reports weak evidence as investigate_further with unresolved questions", async () => {
    const report = makeScoutReport({
      verdict: "investigate_further",
      sources: [],
      verified_facts: [],
      unresolved_questions: ["Could not find independent demand data for this niche."],
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("investigate_further");
    expect(outcome.report.unresolved_questions.length).toBeGreaterThan(0);
  });

  it("honors a reject verdict when Scout concludes the opportunity isn't worth pursuing", async () => {
    const report = makeScoutReport({
      verdict: "reject",
      verdict_rationale: "Market is saturated with near-identical free alternatives.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("reject");
  });

  it("resumes a paused turn instead of returning a truncated result", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(report, {
        stop_reason: "pause_turn",
        content: [{ type: "text", text: "", citations: null }],
      }),
      fakeAnthropicMessage(report),
    ]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    // Usage from both turns should be counted toward the cost ledger.
    expect(outcome.usage.inputTokens).toBe(2000);
  });
});

describe("runScoutResearch — failure handling", () => {
  it("throws with partial usage attached when the model response is not valid JSON", async () => {
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        content: [{ type: "text", text: "not json at all", citations: null }],
      }),
    ]);

    await expect(runScoutResearch(makeMission(), { client })).rejects.toBeInstanceOf(
      ScoutResearchError,
    );

    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      expect(error).toBeInstanceOf(ScoutResearchError);
      const scoutError = error as ScoutResearchError;
      expect(scoutError.usage.inputTokens).toBeGreaterThan(0);
    }
  });

  it("throws when the report fails schema validation (missing required fields)", async () => {
    const client = fakeAnthropicClient([
      fakeAnthropicMessage({ interpreted_mission: "incomplete report" }),
    ]);

    await expect(runScoutResearch(makeMission(), { client })).rejects.toBeInstanceOf(
      ScoutResearchError,
    );
  });

  it("throws a clear error when the model refuses", async () => {
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        stop_reason: "refusal",
        content: [],
      }),
    ]);

    await expect(runScoutResearch(makeMission(), { client })).rejects.toThrow(/declined/i);
  });
});
