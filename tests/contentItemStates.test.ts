import { describe, expect, it } from "vitest";
import type { ContentItemState } from "@/lib/db/types";
import {
  canTransitionContentItem,
  isContentItemCancellable,
  isContentItemTerminal,
  CONTENT_ITEM_STATE_LABELS,
  CONTENT_ITEM_TERMINAL_STATES,
} from "@/lib/domain/contentItemStates";

const ALL_STATES: ContentItemState[] = [
  "planning",
  "generating",
  "blocked",
  "awaiting_review",
  "revision_requested",
  "ready_to_publish",
  "publishing",
  "publish_failed",
  "published",
  "rejected",
  "failed",
  "cancelled",
];

// The exact real adjacency this app enforces (lib/domain/contentItemStates.ts).
const EXPECTED_TRANSITIONS: Record<ContentItemState, ContentItemState[]> = {
  planning: ["generating", "blocked", "failed", "cancelled"],
  generating: ["awaiting_review", "blocked", "failed", "cancelled"],
  blocked: ["revision_requested", "rejected", "cancelled"],
  awaiting_review: ["ready_to_publish", "revision_requested", "rejected", "cancelled"],
  revision_requested: ["generating", "failed", "cancelled"],
  ready_to_publish: ["publishing", "revision_requested", "rejected", "cancelled"],
  publishing: ["published", "publish_failed"],
  publish_failed: ["ready_to_publish", "rejected", "cancelled"],
  published: [],
  rejected: [],
  failed: ["planning", "cancelled"],
  cancelled: [],
};

describe("content item state machine", () => {
  it("has exactly twelve real states, each with a real label", () => {
    expect(ALL_STATES).toHaveLength(12);
    for (const state of ALL_STATES) {
      expect(CONTENT_ITEM_STATE_LABELS[state]).toEqual(expect.any(String));
      expect(CONTENT_ITEM_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });

  it("matches the exact real adjacency graph — every allowed and every refused transition", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = EXPECTED_TRANSITIONS[from].includes(to);
        expect(canTransitionContentItem(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("never allows cancelling out of publishing — once bytes are moving toward a platform, cancelled would be a lie", () => {
    expect(canTransitionContentItem("publishing", "cancelled")).toBe(false);
    expect(isContentItemCancellable("publishing")).toBe(false);
  });

  it("keeps blocked distinct from failed — a founder must be able to tell 'we refused' from 'the tool broke'", () => {
    expect(canTransitionContentItem("planning", "blocked")).toBe(true);
    expect(canTransitionContentItem("blocked", "revision_requested")).toBe(true);
    expect(canTransitionContentItem("blocked", "failed")).toBe(false);
  });

  it("lets approving the piece stay reversible — ready_to_publish can still go back to revision_requested", () => {
    expect(canTransitionContentItem("ready_to_publish", "revision_requested")).toBe(true);
  });

  it("lets a founder resubmit after a technical failure, same as a mission's failed -> awaiting_founder_approval edge", () => {
    expect(canTransitionContentItem("failed", "planning")).toBe(true);
  });

  it("terminal states are exactly published/rejected/cancelled", () => {
    expect(CONTENT_ITEM_TERMINAL_STATES).toEqual(["published", "rejected", "cancelled"]);
    for (const state of ALL_STATES) {
      expect(isContentItemTerminal(state)).toBe(CONTENT_ITEM_TERMINAL_STATES.includes(state));
    }
  });

  it("cancellable states are exactly those with a real cancelled edge", () => {
    for (const state of ALL_STATES) {
      expect(isContentItemCancellable(state)).toBe(EXPECTED_TRANSITIONS[state].includes("cancelled"));
    }
  });
});
