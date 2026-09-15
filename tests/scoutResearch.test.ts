import { describe, expect, it } from "vitest";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import type { Mission } from "@/lib/db/types";
import {
  fakeAnthropicClient,
  fakeAnthropicClientWithCalls,
  fakeAnthropicMessage,
  makeScoutReport,
  makeServiceBusinessReport,
} from "./testUtils";

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
