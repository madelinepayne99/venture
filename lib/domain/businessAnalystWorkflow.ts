import "server-only";
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
import { runBusinessAnalystResearch, BusinessAnalystResearchError } from "@/lib/agents/businessAnalyst";
import { calculateUsdCost } from "@/lib/agents/pricing";
import type { BusinessAnalystReport } from "@/lib/agents/businessAnalyst/schema";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

/**
 * Business Analyst's one real, tested capability: standalone sourced
 * research. Deliberately synchronous (request/response), not dispatched
 * through Inngest the way Scout's research is — this is a first, simpler
 * slice; a real research call can take tens of real seconds, a known,
 * documented tradeoff (see docs/operations-build-progress.md), not an
 * oversight. Real spend is recorded via the existing costs/ledger_entries
 * tables with missionId: null (already nullable — zero schema changes
 * needed there) rather than inventing a parallel ledger.
 */

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

      return saved as BusinessAnalystReportRecord<BusinessAnalystReport>;
    }
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
