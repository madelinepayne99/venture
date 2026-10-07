import { describe, expect, it } from "vitest";
import { buildContentPlanUserPrompt } from "@/lib/agents/contentBot/prompt";
import { makeProductionBrief, makeAudienceContext, makeProductionRecommendation } from "./testUtils";

describe("buildContentPlanUserPrompt — origin-aware creative direction (never fabricated)", () => {
  it("for a scout_recommended brief, includes Scout's own why_it_works / suggested_original_angle / do_not_imitate", () => {
    const brief = makeProductionBrief({
      scout: {
        deliverable_id: "d1",
        verdict: "ready_for_founders_review",
        key_findings: ["A real finding."],
        production_recommendation: makeProductionRecommendation({
          why_it_works: "Scout's own real reasoning.",
          suggested_original_angle: "Scout's own real angle.",
          do_not_imitate: ["Some Show"],
        }),
      },
    });
    const prompt = buildContentPlanUserPrompt(brief, makeAudienceContext());

    expect(prompt).toContain("Scout's own real reasoning.");
    expect(prompt).toContain("Scout's own real angle.");
    expect(prompt).toContain("Some Show");
    expect(prompt).not.toMatch(/commissioned directly by a founder/i);
  });

  it("for a founder_commissioned brief, includes the founder's own concept/direction and the explicit disclosure, never Scout's fields", () => {
    const brief = makeProductionBrief({
      source: "founder_commissioned",
      scout: { deliverable_id: "d1", verdict: "ready_for_founders_review", key_findings: ["A real finding."], production_recommendation: null },
      founder_commission: {
        commissioned_by_founder_id: "founder-1",
        commissioned_at: "2026-09-25T00:00:00.000Z",
        concept: "The founder's own real concept.",
        creative_direction: "The founder's own real direction.",
        do_not_imitate: ["Some Named Creator"],
      },
    });
    const prompt = buildContentPlanUserPrompt(brief, makeAudienceContext());

    expect(prompt).toContain("The founder's own real concept.");
    expect(prompt).toContain("The founder's own real direction.");
    expect(prompt).toContain("Some Named Creator");
    expect(prompt).toMatch(/commissioned directly by a founder, not recommended by Scout/i);
    // Never reads (or crashes trying to read) the null production_recommendation.
    expect(prompt).not.toMatch(/why this format works \(scout's recommendation\)/i);
  });

  it("real evidence and key findings are included identically regardless of origin", () => {
    const founderCommissioned = makeProductionBrief({
      source: "founder_commissioned",
      scout: { deliverable_id: "d1", verdict: "ready_for_founders_review", key_findings: ["Shared finding."], production_recommendation: null },
      founder_commission: {
        commissioned_by_founder_id: "founder-1",
        commissioned_at: "2026-09-25T00:00:00.000Z",
        concept: "Concept.",
        creative_direction: "Direction.",
        do_not_imitate: [],
      },
    });
    const prompt = buildContentPlanUserPrompt(founderCommissioned, makeAudienceContext());
    expect(prompt).toContain("Shared finding.");
    expect(prompt).toContain(founderCommissioned.evidence[0]!.id);
  });

  it("a revision prompt for a founder-commissioned piece still frames it correctly, not as a fresh Scout recommendation", () => {
    const brief = makeProductionBrief({
      source: "founder_commissioned",
      scout: { deliverable_id: "d1", verdict: "ready_for_founders_review", key_findings: [], production_recommendation: null },
      founder_commission: {
        commissioned_by_founder_id: "founder-1",
        commissioned_at: "2026-09-25T00:00:00.000Z",
        concept: "Concept.",
        creative_direction: "Direction.",
        do_not_imitate: [],
      },
    });
    const previousPlan = {
      title: "t",
      description: "d",
      tags: [],
      duration_seconds: 30,
      aspect_ratio: "9:16" as const,
      hook: "h",
      hook_visual: "hv",
      script: [],
      claims: [],
      thumbnail_brief: { prompt: "p", text_overlay: null },
      voice_direction: { pace: "natural" as const },
      visual_identity: null,
      disclosure: { text: "AI-generated, fictional content.", placement: "persistent_badge" as const },
      originality_statement: "o",
    };
    const prompt = buildContentPlanUserPrompt(brief, makeAudienceContext(), previousPlan, "Make it punchier.");
    expect(prompt).toMatch(/commissioned directly by a founder/i);
    expect(prompt).toMatch(/REVISION/);
  });
});
