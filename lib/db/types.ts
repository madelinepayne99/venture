// Row shapes mirror the SQLite columns exactly (snake_case) — no ORM mapping
// layer, so what you see here is what's actually stored.

export interface Founder {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
}

export type AgentStatus = "active" | "planned";

export interface Agent {
  id: string;
  key: string;
  name: string;
  role_summary: string;
  status: AgentStatus;
  created_at: string;
}

export interface AgentCapability {
  id: string;
  agent_id: string;
  capability: string;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  platform_focus: string | null;
  created_at: string;
}

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

export interface Mission {
  id: string;
  project_id: string | null;
  founder_id: string;
  title: string;
  brief: string;
  interpreted_mission: string | null;
  state: MissionState;
  final_status: ScoutVerdict | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type StageStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface MissionStage {
  id: string;
  mission_id: string;
  stage_name: string;
  status: StageStatus;
  started_at: string | null;
  completed_at: string | null;
  detail: string | null;
}

export interface AgentAssignment {
  id: string;
  mission_id: string;
  agent_id: string;
  role: string;
  assigned_at: string;
}

export interface Evidence {
  id: string;
  mission_id: string;
  source_url: string | null;
  source_title: string | null;
  source_date: string | null;
  snippet: string | null;
  retrieved_at: string;
  is_verified_fact: 0 | 1;
}

export interface Deliverable<TContent = unknown> {
  id: string;
  mission_id: string;
  agent_id: string;
  kind: string;
  content: TContent;
  created_at: string;
}

export interface Approval {
  id: string;
  mission_id: string;
  founder_id: string;
  decision: "approved" | "cancelled";
  note: string | null;
  decided_at: string;
}

export interface CostEntry {
  id: string;
  mission_id: string | null;
  agent_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Null means real tokens were spent but pricing for this model is unknown — never a fabricated figure. */
  usd_cost: number | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  mission_id: string | null;
  category: string;
  description: string;
  amount_usd: number;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  mission_id: string | null;
  actor: string;
  action: string;
  detail: string | null;
  created_at: string;
}
