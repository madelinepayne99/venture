import type { InferSelectModel } from "drizzle-orm";
import type * as schema from "./schema";

// Row shapes are inferred directly from the Drizzle schema (lib/db/schema.ts)
// — the schema is now the single source of truth, not a hand-maintained
// interface that can drift out of sync with it.

export type Founder = InferSelectModel<typeof schema.founders>;

export type AgentStatus = (typeof schema.agentStatusValues)[number];
export type Agent = InferSelectModel<typeof schema.agents>;
export type AgentCapability = InferSelectModel<typeof schema.agentCapabilities>;

export type WorkspaceType = (typeof schema.workspaceTypeValues)[number];
export type Project = Omit<InferSelectModel<typeof schema.projects>, "workspace_type"> & {
  workspace_type: WorkspaceType;
};

export const MISSION_STATES = [
  "draft",
  "awaiting_founder_approval",
  "queued",
  "researching",
  "awaiting_evidence",
  "ready_for_founders_review",
  "rejected",
  "failed",
  "cancelled",
] as const;

export type MissionState = (typeof MISSION_STATES)[number];

export type ScoutVerdict = "reject" | "investigate_further" | "ready_for_founders_review";

// Drizzle infers `state`/`final_status` etc. as plain `string` (they're
// untyped text columns by design — see schema.ts) — narrow them back to
// the app's real vocabulary here, at the one boundary that matters.
export type Mission = Omit<InferSelectModel<typeof schema.missions>, "state" | "final_status"> & {
  state: MissionState;
  final_status: ScoutVerdict | null;
};

export type StageStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type MissionStage = Omit<InferSelectModel<typeof schema.missionStages>, "status"> & {
  status: StageStatus;
};

export type AgentAssignment = InferSelectModel<typeof schema.agentAssignments>;
export type Evidence = InferSelectModel<typeof schema.evidence>;

export type Deliverable<TContent = unknown> = Omit<
  InferSelectModel<typeof schema.deliverables>,
  "content"
> & { content: TContent };

export type Approval = InferSelectModel<typeof schema.approvals>;
export type CostEntry = InferSelectModel<typeof schema.costs>;
export type LedgerEntry = InferSelectModel<typeof schema.ledgerEntries>;
export type ActivityEntry = InferSelectModel<typeof schema.activityHistory>;
