import "server-only";
import { ZodError } from "zod";
import { MediaProviderError } from "@/lib/media/types";
import {
  ContentVersionCapExceededError,
  ContentGenerationAttemptCapExceededError,
  ContentAssetCallCapExceededError,
  ContentBudgetExceededError,
} from "@/lib/domain/contentProduction";
import { ContentGuardrailError } from "@/lib/agents/contentBot/guardrails";
import { ContentBotError } from "@/lib/agents/contentBot/errors";
import type { ContentFailureCategory } from "@/lib/domain/contentFailureCategories";

export type { ContentFailureCategory } from "@/lib/domain/contentFailureCategories";
export {
  RECOVERABLE_FAILURE_CATEGORIES,
  isRecoverableFailureCategory,
  CONTENT_FAILURE_CATEGORY_LABELS,
} from "@/lib/domain/contentFailureCategories";

const AUTH_STATUSES = new Set([401, 403]);
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * The one, structured classification of why a content item's production
 * attempt genuinely failed (state "failed" — never "blocked", which
 * already means something categorically different: a safety refusal, not
 * a technical breakdown). This is the single source of truth
 * retryProductionAfterTechnicalFailure and every other caller checks — the
 * UI never inspects failure_reason's free text to decide anything, and
 * this function never pattern-matches a message string either:
 * classification is derived from real, structured signals (a real HTTP
 * status code on MediaProviderError, a structured network-error `cause`,
 * or the concrete error class thrown) — see the real bug this exists for
 * (CLAUDE.md's Content Bot milestone, C1 follow-up): a founder-commissioned
 * mission's Version 2 failed with a 401 from ElevenLabs because the
 * configured key lacked "voices_read" — a genuinely recoverable,
 * technical, no-fault-of-the-plan problem, indistinguishable from a real
 * safety/budget/content failure only if nothing records WHY it failed.
 *
 * Guardrail rejections and the model safety judge's "block" verdict never
 * reach this function at all — they settle to "blocked" through their own,
 * separate path (see runContentProductionPipeline) — so this function's
 * job is only ever to distinguish genuine technical breakdowns from the
 * two OTHER things that can still legitimately settle to "failed": a real
 * budget/cap refusal, and anything unrecognized.
 */
export function classifyProductionFailure(error: unknown): ContentFailureCategory {
  if (error instanceof MediaProviderError) {
    if (AUTH_STATUSES.has(error.status)) return "provider_auth";
    if (TRANSIENT_STATUSES.has(error.status)) return "provider_unavailable";
    return "unclassified"; // a real provider error, but not a status we can confidently call safe to retry
  }

  // A genuine network-level failure (DNS, connection refused/reset, a real
  // timeout) throws before any HTTP response exists at all — Node's fetch
  // attaches a structured `cause.code` from the underlying network stack,
  // which is a real, structured signal, not a message-text guess.
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  const NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);
  if (cause?.code && NETWORK_ERROR_CODES.has(cause.code)) {
    return "provider_network";
  }

  if (
    error instanceof ContentVersionCapExceededError ||
    error instanceof ContentGenerationAttemptCapExceededError ||
    error instanceof ContentAssetCallCapExceededError ||
    error instanceof ContentBudgetExceededError
  ) {
    return "budget_exhausted";
  }

  // A real, live failure (Creative Strategy's own prompt not stating the
  // schema's exact character limits) proved this needs its own category:
  // ContentBotError.cause_ is the real Zod validation error whenever the
  // failure was "the model's structured response didn't match our own
  // schema" (planContentVersion/planCreativeStrategy/reviewContentSafety/
  // reviewVisualQuality all pass their real `validation.error` as cause_ —
  // see each file's own structural-validation throw). That is a genuine
  // technical contract mismatch, never the founder's fault, and a retry
  // has a real chance of succeeding once the prompt/schema are realigned —
  // deliberately narrower than "any ContentBotError": a refusal or a
  // truncated/non-JSON response (cause_ undefined here) is a different
  // failure shape with its own considerations and stays unclassified
  // rather than being folded in.
  if (error instanceof ContentBotError && error.cause_ instanceof ZodError) {
    return "model_output_contract";
  }

  // Guardrail failures are listed here only to be explicit that they are
  // deliberately EXCLUDED from ever producing a recoverable category, even
  // though in practice a guardrail rejection (or the model safety judge's
  // "block" verdict, contentWorkflow.ts's own ContentSafetyBlocked — not
  // importable here without a circular import, but the same reasoning
  // applies) never reaches "failed" at all — it settles to "blocked"
  // through its own, entirely separate path.
  if (error instanceof ContentGuardrailError) {
    return "unclassified";
  }

  return "unclassified";
}
