import { describe, expect, it } from "vitest";
import { parseJsonWithFallbacks, findFirstParseableJsonObject } from "@/lib/agents/shared/jsonExtraction";
import { ContentPlanSchema } from "@/lib/agents/contentBot/schema";
import { makeContentPlan } from "./testUtils";

// Regression coverage for the real Production 5 live failure: a response
// that was one complete, syntactically-valid JSON document — just nested
// one level too deep under an unexpected wrapper key — satisfied "first
// thing that parses" on its very first (and only) candidate, so nothing
// ever looked past it for the real plan. Every top-level ContentPlanSchema
// field then read as `undefined`, since they were all one level too deep.

const VALID_PLAN = makeContentPlan({ claims: [] });
const isValidPlan = (candidate: unknown) => ContentPlanSchema.safeParse(candidate).success;

describe("parseJsonWithFallbacks — schema-aware candidate selection", () => {
  it("1. a normal valid Content Plan with no wrapper still parses exactly as before", () => {
    const text = JSON.stringify(VALID_PLAN);
    const withoutValidator = parseJsonWithFallbacks(text);
    const withValidator = parseJsonWithFallbacks(text, isValidPlan);
    expect(withoutValidator).toEqual(VALID_PLAN);
    expect(withValidator).toEqual(VALID_PLAN);
    expect(withValidator).toEqual(withoutValidator); // the validator changes nothing in the normal case
  });

  it("2. {\"content_plan\": VALID_PLAN} successfully extracts VALID_PLAN, not the wrapper — the exact real Production 5 shape", () => {
    const text = JSON.stringify({ content_plan: VALID_PLAN });
    const result = parseJsonWithFallbacks(text, isValidPlan);
    expect(result).toEqual(VALID_PLAN);
    expect(isValidPlan(result)).toBe(true);

    // Without a validator (today's pre-fix behavior, still reachable for
    // any caller that doesn't opt in), the wrapper itself is returned —
    // proving this is a real regression this fix closes, not a
    // hypothetical one.
    const unfixed = parseJsonWithFallbacks(text);
    expect(unfixed).toEqual({ content_plan: VALID_PLAN });
    expect(isValidPlan(unfixed)).toBe(false);
  });

  it("3. an arbitrary, never-before-seen wrapper key also succeeds — this is structural, never hardcoded to one key name", () => {
    for (const wrapperKey of ["response", "result", "data", "some_totally_unexpected_key_xyz"]) {
      const text = JSON.stringify({ [wrapperKey]: VALID_PLAN });
      const result = parseJsonWithFallbacks(text, isValidPlan);
      expect(result).toEqual(VALID_PLAN);
    }
  });

  it("4. prose/code-fence noise surrounding a valid plan still works", () => {
    const fenced = "Here is the plan you asked for:\n```json\n" + JSON.stringify(VALID_PLAN) + "\n```\nLet me know if you'd like changes.";
    expect(parseJsonWithFallbacks(fenced, isValidPlan)).toEqual(VALID_PLAN);
    expect(parseJsonWithFallbacks(fenced)).toEqual(VALID_PLAN); // unchanged from before — no validator needed for this case either

    const bareProse = `Sure, here's the structured plan: ${JSON.stringify(VALID_PLAN)} Hope that helps!`;
    expect(parseJsonWithFallbacks(bareProse, isValidPlan)).toEqual(VALID_PLAN);
  });

  it("5. multiple parseable objects where the first is wrong-shaped selects the later, valid one", () => {
    const wrongShaped = { note: "this is not a content plan", ok: true };
    const text = `${JSON.stringify(wrongShaped)}\n\n${JSON.stringify(VALID_PLAN)}`;
    const result = parseJsonWithFallbacks(text, isValidPlan);
    expect(result).toEqual(VALID_PLAN);

    // Without a validator, the FIRST parseable object (the wrong-shaped
    // one) wins — the exact old, pre-fix behavior, still true for any
    // caller that doesn't supply one.
    expect(parseJsonWithFallbacks(text)).toEqual(wrongShaped);
  });

  it("6. no schema-valid candidate anywhere preserves the existing structural-validation failure behavior — never silently accepts bad data", () => {
    const wrongShaped = { note: "still not a content plan" };
    const text = JSON.stringify(wrongShaped);
    const result = parseJsonWithFallbacks(text, isValidPlan);
    // Falls back to the first parseable candidate (exactly what the
    // validator-unaware ladder would have returned) so the CALLER's own
    // real Zod validation still runs against it and reports the genuine
    // structural error — never returns null (which would produce a
    // different "not valid JSON" error instead) and never fabricates or
    // accepts the wrong-shaped object as if it were valid.
    expect(result).toEqual(wrongShaped);
    expect(isValidPlan(result)).toBe(false);
    const finalValidation = ContentPlanSchema.safeParse(result);
    expect(finalValidation.success).toBe(false);
  });

  it("7. existing callers that supply no validator retain their exact current behavior (Scout, Safety Review, Creative Strategy, Visual QC all call this with no second argument)", () => {
    // findFirstParseableJsonObject itself, directly, with no validator —
    // the function other call sites reach transitively.
    const text = `noise ${JSON.stringify({ a: 1 })} more noise`;
    expect(findFirstParseableJsonObject(text)).toEqual({ a: 1 });

    // A plain object with no wrapper, no validator supplied anywhere —
    // byte-identical to pre-fix behavior for every caller that hasn't
    // opted in.
    const plain = JSON.stringify({ hello: "world" });
    expect(parseJsonWithFallbacks(plain)).toEqual({ hello: "world" });

    // Empty input still returns null, unchanged.
    expect(parseJsonWithFallbacks("")).toBeNull();
    expect(parseJsonWithFallbacks("not json at all")).toBeNull();
  });
});
