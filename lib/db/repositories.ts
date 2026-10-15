import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import * as schema from "./schema";
import type {
  Agent,
  AgentAssignment,
  AgentStatus,
  AgentTask,
  AgentTaskState,
  AgentDeliverable,
  AgentDeliverableState,
  AgentDeliverableReview,
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
  Organization,
  VentureStage,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationAgent,
  OrganizationAgentStatus,
  SubscriptionPlan,
  OrganizationSubscription,
  SubscriptionStatus,
} from "./types";

function now(): string {
  return new Date().toISOString();
}

// --- Founders -----------------------------------------------------------

export async function listFounders(): Promise<Founder[]> {
  const db = await getDb();
  return db.select().from(schema.founders).orderBy(schema.founders.created_at);
}

/**
 * Real, organization-scoped founder listing (Mission 10) — the actual
 * fix for a real cross-tenant PII leak found live during this session:
 * `listFounders()` above returns EVERY founder in the entire system
 * with no scoping at all, and was being served directly to any
 * authenticated founder via `GET /api/founders` and `app/page.tsx` —
 * meaning a completely unrelated customer could see every other real
 * founder's name and (where set) real email address, including Ellis
 * and Maddie's. This is the organization-scoped replacement every
 * customer-facing read must use instead: only the real members of the
 * organization actually being asked about.
 */
export async function listFoundersForOrganization(organizationId: string): Promise<Founder[]> {
  const db = await getDb();
  const rows = await db
    .select({ founder: schema.founders })
    .from(schema.organizationMembers)
    .innerJoin(schema.founders, eq(schema.founders.id, schema.organizationMembers.founder_id))
    .where(eq(schema.organizationMembers.organization_id, organizationId))
    .orderBy(schema.founders.created_at);
  return rows.map((r) => r.founder);
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

/**
 * Real founder creation — used by this phase's own security-negative
 * tests (two genuinely separate fictional businesses need two genuinely
 * separate real people) and by a future onboarding flow (Phase I, not
 * built yet). Not used by `seed()`, which hardcodes Ellis/Maddie's own
 * two rows directly and must stay that way (see client.ts's own doc
 * comment on preserving founder data).
 */
export async function createFounder(input: { name: string; email?: string | null }): Promise<Founder> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.founders)
    .values({ id: randomUUID(), name: input.name, email: input.email ?? null })
    .returning();
  return row!;
}

// --- Organizations (Master Development Mission 6 — multi-tenancy) -------

export async function createOrganization(input: {
  name: string;
  ownerFounderId: string;
  ventureStage?: VentureStage | null;
}): Promise<Organization> {
  const db = await getDb();
  const id = randomUUID();
  const [row] = await db
    .insert(schema.organizations)
    .values({
      id,
      name: input.name,
      owner_founder_id: input.ownerFounderId,
      venture_stage: input.ventureStage ?? null,
    })
    .returning();
  return row!;
}

export async function getOrganizationById(id: string): Promise<Organization | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, id));
  return row;
}

export async function addOrganizationMember(input: {
  organizationId: string;
  founderId: string;
  role: OrganizationMemberRole;
}): Promise<OrganizationMember> {
  const db = await getDb();
  const id = randomUUID();
  const [row] = await db
    .insert(schema.organizationMembers)
    .values({ id, organization_id: input.organizationId, founder_id: input.founderId, role: input.role })
    .returning();
  return row as OrganizationMember;
}

/** Every real organization this founder genuinely belongs to — ordered oldest-membership-first, so a caller that needs one deterministic "active" organization (no switcher UI yet) gets a stable, repeatable choice. */
export async function listOrganizationMembershipsForFounder(founderId: string): Promise<OrganizationMember[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.founder_id, founderId))
    .orderBy(schema.organizationMembers.created_at);
  return rows as OrganizationMember[];
}

/**
 * The real, server-side membership check every tenant-scoped operation
 * must go through — returns undefined (never throws) when the founder is
 * not genuinely a member of this organization, so callers decide how to
 * fail (see lib/domain/organizationWorkflow.ts's requireOrganizationMembership,
 * the one real place that turns this into a thrown error).
 */
export async function getOrganizationMembership(
  organizationId: string,
  founderId: string,
): Promise<OrganizationMember | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organization_id, organizationId),
        eq(schema.organizationMembers.founder_id, founderId),
      ),
    );
  return row as OrganizationMember | undefined;
}

// --- Subscription plans & billing (Mission 8, Sections 14-15) -----------

export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const db = await getDb();
  return db.select().from(schema.subscriptionPlans);
}

export async function getSubscriptionPlan(planId: string): Promise<SubscriptionPlan | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, planId));
  return row;
}

/** Real, atomic creation — called once, at the moment an organization itself is created (createOrganizationWithOwner), so every organization has exactly one subscription row from the start. `onConflictDoNothing` makes a retried call safe rather than erroring on the real unique constraint. */
export async function createOrganizationSubscription(input: {
  organizationId: string;
  planId: string;
}): Promise<OrganizationSubscription> {
  const db = await getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(schema.organizationSubscriptions)
    .values({
      id,
      organization_id: input.organizationId,
      plan_id: input.planId,
      status: "active",
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing({ target: schema.organizationSubscriptions.organization_id })
    .returning();
  if (row) return row as OrganizationSubscription;
  // Lost a race to a concurrent creation for the SAME organization (or a
  // retried call) — return the real existing row rather than erroring.
  const [existing] = await db
    .select()
    .from(schema.organizationSubscriptions)
    .where(eq(schema.organizationSubscriptions.organization_id, input.organizationId));
  return existing as OrganizationSubscription;
}

export async function getOrganizationSubscription(organizationId: string): Promise<OrganizationSubscription | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.organizationSubscriptions)
    .where(eq(schema.organizationSubscriptions.organization_id, organizationId));
  return row as OrganizationSubscription | undefined;
}

export async function getOrganizationSubscriptionByStripeCustomerId(
  stripeCustomerId: string,
): Promise<OrganizationSubscription | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.organizationSubscriptions)
    .where(eq(schema.organizationSubscriptions.stripe_customer_id, stripeCustomerId));
  return row as OrganizationSubscription | undefined;
}

export async function updateOrganizationSubscription(
  organizationId: string,
  fields: Partial<{
    planId: string;
    status: SubscriptionStatus;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }>,
): Promise<OrganizationSubscription> {
  const db = await getDb();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.planId !== undefined) updates.plan_id = fields.planId;
  if (fields.status !== undefined) updates.status = fields.status;
  if (fields.stripeCustomerId !== undefined) updates.stripe_customer_id = fields.stripeCustomerId;
  if (fields.stripeSubscriptionId !== undefined) updates.stripe_subscription_id = fields.stripeSubscriptionId;
  if (fields.currentPeriodEnd !== undefined) updates.current_period_end = fields.currentPeriodEnd;
  if (fields.cancelAtPeriodEnd !== undefined) updates.cancel_at_period_end = fields.cancelAtPeriodEnd;
  const [row] = await db
    .update(schema.organizationSubscriptions)
    .set(updates)
    .where(eq(schema.organizationSubscriptions.organization_id, organizationId))
    .returning();
  return row as OrganizationSubscription;
}

/** Real idempotency check — returns true if this exact Stripe event id has already been processed (insert succeeded = first time seeing it; conflict = a genuine redelivery). */
export async function recordBillingWebhookEventIfNew(eventId: string, type: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .insert(schema.billingWebhookEvents)
    .values({ id: eventId, type, processed_at: new Date().toISOString() })
    .onConflictDoNothing({ target: schema.billingWebhookEvents.id })
    .returning({ id: schema.billingWebhookEvents.id });
  return result.length > 0;
}

/** Real count of content items a real organization has already started producing this calendar month — the actual mechanism behind each plan's separate monthly video allowance (contentProduction.ts's assertPlanAllowsNewVideoProduction). */
export async function countContentItemsStartedThisMonth(organizationId: string, monthStartIso: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.execute<{ count: string }>(sql`
    select count(*)::int as count
    from ${schema.contentItems} ci
    join ${schema.missions} m on m.id = ci.mission_id
    where m.organization_id = ${organizationId}
      and ci.created_at >= ${monthStartIso}
  `);
  return Number((row as unknown as { count: number })?.count ?? 0);
}

// --- Per-organization workforce (replaces the global agents.status as the
// real "is this agent recruited" signal — see schema.ts's own comment on
// organization_agents for why this is a separate table, not a new column
// on the shared `agents` catalog) -----------------------------------------

export async function listOrganizationAgents(organizationId: string): Promise<OrganizationAgent[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.organizationAgents)
    .where(eq(schema.organizationAgents.organization_id, organizationId));
  return rows as OrganizationAgent[];
}

export async function getOrganizationAgent(
  organizationId: string,
  agentKey: string,
): Promise<OrganizationAgent | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.organizationAgents)
    .where(
      and(
        eq(schema.organizationAgents.organization_id, organizationId),
        eq(schema.organizationAgents.agent_key, agentKey),
      ),
    );
  return row as OrganizationAgent | undefined;
}

/**
 * Real upsert — a genuine insert for this organization's first-ever
 * decision about this agent, or an update if it already has one. Uses
 * the real DB-level unique index (organization_id, agent_key) via
 * `onConflictDoUpdate`, so two genuinely concurrent recruit requests for
 * the same org+agent can never create two rows — the same "the database
 * is the actual guarantee, not just application logic" discipline every
 * other atomic transition in this codebase already follows.
 */
export async function setOrganizationAgentStatus(
  organizationId: string,
  agentKey: string,
  status: OrganizationAgentStatus,
): Promise<OrganizationAgent> {
  const db = await getDb();
  const id = randomUUID();
  const ts = now();
  const [row] = await db
    .insert(schema.organizationAgents)
    .values({ id, organization_id: organizationId, agent_key: agentKey, status, updated_at: ts })
    .onConflictDoUpdate({
      target: [schema.organizationAgents.organization_id, schema.organizationAgents.agent_key],
      set: { status, updated_at: ts },
    })
    .returning();
  return row as OrganizationAgent;
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

/**
 * Sets a real agent's roster status directly (Commercial MVP milestone —
 * the Employee Directory's recruit/remove actions). Deliberately the
 * SAME `status` column `seedAgents()` already owns — "recruited" and
 * "active" are the same real, persisted fact; "removed" and "planned"
 * are too. This never touches any other row (missions, costs, tasks,
 * etc.) — removing an employee only ever changes its own roster status.
 */
export async function setAgentStatus(key: string, status: AgentStatus): Promise<Agent | undefined> {
  const db = await getDb();
  await db.update(schema.agents).set({ status }).where(eq(schema.agents.key, key));
  return getAgentByKey(key);
}

// --- Agent tasks (Operations Wing) -----------------------------------------
// General-purpose task records for the non-mission agents. See schema.ts's
// doc comment on agentTasks for why this is deliberately separate from
// `missions`.

export async function createAgentTask(input: {
  agentKey: string;
  founderId: string;
  organizationId: string;
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
    organization_id: input.organizationId,
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

/** Real, server-side WHERE-clause scoping by organization — used wherever a caller must reason about an organization's work (e.g. the active-work check before removing a recruited agent), never a founder's alone, since a future founder may belong to more than one organization. */
export async function listAgentTasksForOrganization(
  organizationId: string,
  opts?: { agentKey?: string },
): Promise<AgentTask[]> {
  const db = await getDb();
  const conditions = [eq(schema.agentTasks.organization_id, organizationId)];
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

/**
 * A minimal, privacy-conscious projection of every real agent_tasks row
 * — never title/detail/payload (which can hold a founder's personal
 * reminder text) — for the one shared 3D office scene (Milestone 7).
 * Deliberately global, not founder-scoped: the office is one shared
 * space for both founders (consistent with listLeadAssignments() also
 * being global, which Scout/Content Bot's room already relies on), and
 * this is the only signal driving whether a Operations Wing agent's
 * character walks to its own desk — never which task, whose it is, or
 * what it says.
 */
export async function listAgentTaskWorldSignals(): Promise<
  Array<{ agent_key: string; state: AgentTaskState; goal_id: string | null }>
> {
  const db = await getDb();
  const rows = await db
    .select({
      agent_key: schema.agentTasks.agent_key,
      state: schema.agentTasks.state,
      goal_id: schema.agentTasks.goal_id,
    })
    .from(schema.agentTasks);
  return rows as Array<{ agent_key: string; state: AgentTaskState; goal_id: string | null }>;
}

/**
 * The real organization-scoped version — same pure data-scoping change
 * and same rationale as listLeadAssignmentsForOrganization above. The
 * returned shape is identical (never title/detail/payload — see this
 * function's un-scoped sibling's own doc comment for why), so
 * world/layout.ts's agentDestination/agentBusy logic needs zero changes;
 * it just now only ever sees one real organization's own agent_tasks
 * rows.
 */
export async function listAgentTaskWorldSignalsForOrganization(
  organizationId: string,
): Promise<Array<{ agent_key: string; state: AgentTaskState; goal_id: string | null }>> {
  const db = await getDb();
  const rows = await db
    .select({
      agent_key: schema.agentTasks.agent_key,
      state: schema.agentTasks.state,
      goal_id: schema.agentTasks.goal_id,
    })
    .from(schema.agentTasks)
    .where(eq(schema.agentTasks.organization_id, organizationId));
  return rows as Array<{ agent_key: string; state: AgentTaskState; goal_id: string | null }>;
}

// --- Chief of Staff (Operations Wing) ---------------------------------------
// A goal is an immutable grouping container; its real delegated work lives
// in agent_tasks rows carrying this goal's id (see schema.ts's doc comment
// on agentTasks.goal_id).

export async function createChiefOfStaffGoal(input: { founderId: string; organizationId: string; title: string }): Promise<ChiefOfStaffGoal> {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(schema.chiefOfStaffGoals).values({
    id,
    founder_id: input.founderId,
    organization_id: input.organizationId,
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
  organizationId: string;
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
    organization_id: input.organizationId,
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

export async function listExpenses(organizationId: string, opts?: { category?: string }): Promise<Expense[]> {
  const db = await getDb();
  const conditions = [eq(schema.expenses.organization_id, organizationId)];
  if (opts?.category) conditions.push(eq(schema.expenses.category, opts.category));
  const rows = await db
    .select()
    .from(schema.expenses)
    .where(and(...conditions))
    .orderBy(desc(schema.expenses.incurred_at));
  return rows as Expense[];
}

// "One budget ceiling per category+period" (see schema.ts's own comment on
// `budgets`) is now real per-organization uniqueness, not global — Bakery
// HQ and Landscaping HQ can each have their own "software" budget without
// colliding on the same real row. There is no DB-level unique constraint
// for this yet (a real follow-up — see the progress doc); this upsert's
// own SELECT-then-branch is the only guard today, same caveat every other
// non-atomic upsert in this codebase that predates the atomic-transition
// pattern already carries.
export async function upsertBudget(input: {
  organizationId: string;
  category: string;
  amount: number;
  currency: string;
  period?: BudgetPeriod;
}): Promise<Budget> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.budgets)
    .where(
      and(
        eq(schema.budgets.organization_id, input.organizationId),
        eq(schema.budgets.category, input.category),
        eq(schema.budgets.period, input.period ?? "monthly"),
      ),
    );

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
    organization_id: input.organizationId,
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

export async function listBudgets(organizationId: string): Promise<Budget[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.organization_id, organizationId))
    .orderBy(schema.budgets.category);
  return rows as Budget[];
}

export async function getBudgetByCategory(
  organizationId: string,
  category: string,
  period: BudgetPeriod = "monthly",
): Promise<Budget | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.budgets)
    .where(
      and(
        eq(schema.budgets.organization_id, organizationId),
        eq(schema.budgets.category, category),
        eq(schema.budgets.period, period),
      ),
    );
  return row as Budget | undefined;
}

export async function sumExpensesByCategoryAndCurrency(
  organizationId: string,
  category: string,
): Promise<Array<{ currency: string; total: number }>> {
  const db = await getDb();
  const rows = await db
    .select({
      currency: schema.expenses.currency,
      total: sql<number>`coalesce(sum(${schema.expenses.amount}), 0)`,
    })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.organization_id, organizationId), eq(schema.expenses.category, category)))
    .groupBy(schema.expenses.currency);
  return rows;
}

// --- Operations Agent: checklists --------------------------------------
// Deliberately separate tables from agent_tasks — see schema.ts's doc
// comment on `checklists`/`checklist_items` for why (ordered, independently
// completable items vs. one task with one state).

export async function createChecklist(input: {
  founderId: string;
  organizationId: string;
  title: string;
  itemLabels: string[];
}): Promise<ChecklistWithItems> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.checklists).values({
    id,
    founder_id: input.founderId,
    organization_id: input.organizationId,
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
  organizationId: string;
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
    organization_id: input.organizationId,
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

export async function listProjects(organizationId: string): Promise<Project[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organization_id, organizationId))
    .orderBy(schema.projects.created_at);
  return rows as Project[];
}

/** A real cross-tenant leak this migration closes: the old global version picked the single oldest project across EVERY organization — a mission created without an explicit projectId could land in a different organization's workspace entirely. */
export async function getDefaultProject(organizationId: string): Promise<Project | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organization_id, organizationId))
    .orderBy(schema.projects.created_at)
    .limit(1);
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
  organizationId: string;
  workspaceType: WorkspaceType;
  description?: string | null;
}): Promise<Project> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.projects)
    .values({
      id: randomUUID(),
      name: input.name,
      organization_id: input.organizationId,
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
  organizationId: string;
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
    organization_id: input.organizationId,
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

/** Real, server-side WHERE-clause scoping — not a post-fetch filter — for every caller that must never see another organization's missions. */
export async function listMissionsForOrganization(organizationId: string): Promise<Mission[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.missions)
    .where(eq(schema.missions.organization_id, organizationId))
    .orderBy(desc(schema.missions.created_at));
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

/**
 * The real organization-scoped version (Master Development Mission 6 —
 * "Address global leadAssignments ... Keep the business/task state
 * organisation-scoped"). Deliberately a pure data-scoping change: the 3D
 * world components this feeds (components/founders-desk/world/*) are
 * completely untouched — they still receive a plain
 * MissionLeadAssignment[] in the exact same shape, just correctly scoped
 * to one real organization's own missions (via the real
 * mission_id -> missions.organization_id chain) instead of every
 * organization's at once. `listLeadAssignments()` above stays available
 * for any caller that genuinely needs the global view (none currently
 * do outside this function's own callers, which have all been updated).
 */
export async function listLeadAssignmentsForOrganization(organizationId: string): Promise<MissionLeadAssignment[]> {
  const db = await getDb();
  const rows = await db
    .select({ mission_id: schema.agentAssignments.mission_id, agent_key: schema.agents.key })
    .from(schema.agentAssignments)
    .innerJoin(schema.agents, eq(schema.agentAssignments.agent_id, schema.agents.id))
    .innerJoin(schema.missions, eq(schema.agentAssignments.mission_id, schema.missions.id))
    .where(and(eq(schema.agentAssignments.role, "lead"), eq(schema.missions.organization_id, organizationId)));
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
    | "publish"
    // Universal Founders' Desk (Commercial MVP Milestone 4) — a real,
    // audit-only acknowledgment of a Scout mission at
    // ready_for_founders_review, recorded here (real mission_id already
    // exists) rather than inventing a parallel review table for Scout.
    // Deliberately does NOT change `missions.state` — Scout's own
    // protected state machine is untouched; this is purely a founder
    // decision record layered on top of it.
    | "founders_desk_approved"
    | "founders_desk_rejected"
    | "founders_desk_revision_requested";
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
  /**
   * Required — Master Development Mission 7's real attribution fix.
   * Every caller must resolve and pass the real organization this spend
   * belongs to (via its mission, its content item, or directly — see
   * businessAnalystWorkflow.ts for the standalone-research case this
   * closes). Never optional: an unattributed cost is exactly the gap
   * this migration exists to close, so there is no silent fallback.
   */
  organizationId: string;
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
      organization_id: entry.organizationId,
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
      organization_id: entry.organizationId,
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

/**
 * Sum of real, known (non-null) usd_cost rows for one content *version* —
 * narrower than contentItemSpendUsd (item-wide), used by the organization
 * budget reservation's settlement (Mission 8 Milestone C): one version is
 * one real production attempt/spend event (mirrors Scout's one research
 * pass), so its own reservation settles with just its own real cost, not
 * the item's cumulative total across every version.
 */
export async function contentVersionSpendUsd(contentVersionId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.costs.usd_cost}), 0)` })
    .from(schema.costs)
    .where(and(eq(schema.costs.content_version_id, contentVersionId), sql`${schema.costs.usd_cost} is not null`));
  return row?.total ?? 0;
}

/**
 * @deprecated Globally unscoped — returns EVERY organization's real ledger
 * entries with no filtering at all. This was found live during Mission 10
 * serving one organization's real financial data to a completely unrelated
 * customer via GET /api/ledger and app/page.tsx. Kept only because tests
 * reference it directly for seed-data assertions; every real route/page must
 * use `listLedgerEntriesForOrganization` instead.
 */
export async function listLedgerEntries(limit = 50): Promise<LedgerEntry[]> {
  const db = await getDb();
  return db.select().from(schema.ledgerEntries).orderBy(desc(schema.ledgerEntries.created_at)).limit(limit);
}

/**
 * @deprecated Globally unscoped — see `listLedgerEntries`'s doc comment.
 * Use `ledgerTotalUsdForOrganization` for any real, customer-facing total.
 */
export async function ledgerTotalUsd(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amount_usd}), 0)` })
    .from(schema.ledgerEntries);
  return row?.total ?? 0;
}

/**
 * Real, organization-scoped ledger listing (Mission 10) — the fix for the
 * second real cross-tenant leak found live this session (the first was
 * `listFoundersForOrganization`'s own leak). Only entries belonging to the
 * organization actually being asked about.
 */
export async function listLedgerEntriesForOrganization(organizationId: string, limit = 50): Promise<LedgerEntry[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.organization_id, organizationId))
    .orderBy(desc(schema.ledgerEntries.created_at))
    .limit(limit);
}

/** Organization-scoped counterpart to `ledgerTotalUsd` — see its doc comment above. */
export async function ledgerTotalUsdForOrganization(organizationId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amount_usd}), 0)` })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.organization_id, organizationId));
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

// --- Universal Founders' Desk (Commercial MVP Milestone 4) ---------------
// A real, reviewable deliverable for the five Operations Wing agents —
// see schema.ts's own doc comment on agentDeliverables for why this is a
// separate table rather than a forced reuse of the mission-scoped
// deliverables/approvals tables.

export async function createAgentDeliverable(input: {
  agentKey: string;
  founderId: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  kind: string;
  content: unknown;
}): Promise<AgentDeliverable> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = now();
  await db.insert(schema.agentDeliverables).values({
    id,
    agent_key: input.agentKey,
    founder_id: input.founderId,
    organization_id: input.organizationId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    title: input.title,
    kind: input.kind,
    content: input.content,
    state: "awaiting_review",
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const [row] = await db.select().from(schema.agentDeliverables).where(eq(schema.agentDeliverables.id, id));
  return row as unknown as AgentDeliverable;
}

export async function getAgentDeliverable(id: string): Promise<AgentDeliverable | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.agentDeliverables).where(eq(schema.agentDeliverables.id, id));
  return row as unknown as AgentDeliverable | undefined;
}

export async function listAgentDeliverables(opts?: {
  organizationId?: string;
  state?: AgentDeliverableState;
  agentKey?: string;
}): Promise<AgentDeliverable[]> {
  const db = await getDb();
  const conditions = [];
  if (opts?.organizationId) conditions.push(eq(schema.agentDeliverables.organization_id, opts.organizationId));
  if (opts?.state) conditions.push(eq(schema.agentDeliverables.state, opts.state));
  if (opts?.agentKey) conditions.push(eq(schema.agentDeliverables.agent_key, opts.agentKey));
  const rows = conditions.length
    ? await db.select().from(schema.agentDeliverables).where(and(...conditions)).orderBy(desc(schema.agentDeliverables.created_at))
    : await db.select().from(schema.agentDeliverables).orderBy(desc(schema.agentDeliverables.created_at));
  return rows as unknown as AgentDeliverable[];
}

/** Atomic conditional update, same pattern as transitionMissionState — a decision can never double-apply to a stale state. */
export async function transitionAgentDeliverableState(
  id: string,
  fromStates: AgentDeliverableState[],
  toState: AgentDeliverableState,
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .update(schema.agentDeliverables)
    .set({ state: toState, updated_at: now() })
    .where(and(eq(schema.agentDeliverables.id, id), inArray(schema.agentDeliverables.state, fromStates)))
    .returning({ id: schema.agentDeliverables.id });
  return result.length > 0;
}

export async function recordAgentDeliverableReview(entry: {
  deliverableId: string;
  founderId: string;
  decision: "approved" | "rejected" | "revision_requested";
  note?: string | null;
}): Promise<AgentDeliverableReview> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.agentDeliverableReviews)
    .values({
      id: randomUUID(),
      deliverable_id: entry.deliverableId,
      founder_id: entry.founderId,
      decision: entry.decision,
      note: entry.note ?? null,
    })
    .returning();
  return row!;
}

export async function listAgentDeliverableReviews(deliverableId: string): Promise<AgentDeliverableReview[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.agentDeliverableReviews)
    .where(eq(schema.agentDeliverableReviews.deliverable_id, deliverableId))
    .orderBy(schema.agentDeliverableReviews.decided_at);
  return rows;
}
