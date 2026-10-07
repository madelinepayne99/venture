import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import type { AudienceContext } from "@/lib/media/types";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import { ContentPlanSchema, type ContentPlan, type CreativeStrategy } from "./schema";
import { buildContentPlanSystemPrompt, buildContentPlanUserPrompt, buildGuardrailCorrectionUserPrompt } from "./prompt";
import { ContentBotError } from "./errors";

export { ContentBotError } from "./errors";
export { reviewContentSafety, SAFETY_REVIEW_MODEL } from "./safetyReview";
export { planCreativeStrategy, CREATIVE_STRATEGY_MODEL } from "./creativeStrategy";
export { reviewVisualQuality, VISUAL_QC_MODEL, type VisualQCAssetInput } from "./visualQC";

export const CONTENT_BOT_MODEL = process.env.CONTENT_BOT_MODEL || "claude-sonnet-5";

// A production plan is a single structured synthesis pass (script, shot
// list, metadata) — not open-ended agentic reasoning, no tools involved.
// Thinking is disabled for the same reason it is for Scout's own
// synthesis pass (see lib/agents/scout/index.ts's MAX_TOKENS comment):
// an unset `thinking` runs adaptive extended thinking by default on this
// model, consumed from inside the same fixed max_tokens ceiling as the
// visible response.
const THINKING_DISABLED: Anthropic.ThinkingConfigParam = { type: "disabled" };

// --- Dynamic, bounded output-token allowance for the Content Plan call ---
//
// Real live failure this replaces a flat ceiling for: a legitimate
// ~180s/22-beat "episode" commission hit a flat 6,000-token ceiling and
// was truncated, while every prior production had been a ~12-13-beat
// short-form piece that fit comfortably inside it. Rather than one flat
// number (too small for a legitimate longer plan) or an unbounded one (a
// real cost/runaway risk), the allowance scales with the one piece of
// objective, already-available structural complexity Creative Strategy
// provides BEFORE the plan call happens: `pacing.target_cut_count`
// (Zod-bounded 1-30, matching ScriptBeatSchema's own 30-beat cap exactly)
// — never a platform name, duration, content-type, or audience keyword,
// so this works identically for a TikTok short, a longer YouTube video,
// or any future format.
//
// The formula is fit to two real, known data points, not chosen
// arbitrarily:
//   - Two real 12-beat plans completed at 4,435 and 4,451 output tokens
//     (average ~4,440) — comfortably inside the old 6,000 ceiling.
//   - A real 22-beat plan hit the old 6,000-token ceiling and was cut
//     off — its true requirement is necessarily ABOVE 6,000.
// Modeling cost as a FIXED overhead (title/description/tags/hook/
// thumbnail_brief/voice_direction/visual_identity/disclosure/
// originality_statement — present regardless of beat count) plus a
// PER-BEAT rate, solved from the 12-beat data point using the ~315
// tokens/beat rate already observed in practice:
//   FIXED_OVERHEAD = 4440 - 315*12 = 660
// Cross-checked against the 22-beat failure: 660 + 315*22 = 7,590 —
// comfortably above the 6,000 that actually truncated it, consistent
// with the real observed outcome.
const CONTENT_PLAN_FIXED_OVERHEAD_TOKENS = 660;
const CONTENT_PLAN_TOKENS_PER_BEAT = 315;
// 25% headroom over the modeled estimate — the formula is a central
// estimate from two data points, not a guarantee; real per-beat cost
// varies with how much of each field's own character budget Content Bot
// actually uses for a given beat.
const CONTENT_PLAN_SAFETY_MARGIN = 1.25;
// Never LESS than the original flat ceiling — the common ~12-beat
// short-form case (everything produced so far) keeps exactly the
// capacity it already had and already succeeds comfortably with.
const CONTENT_PLAN_MIN_TOKENS = 6000;
// The hard backstop — sized to comfortably cover a genuine schema-max
// (30-beat) plan WITH its own safety margin, not just the raw estimate,
// so the ceiling itself can never clip the largest legitimate plan the
// schema allows: ceil((660 + 315*30) * 1.25) = ceil(10,110 * 1.25) =
// 12,638, rounded up for a little extra headroom.
const CONTENT_PLAN_ABSOLUTE_MAX_TOKENS = 13000;

/**
 * Computes the real, bounded max_tokens allowance for one Content Plan
 * call from Creative Strategy's own already-decided `target_cut_count` —
 * see the constants above for exactly how and why. Exported for direct,
 * deterministic unit testing. `targetCutCount` is optional only for the
 * legacy/resumed call path with no strategy on record at all (see
 * planContentVersion's own `strategy?` doc comment) — that case keeps
 * exactly the old flat 6,000-token behavior.
 */
export function computeContentPlanMaxTokens(targetCutCount?: number): number {
  if (targetCutCount === undefined) return CONTENT_PLAN_MIN_TOKENS;
  const estimated = CONTENT_PLAN_FIXED_OVERHEAD_TOKENS + CONTENT_PLAN_TOKENS_PER_BEAT * targetCutCount;
  const withMargin = Math.ceil(estimated * CONTENT_PLAN_SAFETY_MARGIN);
  return Math.min(Math.max(withMargin, CONTENT_PLAN_MIN_TOKENS), CONTENT_PLAN_ABSOLUTE_MAX_TOKENS);
}

export interface ContentBotDeps {
  client?: Anthropic;
}

export interface ContentBotUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
}

/**
 * The `production_planning` pipeline stage's real work — one Claude call
 * producing a structured ContentPlan. Called by
 * runContentProductionPipeline (contentWorkflow.ts), which owns
 * resumability/checkpointing; this function itself is a single-shot step,
 * exactly the "step functions, not one run()" shape CLAUDE.md's Content
 * Bot milestone commits to (see lib/agents/types.ts's narrowed
 * VentureAgent doc comment for why Content Bot doesn't implement that
 * interface).
 */
export async function planContentVersion(
  input: {
    brief: ProductionBrief;
    audience: AudienceContext;
    previousPlan?: ContentPlan;
    revisionNote?: string;
    /**
     * The Creative Strategy already decided for this piece (see
     * creativeStrategy.ts's planCreativeStrategy) — this call EXECUTES it
     * rather than re-deciding a strategy from scratch. Undefined only for
     * a resumed/legacy call path that somehow has no strategy on record.
     */
    strategy?: CreativeStrategy;
    /**
     * Set only for the one bounded automatic self-correction attempt (see
     * contentWorkflow.ts's runProductionPlanningStage) — mutually
     * exclusive with revisionNote: a founder-requested revision and our
     * own guardrail rejecting a plan are different events and must never
     * be conflated in the prompt or the audit trail.
     */
    guardrailCorrection?: { rejectedPlan: ContentPlan; reason: string; code: string };
  },
  deps: ContentBotDeps = {},
): Promise<{ plan: ContentPlan; usage: ContentBotUsage }> {
  const client = deps.client ?? getAnthropicClient();
  const systemPrompt = buildContentPlanSystemPrompt(input.audience);
  const userPrompt = input.guardrailCorrection
    ? buildGuardrailCorrectionUserPrompt(
        input.brief,
        input.audience,
        input.guardrailCorrection.rejectedPlan,
        input.guardrailCorrection.reason,
        input.guardrailCorrection.code,
        input.strategy,
      )
    : buildContentPlanUserPrompt(input.brief, input.audience, input.previousPlan, input.revisionNote, input.strategy);

  const maxTokens = computeContentPlanMaxTokens(input.strategy?.pacing.target_cut_count);
  const response = await client.messages.create({
    model: CONTENT_BOT_MODEL,
    max_tokens: maxTokens,
    thinking: THINKING_DISABLED,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const usage = {
    model: CONTENT_BOT_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (response.stop_reason === "refusal") {
    throw new ContentBotError("Content Bot declined to produce a plan for this mission.", usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ContentBotError(
      "Content Bot's plan was cut off before it finished — the mission may need a narrower brief.",
      usage,
    );
  }

  const rawText = extractRawText(response.content);
  // The real live failure this validator exists for (Production 5): a
  // response can be one complete, syntactically-valid JSON document that
  // still isn't the plan itself — e.g. nested one level too deep under an
  // unexpected wrapper key. Passing the real schema here lets the
  // extraction ladder keep looking past a wrong-shaped-but-parseable
  // candidate for the one that actually matches, instead of stopping at
  // the first thing that merely parses.
  const parsedJson = parseJsonWithFallbacks(rawText, (candidate) => ContentPlanSchema.safeParse(candidate).success);
  if (parsedJson === null) {
    throw new ContentBotError("Content Bot's plan was not valid JSON.", usage);
  }

  const validation = ContentPlanSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ContentBotError(
      `Content Bot's plan failed structural validation: ${validation.error.message}`,
      usage,
      validation.error,
    );
  }

  const usdCost = calculateUsdCost(CONTENT_BOT_MODEL, {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });

  return { plan: validation.data, usage: { ...usage, usdCost } };
}
