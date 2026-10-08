import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import { BusinessAnalystReportSchema, type BusinessAnalystReport } from "./schema";
import { BUSINESS_ANALYST_SYSTEM_PROMPT, buildBusinessAnalystUserPrompt } from "./prompt";
import { findGuaranteeLanguage, hasAtLeastOneSource } from "./guardrails";

/**
 * Business Analyst's one real, tested capability: sourced opportunity/
 * competitor research, independent of Scout's mission pipeline (see
 * CLAUDE.md's "protect Scout" instruction — this file imports nothing
 * from lib/agents/scout and Scout is not touched). Simpler than Scout's
 * index.ts by design: a single, bounded web-search pass (no multi-pass
 * follow-up, no client-tool submission protocol) — the smallest real,
 * honest version of this capability, not a shortcut around safety.
 */

export const BUSINESS_ANALYST_MODEL = process.env.BUSINESS_ANALYST_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 8000;
const MAX_ITERATIONS = 4;

export interface PartialUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class BusinessAnalystResearchError extends Error {
  constructor(
    message: string,
    readonly usage: PartialUsage,
    readonly cause_?: unknown,
  ) {
    super(message);
    this.name = "BusinessAnalystResearchError";
  }
}

export interface BusinessAnalystRunOutcome {
  report: BusinessAnalystReport;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    usdCost: number | null;
  };
}

interface BusinessAnalystDeps {
  client?: Anthropic;
}

export async function runBusinessAnalystResearch(
  query: string,
  deps: BusinessAnalystDeps = {},
): Promise<BusinessAnalystRunOutcome> {
  const client = deps.client ?? getAnthropicClient();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildBusinessAnalystUserPrompt(query) }];
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] as unknown as Anthropic.Messages.ToolUnion[];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let response: Anthropic.Message | undefined;

  const usageSoFar = (): PartialUsage => ({
    model: BUSINESS_ANALYST_MODEL,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    response = await client.messages.create({
      model: BUSINESS_ANALYST_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system: BUSINESS_ANALYST_SYSTEM_PROMPT,
      tools,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }

  if (!response) {
    throw new BusinessAnalystResearchError("Business Analyst never received a response from the model.", usageSoFar());
  }
  if (response.stop_reason === "refusal") {
    throw new BusinessAnalystResearchError("Business Analyst declined to research this question.", usageSoFar());
  }
  if (response.stop_reason === "max_tokens") {
    throw new BusinessAnalystResearchError(
      "Business Analyst's report was cut off before it finished — try a narrower question.",
      usageSoFar(),
    );
  }

  const rawText = extractRawText(response.content);
  const parsedJson = parseJsonWithFallbacks(rawText, (candidate) => BusinessAnalystReportSchema.safeParse(candidate).success);
  if (parsedJson === null) {
    throw new BusinessAnalystResearchError("Business Analyst's report was not valid JSON.", usageSoFar());
  }

  const validation = BusinessAnalystReportSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new BusinessAnalystResearchError(
      `Business Analyst's report failed structural validation: ${validation.error.message}`,
      usageSoFar(),
      validation.error,
    );
  }

  const report = validation.data;

  const violations = findGuaranteeLanguage(report);
  if (violations.length > 0) {
    const detail = violations.map((v) => `"${v.matchedText}" in ${v.field}`).join("; ");
    throw new BusinessAnalystResearchError(
      `Business Analyst's report contained prohibited certainty language and was rejected: ${detail}.`,
      usageSoFar(),
    );
  }
  if (!hasAtLeastOneSource(report)) {
    throw new BusinessAnalystResearchError(
      "Business Analyst's report cited no real sources — rejected rather than delivered without evidence.",
      usageSoFar(),
    );
  }

  let usdCost: number | null;
  try {
    usdCost = calculateUsdCost(BUSINESS_ANALYST_MODEL, {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });
  } catch {
    // Unknown model/pricing — never invent a dollar figure (CLAUDE.md's
    // standing rule); the real token usage is still returned either way.
    usdCost = null;
  }

  return {
    report,
    usage: {
      model: BUSINESS_ANALYST_MODEL,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      usdCost,
    },
  };
}
