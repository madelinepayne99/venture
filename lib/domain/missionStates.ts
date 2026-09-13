import type { MissionState } from "@/lib/db/types";

/**
 * The only state transitions the mission workflow will perform. Anything
 * not listed here is refused — there is no "just set the field" escape
 * hatch, so the UI can never show a state the workflow didn't actually
 * reach.
 */
const ALLOWED_TRANSITIONS: Record<MissionState, MissionState[]> = {
  draft: ["awaiting_founder_approval", "cancelled"],
  awaiting_founder_approval: ["queued", "cancelled"],
  queued: ["researching", "cancelled"],
  researching: [
    "awaiting_evidence",
    "ready_for_founders_review",
    "rejected",
    "failed",
    "cancelled",
  ],
  awaiting_evidence: ["ready_for_founders_review", "rejected", "cancelled", "failed"],
  ready_for_founders_review: ["cancelled"],
  rejected: [],
  failed: ["awaiting_founder_approval"], // founder may resubmit after a technical failure
  cancelled: [],
};

export function canTransition(from: MissionState, to: MissionState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalMissionTransitionError extends Error {
  constructor(from: MissionState, to: MissionState) {
    super(`Cannot move a mission from "${from}" to "${to}".`);
    this.name = "IllegalMissionTransitionError";
  }
}

export function assertTransition(from: MissionState, to: MissionState): void {
  if (!canTransition(from, to)) {
    throw new IllegalMissionTransitionError(from, to);
  }
}

export const TERMINAL_STATES: MissionState[] = ["rejected", "cancelled"];

export function isTerminal(state: MissionState): boolean {
  return TERMINAL_STATES.includes(state) || state === "ready_for_founders_review";
}

/** States from which a founder may cancel a mission outright. */
export function isCancellable(state: MissionState): boolean {
  return canTransition(state, "cancelled");
}

export const MISSION_STATE_LABELS: Record<MissionState, string> = {
  draft: "Draft",
  awaiting_founder_approval: "Awaiting founder approval",
  queued: "Queued",
  researching: "Researching",
  awaiting_evidence: "Awaiting evidence",
  ready_for_founders_review: "Ready for founders' review",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
};
