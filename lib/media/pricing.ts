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
// C1 only wired up image (fal.ai), voice (ElevenLabs), and assembly
// (Shotstack) — real generated video (fal.ai hosting Kling) is the
// Minimum Motion Proof-of-Concept's own addition; the full motion-first
// pipeline this unblocks is still future work.
const MEDIA_PRICING_PER_UNIT: Record<string, Record<string, number>> = {
  "fal-ai": {
    // Per generated image.
    "fal-ai/flux/schnell": 0.003,
    // Per generated image — real, documented price ($0.04/image, stated
    // as "Fixed $0.04 cost per image edit" on fal.ai's own model page),
    // not estimated. Used only for reference-conditioned generation (see
    // ImageRequest.referenceImageUrl) — a real ~13x per-image cost over
    // the plain text-to-image model above, which is why it's used only
    // for the reference image itself and the conditioned beat/thumbnail
    // batch, never as a blanket replacement for flux/schnell.
    "fal-ai/flux-pro/kontext": 0.04,
    // Per SECOND of generated video, audio OFF — real, documented price
    // from fal.ai's own model page ("$0.112" per second with audio off;
    // audio-on tiers are materially more expensive and deliberately never
    // used — see KlingVideoProvider's own doc comment for why generate_audio
    // is hardcoded false). Quantity passed to calculateMediaUsdCost is the
    // real requested clip duration in seconds, matching this table's other
    // per-second entries (Shotstack) exactly.
    "fal-ai/kling-video/v3/pro/image-to-video": 0.112,
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
