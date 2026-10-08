import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import * as schema from "./schema";
import type {
  Agent,
  AgentAssignment,
  AgentTask,
  AgentTaskState,
  ChiefOfStaffGoal,
  ChiefOfStaffGoalWithSubtasks,
  Budget,
  BudgetPeriod,
  BusinessAnalystReportRecord,
  BusinessAnalystReportState,
  Checklist,
  ChecklistItem,
  ChecklistWithItems,
  Expense,
  ActivityEntry,
  Approval,
  ContentAsset,
  ContentAssetKind,
  ContentItem,
  ContentItemState,
  ContentVersion,
  CostEntry,
  Deliverable,
  Evidence,
  Founder,
  LedgerEntry,
  Mission,
  MissionLeadAssignment,
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

// --- Agent tasks (Operations Wing) -----------------------------------------
// General-purpose task records for the non-mission agents. See schema.ts's
// doc comment on agentTasks for why this is deliberately separate from
// `missions`.

export async function createAgentTask(input: {
  agentKey: string;
  founderId: string;
  taskType: string;
  title: string;
  detail?: string | null;
  dueAt?: string | null;
  payload?: unknown;
  /** Set only when Chief of Staff is delegating this as part of a goal breakdown — see schema.ts. */
  goalId?: string | null;
}): Promise<AgentTask> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.agentTasks).values({
    id,
    agent_key: input.agentKey,
    founder_id: input.founderId,
    task_type: input.taskType,
    title: input.title,
    detail: input.detail ?? null,
    state: "open",
    due_at: input.dueAt ?? null,
    payload: input.payload ?? null,
    goal_id: input.goalId ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const [row] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, id));
  return row as AgentTask;
}

export async function listAgentTasksForFounder(
  founderId: string,
  opts?: { agentKey?: string },
): Promise<AgentTask[]> {
  const db = await getDb();
  const conditions = [eq(schema.agentTasks.founder_id, founderId)];
  if (opts?.agentKey) conditions.push(eq(schema.agentTasks.agent_key, opts.agentKey));
  const rows = await db
    .select()
    .from(schema.agentTasks)
    .where(and(...conditions))
    .orderBy(desc(schema.agentTasks.created_at));
  return rows as AgentTask[];
}

export async function getAgentTask(id: string): Promise<AgentTask | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, id));
  return row as AgentTask | undefined;
}

// Atomic conditional update, same pattern as transitionMissionState — a
// task cancelled while "in progress" can't be silently revived by a late
// write, and a completion can't double-apply.
export async function updateAgentTaskState(
  id: string,
  fromStates: AgentTaskState[],
  toState: AgentTaskState,
  fields?: { result?: unknown },
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .update(schema.agentTasks)
    .set({
      state: toState,
      updated_at: now(),
      ...(fields?.result !== undefined ? { result: fields.result } : {}),
    })
    .where(and(eq(schema.agentTasks.id, id), inArray(schema.agentTasks.state, fromStates)))
    .returning({ id: schema.agentTasks.id });
  return result.length > 0;
}

// --- Chief of Staff (Operations Wing) ---------------------------------------
// A goal is an immutable grouping container; its real delegated work lives
// in agent_tasks rows carrying this goal's id (see schema.ts's doc comment
// on agentTasks.goal_id).

export async function createChiefOfStaffGoal(input: { founderId: string; title: string }): Promise<ChiefOfStaffGoal> {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(schema.chiefOfStaffGoals).values({
    id,
    founder_id: input.founderId,
    title: input.title,
    created_at: now(),
  });
  const [row] = await db.select().from(schema.chiefOfStaffGoals).where(eq(schema.chiefOfStaffGoals.id, id));
  return row as ChiefOfStaffGoal;
}

export async function listChiefOfStaffGoalsForFounder(founderId: string): Promise<ChiefOfStaffGoal[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.chiefOfStaffGoals)
    .where(eq(schema.chiefOfStaffGoals.founder_id, founderId))
    .orderBy(desc(schema.chiefOfStaffGoals.created_at));
  return rows as ChiefOfStaffGoal[];
}

export async function getChiefOfStaffGoal(id: string): Promise<ChiefOfStaffGoal | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.chiefOfStaffGoals).where(eq(schema.chiefOfStaffGoals.id, id));
  return row as ChiefOfStaffGoal | undefined;
}

export async function listSubtasksForGoal(goalId: string): Promise<AgentTask[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.goal_id, goalId))
    .orderBy(schema.agentTasks.created_at);
  return rows as AgentTask[];
}

export async function getChiefOfStaffGoalWithSubtasks(id: string): Promise<ChiefOfStaffGoalWithSubtasks | undefined> {
  const goal = await getChiefOfStaffGoal(id);
  if (!goal) return undefined;
  const subtasks = await listSubtasksForGoal(id);
  return { ...goal, subtasks };
}

// --- Finance (Operations Wing) ---------------------------------------------
// Deliberately separate from ledger_entries/costs — see schema.ts's doc
// comment on `expenses`/`budgets` for why (currency correctness).

export async function recordExpense(input: {
  category: string;
  description: string;
  amount: number;
  currency: string;
  incurredAt?: string;
}): Promise<Expense> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.expenses).values({
    id,
    category: input.category,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    incurred_at: input.incurredAt ?? timestamp,
    created_at: timestamp,
  });
  const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id));
  return row as Expense;
}

export async function listExpenses(opts?: { category?: string }): Promise<Expense[]> {
  const db = await getDb();
  const query = db.select().from(schema.expenses);
  const rows = opts?.category
    ? await query.where(eq(schema.expenses.category, opts.category)).orderBy(desc(schema.expenses.incurred_at))
    : await query.orderBy(desc(schema.expenses.incurred_at));
  return rows as Expense[];
}

export async function upsertBudget(input: {
  category: string;
  amount: number;
  currency: string;
  period?: BudgetPeriod;
}): Promise<Budget> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.budgets)
    .where(and(eq(schema.budgets.category, input.category), eq(schema.budgets.period, input.period ?? "monthly")));

  if (existing.length > 0) {
    const id = existing[0]!.id;
    await db
      .update(schema.budgets)
      .set({ amount: input.amount, currency: input.currency, updated_at: now() })
      .where(eq(schema.budgets.id, id));
    const [row] = await db.select().from(schema.budgets).where(eq(schema.budgets.id, id));
    return row as Budget;
  }

  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.budgets).values({
    id,
    category: input.category,
    amount: input.amount,
    currency: input.currency,
    period: input.period ?? "monthly",
    created_at: timestamp,
    updated_at: timestamp,
  });
  const [row] = await db.select().from(schema.budgets).where(eq(schema.budgets.id, id));
  return row as Budget;
}

export async function listBudgets(): Promise<Budget[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.budgets).orderBy(schema.budgets.category);
  return rows as Budget[];
}

export async function getBudgetByCategory(category: string, period: BudgetPeriod = "monthly"): Promise<Budget | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.budgets)
    .where(and(eq(schema.budgets.category, category), eq(schema.budgets.period, period)));
  return row as Budget | undefined;
}

export async function sumExpensesByCategoryAndCurrency(
  category: string,
): Promise<Array<{ currency: string; total: number }>> {
  const db = await getDb();
  const rows = await db
    .select({
      currency: schema.expenses.currency,
      total: sql<number>`coalesce(sum(${schema.expenses.amount}), 0)`,
    })
    .from(schema.expenses)
    .where(eq(schema.expenses.category, category))
    .groupBy(schema.expenses.currency);
  return rows;
}

// --- Operations Agent: checklists --------------------------------------
// Deliberately separate tables from agent_tasks — see schema.ts's doc
// comment on `checklists`/`checklist_items` for why (ordered, independently
// completable items vs. one task with one state).

export async function createChecklist(input: {
  founderId: string;
  title: string;
  itemLabels: string[];
}): Promise<ChecklistWithItems> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.checklists).values({
    id,
    founder_id: input.founderId,
    title: input.title,
    created_at: timestamp,
    updated_at: timestamp,
  });
  if (input.itemLabels.length > 0) {
    await db.insert(schema.checklistItems).values(
      input.itemLabels.map((label, index) => ({
        id: randomUUID(),
        checklist_id: id,
        label,
        position: index,
        is_done: false,
        created_at: timestamp,
        updated_at: timestamp,
      })),
    );
  }
  return getChecklistWithItems(id) as Promise<ChecklistWithItems>;
}

export async function listChecklistsForFounder(founderId: string): Promise<Checklist[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.checklists)
    .where(eq(schema.checklists.founder_id, founderId))
    .orderBy(desc(schema.checklists.created_at));
  return rows as Checklist[];
}

export async function getChecklist(id: string): Promise<Checklist | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.checklists).where(eq(schema.checklists.id, id));
  return row as Checklist | undefined;
}

export async function getChecklistWithItems(id: string): Promise<ChecklistWithItems | undefined> {
  const db = await getDb();
  const [checklist] = await db.select().from(schema.checklists).where(eq(schema.checklists.id, id));
  if (!checklist) return undefined;
  const items = await db
    .select()
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.checklist_id, id))
    .orderBy(schema.checklistItems.position);
  return { ...(checklist as Checklist), items: items as ChecklistItem[] };
}

export async function addChecklistItem(checklistId: string, label: string): Promise<ChecklistItem> {
  const db = await getDb();
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.checklist_id, checklistId));
  const nextPosition = existing[0]?.count ?? 0;
  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.checklistItems).values({
    id,
    checklist_id: checklistId,
    label,
    position: nextPosition,
    is_done: false,
    created_at: timestamp,
    updated_at: timestamp,
  });
  await db.update(schema.checklists).set({ updated_at: timestamp }).where(eq(schema.checklists.id, checklistId));
  const [row] = await db.select().from(schema.checklistItems).where(eq(schema.checklistItems.id, id));
  return row as ChecklistItem;
}

export async function setChecklistItemDone(itemId: string, isDone: boolean): Promise<ChecklistItem | undefined> {
  const db = await getDb();
  const timestamp = now();
  await db
    .update(schema.checklistItems)
    .set({ is_done: isDone, updated_at: timestamp })
    .where(eq(schema.checklistItems.id, itemId));
  const [row] = await db.select().from(schema.checklistItems).where(eq(schema.checklistItems.id, itemId));
  if (row) {
    await db.update(schema.checklists).set({ updated_at: timestamp }).where(eq(schema.checklists.id, row.checklist_id));
  }
  return row as ChecklistItem | undefined;
}

// --- Business Analyst: research reports ---------------------------------
// One row per real research request, success or failure (see schema.ts's
// doc comment on `business_analyst_reports` for why this is neither a
// mission nor an agent_task).

export async function saveBusinessAnalystReport(input: {
  founderId: string;
  query: string;
  state: BusinessAnalystReportState;
  report: unknown | null;
  error: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  usdCost: number | null;
}): Promise<BusinessAnalystReportRecord> {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(schema.businessAnalystReports).values({
    id,
    founder_id: input.founderId,
    query: input.query,
    state: input.state,
    report: input.report,
    error: input.error,
    model: input.model,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    usd_cost: input.usdCost,
    created_at: now(),
  });
  const [row] = await db
    .select()
    .from(schema.businessAnalystReports)
    .where(eq(schema.businessAnalystReports.id, id));
  return row as unknown as BusinessAnalystReportRecord;
}

export async function listBusinessAnalystReportsForFounder(founderId: string): Promise<BusinessAnalystReportRecord[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.businessAnalystReports)
    .where(eq(schema.businessAnalystReports.founder_id, founderId))
    .orderBy(desc(schema.businessAnalystReports.created_at));
  return rows as unknown as BusinessAnalystReportRecord[];
}

export async function getBusinessAnalystReport(
  id: string,
): Promise<BusinessAnalystReportRecord | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.businessAnalystReports)
    .where(eq(schema.businessAnalystReports.id, id));
  return row as unknown as BusinessAnalystReportRecord | undefined;
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
    Pick<Mission, "interpreted_mission" | "final_status" | "failure_reason" | "research_pass_count">
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
  if (fields.research_pass_count !== undefined) updateValues.research_pass_count = fields.research_pass_count;

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
  scope?: { contentItemId?: string; contentVersionId?: string },
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
      content_item_id: scope?.contentItemId ?? null,
      content_version_id: scope?.contentVersionId ?? null,
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
 * "queued". `scope.contentVersionId` narrows this to a single production
 * version's own stage sequence, so a crash mid-revision resumes into that
 * version's stage, never an earlier version's.
 */
export async function getOpenStage(
  missionId: string,
  stageName: string,
  scope?: { contentVersionId?: string },
): Promise<MissionStage | undefined> {
  const db = await getDb();
  const conditions = [
    eq(schema.missionStages.mission_id, missionId),
    eq(schema.missionStages.stage_name, stageName),
    eq(schema.missionStages.status, "in_progress"),
  ];
  if (scope?.contentVersionId) {
    conditions.push(eq(schema.missionStages.content_version_id, scope.contentVersionId));
  }
  const [row] = await db
    .select()
    .from(schema.missionStages)
    .where(and(...conditions))
    .orderBy(desc(schema.missionStages.started_at))
    .limit(1);
  return row as MissionStage | undefined;
}

/**
 * Every mission still "researching" whose stage started before `olderThan`
 * — for the stuck-mission watchdog. Matches either research stage name —
 * the original pass ("scout_research") or the automatic follow-up pass
 * ("scout_followup_research", see missionWorkflow.ts's MAX_RESEARCH_PASSES)
 * — so a crashed second pass is reaped exactly the same as a crashed first
 * one, not silently left forever because the join only looked for the
 * original stage name.
 */
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
        inArray(schema.missionStages.stage_name, ["scout_research", "scout_followup_research"]),
        eq(schema.missionStages.status, "in_progress"),
      ),
    )
    .where(and(eq(schema.missions.state, "researching"), sql`${schema.missionStages.started_at} < ${olderThan.toISOString()}`));
  return rows as Array<{ mission: Mission; stage: MissionStage }>;
}

/**
 * Every mission still "awaiting_evidence" (i.e. its automatic follow-up
 * dispatch hasn't landed yet) whose last state change was before
 * `olderThan` — for the follow-up-dispatch self-healing watchdog. A
 * healthy dispatch lands near-instantly; a mission stuck here past a
 * short threshold means the mission/followup_needed event send failed
 * (see runScoutPipeline's followup_dispatch_failed handling) and needs
 * re-sending, not a "failed" verdict — no real research work was lost.
 */
export async function listStaleAwaitingEvidenceMissions(olderThan: Date): Promise<Mission[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.missions)
    .where(
      and(
        eq(schema.missions.state, "awaiting_evidence"),
        sql`${schema.missions.updated_at} < ${olderThan.toISOString()}`,
      ),
    );
  return rows as Mission[];
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

/**
 * The lead agent (by real `agents.key`, e.g. "scout") currently on record
 * for each mission that has one. This is the real signal the HQ office
 * scene uses to decide which agent's character should be animated for a
 * given mission — never inferred from mission state alone, so a future
 * second agent's work in progress can never make an unrelated agent's
 * character appear to move.
 */
export async function listLeadAssignments(): Promise<MissionLeadAssignment[]> {
  const db = await getDb();
  const rows = await db
    .select({ mission_id: schema.agentAssignments.mission_id, agent_key: schema.agents.key })
    .from(schema.agentAssignments)
    .innerJoin(schema.agents, eq(schema.agentAssignments.agent_id, schema.agents.id))
    .where(eq(schema.agentAssignments.role, "lead"));
  return rows;
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
  decision:
    | "approved"
    | "cancelled"
    | "approve_for_production"
    | "commission_pilot_anyway"
    | "retry_production"
    | "produce_again"
    | "approve_content"
    | "reject_content"
    | "request_revision"
    | "publish";
  note?: string;
  contentItemId?: string;
  contentVersionId?: string;
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
      content_item_id: entry.contentItemId ?? null,
      content_version_id: entry.contentVersionId ?? null,
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

export async function listApprovalsForContentItem(contentItemId: string): Promise<Approval[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.content_item_id, contentItemId))
    .orderBy(schema.approvals.decided_at);
}

// --- Costs & ledger ---------------------------------------------------------

export async function recordCost(entry: {
  missionId: string | null;
  agentId: string | null;
  model: string;
  /** Null for a media-provider call priced in a different unit — see `provider`/`unit`/`quantity`. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Null means real spend occurred but pricing for this model/provider is unknown — never invent a figure. */
  usdCost: number | null;
  contentItemId?: string | null;
  contentVersionId?: string | null;
  /** Set together for a non-token media-provider call (e.g. fal.ai, ElevenLabs, Shotstack); left unset for a Claude call. */
  provider?: string | null;
  unit?: string | null;
  quantity?: number | null;
}): Promise<CostEntry> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.costs)
    .values({
      id: randomUUID(),
      mission_id: entry.missionId,
      agent_id: entry.agentId,
      model: entry.model,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      usd_cost: entry.usdCost,
      content_item_id: entry.contentItemId ?? null,
      content_version_id: entry.contentVersionId ?? null,
      provider: entry.provider ?? null,
      unit: entry.unit ?? null,
      quantity: entry.quantity ?? null,
    })
    .returning();

  // Only the business ledger gets an entry when we actually know the
  // dollar amount — an unpriced call still gets its usage recorded above
  // (for reconciliation), but the ledger must never carry a fabricated $0
  // (or any other invented) charge.
  if (entry.usdCost !== null) {
    const description =
      entry.provider && entry.unit && entry.quantity != null
        ? `${entry.provider} usage (${entry.quantity} ${entry.unit})`
        : `${entry.model} usage (${entry.inputTokens ?? 0} in / ${entry.outputTokens ?? 0} out tokens)`;
    await db.insert(schema.ledgerEntries).values({
      id: randomUUID(),
      mission_id: entry.missionId,
      category: "agent_cost",
      description,
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

export async function listCostsForContentItem(contentItemId: string): Promise<CostEntry[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.costs)
    .where(eq(schema.costs.content_item_id, contentItemId))
    .orderBy(schema.costs.created_at);
}

/** Sum of real, known (non-null) usd_cost rows for one content item — the pre-flight budget check reads this. */
export async function contentItemSpendUsd(contentItemId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.costs.usd_cost}), 0)` })
    .from(schema.costs)
    .where(and(eq(schema.costs.content_item_id, contentItemId), sql`${schema.costs.usd_cost} is not null`));
  return row?.total ?? 0;
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

// --- Content items (Milestone C1) -------------------------------------------

export async function createContentItem(input: {
  /**
   * Caller-supplied id, defaulting to a fresh random one — used by
   * produceAgainFromMission (contentWorkflow.ts) so a client-generated
   * idempotency key can double as the new content item's own primary key:
   * a genuine double-submit of the same "Produce Again" request collides
   * on this real primary key instead of silently creating two productions.
   */
  id?: string;
  missionId: string;
  agentId: string;
  sourceDeliverableId: string | null;
  brief: unknown;
  audienceContext: unknown;
}): Promise<ContentItem> {
  const db = await getDb();
  const ts = now();
  const [row] = await db
    .insert(schema.contentItems)
    .values({
      id: input.id ?? randomUUID(),
      mission_id: input.missionId,
      agent_id: input.agentId,
      source_deliverable_id: input.sourceDeliverableId,
      brief: input.brief as object,
      audience_context: input.audienceContext as object,
      state: "planning",
      created_at: ts,
      updated_at: ts,
    })
    .returning();
  return row as ContentItem;
}

export async function getContentItem(id: string): Promise<ContentItem | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, id));
  return row as ContentItem | undefined;
}

/** Every content item for the given missions — used to expose `{id, mission_id, state}` alongside `GET /api/missions`. */
export async function listContentItemsForMissions(missionIds: string[]): Promise<ContentItem[]> {
  if (missionIds.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.contentItems)
    .where(inArray(schema.contentItems.mission_id, missionIds))
    // Stable chronological order — now that one mission can genuinely own
    // multiple independent productions, this is what lets the UI number
    // them "Production 1", "Production 2", ... consistently.
    .orderBy(schema.contentItems.created_at);
  return rows as ContentItem[];
}

export interface ContentItemTransitionResult {
  /** Whether the item was actually in one of fromStates and got moved. */
  ok: boolean;
  /** The item's row as it stands right now, whether or not this call moved it. */
  item: ContentItem;
}

/**
 * The only way any code in this app should change a content item's
 * state — mirrors transitionMissionState's atomic conditional-UPDATE
 * pattern exactly: the WHERE clause is the concurrency check, so two
 * callers racing to transition the same item can never both succeed, and
 * neither can silently overwrite a state the item has already moved past
 * (e.g. a founder's decision while the pipeline was mid-write).
 */
export async function transitionContentItemState(
  id: string,
  fromStates: ContentItemState[],
  toState: ContentItemState,
  fields: Partial<
    Pick<
      ContentItem,
      | "approved_version_id"
      | "published_version_id"
      | "platform"
      | "platform_post_id"
      | "platform_post_url"
      | "published_at"
      | "failure_reason"
      | "failure_category"
      | "version_count"
      | "generation_attempt_count"
      | "next_analytics_pull_at"
    >
  > = {},
): Promise<ContentItemTransitionResult> {
  if (fromStates.length === 0) {
    throw new Error("transitionContentItemState requires at least one expected fromState.");
  }
  const db = await getDb();
  const ts = now();

  const updateValues: Record<string, unknown> = { state: toState, updated_at: ts };
  for (const key of [
    "approved_version_id",
    "published_version_id",
    "platform",
    "platform_post_id",
    "platform_post_url",
    "published_at",
    "failure_reason",
    "failure_category",
    "version_count",
    "generation_attempt_count",
    "next_analytics_pull_at",
  ] as const) {
    if (fields[key] !== undefined) updateValues[key] = fields[key];
  }

  const updated = await db
    .update(schema.contentItems)
    .set(updateValues)
    .where(and(eq(schema.contentItems.id, id), inArray(schema.contentItems.state, fromStates)))
    .returning();

  if (updated.length > 0) {
    return { ok: true, item: updated[0] as ContentItem };
  }

  const item = await getContentItem(id);
  if (!item) throw new Error(`Content item ${id} not found.`);
  return { ok: false, item };
}

/**
 * Every content item left `planning`/`generating` whose open stage
 * started before `olderThan` — for the stuck-item watchdog (mirrors
 * listStaleResearchingMissions exactly).
 */
export async function listStaleGeneratingItems(
  olderThan: Date,
): Promise<Array<{ item: ContentItem; stage: MissionStage }>> {
  const db = await getDb();
  const rows = await db
    .select({ item: schema.contentItems, stage: schema.missionStages })
    .from(schema.contentItems)
    .innerJoin(
      schema.missionStages,
      and(
        eq(schema.missionStages.content_item_id, schema.contentItems.id),
        eq(schema.missionStages.status, "in_progress"),
      ),
    )
    .where(
      and(
        inArray(schema.contentItems.state, ["planning", "generating"]),
        sql`${schema.missionStages.started_at} < ${olderThan.toISOString()}`,
      ),
    );
  return rows as Array<{ item: ContentItem; stage: MissionStage }>;
}

/**
 * Every content item sitting in "revision_requested" whose dispatch send
 * apparently failed — the real content-side analogue of
 * listStaleAwaitingEvidenceMissions, backing contentWatchdogs.ts's
 * resendStaleRevisionDispatches.
 */
export async function listStaleRevisionRequestedItems(olderThan: Date): Promise<ContentItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.contentItems)
    .where(
      and(
        eq(schema.contentItems.state, "revision_requested"),
        sql`${schema.contentItems.updated_at} < ${olderThan.toISOString()}`,
      ),
    );
  return rows as ContentItem[];
}

export async function listStagesForContentItem(contentItemId: string): Promise<MissionStage[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.missionStages)
    .where(eq(schema.missionStages.content_item_id, contentItemId))
    .orderBy(schema.missionStages.started_at);
  return rows as MissionStage[];
}

// --- Content versions ---------------------------------------------------

/**
 * Atomically bumps content_items.generation_attempt_count — the pipeline's
 * per-version retry counter (see lib/domain/contentProduction.ts's
 * MAX_GENERATION_ATTEMPTS_PER_VERSION). Reset to 1 by
 * transitionContentItemState whenever a version is freshly opened (a new
 * `generating` entry); this function is only for a same-state RESUME
 * (a durable-job retry finding the item already `generating`), where no
 * state transition happens for the counter to ride along with.
 */
export async function incrementContentItemGenerationAttempts(id: string): Promise<ContentItem> {
  const db = await getDb();
  const [row] = await db
    .update(schema.contentItems)
    .set({ generation_attempt_count: sql`${schema.contentItems.generation_attempt_count} + 1`, updated_at: now() })
    .where(eq(schema.contentItems.id, id))
    .returning();
  if (!row) throw new Error(`Content item ${id} not found.`);
  return row as ContentItem;
}

/** Allocates the next version number atomically against content_items.version_count and inserts the row. */
export async function openNextVersion(args: {
  contentItemId: string;
  parentVersionId: string | null;
  revisionApprovalId: string | null;
}): Promise<ContentVersion> {
  const db = await getDb();
  const [updatedItem] = await db
    .update(schema.contentItems)
    .set({ version_count: sql`${schema.contentItems.version_count} + 1`, updated_at: now() })
    .where(eq(schema.contentItems.id, args.contentItemId))
    .returning();
  if (!updatedItem) throw new Error(`Content item ${args.contentItemId} not found.`);

  const [row] = await db
    .insert(schema.contentVersions)
    .values({
      id: randomUUID(),
      content_item_id: args.contentItemId,
      version_number: updatedItem.version_count,
      parent_version_id: args.parentVersionId,
      revision_approval_id: args.revisionApprovalId,
      status: "generating",
      started_at: now(),
    })
    .returning();
  return row as ContentVersion;
}

export async function getContentVersion(id: string): Promise<ContentVersion | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.contentVersions).where(eq(schema.contentVersions.id, id));
  return row as ContentVersion | undefined;
}

/** The version currently being generated for this item, if any — what a resumed pipeline run resumes into. */
export async function getOpenVersion(contentItemId: string): Promise<ContentVersion | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.contentVersions)
    .where(
      and(eq(schema.contentVersions.content_item_id, contentItemId), eq(schema.contentVersions.status, "generating")),
    )
    .orderBy(desc(schema.contentVersions.version_number))
    .limit(1);
  return row as ContentVersion | undefined;
}

export async function getLatestVersion(contentItemId: string): Promise<ContentVersion | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.contentVersions)
    .where(eq(schema.contentVersions.content_item_id, contentItemId))
    .orderBy(desc(schema.contentVersions.version_number))
    .limit(1);
  return row as ContentVersion | undefined;
}

export async function updateContentVersion(
  id: string,
  fields: Partial<
    Pick<
      ContentVersion,
      | "status"
      | "plan"
      | "safety_verdict"
      | "creative_strategy"
      | "qc_report"
      | "qc_regeneration_count"
      | "reference_qc_verdict"
      | "reference_regeneration_count"
      | "failure_reason"
      | "completed_at"
    >
  >,
): Promise<ContentVersion> {
  const db = await getDb();
  const updateValues: Record<string, unknown> = {};
  if (fields.status !== undefined) updateValues.status = fields.status;
  if (fields.plan !== undefined) updateValues.plan = fields.plan;
  if (fields.safety_verdict !== undefined) updateValues.safety_verdict = fields.safety_verdict;
  if (fields.creative_strategy !== undefined) updateValues.creative_strategy = fields.creative_strategy;
  if (fields.qc_report !== undefined) updateValues.qc_report = fields.qc_report;
  if (fields.qc_regeneration_count !== undefined) updateValues.qc_regeneration_count = fields.qc_regeneration_count;
  if (fields.reference_qc_verdict !== undefined) updateValues.reference_qc_verdict = fields.reference_qc_verdict;
  if (fields.reference_regeneration_count !== undefined)
    updateValues.reference_regeneration_count = fields.reference_regeneration_count;
  if (fields.failure_reason !== undefined) updateValues.failure_reason = fields.failure_reason;
  if (fields.completed_at !== undefined) updateValues.completed_at = fields.completed_at;
  const [row] = await db
    .update(schema.contentVersions)
    .set(updateValues)
    .where(eq(schema.contentVersions.id, id))
    .returning();
  if (!row) throw new Error(`Content version ${id} not found.`);
  return row as ContentVersion;
}

export async function listVersionsWithAssets(
  contentItemId: string,
): Promise<Array<ContentVersion & { assets: ContentAsset[] }>> {
  const db = await getDb();
  const versions = (await db
    .select()
    .from(schema.contentVersions)
    .where(eq(schema.contentVersions.content_item_id, contentItemId))
    .orderBy(schema.contentVersions.version_number)) as ContentVersion[];
  if (versions.length === 0) return [];
  const assetRows = (await db
    .select()
    .from(schema.contentAssets)
    .where(
      inArray(
        schema.contentAssets.content_version_id,
        versions.map((v) => v.id),
      ),
    )
    .orderBy(schema.contentAssets.created_at)) as ContentAsset[];
  return versions.map((v) => ({ ...v, assets: assetRows.filter((a) => a.content_version_id === v.id) }));
}

// --- Content assets -------------------------------------------------------

export async function recordContentAsset(entry: {
  contentVersionId: string;
  kind: ContentAssetKind;
  storageProvider: string;
  storageKey: string;
  contentType: string;
  byteSize: number | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  checksumSha256?: string | null;
  generatorProvider?: string | null;
  generatorModel?: string | null;
  providerAssetId?: string | null;
}): Promise<ContentAsset> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.contentAssets)
    .values({
      id: randomUUID(),
      content_version_id: entry.contentVersionId,
      kind: entry.kind,
      storage_provider: entry.storageProvider,
      storage_key: entry.storageKey,
      content_type: entry.contentType,
      byte_size: entry.byteSize,
      duration_seconds: entry.durationSeconds ?? null,
      width: entry.width ?? null,
      height: entry.height ?? null,
      checksum_sha256: entry.checksumSha256 ?? null,
      generator_provider: entry.generatorProvider ?? null,
      generator_model: entry.generatorModel ?? null,
      provider_asset_id: entry.providerAssetId ?? null,
    })
    .returning();
  return row as ContentAsset;
}

/**
 * The one deliberate exception to content_assets' insert-only philosophy —
 * used ONLY by the Visual QC stage's bounded regeneration (see
 * contentWorkflow.ts's runVisualQCStage). A regenerated still replaces a
 * specific FLAGGED asset at the exact same (storage_provider, storage_key)
 * — a real unique constraint (`content_assets_provider_key_unique`) means
 * a second real INSERT at that same key would fail outright, and this is
 * happening entirely within one still-in-progress version before it has
 * ever been shown to a founder as finished, unlike the version-level
 * insert-only history this app otherwise never breaks. Every real cost
 * from the regeneration is still recorded via the ordinary, unaffected
 * insert-only `costs` table — this only ever replaces the asset row's own
 * metadata, never the cost/audit trail.
 */
export async function updateContentAsset(
  id: string,
  fields: Partial<
    Pick<ContentAsset, "content_type" | "byte_size" | "checksum_sha256" | "generator_provider" | "generator_model" | "provider_asset_id">
  >,
): Promise<ContentAsset> {
  const db = await getDb();
  const updateValues: Record<string, unknown> = {};
  if (fields.content_type !== undefined) updateValues.content_type = fields.content_type;
  if (fields.byte_size !== undefined) updateValues.byte_size = fields.byte_size;
  if (fields.checksum_sha256 !== undefined) updateValues.checksum_sha256 = fields.checksum_sha256;
  if (fields.generator_provider !== undefined) updateValues.generator_provider = fields.generator_provider;
  if (fields.generator_model !== undefined) updateValues.generator_model = fields.generator_model;
  if (fields.provider_asset_id !== undefined) updateValues.provider_asset_id = fields.provider_asset_id;
  const [row] = await db.update(schema.contentAssets).set(updateValues).where(eq(schema.contentAssets.id, id)).returning();
  if (!row) throw new Error(`Content asset ${id} not found.`);
  return row as ContentAsset;
}

export async function getContentAsset(id: string): Promise<ContentAsset | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.contentAssets).where(eq(schema.contentAssets.id, id));
  return row as ContentAsset | undefined;
}

export async function listContentAssets(contentVersionId: string): Promise<ContentAsset[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.contentAssets)
    .where(eq(schema.contentAssets.content_version_id, contentVersionId))
    .orderBy(schema.contentAssets.created_at);
  return rows as ContentAsset[];
}
