import "server-only";
import { contentItemSpendUsd } from "@/lib/db/repositories";

// Content Bot is where real spend enforcement starts (see CLAUDE.md's
// Content Bot milestone, §19) — Scout's costs/ledger_entries stay purely
// observational, which is correct for a two-pass-capped, token-priced
// agent; wrong for an unbounded founder-driven revision loop with
// per-second/per-character media pricing. These are version-controlled
// tuning constants, deliberately not env vars — same reasoning as
// missionWorkflow.ts's MAX_RESEARCH_PASSES: a cost/quality knob that
// should go through code review, not a silent deployment-time change.
export const MAX_VERSIONS_PER_ITEM = 5;
export const MAX_GENERATION_ATTEMPTS_PER_VERSION = 2;
export const MAX_ASSET_CALLS_PER_VERSION = 20;
export const MAX_ITEM_SPEND_USD = 8.0;

export class ContentVersionCapExceededError extends Error {
  constructor(readonly contentItemId: string) {
    super(
      `Content item ${contentItemId} has already reached its cap of ${MAX_VERSIONS_PER_ITEM} versions — no further revision can be produced.`,
    );
    this.name = "ContentVersionCapExceededError";
  }
}

export class ContentGenerationAttemptCapExceededError extends Error {
  constructor(readonly contentItemId: string) {
    super(
      `Content item ${contentItemId} has already used ${MAX_GENERATION_ATTEMPTS_PER_VERSION} generation attempts on its current version — refusing to try again automatically.`,
    );
    this.name = "ContentGenerationAttemptCapExceededError";
  }
}

export class ContentAssetCallCapExceededError extends Error {
  constructor(
    readonly contentItemId: string,
    readonly plannedCalls: number,
  ) {
    super(
      `This version's plan would require ${plannedCalls} real provider calls, above the ${MAX_ASSET_CALLS_PER_VERSION}-call cap per version — refusing before spending anything on it.`,
    );
    this.name = "ContentAssetCallCapExceededError";
  }
}

export class ContentBudgetExceededError extends Error {
  constructor(
    readonly contentItemId: string,
    readonly spentUsd: number,
    readonly estimatedUsd: number,
  ) {
    super(
      `Content item ${contentItemId} would exceed its $${MAX_ITEM_SPEND_USD.toFixed(2)} production budget — already spent $${spentUsd.toFixed(2)}, and this call is estimated at ~$${estimatedUsd.toFixed(2)}.`,
    );
    this.name = "ContentBudgetExceededError";
  }
}

/**
 * The pre-flight budget gate — called BEFORE every real, paid provider
 * call (Claude planning/safety calls and every media-provider call
 * alike), never after. Throws before any spend happens; mirrors
 * lib/media/pricing.ts's calculateMediaUsdCost's "throw on unpriced,
 * never fabricate" philosophy applied to a running total instead of a
 * single price lookup.
 */
export async function assertItemBudgetRemaining(contentItemId: string, estimatedUsd: number): Promise<void> {
  const spent = await contentItemSpendUsd(contentItemId);
  if (spent + estimatedUsd > MAX_ITEM_SPEND_USD) {
    throw new ContentBudgetExceededError(contentItemId, spent, estimatedUsd);
  }
}
