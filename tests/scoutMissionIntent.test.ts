import { describe, expect, it } from "vitest";
import { buildScoutSystemPrompt, buildScoutUserPrompt } from "@/lib/agents/scout/prompt";
import { ScoutReportSchema } from "@/lib/agents/scout/schema";
import { buildSubmitReportTool } from "@/lib/agents/scout/jsonSchema";
import { runScoutResearch } from "@/lib/agents/scout";
import type { Mission } from "@/lib/db/types";
import { fakeAnthropicClientWithCalls, fakeAnthropicMessage, makeScoutReport } from "./testUtils";

// The founder's explicit mission is authoritative. Workspace context (Etsy,
// KDP, YouTube, TikTok…) is background and capability, never a silently
// added requirement. These tests prove that at the level this repo can prove
// for free: the prompts actually built, the report schema, and the provider
// tool schema. Real-model behaviour needs a (separately approved) live probe.

function mission(brief: string, title = "Mission"): Mission {
  return { id: "m", title, brief, research_pass_count: 1 } as unknown as Mission;
}

const VIDEO_BRIEF =
  "Evaluate one original 30-second educational short-form video for children aged 6-9 about how seeds sense gravity.";
const ETSY_BRIEF = "Research demand for printable counting worksheets for 3-5 year olds on Etsy.";
const KDP_BRIEF = "Assess a children's dot-marker activity book for Amazon KDP print-on-demand.";
const MIXED_BRIEF =
  "Assess a 30-second kids' science video for YouTube Shorts AND a companion printable worksheet pack on Etsy.";

/** The prompt text Scout is given by the app, with the founder's own brief text removed. */
function appAuthoredUserPrompt(brief: string, followup = false): string {
  const text = buildScoutUserPrompt(
    mission(brief),
    "commerce",
    followup
      ? { passNumber: 2, maxPasses: 2, priorVerdictRationale: "r", unresolvedQuestions: ["q"], priorVerifiedFacts: [], priorSources: [] }
      : undefined,
  );
  return text.split(brief).join("[BRIEF]");
}

describe("Commerce prompts — founder intent is authoritative", () => {
  it("a video-only mission's user prompt adds no Etsy/KDP/Amazon framing of its own", () => {
    const prompt = appAuthoredUserPrompt(VIDEO_BRIEF);
    expect(prompt).not.toMatch(/etsy|kdp|amazon/i);
    expect(prompt).toContain("[BRIEF]"); // the founder's brief is passed through intact
    expect(prompt).toMatch(/exactly as the founder's brief describes it/i);
    expect(prompt).toMatch(/do not add a marketplace, product type, or monetisation requirement/i);
  });

  it("the old unconditional Etsy/KDP instruction is gone for every Commerce brief", () => {
    for (const brief of [VIDEO_BRIEF, ETSY_BRIEF, KDP_BRIEF, MIXED_BRIEF]) {
      expect(buildScoutUserPrompt(mission(brief), "commerce")).not.toMatch(/potential digital-product opportunity/i);
    }
  });

  it("the system prompt frames Etsy/KDP/video as example channels and states the authority rule", () => {
    const system = buildScoutSystemPrompt("commerce");
    expect(system).toMatch(/examples of what it can support, NOT objectives/i);
    expect(system).toMatch(/YouTube and TikTok/);
    expect(system).toMatch(/Founder intent is authoritative/);
    expect(system).toMatch(/do not make a video mission prove Etsy or KDP demand/i);
    // Scout's independence is explicit.
    expect(system).toMatch(/if the founder's actual proposal is weak, say so and reject it or investigate further/i);
    expect(system).not.toMatch(/initially children's activity products suitable for Etsy downloads/i);
  });

  it("an Etsy mission stays an Etsy mission: the brief is passed through and Etsy remains a supported channel", () => {
    expect(buildScoutUserPrompt(mission(ETSY_BRIEF), "commerce")).toContain(ETSY_BRIEF);
    expect(buildScoutSystemPrompt("commerce")).toMatch(/Etsy digital downloads/);
    expect(buildScoutSystemPrompt("commerce")).toMatch(/etsy_downloads and amazon_kdp_print_on_demand to null when the brief does not involve that channel/);
  });

  it("a KDP mission stays a KDP mission", () => {
    expect(buildScoutUserPrompt(mission(KDP_BRIEF), "commerce")).toContain(KDP_BRIEF);
    expect(buildScoutSystemPrompt("commerce")).toMatch(/Amazon KDP print-on-demand/);
  });

  it("a mixed video + product mission passes both parts through and nothing in the app text excludes either", () => {
    const user = buildScoutUserPrompt(mission(MIXED_BRIEF), "commerce");
    expect(user).toContain("YouTube Shorts");
    expect(user).toContain("printable worksheet pack on Etsy");
    const appText = appAuthoredUserPrompt(MIXED_BRIEF);
    expect(appText).not.toMatch(/only|exclude|do not (research|evaluate)/i);
  });

  it("does not make production_recommendation easier or mandatory: rule 9 is unchanged", () => {
    const system = buildScoutSystemPrompt("commerce");
    expect(system).toMatch(/Only when your verdict is exactly "ready_for_founders_review" AND you\s+genuinely believe/);
    expect(system).toMatch(/Omit the "production_recommendation"\s+key entirely \(do not include it as null or empty\) when it doesn't apply/);
    expect(system).toMatch(/that is a legitimate, common outcome, not a fallback to avoid/);
  });

  it("pass 2 keeps the founder's original scope instead of broadening the mission", () => {
    const followup = appAuthoredUserPrompt(VIDEO_BRIEF, true);
    expect(followup).toMatch(/Stay within the founder's original scope/);
    expect(followup).toMatch(/do not widen the mission to a marketplace, product, or monetisation model the brief does not request/i);
    expect(followup).not.toMatch(/etsy|kdp|amazon/i); // no app-authored Etsy/KDP text in pass 2 either
  });

  it("Service Business prompts are unaffected: no Commerce scope rule, and its own framing is unchanged", () => {
    const system = buildScoutSystemPrompt("service_business");
    expect(system).not.toMatch(/Founder intent is authoritative/);
    expect(system).not.toMatch(/etsy_downloads/);
    const user = buildScoutUserPrompt(mission("A hairdresser client retention plan."), "service_business");
    expect(user).toMatch(/client-facing local service business/);
    expect(user).toMatch(/Do not research or suggest anything involving Etsy, Amazon KDP/);
    const followup = buildScoutUserPrompt(mission("A hairdresser client retention plan."), "service_business", {
      passNumber: 2, maxPasses: 2, priorVerdictRationale: "r", unresolvedQuestions: ["q"], priorVerifiedFacts: [], priorSources: [],
    });
    expect(followup).not.toMatch(/Stay within the founder's original scope/);
  });
});

describe("Commerce report schema — platform fields are nullable, old reports stay valid", () => {
  it("accepts null Etsy/KDP fields for a video-only report, with the platform described in other_notes", () => {
    const report = makeScoutReport({
      platform_suitability: { etsy_downloads: null, amazon_kdp_print_on_demand: null, other_notes: "YouTube Shorts and TikTok." },
    });
    expect(ScoutReportSchema.safeParse(report).success).toBe(true);
  });

  it("still accepts every pre-existing report shape (string Etsy/KDP fields)", () => {
    const report = makeScoutReport();
    expect(typeof (report as { platform_suitability: { etsy_downloads: unknown } }).platform_suitability.etsy_downloads).toBe("string");
    expect(ScoutReportSchema.safeParse(report).success).toBe(true);
  });

  it("still requires the keys to be present (null, not omitted) so the provider-enforced schema stays fully specified", () => {
    const report = makeScoutReport() as unknown as { platform_suitability: Record<string, unknown> };
    delete report.platform_suitability.etsy_downloads;
    expect(ScoutReportSchema.safeParse(report).success).toBe(false);
  });

  it("the strict submit_scout_report schema advertises the fields as nullable and production_recommendation stays the ONLY optional property", () => {
    const schema = buildSubmitReportTool("commerce").input_schema as {
      properties: Record<string, { properties?: Record<string, { anyOf?: unknown[] }> }>;
      required: string[];
    };
    const etsy = schema.properties.platform_suitability?.properties?.etsy_downloads;
    expect(etsy?.anyOf).toEqual(expect.arrayContaining([{ type: "null" }]));
    expect(Object.keys(schema.properties).filter((k) => !schema.required.includes(k))).toEqual(["production_recommendation"]);
  });
});

describe("Scout keeps its independence on a video mission", () => {
  function submit(report: unknown) {
    return fakeAnthropicMessage(null, {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t", name: "submit_scout_report", input: report }],
    });
  }
  const videoPlatforms = { etsy_downloads: null, amazon_kdp_print_on_demand: null, other_notes: "YouTube Shorts / TikTok." };

  it("accepts a video-only report that omits production_recommendation", async () => {
    const { client } = fakeAnthropicClientWithCalls([
      submit(makeScoutReport({ platform_suitability: videoPlatforms })),
    ]);
    const outcome = await runScoutResearch(mission(VIDEO_BRIEF), { client });
    expect(outcome.report.production_recommendation).toBeUndefined();
  });

  it("still lets Scout reject or investigate further a video mission for video-related reasons", async () => {
    for (const verdict of ["reject", "investigate_further"] as const) {
      const { client } = fakeAnthropicClientWithCalls([
        submit(makeScoutReport({ verdict, verdict_rationale: "The video niche is saturated.", platform_suitability: videoPlatforms })),
      ]);
      const outcome = await runScoutResearch(mission(VIDEO_BRIEF), { client });
      expect(outcome.report.verdict).toBe(verdict);
    }
  });

  it("sends the founder-authoritative prompts (not the old Etsy/KDP framing) in the real request", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([submit(makeScoutReport({ platform_suitability: videoPlatforms }))]);
    await runScoutResearch(mission(VIDEO_BRIEF), { client });
    const request = calls[0] as { system: string; messages: Array<{ content: string }> };
    expect(request.system).toMatch(/Founder intent is authoritative/);
    expect(request.messages[0]?.content).not.toMatch(/potential digital-product opportunity/i);
  });
});
