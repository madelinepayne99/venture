// Deliberately its own file with zero server-only dependency — the same
// split this codebase already uses for missionStates.ts / contentItemStates.ts
// (plain domain logic, safe to import from a client component) versus
// contentFailureClassification.ts (the actual classifier, which inspects
// real server-side error objects and does carry "server-only"). The UI
// (ContentDecisionBar.tsx) needs to know whether a persisted category is
// eligible for Retry Production without ever pattern-matching failure_reason
// text itself — this file is the one place that answer lives.

export type ContentFailureCategory =
  | "provider_auth"
  | "provider_unavailable"
  | "provider_network"
  | "model_output_contract"
  | "budget_exhausted"
  | "unclassified";

/**
 * Categories eligible for the narrow, founder-triggered Retry Production
 * action (see contentWorkflow.ts's retryProductionAfterTechnicalFailure).
 * A closed allow-list, not a deny-list — a new failure shape introduced
 * later defaults to NOT retryable until someone deliberately adds it here.
 *
 * "model_output_contract" (added after a real live failure — Creative
 * Strategy's own prompt didn't state the schema's exact character limits,
 * so the model's real answer failed Zod validation) is recoverable for the
 * same reason a provider outage is: it is never the founder's brief or
 * creative concept at fault, it's our own prompt/schema contract, and a
 * retry after that contract is fixed has a real chance of succeeding —
 * see classifyProductionFailure's own doc comment for exactly which
 * failures this covers (a genuine Zod structural mismatch) and which it
 * deliberately does not (a refusal, which is a content-policy concern, not
 * a contract bug).
 */
export const RECOVERABLE_FAILURE_CATEGORIES: ReadonlySet<ContentFailureCategory> = new Set([
  "provider_auth",
  "provider_unavailable",
  "provider_network",
  "model_output_contract",
]);

export function isRecoverableFailureCategory(category: string | null | undefined): boolean {
  return Boolean(category) && RECOVERABLE_FAILURE_CATEGORIES.has(category as ContentFailureCategory);
}

export const CONTENT_FAILURE_CATEGORY_LABELS: Record<ContentFailureCategory, string> = {
  provider_auth: "Provider authentication/permission problem",
  provider_unavailable: "Provider temporarily unavailable",
  provider_network: "Network/connectivity problem reaching a provider",
  model_output_contract: "Content Bot's structured output didn't match our own schema",
  budget_exhausted: "Budget exhausted",
  unclassified: "Unclassified failure",
};
