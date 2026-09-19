import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import type { AudienceContext } from "@/lib/media/types";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import { ContentPlanSchema, type ContentPlan } from "./schema";
import { buildContentPlanSystemPrompt, buildContentPlanUserPrompt } from "./prompt";
import { ContentBotError } from "./errors";

export { ContentBotError } from "./errors";
export { reviewContentSafety, SAFETY_REVIEW_MODEL } from "./safetyReview";

export const CONTENT_BOT_MODEL = process.env.CONTENT_BOT_MODEL || "claude-sonnet-5";

// A production plan is a single structured synthesis pass (script, shot
// list, metadata) — not open-ended agentic reasoning, no tools involved.
// Thinking is disabled for the same reason it is for Scout's own
// synthesis pass (see lib/agents/scout/index.ts's MAX_TOKENS comment):
// an unset `thinking` runs adaptive extended thinking by default on this
// model, consumed from inside the same fixed max_tokens ceiling as the
// visible response.
const MAX_TOKENS = 6000;
const THINKING_DISABLED: Anthropic.ThinkingConfigParam = { type: "disabled" };

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
  },
  deps: ContentBotDeps = {},
): Promise<{ plan: ContentPlan; usage: ContentBotUsage }> {
  const client = deps.client ?? getAnthropicClient();
  const systemPrompt = buildContentPlanSystemPrompt(input.audience);
  const userPrompt = buildContentPlanUserPrompt(input.brief, input.audience, input.previousPlan, input.revisionNote);

  const response = await client.messages.create({
    model: CONTENT_BOT_MODEL,
    max_tokens: MAX_TOKENS,
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
  const parsedJson = parseJsonWithFallbacks(rawText);
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
