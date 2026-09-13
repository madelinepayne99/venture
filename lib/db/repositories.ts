import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./client";
import type {
  Agent,
  AgentAssignment,
  ActivityEntry,
  Approval,
  CostEntry,
  Deliverable,
  Evidence,
  Founder,
  LedgerEntry,
  Mission,
  MissionStage,
  MissionState,
  Project,
} from "./types";

function now(): string {
  return new Date().toISOString();
}

// --- Founders -----------------------------------------------------------

export function listFounders(): Founder[] {
  return getDb().prepare("SELECT * FROM founders ORDER BY created_at").all() as Founder[];
}

export function getFounder(id: string): Founder | undefined {
  return getDb().prepare("SELECT * FROM founders WHERE id = ?").get(id) as
    | Founder
    | undefined;
}

// --- Agents ---------------------------------------------------------------

export function listAgents(): Agent[] {
  return getDb().prepare("SELECT * FROM agents ORDER BY created_at").all() as Agent[];
}

export function getAgentByKey(key: string): Agent | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE key = ?").get(key) as
    | Agent
    | undefined;
}

// --- Projects ---------------------------------------------------------------

export function listProjects(): Project[] {
  return getDb().prepare("SELECT * FROM projects ORDER BY created_at").all() as Project[];
}

export function getDefaultProject(): Project | undefined {
  return getDb().prepare("SELECT * FROM projects ORDER BY created_at LIMIT 1").get() as
    | Project
    | undefined;
}

// --- Missions ---------------------------------------------------------------

export function createMission(input: {
  founderId: string;
  projectId: string | null;
  title: string;
  brief: string;
}): Mission {
  const id = randomUUID();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO missions (id, project_id, founder_id, title, brief, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .run(id, input.projectId, input.founderId, input.title, input.brief, ts, ts);
  recordActivity({
    missionId: id,
    actor: `founder:${input.founderId}`,
    action: "mission_created",
    detail: input.title,
  });
  return getMission(id)!;
}

export function getMission(id: string): Mission | undefined {
  return getDb().prepare("SELECT * FROM missions WHERE id = ?").get(id) as
    | Mission
    | undefined;
}

export function listMissions(): Mission[] {
  return getDb()
    .prepare("SELECT * FROM missions ORDER BY created_at DESC")
    .all() as Mission[];
}

export function updateMissionState(
  id: string,
  state: MissionState,
  fields: Partial<
    Pick<Mission, "interpreted_mission" | "final_status" | "failure_reason">
  > = {},
): Mission {
  const db = getDb();
  const ts = now();
  db.prepare(
    `UPDATE missions
     SET state = ?, updated_at = ?,
         interpreted_mission = COALESCE(?, interpreted_mission),
         final_status = COALESCE(?, final_status),
         failure_reason = COALESCE(?, failure_reason)
     WHERE id = ?`,
  ).run(
    state,
    ts,
    fields.interpreted_mission ?? null,
    fields.final_status ?? null,
    fields.failure_reason ?? null,
    id,
  );
  return getMission(id)!;
}

// --- Mission stages -----------------------------------------------------

export function startStage(missionId: string, stageName: string, detail?: string): MissionStage {
  const id = randomUUID();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO mission_stages (id, mission_id, stage_name, status, started_at, detail)
       VALUES (?, ?, ?, 'in_progress', ?, ?)`,
    )
    .run(id, missionId, stageName, ts, detail ?? null);
  return getStage(id)!;
}

export function completeStage(stageId: string, detail?: string): MissionStage {
  const ts = now();
  getDb()
    .prepare(
      `UPDATE mission_stages SET status = 'completed', completed_at = ?, detail = COALESCE(?, detail) WHERE id = ?`,
    )
    .run(ts, detail ?? null, stageId);
  return getStage(stageId)!;
}

export function failStage(stageId: string, detail?: string): MissionStage {
  const ts = now();
  getDb()
    .prepare(
      `UPDATE mission_stages SET status = 'failed', completed_at = ?, detail = COALESCE(?, detail) WHERE id = ?`,
    )
    .run(ts, detail ?? null, stageId);
  return getStage(stageId)!;
}

function getStage(id: string): MissionStage | undefined {
  return getDb().prepare("SELECT * FROM mission_stages WHERE id = ?").get(id) as
    | MissionStage
    | undefined;
}

export function listStages(missionId: string): MissionStage[] {
  return getDb()
    .prepare("SELECT * FROM mission_stages WHERE mission_id = ? ORDER BY started_at")
    .all(missionId) as MissionStage[];
}

// --- Agent assignments ----------------------------------------------------

export function assignAgent(missionId: string, agentId: string, role: string): AgentAssignment {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO agent_assignments (id, mission_id, agent_id, role) VALUES (?, ?, ?, ?)`,
    )
    .run(id, missionId, agentId, role);
  return getDb().prepare("SELECT * FROM agent_assignments WHERE id = ?").get(id) as AgentAssignment;
}

export function listAssignments(missionId: string): AgentAssignment[] {
  return getDb()
    .prepare("SELECT * FROM agent_assignments WHERE mission_id = ? ORDER BY assigned_at")
    .all(missionId) as AgentAssignment[];
}

// --- Evidence ---------------------------------------------------------------

export function recordEvidence(entry: {
  missionId: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceDate?: string | null;
  snippet?: string | null;
  isVerifiedFact: boolean;
}): Evidence {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO evidence (id, mission_id, source_url, source_title, source_date, snippet, is_verified_fact)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      entry.missionId,
      entry.sourceUrl ?? null,
      entry.sourceTitle ?? null,
      entry.sourceDate ?? null,
      entry.snippet ?? null,
      entry.isVerifiedFact ? 1 : 0,
    );
  return getDb().prepare("SELECT * FROM evidence WHERE id = ?").get(id) as Evidence;
}

export function listEvidence(missionId: string): Evidence[] {
  return getDb()
    .prepare("SELECT * FROM evidence WHERE mission_id = ? ORDER BY retrieved_at")
    .all(missionId) as Evidence[];
}

// --- Deliverables -----------------------------------------------------------

export function recordDeliverable(entry: {
  missionId: string;
  agentId: string;
  kind: string;
  content: unknown;
}): Deliverable {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO deliverables (id, mission_id, agent_id, kind, content_json) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, entry.missionId, entry.agentId, entry.kind, JSON.stringify(entry.content));
  return getDeliverable(id)!;
}

function getDeliverable(id: string): Deliverable | undefined {
  const row = getDb().prepare("SELECT * FROM deliverables WHERE id = ?").get(id) as
    | (Omit<Deliverable, "content"> & { content_json: string })
    | undefined;
  if (!row) return undefined;
  return { ...row, content: JSON.parse(row.content_json) };
}

export function listDeliverables(missionId: string): Deliverable[] {
  const rows = getDb()
    .prepare("SELECT * FROM deliverables WHERE mission_id = ? ORDER BY created_at")
    .all(missionId) as Array<Omit<Deliverable, "content"> & { content_json: string }>;
  return rows.map((row) => ({ ...row, content: JSON.parse(row.content_json) }));
}

// --- Approvals ---------------------------------------------------------------

export function recordApproval(entry: {
  missionId: string;
  founderId: string;
  decision: "approved" | "cancelled";
  note?: string;
}): Approval {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO approvals (id, mission_id, founder_id, decision, note) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, entry.missionId, entry.founderId, entry.decision, entry.note ?? null);
  return getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Approval;
}

export function listApprovals(missionId: string): Approval[] {
  return getDb()
    .prepare("SELECT * FROM approvals WHERE mission_id = ? ORDER BY decided_at")
    .all(missionId) as Approval[];
}

// --- Costs & ledger ---------------------------------------------------------

export function recordCost(entry: {
  missionId: string | null;
  agentId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
}): CostEntry {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO costs (id, mission_id, agent_id, model, input_tokens, output_tokens, usd_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      entry.missionId,
      entry.agentId,
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.usdCost,
    );

  getDb()
    .prepare(
      `INSERT INTO ledger_entries (id, mission_id, category, description, amount_usd)
       VALUES (?, ?, 'agent_cost', ?, ?)`,
    )
    .run(
      randomUUID(),
      entry.missionId,
      `${entry.model} usage (${entry.inputTokens} in / ${entry.outputTokens} out tokens)`,
      -Math.abs(entry.usdCost),
    );

  return getDb().prepare("SELECT * FROM costs WHERE id = ?").get(id) as CostEntry;
}

export function listCosts(missionId: string): CostEntry[] {
  return getDb()
    .prepare("SELECT * FROM costs WHERE mission_id = ? ORDER BY created_at")
    .all(missionId) as CostEntry[];
}

export function listLedgerEntries(limit = 50): LedgerEntry[] {
  return getDb()
    .prepare("SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT ?")
    .all(limit) as LedgerEntry[];
}

export function ledgerTotalUsd(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(amount_usd), 0) as total FROM ledger_entries")
    .get() as { total: number };
  return row.total;
}

// --- Activity history -------------------------------------------------------

export function recordActivity(entry: {
  missionId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
}): ActivityEntry {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO activity_history (id, mission_id, actor, action, detail) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, entry.missionId ?? null, entry.actor, entry.action, entry.detail ?? null);
  return getDb().prepare("SELECT * FROM activity_history WHERE id = ?").get(id) as ActivityEntry;
}

export function listActivity(missionId?: string, limit = 100): ActivityEntry[] {
  if (missionId) {
    return getDb()
      .prepare(
        "SELECT * FROM activity_history WHERE mission_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(missionId, limit) as ActivityEntry[];
  }
  return getDb()
    .prepare("SELECT * FROM activity_history ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ActivityEntry[];
}
