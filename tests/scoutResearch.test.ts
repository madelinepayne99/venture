import { describe, expect, it } from "vitest";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import { findGuaranteeLanguage, findProductionRecommendationInconsistency } from "@/lib/agents/scout/guardrails";
import type { Mission } from "@/lib/db/types";
import {
  fakeAnthropicClient,
  fakeAnthropicClientWithCalls,
  fakeAnthropicMessage,
  makeScoutReport,
  makeServiceBusinessReport,
  makeProductionRecommendation,
} from "./testUtils";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    project_id: null,
    founder_id: "founder-1",
    organization_id: null,
    title: "Preschool counting worksheets",
    brief: "Research demand for printable counting worksheets for 3-5 year olds on Etsy.",
    interpreted_mission: null,
    state: "researching",
    final_status: null,
    failure_reason: null,
    research_pass_count: 1,
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

  it("rejects a report outright when it contains guaranteed-outcome language, rather than delivering it with a self-warning", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      evidence_of_demand: "This product is guaranteed to sell well on Etsy.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScoutResearchError);
    const scoutError = caught as ScoutResearchError;
    expect(scoutError.message).toMatch(/prohibited certainty language/i);
    expect(scoutError.message).toMatch(/evidence_of_demand/);
    // The real cost is still recorded even though the report was rejected.
    expect(scoutError.usage.inputTokens).toBeGreaterThan(0);
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

  it("downgrades ready_for_founders_review to investigate_further when there are zero sources and zero verified facts", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      sources: [],
      verified_facts: [],
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("investigate_further");
    expect(outcome.report.unresolved_questions.some((q) => q.includes("dated source"))).toBe(true);
  });

  it("downgrades ready_for_founders_review when there are sources but zero verified facts", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      verified_facts: [],
      // sources present, but nothing cites them as a verified fact
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("investigate_further");
  });

  it("downgrades ready_for_founders_review when a verified fact cites a source that was never listed", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      sources: [],
      verified_facts: [{ statement: "Some claim.", source_url: "https://example.com/never-listed" }],
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("investigate_further");
  });

  it("does not require more than one authoritative, dated source to keep a ready_for_founders_review verdict", async () => {
    // makeScoutReport()'s default already has exactly one verified fact
    // backed by exactly one dated source — this must be enough on its own.
    const report = makeScoutReport({ verdict: "ready_for_founders_review" });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
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

describe("runScoutResearch — truncation and bounded recovery", () => {
  function truncatedResponse(text = '{"interpreted_mission": "truncated mid-wa') {
    return fakeAnthropicMessage(null, {
      stop_reason: "max_tokens",
      content: [{ type: "text", text, citations: null }],
    });
  }

  it("treats a cut-off report as recoverable rather than an immediate failure, and completes via one bounded compact retry", async () => {
    const report = makeScoutReport();
    const { client, calls } = fakeAnthropicClientWithCalls([
      truncatedResponse(),
      fakeAnthropicMessage(report), // the compact retry succeeds
    ]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    // Exactly one extra call was made — the original attempt plus one
    // bounded recovery, never more.
    expect(calls).toHaveLength(2);
    // Real cost from BOTH calls is recorded, not just the successful one.
    expect(outcome.usage.inputTokens).toBe(2000);
    expect(outcome.usage.outputTokens).toBe(1000);
    expect(outcome.usage.usdCost).toBeGreaterThan(0);
  });

  it("keeps the recovery call tightly bounded — no tools, so it can never trigger new search spend", async () => {
    const report = makeScoutReport();
    const { client, calls } = fakeAnthropicClientWithCalls([
      truncatedResponse(),
      fakeAnthropicMessage(report),
    ]);

    await runScoutResearch(makeMission(), { client });

    expect(calls).toHaveLength(2);
    const recoveryCall = calls[1] as Record<string, unknown>;
    expect(recoveryCall.tools).toBeUndefined();
    expect(recoveryCall.max_tokens).toBeTypeOf("number");
    expect(recoveryCall.thinking).toEqual({ type: "disabled" });
  });

  it("throws a clear, distinct error when the compact retry is also cut off, while still recording all real spend from both attempts", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([
      truncatedResponse('{"interpreted_mission": "still truncated'),
      truncatedResponse('{"interpreted_mission": "truncated again'),
    ]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScoutResearchError);
    const scoutError = caught as ScoutResearchError;
    expect(scoutError.message).toMatch(/cut off again/i);
    expect(calls).toHaveLength(2); // never loops past the one bounded retry
    expect(scoutError.usage.inputTokens).toBe(2000);
    expect(scoutError.usage.outputTokens).toBe(1000);
  });

  it("never attempts a second recovery — a non-truncation failure on the compact retry still fails cleanly", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([
      truncatedResponse(),
      fakeAnthropicMessage(null, { stop_reason: "refusal", content: [] }),
    ]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScoutResearchError);
    expect((caught as ScoutResearchError).message).toMatch(/declined to complete the compact retry/i);
    expect(calls).toHaveLength(2);
    // Both calls' real usage is still recorded even though the run failed.
    expect((caught as ScoutResearchError).usage.inputTokens).toBe(2000);
  });
});

describe("runScoutResearch — turn ended without a report (live pass-2 failure class)", () => {
  // Live regression: a real follow-up pass ended its turn after searching
  // having written prose (874 output tokens for the whole pass, no report),
  // and the mission failed as "not valid JSON", discarding the research.
  function proseOnlyResponse() {
    return fakeAnthropicMessage(null, {
      content: [
        { type: "text", text: "I've now completed my searches and have a clear picture of the gaps.", citations: null },
      ],
    });
  }

  it("sends exactly one same-conversation format nudge and accepts the report it yields, with combined usage", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([
      proseOnlyResponse(),
      fakeAnthropicMessage(makeScoutReport()),
    ]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(calls).toHaveLength(2);
    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    expect(outcome.usage.inputTokens).toBe(2000);
    expect(outcome.usage.outputTokens).toBe(1000);

    const second = calls[1] as { messages: Array<{ role: string; content: unknown }>; tools?: unknown };
    const last = second.messages.at(-1);
    expect(last?.role).toBe("user");
    expect(JSON.stringify(last?.content)).toMatch(/did not deliver the report/i);
    expect(JSON.stringify(last?.content)).toMatch(/submit_scout_report/);
    // The model's own prior turn (with its research) stays in context.
    expect(second.messages.at(-2)?.role).toBe("assistant");
    // Same request shape as the main loop — tools still declared.
    expect(second.tools).toBeTruthy();
  });

  it("is bounded: a second non-report still fails loudly after exactly one nudge, recording both calls' spend", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([proseOnlyResponse(), proseOnlyResponse(), proseOnlyResponse()]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }

    expect(calls).toHaveLength(2);
    expect(caught).toBeInstanceOf(ScoutResearchError);
    expect((caught as ScoutResearchError).message).toMatch(/not valid JSON/i);
    expect((caught as ScoutResearchError).usage.inputTokens).toBe(2000);
  });

  it("does not nudge when the first response already parses (no extra spend on the happy path)", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(makeScoutReport())]);
    await runScoutResearch(makeMission(), { client });
    expect(calls).toHaveLength(1);
  });

  it("still applies schema validation to the nudged report (the nudge does not loosen validation)", async () => {
    const client = fakeAnthropicClient([proseOnlyResponse(), fakeAnthropicMessage({ interpreted_mission: "only this" })]);
    await expect(runScoutResearch(makeMission(), { client })).rejects.toThrow(/structural validation/i);
  });
});

describe("runScoutResearch — JSON extraction robustness", () => {
  // A live mission failed with "Scout's report was not valid JSON." because
  // a real response can come back as clean JSON, JSON inside a Markdown
  // code fence, or JSON with a short sentence of prose around it — these
  // four cases lock in that extraction handles all of them, and still
  // rejects genuinely malformed output rather than accepting it.

  it("parses clean JSON with nothing else in the response", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        content: [{ type: "text", text: JSON.stringify(report), citations: null }],
      }),
    ]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    expect(outcome.report.interpreted_mission).toBe(report.interpreted_mission);
  });

  it("parses JSON wrapped in a ```json Markdown code fence", async () => {
    const report = makeScoutReport();
    const fenced = "```json\n" + JSON.stringify(report, null, 2) + "\n```";
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        content: [{ type: "text", text: fenced, citations: null }],
      }),
    ]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    expect(outcome.report.interpreted_mission).toBe(report.interpreted_mission);
  });

  it("parses JSON surrounded by short explanatory text, with no fence", async () => {
    const report = makeScoutReport();
    const surrounded =
      "Here is my research report:\n\n" +
      JSON.stringify(report) +
      "\n\nLet me know if you'd like me to look into anything else.";
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        content: [{ type: "text", text: surrounded, citations: null }],
      }),
    ]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    expect(outcome.report.interpreted_mission).toBe(report.interpreted_mission);
  });

  it("still throws a clear error for genuinely invalid output, rather than accepting garbage", async () => {
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        content: [
          {
            type: "text",
            text: "I wasn't able to complete this research — here's what I found, in no particular structure: demand seems moderate but I don't have a clean report to give you.",
            citations: null,
          },
        ],
      }),
    ]);

    await expect(runScoutResearch(makeMission(), { client })).rejects.toThrow(
      /not valid JSON/i,
    );

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScoutResearchError);
    expect((caught as ScoutResearchError).usage.inputTokens).toBeGreaterThan(0);
  });

  it("still rejects a fenced, well-formed JSON object that fails schema validation", async () => {
    const incomplete = { interpreted_mission: "incomplete report" };
    const fenced = "```json\n" + JSON.stringify(incomplete) + "\n```";
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, {
        content: [{ type: "text", text: fenced, citations: null }],
      }),
    ]);

    await expect(runScoutResearch(makeMission(), { client })).rejects.toThrow(
      /failed structural validation/i,
    );
  });
});

describe("runScoutResearch — workspace-aware reports", () => {
  it("defaults to a Commerce report when no workspaceType is given (backward compatible)", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.workspace_type).toBe("commerce");
    if (outcome.report.workspace_type === "commerce") {
      expect(outcome.report.platform_suitability.etsy_downloads).toBeTruthy();
    }
  });

  it("returns a Service Business report shape when workspaceType is service_business, with no Etsy/KDP fields forced in", async () => {
    const report = makeServiceBusinessReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client, workspaceType: "service_business" });

    expect(outcome.report.workspace_type).toBe("service_business");
    if (outcome.report.workspace_type === "service_business") {
      expect(outcome.report.service_delivery_considerations).toBeTruthy();
      expect(outcome.report.regulatory_and_compliance_notes[0]?.source_quality).toBe("primary_regulator");
      // TypeScript already proves platform_suitability/etc. don't exist on
      // this variant — this is the runtime half of that same guarantee.
      expect(outcome.report).not.toHaveProperty("platform_suitability");
      expect(outcome.report).not.toHaveProperty("copyright_trademark_concerns");
    }
  });

  it("throws when the model returns the wrong workspace shape for the mission it was asked to research", async () => {
    // Asked for service_business, but the model answered with a fully
    // valid Commerce report — this must fail loudly, not render as if it
    // were the requested workspace's report.
    const report = makeScoutReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    await expect(
      runScoutResearch(makeMission(), { client, workspaceType: "service_business" }),
    ).rejects.toThrow(/wrong workspace type/i);
  });

  it("rejects a Service Business report containing guarantee language in its workspace-specific fields", async () => {
    const report = makeServiceBusinessReport({
      verdict: "ready_for_founders_review",
      client_retention_or_acquisition_gaps: "This loyalty scheme is guaranteed to retain clients.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    await expect(
      runScoutResearch(makeMission(), { client, workspaceType: "service_business" }),
    ).rejects.toThrow(/prohibited certainty language/i);
  });

  it("applies the same structural evidence guardrail to Service Business reports as Commerce ones", async () => {
    const report = makeServiceBusinessReport({
      verdict: "ready_for_founders_review",
      sources: [],
      verified_facts: [],
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client, workspaceType: "service_business" });

    expect(outcome.report.verdict).toBe("investigate_further");
    expect(outcome.report.unresolved_questions.some((q) => q.includes("dated source"))).toBe(true);
  });
});

describe("findGuaranteeLanguage — complete coverage across the discriminated union", () => {
  // A live Service Business report actually produced this exact sentence
  // inside its unresolved_questions, because the old guardrail caught the
  // violation but then delivered the report anyway with its own
  // meta-commentary embedded in it — including the prohibited word,
  // quoted back:
  const LIVE_SELF_WARNING_PHRASE =
    "Safety guardrail: 'guaranteed' in evidence_of_demand reads as a certainty claim about " +
    "demand/revenue/profit — verify manually before trusting this section.";

  it("never lets a completed report contain that exact self-warning sentence — the mission fails instead", async () => {
    const report = makeScoutReport({ evidence_of_demand: "Demand for this is guaranteed." });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScoutResearchError);
    // No report was ever returned to check — that's the point — but make
    // the intent explicit: this phrase must not exist in the source at
    // all anymore (it was the literal template for the old self-warning).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib", "agents", "scout", "index.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/reads as a certainty claim/);
    void LIVE_SELF_WARNING_PHRASE; // documents the exact live phrase this test guards against
  });

  it("catches guarantee language in previously-unscanned Commerce core fields (competition_observations, verified_facts, inferences, unresolved_questions, recommended_next_action)", async () => {
    const cases: Array<[string, Partial<ReturnType<typeof makeScoutReport>>]> = [
      ["competition_observations", { competition_observations: "Competitors are guaranteed to lose share." }],
      [
        "verified_facts",
        { verified_facts: [{ statement: "This is a guaranteed best-seller.", source_url: null }] },
      ],
      ["inferences", { inferences: ["This will be a guaranteed hit."] }],
      ["unresolved_questions", { unresolved_questions: ["Is the guaranteed 100% success rate real?"] }],
      ["recommended_next_action", { recommended_next_action: "Proceed — sales are guaranteed." }],
      ["research_questions", { research_questions: ["Is demand truly guaranteed here?"] }],
      ["potential_customer", { potential_customer: "Buyers guaranteed to convert." }],
      ["important_risks", { important_risks: ["None — success is guaranteed."] }],
    ];

    for (const [label, overrides] of cases) {
      const report = makeScoutReport(overrides);
      const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

      await expect(
        runScoutResearch(makeMission(), { client }),
        `expected a rejection for guarantee language in ${label}`,
      ).rejects.toThrow(/prohibited certainty language/i);
    }
  });

  it("catches guarantee language in previously-unscanned Commerce-only variant fields", async () => {
    const cases: Array<[string, Partial<ReturnType<typeof makeScoutReport>>]> = [
      [
        "platform_suitability.etsy_downloads",
        {
          platform_suitability: {
            etsy_downloads: "Guaranteed to rank on page one.",
            amazon_kdp_print_on_demand: "Fine.",
            other_notes: null,
          },
        },
      ],
      ["copyright_trademark_concerns", { copyright_trademark_concerns: ["Guaranteed to be clear of any claim."] }],
      [
        "likely_costs.breakdown",
        { likely_costs: { estimate: "Low.", breakdown: ["Guaranteed low design cost."] } },
      ],
      [
        "estimated_production_difficulty.rationale",
        {
          estimated_production_difficulty: {
            level: "low",
            rationale: "Guaranteed to be simple to produce.",
          },
        },
      ],
    ];

    for (const [label, overrides] of cases) {
      const report = makeScoutReport(overrides);
      const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

      await expect(
        runScoutResearch(makeMission(), { client }),
        `expected a rejection for guarantee language in ${label}`,
      ).rejects.toThrow(/prohibited certainty language/i);
    }
  });

  it("catches guarantee language in previously-unscanned Service Business variant fields", async () => {
    const cases: Array<[string, Partial<ReturnType<typeof makeServiceBusinessReport>>]> = [
      [
        "regulatory_and_compliance_notes",
        {
          regulatory_and_compliance_notes: [
            { note: "Compliance is guaranteed under current rules.", source_url: null, source_quality: "secondary" },
          ],
        },
      ],
      [
        "pricing_or_service_model_considerations.considerations",
        {
          pricing_or_service_model_considerations: {
            summary: "Reasonable.",
            considerations: ["Guaranteed to reduce no-shows."],
          },
        },
      ],
      ["service_delivery_considerations", { service_delivery_considerations: "Guaranteed to fit current staffing." }],
    ];

    for (const [label, overrides] of cases) {
      const report = makeServiceBusinessReport(overrides);
      const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

      await expect(
        runScoutResearch(makeMission(), { client, workspaceType: "service_business" }),
        `expected a rejection for guarantee language in ${label}`,
      ).rejects.toThrow(/prohibited certainty language/i);
    }
  });

  it("still allows hedged, cautious language through untouched — no false positives", async () => {
    const report = makeScoutReport({
      evidence_of_demand: "Evidence suggests moderate interest, though this could change and cannot be confirmed.",
      competition_observations: "Competitors may be established, but this is not certain.",
      inferences: ["This category might reward variants, based on limited data."],
      recommended_next_action: "This could plausibly proceed to founders' review.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(outcome.report.verdict).toBe("ready_for_founders_review");
  });

  it("keeps facts and inferences structurally separate — this fix does not blur that distinction", async () => {
    const report = makeScoutReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    const factStatements = outcome.report.verified_facts.map((f) => f.statement);
    expect(factStatements).not.toContain(outcome.report.inferences[0]);
  });
});

describe("runScoutResearch — targeted follow-up pass (two-pass evidence loop)", () => {
  const followupContext = {
    passNumber: 2,
    maxPasses: 2,
    priorVerdictRationale: "Only one weak source was found for real demand.",
    unresolvedQuestions: [
      "Is there genuine monthly search volume for this term?",
      "Do any competitors actually have verified sales?",
    ],
    priorVerifiedFacts: [
      { statement: "Etsy allows digital downloads in this category.", source_url: "https://example.com/etsy-trends" },
    ],
    priorSources: [{ url: "https://example.com/etsy-trends", title: "Etsy seller trends report" }],
  };

  it("sends a user prompt that includes the prior rationale and every unresolved question verbatim", async () => {
    const report = makeScoutReport({ verdict: "ready_for_founders_review" });
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(report)]);

    await runScoutResearch(makeMission({ research_pass_count: 2 }), { client, followupContext });

    const sentPrompt = (calls[0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(sentPrompt).toContain(followupContext.priorVerdictRationale);
    for (const question of followupContext.unresolvedQuestions) {
      expect(sentPrompt).toContain(question);
    }
    expect(sentPrompt).toContain(followupContext.priorVerifiedFacts[0]!.statement);
    expect(sentPrompt).toContain(followupContext.priorSources[0]!.url);
  });

  it("explicitly frames the follow-up as targeted and non-repeating, not a fresh research job", async () => {
    const report = makeScoutReport({ verdict: "ready_for_founders_review" });
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(report)]);

    await runScoutResearch(makeMission({ research_pass_count: 2 }), { client, followupContext });

    const sentPrompt = (calls[0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(sentPrompt).toMatch(/targeted follow-up investigation/i);
    expect(sentPrompt).toMatch(/do not repeat the original broad research/i);
    expect(sentPrompt).toMatch(/last automated research pass/i);
  });

  it("omits the follow-up framing entirely when no followupContext is given (pass 1's prompt is unchanged)", async () => {
    const report = makeScoutReport();
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(report)]);

    await runScoutResearch(makeMission(), { client });

    const sentPrompt = (calls[0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(sentPrompt).not.toMatch(/targeted follow-up investigation/i);
  });

  it("applies the same guarantee-language guardrail to a follow-up report — no special-casing needed", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      evidence_of_demand: "This product is guaranteed to sell well now that the follow-up confirmed it.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    await expect(
      runScoutResearch(makeMission({ research_pass_count: 2 }), { client, followupContext }),
    ).rejects.toBeInstanceOf(ScoutResearchError);
  });

  it("applies the same structural evidence guardrail to a follow-up report — a ready verdict with no sourced fact still downgrades", async () => {
    const report = makeScoutReport({ verdict: "ready_for_founders_review", sources: [], verified_facts: [] });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission({ research_pass_count: 2 }), { client, followupContext });

    expect(outcome.report.verdict).toBe("investigate_further");
  });
});

describe("findGuaranteeLanguage — negation-aware (a real live false-positive rejection, fixed)", () => {
  // The live bug: a real $0.30 research call was rejected because
  // verdict_rationale contained "guaranteed" inside what was almost
  // certainly Scout's own honest hedge (rule 1 of its system prompt
  // requires exactly this) — the old scan couldn't tell a hedge from a
  // promise. These are direct unit tests against the validator itself
  // (not a full runScoutResearch round-trip) so every case is fast and
  // explicit about which field/sentence is being judged.

  function reportWith(field: Record<string, unknown>) {
    return makeScoutReport(field as Partial<ReturnType<typeof makeScoutReport>>);
  }

  describe("must still reject genuine certainty claims", () => {
    const genuineClaims = [
      "demand is guaranteed",
      "this is guaranteed to go viral",
      "this will definitely sell",
      "this is a risk-free opportunity",
      "profit is assured",
    ];

    it.each(genuineClaims)('rejects: "%s"', (claim) => {
      const report = reportWith({ verdict_rationale: `Based on the research, ${claim}.` });
      expect(findGuaranteeLanguage(report)).not.toHaveLength(0);
    });
  });

  describe("must now allow explicit hedges (the false-positive class this fixes)", () => {
    const hedges = [
      "success cannot be guaranteed",
      "there is no guarantee this will translate into views",
      "this is not risk-free",
      "no assured revenue exists",
    ];

    it.each(hedges)('allows: "%s"', (hedge) => {
      const report = reportWith({ verdict_rationale: `Based on the research, ${hedge}.` });
      expect(findGuaranteeLanguage(report)).toHaveLength(0);
    });

    it("the exact live failure class is no longer rejected: a hedge inside verdict_rationale", async () => {
      const report = makeScoutReport({
        verdict: "investigate_further",
        verdict_rationale:
          "The trend is real, but given the limited data, sustained virality cannot be guaranteed and further monitoring is recommended.",
      });
      const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);
      const outcome = await runScoutResearch(makeMission(), { client });
      expect(outcome.report.verdict).toBe("investigate_further");
    });
  });

  describe("adversarial: negation and a genuine certainty claim in the same sentence", () => {
    it("does NOT let a distant, unrelated negation shield a later, separate real claim", () => {
      const report = reportWith({
        verdict_rationale: "There is no reliable data yet, but demand is guaranteed.",
      });
      const violations = findGuaranteeLanguage(report);
      expect(violations.some((v) => v.matchedText.toLowerCase().includes("guarantee"))).toBe(true);
    });

    it('does NOT let "no doubt" (negation-shaped but not a real hedge) shield a genuine claim', () => {
      const report = reportWith({
        verdict_rationale: "No doubt, demand is guaranteed to grow next quarter.",
      });
      expect(findGuaranteeLanguage(report)).not.toHaveLength(0);
    });

    it('does NOT let an unrelated "not" earlier in a long sentence shield a later real claim about a DIFFERENT subject', () => {
      const report = reportWith({
        competition_observations:
          "Competitors have not published performance data, and separately, this format is guaranteed to outperform every alternative.",
      });
      expect(findGuaranteeLanguage(report)).not.toHaveLength(0);
    });

    it("DOES correctly allow a real hedge even when an earlier sentence in the same field made a claim about something else", () => {
      const report = reportWith({
        verdict_rationale:
          "The underlying format is popular and well-documented. Whether OUR specific execution succeeds cannot be guaranteed.",
      });
      // Two sentences: the first contains no banned language at all; the
      // second is a genuine hedge — the whole field must pass.
      expect(findGuaranteeLanguage(report)).toHaveLength(0);
    });
  });

  describe("the negation window boundary — proven with tests, not asserted as a fixed number", () => {
    it("allows a hedge whose negation sits within the local window (distance 1-2 words)", () => {
      const report = reportWith({ verdict_rationale: "Success here cannot be guaranteed given the evidence." });
      expect(findGuaranteeLanguage(report)).toHaveLength(0);
    });

    it("still rejects when a negation-shaped word sits just outside the local window, with unrelated content between it and the claim", () => {
      // "no" is present in the sentence but four content words away from
      // "guaranteed", separated by unrelated material — this must NOT be
      // treated as a hedge of the claim that follows.
      const report = reportWith({
        verdict_rationale: "There is no question that competitors are weak, and growth here is guaranteed.",
      });
      expect(findGuaranteeLanguage(report)).not.toHaveLength(0);
    });

    it("a verbose hedge whose negation word is far from the banned term is STILL rejected — documents a real, accepted limitation rather than hiding it", () => {
      // "cannot ... be guaranteed" with several words in between is a
      // legitimate hedge a model might write, but it falls outside the
      // deliberately narrow local window. This is the accepted tradeoff
      // (favoring never letting a real claim slip through over catching
      // every possible hedge phrasing) — documented here, not silently
      // broken.
      const report = reportWith({
        verdict_rationale: "This cannot, in the founders' own good conscience, be guaranteed to succeed.",
      });
      expect(findGuaranteeLanguage(report)).not.toHaveLength(0);
    });
  });

  it("complete-field coverage is preserved: a hedge is allowed in a previously-unscanned field too", () => {
    const report = reportWith({
      competition_observations: "Repeating a competitor's past success here cannot be guaranteed.",
    });
    expect(findGuaranteeLanguage(report)).toHaveLength(0);
  });

  it("complete-field coverage still catches a genuine claim in a previously-unscanned field", () => {
    const report = reportWith({
      unresolved_questions: ["Whether this specific execution is guaranteed to outperform the original trend."],
    });
    expect(findGuaranteeLanguage(report)).not.toHaveLength(0);
  });

  it("the widened assured-pattern catches the reversed word order too", () => {
    expect(findGuaranteeLanguage(reportWith({ verdict_rationale: "Profit is assured here." }))).not.toHaveLength(0);
    expect(findGuaranteeLanguage(reportWith({ verdict_rationale: "Assured profit is expected here." }))).not.toHaveLength(0);
  });
});

describe("findProductionRecommendationInconsistency — preserves valid research, never fabricates or rejects", () => {
  function reportWith(field: Record<string, unknown>) {
    return makeScoutReport(field as Partial<ReturnType<typeof makeScoutReport>>);
  }

  it("flags the exact real sentences from the live 'Find Our Next Viral Short' mission", () => {
    const report = reportWith({
      verdict: "ready_for_founders_review",
      verdict_rationale:
        "There is converging, multi-source evidence that this format is well-evidenced and original enough to recommend a pilot, with clear caveats flagged for the founders.",
      recommended_next_action:
        "Produce one pilot ~30-second video using the recommended concept, post it to both TikTok and YouTube Shorts, and measure completion rate/shares over 1-2 weeks before committing to a series.",
    });
    const violations = findProductionRecommendationInconsistency(report);
    expect(violations.map((v) => v.field).sort()).toEqual(["recommended_next_action", "verdict_rationale"]);
  });

  it("is a no-op whenever production_recommendation is present, whatever the prose says", () => {
    const withRecommendation = makeScoutReport({
      recommended_next_action: "Produce one pilot video immediately.",
      production_recommendation: makeProductionRecommendation(),
    });
    expect(findProductionRecommendationInconsistency(withRecommendation)).toHaveLength(0);
  });

  describe("genuinely hedged recommendations are allowed", () => {
    const hedges = [
      "If the founders choose to invest further, producing a pilot video could be reasonable.",
      "Before deciding whether to produce a video, further validation of demand is needed.",
      "Should the team decide to proceed, a pilot may be worthwhile once saturation is confirmed.",
      "Only after further validation should the founders consider producing this pilot video.",
    ];

    it.each(hedges)('allows: "%s"', (hedge) => {
      const report = reportWith({ recommended_next_action: hedge });
      expect(findProductionRecommendationInconsistency(report)).toHaveLength(0);
    });
  });

  describe("genuinely analytical (non-directive) next actions never trip this check", () => {
    const analytical = [
      "Run a targeted competitor search on Etsy and Amazon before any further decision.",
      "Investigate whether this micro-topic has independent view-count data.",
    ];

    it.each(analytical)('allows: "%s"', (text) => {
      const report = reportWith({ recommended_next_action: text, verdict: "investigate_further" });
      expect(findProductionRecommendationInconsistency(report)).toHaveLength(0);
    });
  });

  it("does not false-positive on unrelated words sharing a root (production/productive)", () => {
    const report = reportWith({
      verdict_rationale: "Production difficulty is low, and this is otherwise a productive avenue to explore.",
    });
    expect(findProductionRecommendationInconsistency(report)).toHaveLength(0);
  });

  it("does not false-positive on a Service-Business-style next action unrelated to video", () => {
    const report = reportWith({
      recommended_next_action: "Produce a one-page service menu for the front desk to test client reaction.",
    });
    expect(findProductionRecommendationInconsistency(report)).toHaveLength(0);
  });

  it("a trailing, later conditional in the same sentence does NOT retroactively excuse an earlier unconditional directive", () => {
    // The exact real shape: "Produce X... before committing to a series." The
    // later "before committing" governs a DIFFERENT, future decision (an
    // ongoing series), not the pilot production itself — proven by keeping
    // this flagged rather than excused.
    const report = reportWith({
      recommended_next_action:
        "Produce one pilot short-form video now, then decide before committing to a full series.",
    });
    expect(findProductionRecommendationInconsistency(report)).not.toHaveLength(0);
  });

  it("integration: runScoutResearch delivers the report as-is (never rejects, never fabricates a recommendation)", async () => {
    const report = makeScoutReport({
      verdict: "ready_for_founders_review",
      recommended_next_action: "Produce one pilot ~30-second video and post it to TikTok and YouTube Shorts.",
    });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runScoutResearch(makeMission(), { client });

    // Delivered, not thrown — the whole point of this fix.
    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    expect(outcome.report.recommended_next_action).toContain("Produce one pilot");
    // Never fabricated on Scout's behalf.
    expect(outcome.report.production_recommendation).toBeUndefined();
  });
});
