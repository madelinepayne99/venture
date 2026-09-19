import "server-only";
import { Inngest } from "inngest";

// With no INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY set (true for local dev and
// tests), this client talks to a local Inngest Dev Server instead of
// Inngest Cloud — no account or credentials required. Those env vars are
// only needed for a real deployment (see CLAUDE.md).
export const inngest = new Inngest({ id: "venture-hq" });

export const MISSION_APPROVED_EVENT = "mission/approved" as const;

export interface MissionApprovedEventData {
  missionId: string;
}

// Fired automatically when a mission's first Scout pass settles into
// "awaiting_evidence" (never by a founder action — see missionWorkflow.ts).
// Same shape and same durable-dispatch pattern as MISSION_APPROVED_EVENT:
// sent, then returned from immediately, actual work happens in the Inngest
// job. A deterministic event id (mission-followup-<missionId>) gives the
// same Inngest-level dedup guarantee the approval event already relies on.
export const MISSION_FOLLOWUP_NEEDED_EVENT = "mission/followup_needed" as const;

export interface MissionFollowupNeededEventData {
  missionId: string;
}

// Fired once, the moment a founder's "approve for production" decision
// commits (see contentWorkflow.ts's approveForProduction) — the real
// hand-off from Scout's research to Content Bot's production pipeline.
// Same durable-dispatch pattern as MISSION_APPROVED_EVENT: sent last,
// after everything else in that transaction has already committed, so a
// send failure can never leave a half-created content item.
export const CONTENT_PRODUCTION_REQUESTED_EVENT = "content/production_requested" as const;

export interface ContentProductionRequestedEventData {
  contentItemId: string;
  missionId: string;
}

// Fired when a founder sends a produced piece back with revision notes
// (see contentWorkflow.ts's requestContentRevision). The event id is
// deterministic per *decision* (content-revision-<itemId>-<approvalId>),
// not per item — so a double-click on "Send back" yields one approval row
// and one event, never two revision passes for the same founder decision.
export const CONTENT_REVISION_REQUESTED_EVENT = "content/revision_requested" as const;

export interface ContentRevisionRequestedEventData {
  contentItemId: string;
  missionId: string;
  approvalId: string;
}
