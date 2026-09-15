import type { ScoutReport } from "./schema";

// Defense in depth: the system prompt instructs Scout never to promise
// guaranteed demand/revenue/profit, but model output isn't fully
// controllable, so we also scan the free-text fields ourselves. A hit here
// downgrades the verdict rather than silently passing the claim through.
const BANNED_PATTERNS: RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bwill (definitely|certainly) sell\b/i,
  /\bcertain(ly)? (to|of) (sell|profit|succeed)\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  /\bassured (profit|revenue|success|sales)\b/i,
  /\b(100%|guaranteed) (profit|return|success)\b/i,
];

// Fields present on every workspace's report (see the shared core in
// schema.ts) — scanned regardless of workspace_type.
const CORE_SCANNED_TEXT_FIELDS = ["evidence_of_demand", "verdict_rationale"] as const;

export interface GuardrailViolation {
  field: string;
  matchedText: string;
}

function scanField(violations: GuardrailViolation[], field: string, value: unknown): void {
  if (typeof value !== "string") return;
  for (const pattern of BANNED_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      violations.push({ field, matchedText: match[0] });
    }
  }
}

/**
 * Workspace-specific free-text fields to scan, beyond the shared core
 * above — kept in one place so adding a new workspace type only means
 * adding one branch here, not hunting for every scan site.
 */
export function findGuaranteeLanguage(report: ScoutReport): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  for (const field of CORE_SCANNED_TEXT_FIELDS) {
    scanField(violations, field, report[field]);
  }

  if (report.workspace_type === "commerce") {
    scanField(violations, "opportunity_gaps", report.opportunity_gaps);
    scanField(violations, "originality_considerations", report.originality_considerations);
    scanField(violations, "likely_costs.estimate", report.likely_costs?.estimate);
  } else {
    scanField(violations, "service_delivery_considerations", report.service_delivery_considerations);
    scanField(
      violations,
      "client_retention_or_acquisition_gaps",
      report.client_retention_or_acquisition_gaps,
    );
    scanField(
      violations,
      "pricing_or_service_model_considerations.summary",
      report.pricing_or_service_model_considerations?.summary,
    );
  }

  return violations;
}

/**
 * Structural check, independent of the language scan above: a
 * "ready_for_founders_review" verdict must be backed by at least one
 * verified fact grounded in a real, dated source — not just plausible-
 * sounding prose. This deliberately does not require multiple sources:
 * one authoritative, dated source backing one verified fact is enough:
 * the point is to catch "confident report, zero real evidence" (e.g. web
 * search failed entirely and Scout fell back to training knowledge), not
 * to impose an arbitrary source count.
 */
export function hasMeaningfulEvidence(report: ScoutReport): boolean {
  const sourceByUrl = new Map(report.sources.map((source) => [source.url, source]));

  return report.verified_facts.some((fact) => {
    if (!fact.source_url || !fact.source_url.trim()) return false;
    const source = sourceByUrl.get(fact.source_url);
    // The source must actually be listed (not just referenced) and carry a
    // real access date — every entry in `sources` already requires one by
    // schema, so this mainly guards against a fact citing a URL that never
    // made it into the sources list at all.
    return Boolean(source && source.accessed_date);
  });
}
