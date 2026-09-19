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
 * starts there and attempting to parse it, and returns the first one that
 * parses successfully. This is what lets a real response survive short
 * explanatory text around the JSON — a naive first-"{"-to-last-"}" slice
 * can't distinguish that from the real object.
 */
export function findFirstParseableJsonObject(text: string): unknown | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const candidate = extractBalancedObjectAt(text, i);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The full three-layer fallback ladder: a direct parse, then a fenced
 * extraction, then a balanced-brace scan. Returns null (never throws) if
 * nothing parses — the caller decides what "no JSON found" means for its
 * own error type.
 */
export function parseJsonWithFallbacks(rawText: string): unknown | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = extractFencedJson(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced);
    } catch {
      // fall through — the general scan below still gets a chance
    }
  }

  return findFirstParseableJsonObject(trimmed);
}
