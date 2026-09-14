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
