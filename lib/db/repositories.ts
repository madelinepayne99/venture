import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import * as schema from "./schema";
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
  WorkspaceType,
} from "./types";

function now(): string {
  return new Date().toISOString();
}

// --- Founders -----------------------------------------------------------

export async function listFounders(): Promise<Founder[]> {
  const db = await getDb();
  return db.select().from(schema.founders).orderBy(schema.founders.created_at);
}

export async function getFounder(id: string): Promise<Founder | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.founders).where(eq(schema.founders.id, id));
  return row;
}

export async function getFounderByEmail(email: string): Promise<Founder | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.founders).where(eq(schema.founders.email, email));
  return row;
}

// --- Agents ---------------------------------------------------------------

export async function listAgents(): Promise<Agent[]> {
  const db = await getDb();
  return db.select().from(schema.agents).orderBy(schema.agents.created_at);
}

export async function getAgentByKey(key: string): Promise<Agent | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.key, key));
  return row;
}

// --- Projects ---------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.projects).orderBy(schema.projects.created_at);
  return rows as Project[];
}

export async function getDefaultProject(): Promise<Project | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.projects).orderBy(schema.projects.created_at).limit(1);
  return row as Project | undefined;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return row as Project | undefined;
}

/**
 * Creates a new project/workspace. Deliberately the only write path for
 * workspace_type — there is no update function, so an existing workspace
 * (and any missions already run under it) can never be silently
 * repurposed to a different type. A founder who wants a different kind of
 * workspace creates a new one.
 */
export async function createProject(input: {
  name: string;
  workspaceType: WorkspaceType;
  description?: string | null;
}): Promise<Project> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.projects)
    .values({
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      platform_focus: null,
      workspace_type: input.workspaceType,
    })
    .returning();
  return row as Project;
}

// --- Missions ---------------------------------------------------------------

export async function createMission(input: {
  founderId: string;
  projectId: string | null;
  title: string;
  brief: string;
}): Promise<Mission> {
  const id = randomUUID();
  const ts = now();
  const db = await getDb();
  await db.insert(schema.missions).values({
    id,
    project_id: input.projectId,
    founder_id: input.founderId,
    title: input.title,
    brief: input.brief,
    state: "draft",
    created_at: ts,
    updated_at: ts,
  });
  await recordActivity({
    missionId: id,
    actor: `founder:${input.founderId}`,
    action: "mission_created",
    detail: input.title,
  });
  return (await getMission(id))!;
}

export async function getMission(id: string): Promise<Mission | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.missions).where(eq(schema.missions.id, id));
  return row as Mission | undefined;
}

export async function listMissions(): Promise<Mission[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.missions).orderBy(desc(schema.missions.created_at));
  return rows as Mission[];
}

export interface TransitionResult {
  /** Whether the mission was actually in one of fromStates and got moved. */
  ok: boolean;
  /** The mission's row as it stands right now, whether or not this call moved it. */
  mission: Mission;
}

/**
 * The only way any code in this app should change a mission's state. The
 * WHERE clause makes the check-and-write a single atomic statement — there
 * is no gap between "is it still in that state?" and "move it," so two
 * callers racing to transition the same mission can never both succeed,
 * and neither can silently overwrite a state the mission has already
 * moved past (e.g. a founder's cancellation while an agent's work is still
 * in flight).
 */
export async function transitionMissionState(
  id: string,
  fromStates: MissionState[],
  toState: MissionState,
  fields: Partial<
    Pick<Mission, "interpreted_mission" | "final_status" | "failure_reason">
  > = {},
): Promise<TransitionResult> {
  if (fromStates.length === 0) {
    throw new Error("transitionMissionState requires at least one expected fromState.");
  }
  const db = await getDb();
  const ts = now();

  const updateValues: Record<string, unknown> = { state: toState, updated_at: ts };
  if (fields.interpreted_mission !== undefined) updateValues.interpreted_mission = fields.interpreted_mission;
  if (fields.final_status !== undefined) updateValues.final_status = fields.final_status;
  if (fields.failure_reason !== undefined) updateValues.failure_reason = fields.failure_reason;

  const updated = await db
    .update(schema.missions)
    .set(updateValues)
    .where(and(eq(schema.missions.id, id), inArray(schema.missions.state, fromStates)))
    .returning();

  if (updated.length > 0) {
    return { ok: true, mission: updated[0] as Mission };
  }

  const mission = await getMission(id);
  if (!mission) throw new Error(`Mission ${id} not found.`);
  return { ok: false, mission };
}

// --- Mission stages -----------------------------------------------------

export async function startStage(
  missionId: string,
  stageName: string,
  detail?: string,
): Promise<MissionStage> {
  const db = await getDb();
  const id = randomUUID();
  const ts = now();
  const [row] = await db
    .insert(schema.missionStages)
    .values({
      id,
      mission_id: missionId,
      stage_name: stageName,
      status: "in_progress",
      started_at: ts,
      detail: detail ?? null,
    })
    .returning();
  return row as MissionStage;
}

export async function completeStage(stageId: string, detail?: string): Promise<MissionStage> {
  const db = await getDb();
  const ts = now();
  const updateValues: Record<string, unknown> = { status: "completed", completed_at: ts };
  if (detail !== undefined) updateValues.detail = detail;
  const [row] = await db
    .update(schema.missionStages)
    .set(updateValues)
    .where(eq(schema.missionStages.id, stageId))
    .returning();
  return row as MissionStage;
}

export async function failStage(stageId: string, detail?: string): Promise<MissionStage> {
  const db = await getDb();
  const ts = now();
  const updateValues: Record<string, unknown> = { status: "failed", completed_at: ts };
  if (detail !== undefined) updateValues.detail = detail;
  const [row] = await db
    .update(schema.missionStages)
    .set(updateValues)
    .where(eq(schema.missionStages.id, stageId))
    .returning();
  return row as MissionStage;
}

export async function listStages(missionId: string): Promise<MissionStage[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.missionStages)
    .where(eq(schema.missionStages.mission_id, missionId))
    .orderBy(schema.missionStages.started_at);
  return rows as MissionStage[];
}

/**
 * The most recent still-open stage of this name for a mission — used by
 * the durable job workflow to resume into an existing stage row instead
 * of creating a duplicate one when a retry finds the mission already past
 * "queued".
 */
export async function getOpenStage(
  missionId: string,
  stageName: string,
): Promise<MissionStage | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.missionStages)
    .where(
      and(
        eq(schema.missionStages.mission_id, missionId),
        eq(schema.missionStages.stage_name, stageName),
        eq(schema.missionStages.status, "in_progress"),
      ),
    )
    .orderBy(desc(schema.missionStages.started_at))
    .limit(1);
  return row as MissionStage | undefined;
}

/** Every mission still "researching" whose stage started before `olderThan` — for the stuck-mission watchdog. */
export async function listStaleResearchingMissions(olderThan: Date): Promise<
  Array<{ mission: Mission; stage: MissionStage }>
> {
  const db = await getDb();
  const rows = await db
    .select({ mission: schema.missions, stage: schema.missionStages })
    .from(schema.missions)
    .innerJoin(
      schema.missionStages,
      and(
        eq(schema.missionStages.mission_id, schema.missions.id),
        eq(schema.missionStages.stage_name, "scout_research"),
        eq(schema.missionStages.status, "in_progress"),
      ),
    )
    .where(and(eq(schema.missions.state, "researching"), sql`${schema.missionStages.started_at} < ${olderThan.toISOString()}`));
  return rows as Array<{ mission: Mission; stage: MissionStage }>;
}

// --- Agent assignments ----------------------------------------------------

export async function assignAgent(
  missionId: string,
  agentId: string,
  role: string,
): Promise<AgentAssignment> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.agentAssignments)
    .values({ id: randomUUID(), mission_id: missionId, agent_id: agentId, role })
    .returning();
  return row!;
}

export async function listAssignments(missionId: string): Promise<AgentAssignment[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.agentAssignments)
    .where(eq(schema.agentAssignments.mission_id, missionId))
    .orderBy(schema.agentAssignments.assigned_at);
}

/** Whether this agent is already assigned to this mission — used to keep resumed retries idempotent. */
export async function hasAssignment(missionId: string, agentId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.agentAssignments.id })
    .from(schema.agentAssignments)
    .where(and(eq(schema.agentAssignments.mission_id, missionId), eq(schema.agentAssignments.agent_id, agentId)))
    .limit(1);
  return Boolean(row);
}

// --- Evidence ---------------------------------------------------------------

export async function recordEvidence(entry: {
  missionId: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceDate?: string | null;
  snippet?: string | null;
  isVerifiedFact: boolean;
}): Promise<Evidence> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.evidence)
    .values({
      id: randomUUID(),
      mission_id: entry.missionId,
      source_url: entry.sourceUrl ?? null,
      source_title: entry.sourceTitle ?? null,
      source_date: entry.sourceDate ?? null,
      snippet: entry.snippet ?? null,
      is_verified_fact: entry.isVerifiedFact,
    })
    .returning();
  return row!;
}

export async function listEvidence(missionId: string): Promise<Evidence[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.mission_id, missionId))
    .orderBy(schema.evidence.retrieved_at);
}

// --- Deliverables -----------------------------------------------------------

export async function recordDeliverable(entry: {
  missionId: string;
  agentId: string;
  kind: string;
  content: unknown;
}): Promise<Deliverable> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.deliverables)
    .values({
      id: randomUUID(),
      mission_id: entry.missionId,
      agent_id: entry.agentId,
      kind: entry.kind,
      content: entry.content as object,
    })
    .returning();
  return row as Deliverable;
}

export async function listDeliverables(missionId: string): Promise<Deliverable[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.deliverables)
    .where(eq(schema.deliverables.mission_id, missionId))
    .orderBy(schema.deliverables.created_at);
  return rows as Deliverable[];
}

// --- Approvals ---------------------------------------------------------------

export async function recordApproval(entry: {
  missionId: string;
  founderId: string;
  decision: "approved" | "cancelled";
  note?: string;
}): Promise<Approval> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.approvals)
    .values({
      id: randomUUID(),
      mission_id: entry.missionId,
      founder_id: entry.founderId,
      decision: entry.decision,
      note: entry.note ?? null,
    })
    .returning();
  return row!;
}

export async function listApprovals(missionId: string): Promise<Approval[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.mission_id, missionId))
    .orderBy(schema.approvals.decided_at);
}

// --- Costs & ledger ---------------------------------------------------------

export async function recordCost(entry: {
  missionId: string | null;
  agentId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Null means real tokens were spent but pricing for this model is unknown — never invent a figure. */
  usdCost: number | null;
}): Promise<CostEntry> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.costs)
    .values({
      id: randomUUID(),
      mission_id: entry.missionId,
      agent_id: entry.agentId,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      usd_cost: entry.usdCost,
    })
    .returning();

  // Only the business ledger gets an entry when we actually know the
  // dollar amount — an unpriced model still gets its token usage recorded
  // above (for reconciliation), but the ledger must never carry a
  // fabricated $0 (or any other invented) charge.
  if (entry.usdCost !== null) {
    await db.insert(schema.ledgerEntries).values({
      id: randomUUID(),
      mission_id: entry.missionId,
      category: "agent_cost",
      description: `${entry.model} usage (${entry.inputTokens} in / ${entry.outputTokens} out tokens)`,
      amount_usd: -Math.abs(entry.usdCost),
    });
  }

  return row!;
}

export async function listCosts(missionId: string): Promise<CostEntry[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.costs)
    .where(eq(schema.costs.mission_id, missionId))
    .orderBy(schema.costs.created_at);
}

export async function listLedgerEntries(limit = 50): Promise<LedgerEntry[]> {
  const db = await getDb();
  return db.select().from(schema.ledgerEntries).orderBy(desc(schema.ledgerEntries.created_at)).limit(limit);
}

export async function ledgerTotalUsd(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amount_usd}), 0)` })
    .from(schema.ledgerEntries);
  return row?.total ?? 0;
}

// --- Activity history -------------------------------------------------------

export async function recordActivity(entry: {
  missionId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
}): Promise<ActivityEntry> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.activityHistory)
    .values({
      id: randomUUID(),
      mission_id: entry.missionId ?? null,
      actor: entry.actor,
      action: entry.action,
      detail: entry.detail ?? null,
    })
    .returning();
  return row!;
}

export async function listActivity(missionId?: string, limit = 100): Promise<ActivityEntry[]> {
  const db = await getDb();
  if (missionId) {
    return db
      .select()
      .from(schema.activityHistory)
      .where(eq(schema.activityHistory.mission_id, missionId))
      .orderBy(desc(schema.activityHistory.created_at))
      .limit(limit);
  }
  return db.select().from(schema.activityHistory).orderBy(desc(schema.activityHistory.created_at)).limit(limit);
}
