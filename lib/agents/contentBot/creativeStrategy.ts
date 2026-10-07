import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import type { AudienceContext } from "@/lib/media/types";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import { CreativeStrategySchema, type CreativeStrategy } from "./schema";
import { buildCreativeStrategySystemPrompt, buildCreativeStrategyUserPrompt } from "./prompt";
import { ContentBotError } from "./errors";

export const CREATIVE_STRATEGY_MODEL = process.env.CONTENT_BOT_MODEL || "claude-sonnet-5";

// Compact by design — this is reasoning, not a script (see prompt.ts's
// CreativeStrategySchema doc comment). A much smaller ceiling than the
// plan pass's MAX_TOKENS is a deliberate structural enforcement of
// "keep it compact and bounded. It is strategy, not another full script."
const MAX_TOKENS = 1500;
const THINKING_DISABLED: Anthropic.ThinkingConfigParam = { type: "disabled" };

/**
 * Stage 0 of Content Bot's pipeline (CLAUDE.md's Content Bot Creative
 * Quality milestone): one bounded Claude call that turns Scout's real
 * evidence + the founder/Scout creative direction + the audience/platform/
 * content type into a genuine per-piece creative strategy BEFORE any
 * script is written. Called by runCreativeStrategyStage
 * (contentWorkflow.ts), which owns resumability/checkpointing — this
 * function itself is a single-shot step, the same "step functions, not
 * one run()" shape planContentVersion/reviewContentSafety already use.
 */
export async function planCreativeStrategy(
  input: { brief: ProductionBrief; audience: AudienceContext },
  deps: { client?: Anthropic } = {},
): Promise<{
  strategy: CreativeStrategy;
  usage: { model: string; inputTokens: number; outputTokens: number; usdCost: number };
}> {
  const client = deps.client ?? getAnthropicClient();
  const systemPrompt = buildCreativeStrategySystemPrompt(input.audience);
  const userPrompt = buildCreativeStrategyUserPrompt(input.brief, input.audience);

  const response = await client.messages.create({
    model: CREATIVE_STRATEGY_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: THINKING_DISABLED,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const usage = {
    model: CREATIVE_STRATEGY_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (response.stop_reason === "refusal") {
    throw new ContentBotError("Content Bot declined to produce a creative strategy for this mission.", usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ContentBotError(
      "Content Bot's creative strategy was cut off before it finished — this should stay compact by design.",
      usage,
    );
  }

  const rawText = extractRawText(response.content);
  const parsedJson = parseJsonWithFallbacks(rawText);
  if (parsedJson === null) {
    throw new ContentBotError("Content Bot's creative strategy was not valid JSON.", usage);
  }

  const validation = CreativeStrategySchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ContentBotError(
      `Content Bot's creative strategy failed structural validation: ${validation.error.message}`,
      usage,
      validation.error,
    );
  }

  const usdCost = calculateUsdCost(CREATIVE_STRATEGY_MODEL, {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });

  return { strategy: validation.data, usage: { ...usage, usdCost } };
}
