import type { AudienceContext } from "@/lib/media/types";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import type { ContentPlan } from "./schema";

const PLAN_JSON_SHAPE = `{
  "title": string,
  "description": string,
  "tags": string[],
  "duration_seconds": number,
  "aspect_ratio": "9:16" | "16:9" | "1:1",
  "hook": string,
  "script": [ { "index": number, "narration": string, "visual_direction": string, "start_seconds": number, "end_seconds": number } ],
  "claims": [ { "text": string, "evidence_id": string } ],
  "thumbnail_brief": { "prompt": string, "text_overlay": string | null },
  "voice_direction": { "pace": "slow" | "natural" | "brisk" },
  "originality_statement": string
}`;

/**
 * Composed by context exactly as Scout's buildScoutSystemPrompt is
 * composed by workspace type (see lib/agents/scout/prompt.ts) — Content
 * Bot is never shown, or asked to follow, a rule that doesn't apply to
 * the audience/platform/content-type the founder actually chose at the
 * approval gate (see CLAUDE.md's Content Bot milestone, §14).
 */
export function buildContentPlanSystemPrompt(ctx: AudienceContext): string {
  const audienceRules: string[] = [];
  if (ctx.audience === "kids") {
    audienceRules.push(
      "This is for a KIDS audience. No peril, jump-scares, injury, romance, or purchase-pressure " +
        "language. Never solicit comments, follows, or engagement (\"like and subscribe\", \"comment " +
        "below\"). Never include external links or calls to visit another site.",
    );
  } else if (ctx.audience === "teen") {
    audienceRules.push(
      "This is for a TEEN audience. Avoid graphic content, and avoid purchase-pressure or " +
        "engagement-manipulation phrasing.",
    );
  }

  const platformRules: Record<AudienceContext["platform"], string> = {
    youtube: "Target platform: YouTube (long-form or standard upload). duration_seconds may run up to 180.",
    youtube_shorts: "Target platform: YouTube Shorts. duration_seconds must be 60 or under, aspect_ratio must be \"9:16\".",
    tiktok: "Target platform: TikTok. duration_seconds should typically be under 90, aspect_ratio must be \"9:16\".",
  };

  const contentTypeNote: Record<AudienceContext["contentType"], string> = {
    educational: "Content type: educational — prioritize clarity and accurate framing of any claim over cleverness.",
    comedy:
      "Content type: comedy. Original absurdist or slapstick fiction is fine when audience-appropriate — " +
      "fictional characters in fictional scenarios, never real-world tragedy or real identifiable people " +
      "placed in fabricated situations.",
    commentary: "Content type: commentary — clearly distinguish opinion from any factual claim.",
    product: "Content type: product-focused — never overstate what a product does or guarantee results.",
    story: "Content type: narrative/story — original characters and scenarios only.",
  };

  return `You are Content Bot, the production specialist inside Venture HQ, an AI \
business-management system for two founders, Ellis and Maddie. You turn an \
opportunity a founder has already approved for production into a real, \
original, finished short-form video plan — a script, shot list, and \
metadata that Content Bot's own pipeline will use to generate real assets \
and assemble a real video. You do not publish anything, contact anyone, or \
spend money beyond your own generation calls.

${platformRules[ctx.platform]}
${contentTypeNote[ctx.contentType]}
${audienceRules.join("\n")}

Hard rules, no exceptions:
1. Produce an ORIGINAL execution. Never reproduce, closely imitate, or \
   describe reproducing any specific existing video, character, artwork, \
   music, or creator's work — including anything named in the opportunity \
   brief's "do_not_imitate" list. You may take inspiration from a general \
   FORMAT or PATTERN (e.g. "fast-cut list format", "before/after reveal"), \
   never from a specific named work.
2. Never depict a real, identifiable person in a fabricated situation.
3. Every factual claim you make must cite a real evidence_id from the \
   opportunity brief's evidence list — never invent a claim with no \
   evidence backing it, and never cite an evidence_id that isn't in the \
   brief. If you want to say something you can't back with real evidence, \
   phrase it as a creative/fictional premise, not a factual claim.
4. Never guarantee or imply guaranteed results, sales, virality, or \
   outcomes of any kind.
5. Be compact. Respect these maximums exactly: tags (15), script beats \
   (30), claims (20). Keep narration natural for spoken delivery — short \
   sentences, not written prose read aloud.
6. Include a real "originality_statement" confirming this plan is your own \
   original execution, not a reproduction of anything specific you were \
   told about.

Respond with a single JSON object and nothing else — no prose, no \
reasoning, no markdown code fences. It must match exactly this shape:

${PLAN_JSON_SHAPE}`;
}

export function buildContentPlanUserPrompt(
  brief: ProductionBrief,
  ctx: AudienceContext,
  previousPlan?: ContentPlan,
  revisionNote?: string,
): string {
  const evidenceList = brief.evidence
    .map((e) => `- id: ${e.id} | ${e.source_title ?? e.source_url ?? "untitled"} — ${e.snippet ?? "(no snippet)"}`)
    .join("\n");

  const base = `Mission: ${brief.mission.title}

Opportunity brief (from Scout's research):
${brief.mission.interpreted_mission ?? brief.mission.brief}

Why this format works (Scout's recommendation):
${brief.scout.production_recommendation.why_it_works}

Suggested original angle: ${brief.scout.production_recommendation.suggested_original_angle}

Do NOT imitate any of these specific named works: ${
    brief.scout.production_recommendation.do_not_imitate.join(", ") || "(none named)"
  }

Key findings from Scout's research:
${brief.scout.key_findings.map((f) => `- ${f}`).join("\n") || "(none)"}

Real evidence you may cite (use the "id" value as claims[].evidence_id — never cite anything not listed here):
${evidenceList || "(no evidence selected)"}
${brief.founder_notes ? `\nFounder's own notes: ${brief.founder_notes}` : ""}`;

  if (!previousPlan || !revisionNote) {
    return `${base}\n\nProduce the complete structured production plan.`;
  }

  return `${base}

This is a REVISION, not a fresh plan. Your previous plan for this piece:
${JSON.stringify(previousPlan, null, 2)}

The founder reviewed the finished piece made from that plan and asked for this change:
"${revisionNote}"

You may rework the WHOLE piece if that's what's needed to make the requested change land well — \
this is not a patch instruction forcing untouched parts to stay identical. Produce a new, \
complete structured production plan (the full JSON shape, not a diff) reflecting the change.`;
}
