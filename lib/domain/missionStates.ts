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
  // "researching" is the automatic targeted follow-up pass (see
  // missionWorkflow.ts's MAX_RESEARCH_PASSES) — the only real way out of
  // this state besides a founder cancelling. The old
  // ready_for_founders_review/rejected/failed edges here were legal in
  // the graph but structurally unreachable (nothing ever called
  // transitionMissionState with awaiting_evidence as the fromState) —
  // dropped rather than left as a misleading dead path; a settled
  // follow-up pass now reaches those states via researching, same as the
  // original pass always did.
  awaiting_evidence: ["researching", "cancelled"],
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

/**
 * Thrown when a transition was legal in the state graph (assertTransition
 * passed) but the atomic conditional database update still didn't apply —
 * meaning the mission's real, persisted state had already moved on by the
 * time the write happened (a genuine concurrent change, e.g. a founder
 * cancelling while an agent's work was still in flight). Distinct from
 * IllegalMissionTransitionError, which means the move was never legal at
 * all, regardless of timing.
 */
export class MissionConcurrencyError extends Error {
  constructor(
    readonly missionId: string,
    readonly expectedStates: MissionState[],
    readonly toState: MissionState,
    readonly actualState: MissionState,
  ) {
    super(
      `Mission ${missionId} was expected to be in ${expectedStates.join("/")} when moving it to "${toState}", but it is now "${actualState}" — it must have changed concurrently.`,
    );
    this.name = "MissionConcurrencyError";
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

/**
 * The HQ office view's mission dock shows a compact, 6-bucket summary
 * rather than all 9 real states — this is the one place that coarser
 * grouping is defined, so both the dock and any test asserting on it stay
 * in sync with the real state machine above. No state is invented or
 * dropped: every one of the 9 real states maps to exactly one bucket.
 *  - "queued" joins "researching" — both mean Scout is dispatched or
 *    actively working; there's no meaningful visual distinction for a
 *    founder glancing at the dock.
 *  - "rejected" joins "ready_for_founders_review" under "completed" —
 *    both mean Scout finished its research and reached a real verdict;
 *    "rejected" is a genuine outcome, not a failure of the process.
 *  - "cancelled" joins "failed" — neither reached a real research verdict.
 */
export const MISSION_DOCK_BUCKETS = [
  "draft",
  "awaiting_approval",
  "researching",
  "awaiting_evidence",
  "completed",
  "failed",
] as const;

export type MissionDockBucket = (typeof MISSION_DOCK_BUCKETS)[number];

export const MISSION_DOCK_BUCKET_LABELS: Record<MissionDockBucket, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  researching: "Researching",
  awaiting_evidence: "Awaiting evidence",
  completed: "Completed",
  failed: "Failed",
};

const STATE_TO_DOCK_BUCKET: Record<MissionState, MissionDockBucket> = {
  draft: "draft",
  awaiting_founder_approval: "awaiting_approval",
  queued: "researching",
  researching: "researching",
  awaiting_evidence: "awaiting_evidence",
  ready_for_founders_review: "completed",
  rejected: "completed",
  failed: "failed",
  cancelled: "failed",
};

export function missionDockBucket(state: MissionState): MissionDockBucket {
  return STATE_TO_DOCK_BUCKET[state];
}
