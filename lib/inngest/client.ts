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
