import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Mission } from "@/lib/db/types";
import type { AgentRunOutcome } from "@/lib/agents/types";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { ScoutReportSchema, type ScoutReport } from "./schema";
import { SCOUT_SYSTEM_PROMPT, buildScoutUserPrompt } from "./prompt";
import { findGuaranteeLanguage } from "./guardrails";

export const SCOUT_MODEL = process.env.SCOUT_MODEL || "claude-sonnet-5";
// Sonnet 5 is the deliberate default: Scout runs frequently on ordinary
// research briefs, and cost discipline is part of the product, not an
// afterthought. Override with SCOUT_MODEL if a mission genuinely needs
// Opus-tier reasoning.

const MAX_ITERATIONS = 4;
const MAX_TOKENS = 8000;

export interface PartialUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class ScoutResearchError extends Error {
  constructor(
    message: string,
    readonly usage: PartialUsage,
    readonly cause_?: unknown,
  ) {
    super(message);
    this.name = "ScoutResearchError";
  }
}

interface ScoutDeps {
  client?: Anthropic;
}

export async function runScoutResearch(
  mission: Mission,
  deps: ScoutDeps = {},
): Promise<AgentRunOutcome<ScoutReport>> {
  const client = deps.client ?? getAnthropicClient();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildScoutUserPrompt(mission) },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let response: Anthropic.Message | undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    response = await client.messages.create({
      model: SCOUT_MODEL,
      max_tokens: MAX_TOKENS,
      system: SCOUT_SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
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

  const usageSoFar = (): PartialUsage => ({
    model: SCOUT_MODEL,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });

  if (!response) {
    throw new ScoutResearchError("Scout never received a response from the model.", usageSoFar());
  }

  if (response.stop_reason === "refusal") {
    throw new ScoutResearchError("Scout declined to research this mission.", usageSoFar());
  }
  if (response.stop_reason === "max_tokens") {
    throw new ScoutResearchError(
      "Scout's report was cut off before it finished — the mission may be too broad for one research pass.",
      usageSoFar(),
    );
  }
  if (response.stop_reason === "pause_turn") {
    throw new ScoutResearchError(
      "Scout's research ran too long across multiple search rounds without finishing.",
      usageSoFar(),
    );
  }

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const rawText = textBlocks.map((block) => block.text).join("");

  if (!rawText.trim()) {
    throw new ScoutResearchError("Scout returned no report text.", usageSoFar());
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText.trim());
  } catch {
    // The model has no enforced structured-output mode in this SDK version
    // — it was instructed to return only JSON, but fall back to extracting
    // the outermost { ... } block in case it added any stray prose.
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    try {
      if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found");
      parsedJson = JSON.parse(rawText.slice(start, end + 1));
    } catch (error) {
      throw new ScoutResearchError("Scout's report was not valid JSON.", usageSoFar(), error);
    }
  }

  const validation = ScoutReportSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ScoutResearchError(
      `Scout's report failed structural validation: ${validation.error.message}`,
      usageSoFar(),
      validation.error,
    );
  }

  const report: ScoutReport = { ...validation.data };

  const violations = findGuaranteeLanguage(report);
  if (violations.length > 0) {
    if (report.verdict === "ready_for_founders_review") {
      report.verdict = "investigate_further";
    }
    report.unresolved_questions = [
      ...report.unresolved_questions,
      ...violations.map(
        (v) =>
          `Safety guardrail: "${v.matchedText}" in ${v.field} reads as a certainty claim about demand/revenue/profit — verify manually before trusting this section.`,
      ),
    ];
  }

  const usdCost = calculateUsdCost(SCOUT_MODEL, {
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  });

  const factEvidence = report.verified_facts.map((fact) => ({
    sourceUrl: fact.source_url,
    sourceTitle: null,
    sourceDate: null,
    snippet: fact.statement,
    isVerifiedFact: true,
  }));

  const citedUrls = new Set(report.verified_facts.map((f) => f.source_url).filter(Boolean));
  const sourceEvidence = report.sources
    .filter((source) => !citedUrls.has(source.url))
    .map((source) => ({
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourceDate: source.published_date,
      snippet: null,
      isVerifiedFact: false,
    }));

  return {
    report,
    usage: {
      model: SCOUT_MODEL,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      usdCost,
    },
    evidence: [...factEvidence, ...sourceEvidence],
  };
}
