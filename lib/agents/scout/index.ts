import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Mission, WorkspaceType } from "@/lib/db/types";
import type { AgentRunOutcome } from "@/lib/agents/types";
import { getAnthropicClient } from "@/lib/agents/anthropicClient";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { extractRawText, parseJsonWithFallbacks } from "@/lib/agents/shared/jsonExtraction";
import { ScoutReportSchema, type ScoutReport } from "./schema";
import { buildScoutSystemPrompt, buildScoutUserPrompt, type ScoutFollowupContext } from "./prompt";
import { findGuaranteeLanguage, findUncitedProductionEvidenceUrls, hasMeaningfulEvidence } from "./guardrails";

const DEFAULT_WORKSPACE_TYPE: WorkspaceType = "commerce";

export const SCOUT_MODEL = process.env.SCOUT_MODEL || "claude-sonnet-5";
// Sonnet 5 is the deliberate default: Scout runs frequently on ordinary
// research briefs, and cost discipline is part of the product, not an
// afterthought. Override with SCOUT_MODEL if a mission genuinely needs
// Opus-tier reasoning.

const MAX_ITERATIONS = 4;

// Two focused, real-run failures ("Scout's report was cut off before it
// finished") traced to the same root cause: every messages.create call left
// `thinking` unset. On this model, an unset `thinking` runs Claude's
// adaptive extended thinking by default — and thinking tokens are NOT extra
// headroom on top of max_tokens, they're generated (and billed) from inside
// the same fixed ceiling as the visible response. Scout's job is a single
// structured synthesis-and-formatting pass, not open-ended agentic
// reasoning, so an invisible, uncontrolled thinking pass had no business
// silently eating an unpredictable share of the budget meant for the JSON
// report itself — that's what was leaving too little room to finish a
// focused, well-scoped mission. Thinking is now explicitly disabled below
// (safe here specifically because Scout has no client-defined tools — only
// the server-executed web_search tool — so it carries none of the
// visible-tool-call-leak risk disabling thinking has on models/setups with
// custom client tools). MAX_TOKENS is also raised modestly, as a real but
// bounded safety margin on top of that fix, not a replacement for it — this
// is not "unlimited output."
const MAX_TOKENS = 10000;

// The bounded recovery path (see attemptBoundedRecovery below) reuses the
// same ceiling — it's asked to redo the SAME report more compactly, not to
// do more work than the original attempt ever had room for.
const RECOVERY_MAX_TOKENS = MAX_TOKENS;

const THINKING_DISABLED: Anthropic.ThinkingConfigParam = { type: "disabled" };

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
  /** Defaults to "commerce" — the workspace type that existed before workspaces did. */
  workspaceType?: WorkspaceType;
  /** Present only for the automatic second pass — see missionWorkflow.ts's MAX_RESEARCH_PASSES. */
  followupContext?: ScoutFollowupContext;
}

function parseAndValidateReport(rawText: string, usageSoFar: () => PartialUsage): ScoutReport {
  const parsedJson = parseJsonWithFallbacks(rawText);
  if (parsedJson === null) {
    throw new ScoutResearchError("Scout's report was not valid JSON.", usageSoFar());
  }

  const validation = ScoutReportSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new ScoutResearchError(
      `Scout's report failed structural validation: ${validation.error.message}`,
      usageSoFar(),
      validation.error,
    );
  }

  return { ...validation.data };
}

/**
 * Rejects the report outright if it contains prohibited certainty
 * language anywhere. This must never be softened into a downgrade-and-
 * annotate — an earlier version did exactly that (rewrote the verdict and
 * appended an explanatory sentence, quoting the offending word, into
 * unresolved_questions), which meant a report using a banned word was
 * still delivered to the founder as a *completed* report, just with the
 * guardrail's own meta-commentary embedded in what looks like Scout's
 * analysis — including the prohibited word itself, quoted back. A report
 * that fails this check has no legitimate partial form to deliver; it
 * fails the mission the same way invalid JSON or a wrong-workspace report
 * does (see runScoutResearch), with the real token cost still recorded
 * via ScoutResearchError.usage.
 */
function assertNoGuaranteeLanguage(report: ScoutReport, usageSoFar: () => PartialUsage): void {
  const violations = findGuaranteeLanguage(report);
  if (violations.length > 0) {
    const detail = violations.map((v) => `"${v.matchedText}" in ${v.field}`).join("; ");
    throw new ScoutResearchError(
      `Scout's report contained prohibited certainty language about demand, revenue, or profit and was rejected: ${detail}.`,
      usageSoFar(),
    );
  }
}

/**
 * The Scout -> Content Bot hand-off must be as evidence-disciplined as
 * the report itself: a production_recommendation citing a URL Scout never
 * actually looked at (an invented or training-knowledge URL, not one of
 * this run's real sources/verified_facts) fails the mission the same way
 * invalid JSON or a wrong-workspace report does — never delivered with the
 * fabricated citation silently attached.
 */
function assertValidProductionRecommendation(report: ScoutReport, usageSoFar: () => PartialUsage): void {
  const uncited = findUncitedProductionEvidenceUrls(report);
  if (uncited.length > 0) {
    throw new ScoutResearchError(
      `Scout's production recommendation cited evidence URLs it never actually sourced in this report: ${uncited.join(", ")}.`,
      usageSoFar(),
    );
  }
}

/** Defense in depth: the prompt already asks for this, but model output isn't fully controllable. */
function applyGuardrails(report: ScoutReport): ScoutReport {
  if (report.verdict === "ready_for_founders_review" && !hasMeaningfulEvidence(report)) {
    report.verdict = "investigate_further";
    report.unresolved_questions = [
      ...report.unresolved_questions,
      "Safety guardrail: no verified fact was backed by a real, dated source — downgraded from ready_for_founders_review, since a founders'-review verdict needs at least one authoritative, dated source behind it.",
    ];
  }

  return report;
}

function buildEvidence(report: ScoutReport): AgentRunOutcome<ScoutReport>["evidence"] {
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

  return [...factEvidence, ...sourceEvidence];
}

interface RecoveryParams {
  client: Anthropic;
  workspaceType: WorkspaceType;
  messages: Anthropic.MessageParam[];
  partialText: string;
  accumulate: (inputTokens: number, outputTokens: number) => void;
  usageSoFar: () => PartialUsage;
}

/**
 * One, and only one, bounded recovery attempt for the specific "cut off
 * before it finished" failure (stop_reason: "max_tokens"). Anthropic's
 * current API rejects assistant-message prefill on this model, so a
 * truncated response cannot be resumed token-by-token — the only technically
 * safe option is a single fresh request asking Scout to produce the
 * complete report again, compactly, informed by (not literally continuing)
 * what it already had. This call:
 *  - never loops or retries itself — exactly one attempt, ever, per run;
 *  - omits `tools` entirely, so it cannot trigger new web searches or any
 *    further real research spend beyond this one bounded completion;
 *  - reuses the same token ceiling and keeps thinking disabled, for the
 *    same reason as the main loop.
 * Its token usage is folded into the run's real total via `accumulate`
 * regardless of whether this attempt succeeds — the tokens were spent
 * either way and must be recorded (see runScoutPipeline's cost recording,
 * which is unconditional on outcome).
 */
async function attemptBoundedRecovery(params: RecoveryParams): Promise<string> {
  const { client, workspaceType, messages, partialText, accumulate, usageSoFar } = params;

  const salvage = partialText.trim().slice(0, 4000);
  const recoveryMessages: Anthropic.MessageParam[] = [
    ...messages,
    {
      role: "user",
      content:
        "Your previous attempt to write the final report was too long and got cut off before " +
        "finishing — do not continue it. Produce the COMPLETE report again from scratch, in ONE " +
        "pass, as a single compact JSON object obeying every length limit in the system prompt. " +
        "Reuse the research and sources you already have; do not run new searches unless something " +
        "essential is missing. Output only the JSON object — no reasoning, no preamble, no markdown." +
        (salvage
          ? `\n\nFor reference, here is what you had produced before being cut off (incomplete — do not resume it verbatim):\n${salvage}`
          : ""),
    },
  ];

  const response = await client.messages.create({
    model: SCOUT_MODEL,
    max_tokens: RECOVERY_MAX_TOKENS,
    thinking: THINKING_DISABLED,
    system: buildScoutSystemPrompt(workspaceType),
    messages: recoveryMessages,
  });

  accumulate(response.usage.input_tokens, response.usage.output_tokens);

  if (response.stop_reason === "max_tokens") {
    throw new ScoutResearchError(
      "Scout's report was cut off again even after a compact retry — the mission likely needs a narrower brief.",
      usageSoFar(),
    );
  }
  if (response.stop_reason === "refusal") {
    throw new ScoutResearchError("Scout declined to complete the compact retry.", usageSoFar());
  }
  if (response.stop_reason !== "end_turn" && response.stop_reason !== "stop_sequence") {
    throw new ScoutResearchError(
      `Scout's compact retry did not finish cleanly (stop reason: "${response.stop_reason}").`,
      usageSoFar(),
    );
  }

  const rawText = extractRawText(response.content);
  if (!rawText.trim()) {
    throw new ScoutResearchError("Scout's compact retry returned no report text.", usageSoFar());
  }
  return rawText;
}

export async function runScoutResearch(
  mission: Mission,
  deps: ScoutDeps = {},
): Promise<AgentRunOutcome<ScoutReport>> {
  const client = deps.client ?? getAnthropicClient();
  const workspaceType = deps.workspaceType ?? DEFAULT_WORKSPACE_TYPE;
  const systemPrompt = buildScoutSystemPrompt(workspaceType);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildScoutUserPrompt(mission, workspaceType, deps.followupContext) },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let response: Anthropic.Message | undefined;

  const usageSoFar = (): PartialUsage => ({
    model: SCOUT_MODEL,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    response = await client.messages.create({
      model: SCOUT_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: THINKING_DISABLED,
      system: systemPrompt,
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

  if (!response) {
    throw new ScoutResearchError("Scout never received a response from the model.", usageSoFar());
  }

  if (response.stop_reason === "refusal") {
    throw new ScoutResearchError("Scout declined to research this mission.", usageSoFar());
  }
  if (response.stop_reason === "pause_turn") {
    throw new ScoutResearchError(
      "Scout's research ran too long across multiple search rounds without finishing.",
      usageSoFar(),
    );
  }

  let rawText = extractRawText(response.content);

  if (response.stop_reason === "max_tokens") {
    rawText = await attemptBoundedRecovery({
      client,
      workspaceType,
      messages,
      partialText: rawText,
      accumulate: (inputTokens, outputTokens) => {
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
      },
      usageSoFar,
    });
  }

  const parsedReport = parseAndValidateReport(rawText, usageSoFar);

  // Structural check, independent of the prompt: the schema only proves the
  // report is SOME valid workspace shape, not that it's the shape actually
  // requested — a mismatch here would otherwise render as a Commerce report
  // for a Service Business mission (or vice versa) rather than failing
  // loudly. This is what makes "stop Etsy/KDP sections appearing on the
  // wrong workspace" an enforced guarantee rather than just a prompt hope.
  if (parsedReport.workspace_type !== workspaceType) {
    throw new ScoutResearchError(
      `Scout's report was built for the wrong workspace type (expected "${workspaceType}", got "${parsedReport.workspace_type}").`,
      usageSoFar(),
    );
  }

  assertNoGuaranteeLanguage(parsedReport, usageSoFar);
  assertValidProductionRecommendation(parsedReport, usageSoFar);
  const report = applyGuardrails(parsedReport);

  const usdCost = calculateUsdCost(SCOUT_MODEL, {
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  });

  return {
    report,
    usage: {
      model: SCOUT_MODEL,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      usdCost,
    },
    evidence: buildEvidence(report),
  };
}
