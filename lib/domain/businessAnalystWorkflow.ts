import "server-only";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  saveBusinessAnalystReport,
  listBusinessAnalystReportsForFounder,
  getBusinessAnalystReport,
  getAgentByKey,
  recordCost,
  recordActivity,
} from "@/lib/db/repositories";
import type { BusinessAnalystReportRecord } from "@/lib/db/types";
import { runBusinessAnalystResearch, BusinessAnalystResearchError, BUSINESS_ANALYST_MODEL } from "@/lib/agents/businessAnalyst";
import { calculateUsdCost } from "@/lib/agents/pricing";
import type { BusinessAnalystReport } from "@/lib/agents/businessAnalyst/schema";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { reserveBudget, settleReservation, releaseReservation } from "@/lib/domain/budgetWorkflow";

/**
 * Business Analyst's one real, tested capability: standalone sourced
 * research. Deliberately synchronous (request/response), not dispatched
 * through Inngest the way Scout's research is — this is a first, simpler
 * slice; a real research call can take tens of real seconds, a known,
 * documented tradeoff (see docs/operations-build-progress.md), not an
 * oversight. Real spend is recorded via the existing costs/ledger_entries
 * tables with missionId: null (already nullable — zero schema changes
 * needed there) rather than inventing a parallel ledger.
 *
 * Mission 7 Phase 4: this is also the first real call site wired into
 * `budgetWorkflow.ts`'s atomic reservation gate — the simplest real
 * integration point (a single synchronous call, no durable-job resume
 * path to coordinate with), proven here before Scout's and Content Bot's
 * own multi-stage pipelines get the same treatment. A reservation is
 * taken out for a genuine worst-case ceiling *before* the real model call
 * ever starts (so an organization that's already exhausted its monthly
 * budget is refused before spending anything, not after), and is always
 * either settled with the real final cost (success or a failed-but-
 * billed run) or released (nothing was actually spent) — never left
 * dangling.
 */

// Business Analyst's agent-level worst case (see lib/agents/businessAnalyst/
// index.ts): MAX_ITERATIONS (4) calls, each capped at MAX_TOKENS (8000)
// output tokens — 32,000 output tokens total. Input tokens grow with a
// multi-turn search conversation and aren't precisely bounded; 20,000 is a
// generous, documented estimate (the same "don't try to bound input
// precisely, use a generous figure" approach CLAUDE.md's own Scout cost
// ceiling takes), not a measured figure. Computed via the real pricing
// table rather than a hand-picked dollar constant, so it tracks the actual
// model's rate automatically.
const WORST_CASE_OUTPUT_TOKENS = 8000 * 4;
const WORST_CASE_INPUT_TOKENS_ESTIMATE = 20_000;

function estimateResearchCeilingUsd(): number {
  try {
    return calculateUsdCost(BUSINESS_ANALYST_MODEL, {
      input_tokens: WORST_CASE_INPUT_TOKENS_ESTIMATE,
      output_tokens: WORST_CASE_OUTPUT_TOKENS,
    });
  } catch {
    // Unknown model pricing — fall back to a conservative, documented flat
    // figure rather than letting an unpriced model bypass budget
    // enforcement entirely.
    return 1;
  }
}

export class BusinessAnalystValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "BusinessAnalystValidationError";
  }
}

export class BusinessAnalystReportNotFoundError extends Error {
  constructor(id: string) {
    super(`Business Analyst report ${id} not found.`);
    this.name = "BusinessAnalystReportNotFoundError";
  }
}

function safeCalculateUsdCost(model: string, inputTokens: number, outputTokens: number): number | null {
  try {
    return calculateUsdCost(model, { input_tokens: inputTokens, output_tokens: outputTokens });
  } catch {
    // Unknown model/pricing — never invent a dollar figure.
    return null;
  }
}

export interface RequestResearchDeps {
  client?: Anthropic;
}

export async function requestResearch(
  founderId: string,
  query: string,
  deps: RequestResearchDeps = {},
): Promise<BusinessAnalystReportRecord<BusinessAnalystReport>> {
  const trimmed = query?.trim();
  const errors: string[] = [];
  if (!trimmed) errors.push("A research question is required.");
  if (trimmed && trimmed.length > 1000) errors.push("Keep the research question to 1000 characters or fewer.");
  if (errors.length) throw new BusinessAnalystValidationError(errors);

  const organization = await getActiveOrganizationForFounder(founderId);
  const agent = await getAgentByKey("business_analyst");

  // The real enforcement point: this throws BudgetExhaustedError (mapped
  // to HTTP 429 in lib/api/errors.ts) and refuses the request *before* any
  // real model call happens whenever this organization's current month
  // committed spend plus this call's worst-case ceiling would exceed its
  // budget. Two genuinely concurrent requests against the same
  // organization's remaining headroom can never both pass this gate — see
  // budgetWorkflow.ts's own row-locking guarantee.
  const reservation = await reserveBudget({
    organizationId: organization.id,
    purpose: "business_analyst_research",
    estimatedUsd: estimateResearchCeilingUsd(),
    idempotencyKey: randomUUID(),
  });

  try {
    const outcome = await runBusinessAnalystResearch(trimmed!, deps);

    const saved = await saveBusinessAnalystReport({
      founderId,
      organizationId: organization.id,
      query: trimmed!,
      state: "completed",
      report: outcome.report,
      error: null,
      model: outcome.usage.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      usdCost: outcome.usage.usdCost,
    });

    await recordCost({
      missionId: null,
      organizationId: organization.id,
      agentId: agent?.id ?? null,
      model: outcome.usage.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      usdCost: outcome.usage.usdCost,
    });
    await recordActivity({
      missionId: null,
      actor: "business_analyst",
      action: "research_completed",
      detail: trimmed,
    });

    // Close the reservation out with the real final cost — never the
    // estimate. A null usdCost (unpriced model) settles as null too,
    // matching recordCost's own "never invent a dollar figure" rule.
    await settleReservation(reservation.id, outcome.usage.usdCost);

    return saved as BusinessAnalystReportRecord<BusinessAnalystReport>;
  } catch (error) {
    if (error instanceof BusinessAnalystResearchError) {
      const usdCost = safeCalculateUsdCost(error.usage.model, error.usage.inputTokens, error.usage.outputTokens);

      const saved = await saveBusinessAnalystReport({
        founderId,
        organizationId: organization.id,
        query: trimmed!,
        state: "failed",
        report: null,
        error: error.message,
        model: error.usage.model,
        inputTokens: error.usage.inputTokens,
        outputTokens: error.usage.outputTokens,
        usdCost,
      });

      // Real tokens were spent even on a failed run (e.g. a cut-off or
      // unparseable response) — record that cost rather than dropping it,
      // the same discipline Scout's own failure path follows. Skip the
      // insert entirely when literally nothing was spent (e.g. the model
      // never responded at all).
      if (error.usage.inputTokens > 0 || error.usage.outputTokens > 0) {
        await recordCost({
          missionId: null,
          organizationId: organization.id,
          agentId: agent?.id ?? null,
          model: error.usage.model,
          inputTokens: error.usage.inputTokens,
          outputTokens: error.usage.outputTokens,
          usdCost,
        });
      }
      await recordActivity({
        missionId: null,
        actor: "business_analyst",
        action: "research_failed",
        detail: error.message,
      });

      // Still settle with the real (possibly null) cost — a failed-but-
      // billed run genuinely spent money and must count against the
      // organization's committed spend, same as a successful one.
      await settleReservation(reservation.id, usdCost);

      return saved as BusinessAnalystReportRecord<BusinessAnalystReport>;
    }
    // An unexpected error (not even a BusinessAnalystResearchError) means
    // nothing was persisted or billed — release the reservation rather
    // than settling it with a fabricated cost, so it stops counting
    // against the organization's budget.
    await releaseReservation(reservation.id).catch(() => {
      // Never let a cleanup failure mask the real underlying error below.
    });
    throw error;
  }
}

export async function listFounderResearchReports(
  founderId: string,
): Promise<BusinessAnalystReportRecord<BusinessAnalystReport>[]> {
  return listBusinessAnalystReportsForFounder(founderId) as unknown as Promise<
    BusinessAnalystReportRecord<BusinessAnalystReport>[]
  >;
}

export async function getFounderResearchReport(
  id: string,
  founderId: string,
): Promise<BusinessAnalystReportRecord<BusinessAnalystReport>> {
  const report = await getBusinessAnalystReport(id);
  if (!report || report.founder_id !== founderId) {
    throw new BusinessAnalystReportNotFoundError(id);
  }
  return report as unknown as BusinessAnalystReportRecord<BusinessAnalystReport>;
}
