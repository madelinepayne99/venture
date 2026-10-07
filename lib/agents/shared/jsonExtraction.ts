import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

// Extracted from Scout's original index.ts (Milestone 1) so Content Bot's
// own structured-output parsing can reuse it verbatim rather than
// duplicating ~90 lines of tricky, already-battle-tested logic — no
// behavior change for Scout, just a relocation. Neither agent has an
// enforced structured-output mode in this SDK version, so both are
// instructed via their system prompts to return matching JSON; this is
// the same three-layer fallback ladder either one parses that text with.

export function extractRawText(content: Anthropic.Message["content"]): string {
  const textBlocks = content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return textBlocks.map((block) => block.text).join("");
}

/**
 * Extracts the content of a Markdown-style code fence (```json ... ``` or a
 * plain ``` ... ```), if the text has one. A real response sometimes wraps
 * the object in one even when the prompt asks it not to (and/or adds a
 * short sentence of prose before/after it).
 */
export function extractFencedJson(text: string): string | null {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  return match ? (match[1] ?? "").trim() : null;
}

/**
 * Scans `text` starting at index `start` (which must point at a `{`) for
 * the matching closing brace, tracking nesting depth and skipping over
 * braces that appear inside a JSON string literal (so a stray "{"/"}"
 * inside a quoted value — or inside surrounding prose — can't prematurely
 * end the match). Returns the balanced `{...}` substring, or null if the
 * object never closes.
 */
export function extractBalancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Tries every "{" in `text` in order, extracting the balanced object that
 * starts there and attempting to parse it. This is what lets a real
 * response survive short explanatory text around the JSON — a naive
 * first-"{"-to-last-"}" slice can't distinguish that from the real object.
 *
 * `isValid`, when supplied, is a real structural check (typically a Zod
 * schema's `safeParse(...).success`) — a live failure (Content Bot's
 * Production 5, "every top-level field undefined") showed why this
 * matters: without it, a response that parses as ONE complete, valid, but
 * WRONG-SHAPED JSON document (e.g. the real plan nested one level too
 * deep under an unexpected wrapper key) satisfies "first thing that
 * parses" immediately, on the very first candidate, and nothing ever
 * looks any further for the real object. With `isValid` supplied, every
 * candidate is still tried in the same left-to-right order, but the
 * first one that ALSO satisfies it wins — falling back to the first
 * merely-parseable candidate (the old, validator-unaware behavior) only
 * if nothing ever validates, so a genuinely bad response still produces
 * the caller's own real schema error instead of this function inventing
 * a different "nothing parsed" outcome. Deliberately structural, never
 * name-based — no wrapper key name is ever inspected or assumed, so this
 * works for literally any wrapper shape, not just one hardcoded key.
 */
export function findFirstParseableJsonObject(
  text: string,
  isValid?: (candidate: unknown) => boolean,
): unknown | null {
  let firstParseable: unknown | undefined;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const candidate = extractBalancedObjectAt(text, i);
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isValid) return parsed; // no validator supplied — exact original behavior, unchanged
    if (isValid(parsed)) return parsed; // prefer the first candidate that actually matches the caller's schema
    if (firstParseable === undefined) firstParseable = parsed;
  }
  if (!isValid) return null;
  return firstParseable ?? null; // nothing validated — fall back to the first parseable candidate, same as before
}

/**
 * The full three-layer fallback ladder: a direct parse, then a fenced
 * extraction, then a balanced-brace scan. Returns null (never throws) if
 * nothing parses — the caller decides what "no JSON found" means for its
 * own error type.
 *
 * `isValid` (optional, same contract as findFirstParseableJsonObject's
 * own parameter): when omitted, every layer below behaves EXACTLY as
 * before — returns on the first successful parse, full stop. When
 * supplied, each layer only returns immediately on a candidate that also
 * validates; a parseable-but-invalid candidate is remembered (never
 * returned early) so a later layer, or a later position within the
 * balanced-brace scan, still gets the chance to find the real, correctly-
 * shaped object. If nothing anywhere ever validates, this falls back to
 * whatever the validator-unaware ladder would have returned, so the
 * caller's own schema validation still runs and reports its real error —
 * never silently accepted, never replaced with a different failure.
 */
export function parseJsonWithFallbacks(rawText: string, isValid?: (candidate: unknown) => boolean): unknown | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  let firstParseable: unknown | undefined;

  try {
    const direct = JSON.parse(trimmed);
    if (!isValid || isValid(direct)) return direct;
    firstParseable = direct;
  } catch {
    // fall through
  }

  const fenced = extractFencedJson(trimmed);
  if (fenced) {
    try {
      const parsedFenced = JSON.parse(fenced);
      if (!isValid || isValid(parsedFenced)) return parsedFenced;
      if (firstParseable === undefined) firstParseable = parsedFenced;
    } catch {
      // fall through — the general scan below still gets a chance
    }
  }

  const scanned = findFirstParseableJsonObject(trimmed, isValid);
  if (scanned !== null) return scanned;
  return firstParseable ?? null;
}
