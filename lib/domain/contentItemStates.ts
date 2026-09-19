import type { ContentItemState } from "@/lib/db/types";

/**
 * The only state transitions Content Bot's production pipeline will
 * perform. Anything not listed here is refused — same discipline as
 * missionStates.ts's ALLOWED_TRANSITIONS, applied to the production
 * lifecycle's own child entity (content_items) rather than to missions
 * directly. See CLAUDE.md's Content Bot milestone for why this is a
 * separate state machine instead of more mission states.
 */
const ALLOWED_TRANSITIONS: Record<ContentItemState, ContentItemState[]> = {
  planning: ["generating", "blocked", "failed", "cancelled"],
  generating: ["awaiting_review", "blocked", "failed", "cancelled"],
  // Distinct from "failed" — a founder must be able to tell "the tool
  // broke" from "we refused to make this." Carries the structured safety
  // verdict and is answerable with revision notes, same as a real review
  // decision.
  blocked: ["revision_requested", "rejected", "cancelled"],
  awaiting_review: ["ready_to_publish", "revision_requested", "rejected", "cancelled"],
  revision_requested: ["generating", "failed", "cancelled"],
  // Approving the piece is not a commitment to publish — revision_requested
  // stays legal from here, exactly as the brief requires two separate
  // gates.
  ready_to_publish: ["publishing", "revision_requested", "rejected", "cancelled"],
  // Deliberately NOT cancellable — once bytes are moving toward a
  // platform, "cancelled" would be a lie. A cancel attempt here is
  // refused with a truthful 409 (see the publish route in Milestone C2).
  publishing: ["published", "publish_failed"],
  publish_failed: ["ready_to_publish", "rejected", "cancelled"],
  published: [],
  rejected: [],
  // Founder may resubmit after a technical failure, same as a mission's
  // own failed -> awaiting_founder_approval edge.
  failed: ["planning", "cancelled"],
  cancelled: [],
};

export function canTransitionContentItem(from: ContentItemState, to: ContentItemState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalContentItemTransitionError extends Error {
  constructor(from: ContentItemState, to: ContentItemState) {
    super(`Cannot move a content item from "${from}" to "${to}".`);
    this.name = "IllegalContentItemTransitionError";
  }
}

export function assertContentItemTransition(from: ContentItemState, to: ContentItemState): void {
  if (!canTransitionContentItem(from, to)) {
    throw new IllegalContentItemTransitionError(from, to);
  }
}

/**
 * Thrown when a transition was legal in the state graph but the atomic
 * conditional database update still didn't apply — the item's real,
 * persisted state had already moved on by the time the write happened
 * (e.g. a founder made a decision while the pipeline was mid-write).
 * Mirrors missionStates.ts's MissionConcurrencyError exactly.
 */
export class ContentItemConcurrencyError extends Error {
  constructor(
    readonly contentItemId: string,
    readonly expectedStates: ContentItemState[],
    readonly toState: ContentItemState,
    readonly actualState: ContentItemState,
  ) {
    super(
      `Content item ${contentItemId} was expected to be in ${expectedStates.join("/")} when moving it to "${toState}", but it is now "${actualState}" — it must have changed concurrently.`,
    );
    this.name = "ContentItemConcurrencyError";
  }
}

export const CONTENT_ITEM_TERMINAL_STATES: ContentItemState[] = ["published", "rejected", "cancelled"];

export function isContentItemTerminal(state: ContentItemState): boolean {
  return CONTENT_ITEM_TERMINAL_STATES.includes(state);
}

/** States from which a founder may cancel a mission's production outright. */
export function isContentItemCancellable(state: ContentItemState): boolean {
  return canTransitionContentItem(state, "cancelled");
}

export const CONTENT_ITEM_STATE_LABELS: Record<ContentItemState, string> = {
  planning: "Planning",
  generating: "Generating",
  blocked: "Blocked — safety review",
  awaiting_review: "Awaiting founder review",
  revision_requested: "Revision requested",
  ready_to_publish: "Ready to publish",
  publishing: "Publishing",
  published: "Published",
  publish_failed: "Publish failed",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
};
