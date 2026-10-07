import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import type { AudienceContext } from "@/lib/media/types";
import { VisualQCReportSchema, type VisualQCReport, type ContentPlan, type SubjectProminence, VISUAL_QC_ISSUE_TYPES } from "./schema";
import { ContentBotError } from "./errors";

export const VISUAL_QC_MODEL = process.env.CONTENT_BOT_MODEL || "claude-sonnet-5";

// The INPUT (one image per beat plus a thumbnail, ≤31 per ContentPlanSchema's
// script cap of 30) is genuinely bounded by the plan's own array caps — but
// that bound does NOT by itself bound the OUTPUT `findings` array, which is
// exactly what caused a real live failure: the original prompt required one
// finding per image shown regardless of verdict, so a 13-beat plan (well
// under the 30-beat cap) already produced 14 required findings against this
// schema's separate `.max(12)` — a genuine prompt/schema misalignment (see
// VisualQCReportSchema's own doc comment). The fix is structural (findings
// now holds only genuine problems, so a normal run stays far under 12
// regardless of asset count) plus this prompt's own explicit
// prioritization/consolidation instruction below for the rare case real
// problems still exceed it.
const MAX_TOKENS = 3000;
const THINKING_DISABLED: Anthropic.ThinkingConfigParam = { type: "disabled" };

export type VisualQCAssetInput = {
  /** Stable identifier this caller assigns (e.g. "thumbnail" or "beat_3") — matched back up in code, never re-derived from the model's prose. */
  assetRef: string;
  /** The intended visual content for this asset — the beat's visual_direction, or the thumbnail_brief's prompt. */
  description: string;
  contentType: string;
  base64: string;
  /**
   * How visible the recurring subject is SUPPOSED to be in this shot (see
   * schema.ts's SubjectProminence — "full" | "faint" | "absent") —
   * defaults to "full" when omitted (the caller's own default, via
   * beatSubjectProminence in contentWorkflow.ts). Real live failure this
   * exists for (Production 4): without this, QC had no way to tell a
   * shot that correctly shows the subject faint/absent from one that
   * should show it clearly but doesn't — it could only ever judge against
   * an implicit "should be clearly visible" assumption.
   */
  expectedProminence?: SubjectProminence;
};

function buildSystemPrompt(ctx: AudienceContext): string {
  return `You are Content Bot's visual quality checker, inside Venture HQ. You are shown the STILL IMAGES \
already generated for one short-form video, each labeled with what it was supposed to show, and you check \
them against real, objective, checkable problems — never subjective artistic taste, and never a numeric \
quality score of any kind.

Platform: ${ctx.platform}. Audience: ${ctx.audience}.

For each image, decide whether it has a REAL, objective problem from EXACTLY these categories (an image \
can have more than one):
${VISUAL_QC_ISSUE_TYPES.map((t) => `- "${t}"`).join("\n")}

Definitions:
- subject_mismatch: the image does not actually show what its description asked for (a different subject, \
  scene, or setting entirely). When an asset's "Intended subject visibility" says "faint" or "absent", judge \
  this AGAINST that expectation, not against a default "should be clearly visible" assumption: for "faint", \
  the recurring subject correctly camouflaged, obscured, or only barely perceptible is NOT a defect — only \
  flag it if the subject is instead rendered fully clear and solid (failing to honor its own "faint" intent), \
  or if it's missing entirely. For "absent", the recurring subject being absent is CORRECT — only flag it if \
  the subject appears in the shot at all. For "full" (or when no visibility is stated), a faint, obscured, or \
  missing subject IS a real subject_mismatch, exactly as before.
- continuity_break: when a recurring subject/character is defined, this image shows it looking meaningfully \
  different from how it appears in the other images (different color, body plan, or defining features).
- composition_failure: the image is broken in an obvious, objective way — e.g. overwhelmingly empty/blank, \
  unusable framing, or a clearly malformed render.
- garbled_or_unintended_text: the image contains illegible, garbled, or nonsensical text baked into the \
  picture (a known failure mode of image generation when text appears in a scene).
- watermark_or_logo: the image appears to contain a watermark, logo, or brand mark that shouldn't be there.
- unsafe_or_off_brief: the image depicts something unsafe, or something unrelated to and inconsistent with \
  the stated creative brief (e.g. an unrelated real-world scene with no connection to the intended subject).

Do NOT flag an image merely because you personally would have composed, lit, or styled it differently — \
that is subjective taste, not one of the categories above.

IMPORTANT — only report images with a REAL problem:
- If an image looks fine, do NOT include an entry for it at all. "findings" holds ONLY the images that need \
  attention, never a full pass/fail entry for every image shown. If every image looks fine, "findings" must \
  be an empty array and "overall_verdict" must be "pass".
- "findings" may contain AT MOST 12 entries — this is enforced automatically, and a response exceeding it \
  is rejected entirely. If more than 12 images genuinely have a real problem, report only the 12 MOST \
  MATERIAL and actionable ones: prioritize "unsafe_or_off_brief", "subject_mismatch", and \
  "watermark_or_logo" over "composition_failure" or "garbled_or_unintended_text". Still set "overall_verdict" \
  to "flag" in that case — you do not need to enumerate every affected image to correctly signal that a real \
  problem exists.
- If several images share the exact same underlying problem (e.g. the same continuity break repeated across \
  many shots), do not create a separate finding for every one of them — report the clearest 1-2 examples \
  instead, so the 12-entry limit is spent on genuinely distinct problems, not repetitions of the same one.

Respond with a single JSON object and nothing else — no prose, no markdown code fences. It must match \
exactly this shape:
{
  "overall_verdict": "pass" | "flag",
  "findings": [ { "asset_ref": string, "issue_types": string[], "reasons": string[] } ]
}`;
}

function buildUserContent(
  plan: Pick<ContentPlan, "visual_identity" | "disclosure">,
  assets: VisualQCAssetInput[],
): Anthropic.MessageParam["content"] {
  const content: Anthropic.MessageParam["content"] = [];

  const identityNote = plan.visual_identity
    ? `This piece has a recurring subject that must look consistent across every image showing it:\n` +
      `Canonical description: ${plan.visual_identity.canonical_description}\n` +
      (plan.visual_identity.immutable_traits.length > 0
        ? `Traits that must never change: ${plan.visual_identity.immutable_traits.join(", ")}\n`
        : "") +
      (plan.visual_identity.continuity_notes ? `Continuity notes: ${plan.visual_identity.continuity_notes}\n` : "")
    : "This piece has no single recurring subject requiring cross-shot consistency.";

  content.push({
    type: "text",
    text: `${identityNote}\n\nBelow are the ${assets.length} generated image(s), each labeled with its own asset_ref and intended description.`,
  });

  for (const asset of assets) {
    const prominence = asset.expectedProminence ?? "full";
    content.push({
      type: "text",
      text:
        `asset_ref: "${asset.assetRef}"\nIntended description: ${asset.description}\n` +
        `Intended subject visibility for this shot: "${prominence}" (full = subject should be clearly visible; ` +
        `faint = subject is intentionally camouflaged/obscured/barely visible; absent = subject intentionally ` +
        `does not appear in this shot at all)`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: (asset.contentType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: asset.base64,
      },
    });
  }

  content.push({ type: "text", text: "Review every image above and return your structured verdict now." });
  return content;
}

/**
 * The mandatory Visual QC pipeline stage (CLAUDE.md's Content Bot Creative
 * Quality milestone): one bounded, multimodal Claude call reviewing the
 * real generated stills against the plan's own intended descriptions and
 * visual identity, BEFORE assembly. Called by runVisualQCStage
 * (contentWorkflow.ts), which owns the regeneration/cap logic and the
 * "stop for founder review" decision — this function is a single-shot
 * check, never a loop itself.
 */
export async function reviewVisualQuality(
  input: {
    plan: Pick<ContentPlan, "visual_identity" | "disclosure">;
    audience: AudienceContext;
    assets: VisualQCAssetInput[];
  },
  deps: { client?: Anthropic } = {},
): Promise<{
  report: VisualQCReport;
  usage: { model: string; inputTokens: number; outputTokens: number; usdCost: number };
}> {
  const client = deps.client ?? getAnthropicClient();
  const systemPrompt = buildSystemPrompt(input.audience);
  const userContent = buildUserContent(input.plan, input.assets);

  const response = await client.messages.create({
    model: VISUAL_QC_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: THINKING_DISABLED,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const usage = {
    model: VISUAL_QC_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (response.stop_reason === "refusal") {
    throw new ContentBotError("Content Bot's visual QC reviewer declined to complete its review.", usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ContentBotError("Content Bot's visual QC response was cut off before it finished.", usage);
  }

  const rawText = extractRawText(response.content);
  const parsedJson = parseJsonWithFallbacks(rawText);
  if (parsedJson === null) {
    throw new ContentBotError("Content Bot's visual QC response was not valid JSON.", usage);
  }

  const validation = VisualQCReportSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ContentBotError(
      `Content Bot's visual QC response failed structural validation: ${validation.error.message}`,
      usage,
      validation.error,
    );
  }

  const usdCost = calculateUsdCost(VISUAL_QC_MODEL, {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });

  return { report: validation.data, usage: { ...usage, usdCost } };
}
