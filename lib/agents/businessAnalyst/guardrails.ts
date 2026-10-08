import type { BusinessAnalystReport } from "./schema";

/**
 * Independent of Scout's guardrails.ts (lib/agents/scout/guardrails.ts) —
 * deliberately not imported or reused, so Scout's own file stays
 * completely untouched (see CLAUDE.md's "protect Scout" instruction).
 * Same philosophy as Scout's own: a generic, structural walk over every
 * string value anywhere in the report, not a maintained field-name list —
 * so a future field added to BusinessAnalystReportSchema is covered
 * automatically.
 */

const GUARANTEE_PATTERNS: RegExp[] = [
  /\bguaranteed?\b/i,
  /\bwill (definitely|certainly) (succeed|sell|work|profit)/i,
  /\bno[\s-]?risk\b/i,
  /\bcan't (fail|lose)\b/i,
  /\b100% (certain|sure)\b/i,
  /\bsure(-|\s)?fire\b/i,
];

export interface GuardrailViolation {
  field: string;
  matchedText: string;
}

function collectViolations(value: unknown, path: string, violations: GuardrailViolation[]): void {
  if (typeof value === "string") {
    for (const pattern of GUARANTEE_PATTERNS) {
      const match = value.match(pattern);
      if (match) {
        violations.push({ field: path || "(root)", matchedText: match[0] });
        return;
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectViolations(item, `${path}[${index}]`, violations));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectViolations(nested, path ? `${path}.${key}` : key, violations);
    }
  }
}

export function findGuaranteeLanguage(report: BusinessAnalystReport): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  collectViolations(report, "", violations);
  return violations;
}

/** At least one real source — never a report with zero evidence behind it. */
export function hasAtLeastOneSource(report: BusinessAnalystReport): boolean {
  return report.sources.length > 0;
}
