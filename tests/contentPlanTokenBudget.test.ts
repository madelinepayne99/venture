import { describe, expect, it } from "vitest";
import { computeContentPlanMaxTokens, planContentVersion, ContentBotError } from "@/lib/agents/contentBot";
import { ContentPlanSchema } from "@/lib/agents/contentBot/schema";
import {
  makeContentPlan,
  makeCreativeStrategy,
  makeProductionBrief,
  makeAudienceContext,
  fakeAnthropicClientWithCalls,
  fakeAnthropicMessage,
} from "./testUtils";

// Regression coverage for the real Production ("YouTube kids") live
// failure: a legitimate ~22-beat, longer-form plan hit a flat 6,000-token
// ceiling and was truncated. computeContentPlanMaxTokens replaces that
// flat ceiling with a dynamic, bounded allowance derived from Creative
// Strategy's own real target_cut_count — never a platform/duration/
// content-type keyword.

describe("computeContentPlanMaxTokens — the formula itself", () => {
  it("a normal ~12-beat short retains approximately the existing 6,000-token allowance", () => {
    expect(computeContentPlanMaxTokens(12)).toBe(6000);
    expect(computeContentPlanMaxTokens(13)).toBe(6000); // still well under the old ceiling once margin is applied
  });

  it("a 22-beat plan (the exact real failure's shape) receives sufficient increased capacity, well above the old flat ceiling", () => {
    const allowance = computeContentPlanMaxTokens(22);
    expect(allowance).toBeGreaterThan(6000);
    // The real, modeled requirement for 22 beats (660 + 315*22 = 7,590)
    // must fit comfortably inside the allowance, with real margin to
    // spare — not just barely clear the old ceiling.
    expect(allowance).toBeGreaterThanOrEqual(7590);
  });

  it("a 30-beat schema-max plan remains within the absolute bounded ceiling", () => {
    const allowance = computeContentPlanMaxTokens(30);
    expect(allowance).toBeLessThanOrEqual(13000);
    // And still comfortably covers the real modeled 30-beat requirement
    // (660 + 315*30 = 10,110) — the ceiling doesn't clip the largest
    // legitimate plan the schema itself allows.
    expect(allowance).toBeGreaterThanOrEqual(10110);
  });

  it("the allowance never exceeds the absolute ceiling, even for a hypothetical beat count beyond the schema's own 30-beat cap", () => {
    expect(computeContentPlanMaxTokens(30)).toBeLessThanOrEqual(13000);
    expect(computeContentPlanMaxTokens(1000)).toBe(13000); // clamped, not unbounded — a real safety backstop
  });

  it("scales monotonically with beat count between the floor and the ceiling", () => {
    const values = [1, 5, 12, 18, 22, 26, 30].map(computeContentPlanMaxTokens);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!);
    }
  });

  it("the legacy/no-strategy call path (target_cut_count unknown) keeps exactly the old flat 6,000-token behavior", () => {
    expect(computeContentPlanMaxTokens(undefined)).toBe(6000);
  });
});

describe("planContentVersion — the dynamic allowance actually reaches the real API call", () => {
  it("a strategy with target_cut_count: 22 sends the correct, larger max_tokens on the real request", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(makeContentPlan({ claims: [] }))]);
    await planContentVersion(
      {
        brief: makeProductionBrief(),
        audience: makeAudienceContext(),
        strategy: makeCreativeStrategy({ pacing: { target_cut_count: 22, rationale: "longer-form piece" } }),
      },
      { client },
    );
    const params = calls[0] as { max_tokens: number };
    expect(params.max_tokens).toBe(computeContentPlanMaxTokens(22));
    expect(params.max_tokens).toBeGreaterThan(6000);
  });

  it("a strategy with the common target_cut_count: 5 (testUtils' own default) sends the original 6,000 allowance, unchanged", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(makeContentPlan({ claims: [] }))]);
    await planContentVersion(
      { brief: makeProductionBrief(), audience: makeAudienceContext(), strategy: makeCreativeStrategy() },
      { client },
    );
    const params = calls[0] as { max_tokens: number };
    expect(params.max_tokens).toBe(6000);
  });
});

describe("genuine truncation detection is preserved", () => {
  it("a real stop_reason: \"max_tokens\" still fails explicitly as a truncation/capacity error, never attempting to parse incomplete JSON", async () => {
    const { client } = fakeAnthropicClientWithCalls([
      fakeAnthropicMessage(
        { title: "incomplete because it was cut off mid" }, // deliberately not a full valid plan — must never be parsed
        { stop_reason: "max_tokens" },
      ),
    ]);
    let caught: unknown;
    try {
      await planContentVersion(
        {
          brief: makeProductionBrief(),
          audience: makeAudienceContext(),
          strategy: makeCreativeStrategy({ pacing: { target_cut_count: 22, rationale: "longer-form piece" } }),
        },
        { client },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentBotError);
    expect((caught as ContentBotError).message).toMatch(/cut off before it finished/i);
    // Never a structural-validation error — the truncation check must
    // fire BEFORE any JSON parsing is even attempted.
    expect((caught as ContentBotError).message).not.toMatch(/structural validation/i);
  });
});

describe("existing schema-aware extraction behavior (the Production 5 fix) is unaffected by this change", () => {
  it("a Content Plan wrapped under an unexpected key is still correctly unwrapped", async () => {
    const validPlan = makeContentPlan({ claims: [] });
    const { client } = fakeAnthropicClientWithCalls([fakeAnthropicMessage({ content_plan: validPlan })]);
    const result = await planContentVersion(
      { brief: makeProductionBrief(), audience: makeAudienceContext(), strategy: makeCreativeStrategy() },
      { client },
    );
    expect(result.plan).toEqual(validPlan);
    expect(ContentPlanSchema.safeParse(result.plan).success).toBe(true);
  });
});
