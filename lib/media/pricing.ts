import "server-only";
import { UnpricedProviderError } from "./types";

// Per-unit USD pricing for the real media providers Content Bot is allowed
// to call. Mirrors lib/agents/pricing.ts's own philosophy exactly: used
// only to record real spend, never to estimate or promise savings/profit,
// and an unpriced provider/model throws rather than silently recording a
// wrong (or zero) cost. Keep these in sync with each vendor's live pricing
// page — this market moves quickly; the figures below are the September
// 2026 research recorded in CLAUDE.md's Content Bot milestone and the
// implementation plan, not a live-queried price.
//
// C1 only wires up image (fal.ai), voice (ElevenLabs), and assembly
// (Shotstack) — video generation (fal.ai hosting Kling/Veo) is C1.5's own
// milestone and deliberately has no entry here yet; adding one is exactly
// the "smallest architecture-compatible correction" this table is built to
// take without any other change.
const MEDIA_PRICING_PER_UNIT: Record<string, Record<string, number>> = {
  "fal-ai": {
    // Per generated image.
    "fal-ai/flux/schnell": 0.003,
  },
  elevenlabs: {
    // Per character of input text.
    eleven_turbo_v2_5: 0.00005, // $0.05 / 1,000 characters
    eleven_multilingual_v2: 0.0001, // $0.10 / 1,000 characters
  },
  shotstack: {
    // Per second of rendered output — Shotstack's own PAYG pricing is
    // quoted per minute (~$0.07-$0.40/min depending on tier); this is the
    // low end, converted to a per-second rate, matching the modest
    // vertical/HD short-form renders Content Bot produces.
    default: 0.07 / 60,
  },
};

/**
 * Priced BEFORE any spend — the pipeline's `assertItemBudgetRemaining`
 * step (lib/domain/contentProduction.ts) calls this pre-flight, and a
 * throw here means the call is never made at all. Also used after a real
 * call, with the real measured quantity, to record the actual charge.
 */
export function calculateMediaUsdCost(provider: string, model: string, quantity: number): number {
  const table = MEDIA_PRICING_PER_UNIT[provider];
  const perUnit = table?.[model];
  if (perUnit === undefined) {
    throw new UnpricedProviderError(provider, model);
  }
  return perUnit * quantity;
}
