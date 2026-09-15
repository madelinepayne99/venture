import type { ScoutReport } from "./schema";

// Defense in depth: the system prompt instructs Scout never to promise
// guaranteed demand/revenue/profit, but model output isn't fully
// controllable, so we also scan every string in the report ourselves. A
// hit here rejects the report outright (see runScoutResearch) rather than
// letting the claim through in any form.
const BANNED_PATTERNS: RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bwill (definitely|certainly) sell\b/i,
  /\bcertain(ly)? (to|of) (sell|profit|succeed)\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  /\bassured (profit|revenue|success|sales)\b/i,
  /\b(100%|guaranteed) (profit|return|success)\b/i,
];

export interface GuardrailViolation {
  field: string;
  matchedText: string;
}

/**
 * Recursively walks every string value in `value` (through nested objects
 * and arrays alike) and scans each one against BANNED_PATTERNS, recording
 * violations with a JSON-path-style `field` label (e.g.
 * "verified_facts[0].statement", "platform_suitability.etsy_downloads").
 *
 * This replaces an earlier version that scanned a manually maintained list
 * of field names — that list quietly went stale as fields were added (a
 * live report's evidence_of_demand tripped the guardrail correctly, but
 * fields like competition_observations, verified_facts, inferences,
 * unresolved_questions, and every Service Business field were never
 * scanned at all). A generic walk over the whole object is complete by
 * construction: every string in the report is covered automatically,
 * including any field a future workspace variant adds, with nothing to
 * remember to update here.
 */
function collectViolations(value: unknown, path: string, violations: GuardrailViolation[]): void {
  if (typeof value === "string") {
    for (const pattern of BANNED_PATTERNS) {
      const match = value.match(pattern);
      if (match) {
        violations.push({ field: path, matchedText: match[0] });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectViolations(item, `${path}[${index}]`, violations));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectViolations(nested, path ? `${path}.${key}` : key, violations);
    }
  }
}

export function findGuaranteeLanguage(report: ScoutReport): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  collectViolations(report, "", violations);
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
