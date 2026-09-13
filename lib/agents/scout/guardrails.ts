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

const SCANNED_TEXT_FIELDS: Array<keyof ScoutReport> = [
  "evidence_of_demand",
  "opportunity_gaps",
  "originality_considerations",
  "verdict_rationale",
];

export interface GuardrailViolation {
  field: string;
  matchedText: string;
}

export function findGuaranteeLanguage(report: ScoutReport): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  for (const field of SCANNED_TEXT_FIELDS) {
    const value = report[field];
    if (typeof value !== "string") continue;
    for (const pattern of BANNED_PATTERNS) {
      const match = value.match(pattern);
      if (match) {
        violations.push({ field, matchedText: match[0] });
      }
    }
  }

  const costEstimate = report.likely_costs?.estimate;
  if (typeof costEstimate === "string") {
    for (const pattern of BANNED_PATTERNS) {
      const match = costEstimate.match(pattern);
      if (match) {
        violations.push({ field: "likely_costs.estimate", matchedText: match[0] });
      }
    }
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
