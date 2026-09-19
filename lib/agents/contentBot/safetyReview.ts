import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import type { AudienceContext } from "@/lib/media/types";
import { SafetyVerdictSchema, type SafetyVerdict, type ContentPlan } from "./schema";
import { ContentBotError } from "./errors";

export const SAFETY_REVIEW_MODEL = process.env.CONTENT_BOT_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 2000;
const THINKING_DISABLED: Anthropic.ThinkingConfigParam = { type: "disabled" };

/**
 * Layer 3 of the safety architecture: a real model judge, run as its own
 * pipeline stage, specifically because tone-vs-audience mismatch and
 * real-world-tragedy-exploitation genuinely aren't regex-detectable —
 * layers 1 (prompt) and 2 (code guardrails, see guardrails.ts) are the
 * floor that doesn't depend on a model behaving; this is what catches
 * what those can't. A "block" verdict is a visible, explicable state
 * (content_versions.blocked), never a silent filter.
 */
export async function reviewContentSafety(
  plan: ContentPlan,
  ctx: AudienceContext,
  deps: { client?: Anthropic } = {},
): Promise<{ verdict: SafetyVerdict; usage: { model: string; inputTokens: number; outputTokens: number; usdCost: number } }> {
  const client = deps.client ?? getAnthropicClient();

  const systemPrompt = `You are a content-safety reviewer for Venture HQ, an AI business-management \
system. You are reviewing a short-form video production plan before it is produced, specifically \
for two things regex/code checks cannot catch:
1. Whether the tone/content genuinely matches the stated audience ("${ctx.audience}") and content \
   type ("${ctx.contentType}") — e.g. content that's technically not using a banned word but is \
   still clearly inappropriate in tone for a kids audience.
2. Whether the plan exploits a real-world tragedy or real identifiable person's suffering for \
   engagement. Original fictional/absurdist content (fictional characters, fictional conflict, \
   slapstick) is FINE when audience-appropriate — do not block a plan just because it's silly or \
   dramatic fiction. Only block genuine real-world tragedy exploitation or real-person harm.

Respond with a single JSON object and nothing else: {"verdict": "pass" | "block", "reasons": \
string[], "concerns": string[]}. "reasons" is required and must explain the verdict either way. \
"concerns" holds anything worth a founder's attention even on a "pass" verdict (empty array if none).`;

  const userPrompt = `Platform: ${ctx.platform}
Audience: ${ctx.audience}
Content type: ${ctx.contentType}

Title: ${plan.title}
Hook: ${plan.hook}
Description: ${plan.description}

Script:
${plan.script.map((b) => `[${b.start_seconds}s-${b.end_seconds}s] ${b.narration}`).join("\n")}

Review this plan and return your verdict.`;

  const response = await client.messages.create({
    model: SAFETY_REVIEW_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: THINKING_DISABLED,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const usage = {
    model: SAFETY_REVIEW_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  const usdCost = calculateUsdCost(SAFETY_REVIEW_MODEL, {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });

  if (response.stop_reason === "refusal") {
    throw new ContentBotError("The safety reviewer declined to complete its review.", usage);
  }

  const rawText = extractRawText(response.content);
  const parsedJson = parseJsonWithFallbacks(rawText);
  if (parsedJson === null) {
    throw new ContentBotError("The safety reviewer's response was not valid JSON.", usage);
  }

  const validation = SafetyVerdictSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ContentBotError(
      `The safety reviewer's response failed structural validation: ${validation.error.message}`,
      usage,
      validation.error,
    );
  }

  return { verdict: validation.data, usage: { ...usage, usdCost } };
}
