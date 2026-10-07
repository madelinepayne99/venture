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
  // Reversed word order ("profit is assured") — a real live example needed
  // this covered in either direction, not just "assured profit".
  /\b(profit|revenue|success|sales) (is|are|was|were) assured\b/i,
  /\b(100%|guaranteed) (profit|return|success)\b/i,
];

// A live guardrail rejection ($0.30 of real research discarded) traced to
// this exact gap: the scan above is a pure substring match with no
// awareness of negation, so it rejected Scout's own honest hedge
// ("success cannot be guaranteed") identically to a real promise
// ("demand is guaranteed") — even though rule 1 of Scout's own system
// prompt explicitly instructs it to hedge forward-looking claims this way.
// This is a real defect in the validator, not a problem with Scout's
// output. The fix is a small, LOCAL negation check (not a rewrite of the
// scan): a match is excused only when an explicit negation cue appears
// within NEGATION_WINDOW_WORDS words immediately before it, in the same
// sentence. Deliberately narrow and local, not "anywhere earlier in the
// sentence" — every hedge this guardrail needs to allow ("cannot be
// guaranteed", "no guarantee this will...", "not risk-free", "no assured
// revenue exists") has its negation word 1-2 words before the match; a
// wider window risks letting an unrelated earlier negation (e.g. "No
// doubt, demand is guaranteed") shield a genuine, later, separate
// certainty claim. See scoutResearch.test.ts's adversarial cases, which
// prove this boundary both ways rather than asserting a number.
const NEGATION_CUES: string[] = [
  "not",
  "never",
  "cannot",
  "can't",
  "couldn't",
  "won't",
  "wouldn't",
  "isn't",
  "aren't",
  "no",
  "without",
  "far from",
  "unlikely to be",
];

const NEGATION_WINDOW_WORDS = 3;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

/** True when an explicit negation cue appears within the local word window immediately before this match, in the same sentence. */
function isExplicitlyNegated(sentence: string, matchIndex: number): boolean {
  const precedingWords = sentence
    .slice(0, matchIndex)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const window = precedingWords.slice(-NEGATION_WINDOW_WORDS).join(" ").toLowerCase();
  const windowWords = window.split(" ");
  return NEGATION_CUES.some((cue) => (cue.includes(" ") ? window.includes(cue) : windowWords.includes(cue)));
}

// A live mission ("Find Our Next Viral Short") proved a real contract gap:
// Scout's own prose (verdict_rationale / recommended_next_action) can
// unconditionally tell founders to go produce the content while the
// structured production_recommendation object — the ONLY thing the real
// Approve-for-Production gate and Content Bot hand-off ever look at — is
// simply absent. Unlike the certainty-language check above, this is NOT
// prohibited content to reject the whole report over: it would throw away
// an otherwise-valid, already-paid-for research report (see CLAUDE.md's
// Milestone 5.1 note on never discarding valid work over a validator
// issue). The caller (missionWorkflow.ts) surfaces this as a flag on the
// mission's real activity log instead — the research/report/evidence are
// preserved exactly as returned; production is (correctly) never
// available regardless, since that gate already requires
// production_recommendation to exist. This function never infers or
// fabricates the missing object — it only detects the inconsistency.
const PRODUCTION_DIRECTIVE_PATTERNS: RegExp[] = [
  /\brecommend(?:ing|ed)? (?:a |the )?pilot\b/i,
  /\bproduce (?:one|a|this|the)\b[^.?!]{0,40}\b(?:video|short|pilot)\b/i,
  /\b(?:make|film|shoot) (?:one|a|this|the)\b[^.?!]{0,40}\b(?:video|short|pilot)\b/i,
  /\bgreenlight (?:this|the)\b[^.?!]{0,20}\b(?:video|short|pilot|concept)\b/i,
];

// Genuine conditional/hedge cues that turn a directive-shaped sentence into
// a hedged suggestion rather than a command — checked for anywhere EARLIER
// in the same sentence than the directive match (not a tight word window,
// unlike NEGATION_WINDOW_WORDS above): a false negative here (occasionally
// missing a real directive) is the safer failure mode than a false
// positive that would otherwise flag a legitimately hedged report and
// waste a real, already-completed research call.
const CONDITIONAL_CUES: string[] = [
  "if ",
  "once ",
  "provided that",
  "assuming",
  "before",
  "whether",
  "pending",
  "subject to",
  "consider",
  "could consider",
  "may want to",
  "would need",
];

function hasPrecedingConditionalCue(sentence: string, matchIndex: number): boolean {
  const before = sentence.slice(0, matchIndex).toLowerCase();
  return CONDITIONAL_CUES.some((cue) => before.includes(cue));
}

export interface ProductionRecommendationInconsistency {
  field: "verdict_rationale" | "recommended_next_action";
  matchedText: string;
}

/**
 * Detects (never fabricates or resolves) the contract gap above: Scout's
 * prose unconditionally recommends producing the content, but
 * production_recommendation is absent. Returns [] whenever
 * production_recommendation is present — there is nothing to reconcile in
 * that case, whatever the prose says.
 */
export function findProductionRecommendationInconsistency(
  report: ScoutReport,
): ProductionRecommendationInconsistency[] {
  if (report.production_recommendation) return [];

  const violations: ProductionRecommendationInconsistency[] = [];
  for (const field of ["verdict_rationale", "recommended_next_action"] as const) {
    for (const sentence of splitSentences(report[field])) {
      for (const pattern of PRODUCTION_DIRECTIVE_PATTERNS) {
        const match = sentence.match(pattern);
        if (match && typeof match.index === "number" && !hasPrecedingConditionalCue(sentence, match.index)) {
          violations.push({ field, matchedText: match[0] });
        }
      }
    }
  }
  return violations;
}

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
    for (const sentence of splitSentences(value)) {
      for (const pattern of BANNED_PATTERNS) {
        const match = sentence.match(pattern);
        if (match && typeof match.index === "number" && !isExplicitlyNegated(sentence, match.index)) {
          violations.push({ field: path, matchedText: match[0] });
        }
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

/**
 * Structural check on the Scout -> Content Bot hand-off itself: a
 * production_recommendation's supporting_evidence_urls must be a genuine
 * subset of the URLs Scout actually cited in this same report (its
 * sources or verified_facts) — never a URL invented, or lifted from
 * training knowledge, specifically to pad the hand-off. Returns the
 * offending URLs (empty when the recommendation is absent or entirely
 * grounded) so the caller can build a precise error message.
 */
export function findUncitedProductionEvidenceUrls(report: ScoutReport): string[] {
  if (!report.production_recommendation) return [];
  const citedUrls = new Set<string>([
    ...report.sources.map((s) => s.url),
    ...report.verified_facts.map((f) => f.source_url).filter((url): url is string => Boolean(url)),
  ]);
  return report.production_recommendation.supporting_evidence_urls.filter((url) => !citedUrls.has(url));
}
