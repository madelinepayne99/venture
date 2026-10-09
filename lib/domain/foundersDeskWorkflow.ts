import "server-only";
import {
  listMissionsForOrganization,
  getMission,
  recordApproval,
  listApprovals,
  listContentItemsForMissions,
  createAgentDeliverable,
  getAgentDeliverable,
  listAgentDeliverables,
  transitionAgentDeliverableState,
  recordAgentDeliverableReview,
  listAgentDeliverableReviews,
  createAgentTask,
  getAgentTask,
  getChecklistWithItems,
  getBusinessAnalystReport,
  getChiefOfStaffGoalWithSubtasks,
} from "@/lib/db/repositories";
import { getBudgetStatus, listAllExpenses } from "@/lib/domain/financeWorkflow";
import type { AgentDeliverable, Mission, Expense } from "@/lib/db/types";
import type { BusinessAnalystReport } from "@/lib/agents/businessAnalyst/schema";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

/**
 * The Universal Founders' Desk (Commercial MVP Milestone 4) — a real
 * adapter unifying three genuinely different review mechanisms into one
 * inbox, without replacing or bypassing any of them:
 *
 *  - Scout's missions at `ready_for_founders_review` are reviewed
 *    through the EXISTING `approvals` table (a real `mission_id`
 *    already exists there) — a new decision vocabulary
 *    (`founders_desk_approved`/`_rejected`/`_revision_requested`), never
 *    a change to `missions.state` itself. Scout's own protected state
 *    machine, research pipeline, and existing production-approval gate
 *    (`approve_for_production`) are completely untouched — this is a
 *    separate, audit-only acknowledgment layered on top, exactly so an
 *    approval here can never accidentally trigger production or
 *    publishing (see CLAUDE.md's own safety rules).
 *  - Content Bot's content items are reviewed through the EXISTING,
 *    fully protected `/api/content-items/[id]/decision` flow
 *    (`approveContentVersion`/`rejectContentItem`/
 *    `requestContentRevision` in `lib/domain/contentWorkflow.ts`) —
 *    this file does not touch that flow at all. The inbox only *lists*
 *    these items; the founder reviews/decides through the existing
 *    `ContentReviewSlideOver` UI, unchanged.
 *  - The five Operations Wing agents (which had no reviewable-
 *    deliverable concept before this milestone) get a real, new
 *    `agent_deliverables` row — see schema.ts's own doc comment for why
 *    this is a separate table, not a forced reuse of the mission-scoped
 *    `deliverables`/`approvals` tables.
 */

export class FoundersDeskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundersDeskValidationError";
  }
}
export class FoundersDeskNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundersDeskNotFoundError";
  }
}
export class FoundersDeskStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundersDeskStateError";
  }
}

export type ReviewSource = "scout_mission" | "content_bot_item" | "agent_deliverable";

export interface ReviewItem {
  id: string;
  source: ReviewSource;
  agentKey: string;
  title: string;
  kind: string;
  createdAt: string;
  /** For "scout_mission": the mission id. For "content_bot_item": the content item id. For "agent_deliverable": the deliverable id. */
  referenceId: string;
}

/**
 * The real, unified pending inbox — every item a founder genuinely has
 * waiting to review right now, across all seven agents, scoped to one
 * real organization (Master Development Mission 6, Phase E — Section 8's
 * explicit "one organization cannot review... another organization's
 * work"). A mission/item/deliverable only ever appears here once
 * (missions already reviewed at the Founders' Desk — any
 * `founders_desk_*` decision recorded — drop off, same as any other
 * agent's reviewed work).
 */
export async function listFoundersDeskInbox(organizationId: string): Promise<ReviewItem[]> {
  const missions = await listMissionsForOrganization(organizationId);
  const readyMissions = missions.filter((m) => m.state === "ready_for_founders_review");

  const scoutItems: ReviewItem[] = [];
  for (const mission of readyMissions) {
    const approvals = await listApprovals(mission.id);
    const alreadyReviewed = approvals.some((a) =>
      ["founders_desk_approved", "founders_desk_rejected", "founders_desk_revision_requested"].includes(a.decision),
    );
    if (!alreadyReviewed) {
      scoutItems.push({
        id: `scout:${mission.id}`,
        source: "scout_mission",
        agentKey: "scout",
        title: mission.title,
        kind: "research_report",
        createdAt: mission.updated_at,
        referenceId: mission.id,
      });
    }
  }

  const contentItems = await listContentItemsForMissions(missions.map((m) => m.id));
  const awaitingReview = contentItems.filter((c) => c.state === "awaiting_review");
  // Master Development Mission 5, Section 5 — a real founder test saw two
  // Content Bot inbox entries with near-identical, truncated titles and
  // asked whether that's a genuine duplication bug. Investigated: it
  // isn't — Content Bot's multi-production architecture (see
  // lib/domain/contentWorkflow.ts's `produceAgainFromMission`) lets one
  // Scout mission genuinely own several independent content_items
  // (separate "Produce Again" attempts), and this inbox correctly listed
  // each of them once. The real problem was presentation: both rows
  // showed only the shared mission title, with nothing to tell a founder
  // they're two distinct, real pieces of work. Fixed here, not by
  // deduplicating (that would hide a real, legitimate second deliverable)
  // — every content item for a mission with more than one is labeled
  // with its own real ordinal among that mission's real items, ordered
  // by creation, so "attempt 2 of 2" (etc.) is visible at a glance.
  const itemsByMission = new Map<string, typeof contentItems>();
  for (const item of contentItems) {
    const list = itemsByMission.get(item.mission_id) ?? [];
    list.push(item);
    itemsByMission.set(item.mission_id, list);
  }
  for (const list of itemsByMission.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const contentBotItems: ReviewItem[] = awaitingReview.map((c) => {
    const mission = missions.find((m) => m.id === c.mission_id);
    const siblings = itemsByMission.get(c.mission_id) ?? [c];
    const ordinal = siblings.findIndex((s) => s.id === c.id) + 1;
    const baseTitle = mission?.title ?? "Produced content";
    const title = siblings.length > 1 ? `${baseTitle} (production attempt ${ordinal} of ${siblings.length})` : baseTitle;
    return {
      id: `content_bot:${c.id}`,
      source: "content_bot_item",
      agentKey: "content_bot",
      title,
      kind: "produced_content",
      createdAt: c.updated_at,
      referenceId: c.id,
    };
  });

  const deliverables = await listAgentDeliverables({ organizationId, state: "awaiting_review" });
  const deliverableItems: ReviewItem[] = deliverables.map((d) => ({
    id: `deliverable:${d.id}`,
    source: "agent_deliverable",
    agentKey: d.agent_key,
    title: d.title,
    kind: d.kind,
    createdAt: d.created_at,
    referenceId: d.id,
  }));

  return [...scoutItems, ...contentBotItems, ...deliverableItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// --- Scout mission review (approvals-table based) ------------------------

export type ScoutDeskDecision = "approve" | "reject" | "revise";

const FOUNDERS_DESK_DECISIONS = ["founders_desk_approved", "founders_desk_rejected", "founders_desk_revision_requested"];

export async function reviewScoutMission(
  missionId: string,
  founderId: string,
  decision: ScoutDeskDecision,
  note?: string,
): Promise<{ mission: Mission; message: string }> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const mission = await getMission(missionId);
  // Deliberately the same "not found" error whether the mission genuinely
  // doesn't exist or belongs to a different organization — never confirm
  // or deny another organization's mission exists to a founder outside it
  // (Master Development Mission 6, Section 8/10 — the real cross-tenant
  // boundary this adapter must now also enforce).
  if (!mission || mission.organization_id !== organization.id) {
    throw new FoundersDeskNotFoundError(`Mission ${missionId} not found.`);
  }
  if (mission.state !== "ready_for_founders_review") {
    throw new FoundersDeskStateError(`Mission ${missionId} is not awaiting Founders' Desk review (state: ${mission.state}).`);
  }
  // Scout's own `missions.state` is deliberately never touched by this
  // adapter (see this file's own doc comment), so it alone can't tell
  // "already reviewed" from "still pending" — the real signal is whether
  // a founders_desk_* decision already exists in the real approvals
  // history, the exact same check listFoundersDeskInbox itself uses to
  // decide whether this mission still belongs in the pending list.
  const existingApprovals = await listApprovals(missionId);
  if (existingApprovals.some((a) => FOUNDERS_DESK_DECISIONS.includes(a.decision))) {
    throw new FoundersDeskStateError(`Mission ${missionId} was already reviewed at the Founders' Desk.`);
  }

  if (decision === "approve") {
    await recordApproval({ missionId, founderId, decision: "founders_desk_approved", note });
    return { mission, message: "Scout's research was acknowledged as reviewed. Production still requires its own separate approval." };
  }
  if (decision === "reject") {
    await recordApproval({ missionId, founderId, decision: "founders_desk_rejected", note });
    return { mission, message: "Scout's research was marked rejected at the Founders' Desk. The real report and its cost remain on record." };
  }
  // "revise" — Scout has no automatic mission-revision workflow. Recorded
  // honestly as a real decision, with no fabricated revision attempted —
  // CLAUDE.md's own mission state machine is never touched by this.
  await recordApproval({ missionId, founderId, decision: "founders_desk_revision_requested", note });
  return {
    mission,
    message: "Recorded. Scout doesn't have an automatic mission-revision workflow — start a new mission with refined instructions for further research.",
  };
}

// --- Agent deliverable review (the five Operations Wing agents) ----------

export type DeliverableDecision = "approve" | "reject" | "revise";

export async function reviewAgentDeliverable(
  deliverableId: string,
  founderId: string,
  decision: DeliverableDecision,
  note?: string,
): Promise<{ deliverable: AgentDeliverable; message: string }> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const deliverable = await getAgentDeliverable(deliverableId);
  // Same real cross-tenant boundary as reviewScoutMission above — a
  // generic "not found" regardless of why, never a signal that a
  // deliverable exists in someone else's organization.
  if (!deliverable || deliverable.organization_id !== organization.id) {
    throw new FoundersDeskNotFoundError(`Deliverable ${deliverableId} not found.`);
  }
  if (deliverable.state !== "awaiting_review") {
    throw new FoundersDeskStateError(`Deliverable ${deliverableId} is not awaiting review (state: ${deliverable.state}).`);
  }

  const toState = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revision_requested";
  const applied = await transitionAgentDeliverableState(deliverableId, ["awaiting_review"], toState);
  if (!applied) throw new FoundersDeskStateError(`Deliverable ${deliverableId} was already reviewed by someone else.`);
  await recordAgentDeliverableReview({
    deliverableId,
    founderId,
    decision: toState as "approved" | "rejected" | "revision_requested",
    note,
  });

  let message = decision === "approve" ? "Approved." : decision === "reject" ? "Rejected — the original work stays on record." : "";
  if (decision === "revise") {
    // None of the five Operations Wing agents have an automatic
    // "re-do this deliverable" capability yet — a real, visible
    // follow-up task is created instead of claiming a revision occurred.
    await createAgentTask({
      agentKey: deliverable.agent_key,
      founderId,
      organizationId: organization.id,
      taskType: "revision_follow_up",
      title: `Revise: ${deliverable.title}`,
      detail: note || "A founder requested a revision at the Founders' Desk.",
    });
    message = `${deliverable.agent_key} doesn't have an automatic revision capability yet — a real follow-up task was created instead.`;
  }

  const fresh = await getAgentDeliverable(deliverableId);
  return { deliverable: fresh!, message };
}

export async function listDeliverableHistory(deliverableId: string) {
  return listAgentDeliverableReviews(deliverableId);
}

// --- Submission functions: wrap real, existing data into a real deliverable ---

async function submit(input: {
  agentKey: string;
  founderId: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  kind: string;
  content: unknown;
}): Promise<AgentDeliverable> {
  return createAgentDeliverable(input);
}

/** Executive Assistant — a reviewable summary of a genuinely completed task. */
export async function submitExecutiveAssistantSummary(founderId: string, taskId: string): Promise<AgentDeliverable> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const task = await getAgentTask(taskId);
  if (!task || task.founder_id !== founderId || task.organization_id !== organization.id) {
    throw new FoundersDeskNotFoundError(`Task ${taskId} not found.`);
  }
  if (task.state !== "completed") {
    throw new FoundersDeskValidationError(`Task "${task.title}" is not completed yet (state: ${task.state}).`);
  }
  return submit({
    agentKey: "executive_assistant",
    founderId,
    organizationId: organization.id,
    sourceType: "agent_task",
    sourceId: taskId,
    title: task.title,
    kind: "task_summary",
    content: {
      title: task.title,
      detail: task.detail,
      completedAt: task.updated_at,
      dueAt: task.due_at,
    },
  });
}

/** Finance Agent — a reviewable report from genuinely recorded expenses/budget. */
export async function submitFinanceReport(founderId: string, category: string): Promise<AgentDeliverable> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const status = await getBudgetStatus(organization.id, category);
  const expenses = await listAllExpenses(organization.id, category);
  if (!status.budget && expenses.length === 0) {
    throw new FoundersDeskValidationError(`No real budget or expenses exist for "${category}" yet.`);
  }
  return submit({
    agentKey: "finance_agent",
    founderId,
    organizationId: organization.id,
    sourceType: "finance_report",
    sourceId: category,
    title: `Spend report — ${category}`,
    kind: "financial_report",
    content: {
      category,
      budget: status.budget,
      spentInBudgetCurrency: status.spentInBudgetCurrency,
      remaining: status.remaining,
      excludedOtherCurrencyTotals: status.excludedOtherCurrencyTotals,
      expenses: expenses.map((e: Expense) => ({ description: e.description, amount: e.amount, currency: e.currency, incurredAt: e.incurred_at })),
    },
  });
}

/** Operations Agent — a reviewable snapshot of a real checklist. */
export async function submitChecklistForReview(founderId: string, checklistId: string): Promise<AgentDeliverable> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const checklist = await getChecklistWithItems(checklistId);
  if (!checklist || checklist.founder_id !== founderId || checklist.organization_id !== organization.id) {
    throw new FoundersDeskNotFoundError(`Checklist ${checklistId} not found.`);
  }
  return submit({
    agentKey: "operations_agent",
    founderId,
    organizationId: organization.id,
    sourceType: "checklist",
    sourceId: checklistId,
    title: checklist.title,
    kind: "checklist_summary",
    content: {
      title: checklist.title,
      items: checklist.items.map((i) => ({ label: i.label, isDone: i.is_done })),
      completeCount: checklist.items.filter((i) => i.is_done).length,
      totalCount: checklist.items.length,
    },
  });
}

/** Business Analyst — the genuine completed research report, with real sources and cost. */
export async function submitBusinessAnalystReport(founderId: string, reportId: string): Promise<AgentDeliverable> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const report = await getBusinessAnalystReport(reportId);
  if (!report || report.founder_id !== founderId || report.organization_id !== organization.id) {
    throw new FoundersDeskNotFoundError(`Report ${reportId} not found.`);
  }
  if (report.state !== "completed") {
    throw new FoundersDeskValidationError(`This research request did not complete successfully (state: ${report.state}).`);
  }
  const content = report.report as BusinessAnalystReport;
  return submit({
    agentKey: "business_analyst",
    founderId,
    organizationId: organization.id,
    sourceType: "business_analyst_report",
    sourceId: reportId,
    title: report.query,
    kind: "research_report",
    content: {
      query: report.query,
      summary: content.summary,
      opportunities: content.opportunities,
      risks: content.risks,
      sources: content.sources,
      model: report.model,
      inputTokens: report.input_tokens,
      outputTokens: report.output_tokens,
      usdCost: report.usd_cost,
    },
  });
}

/**
 * Chief of Staff — a consolidated result from genuine subtask outcomes.
 * Refuses to submit while any subtask is still genuinely open/in
 * progress, so this can never fabricate completion for delegated work
 * that isn't actually done.
 */
export async function submitGoalConsolidation(founderId: string, goalId: string): Promise<AgentDeliverable> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const goal = await getChiefOfStaffGoalWithSubtasks(goalId);
  if (!goal || goal.founder_id !== founderId || goal.organization_id !== organization.id) {
    throw new FoundersDeskNotFoundError(`Goal ${goalId} not found.`);
  }
  const unresolved = goal.subtasks.filter((s) => s.state === "open" || s.state === "in_progress");
  if (unresolved.length > 0) {
    throw new FoundersDeskValidationError(
      `"${goal.title}" still has ${unresolved.length} unresolved subtask(s) — resolve them before submitting a consolidated result.`,
    );
  }
  return submit({
    agentKey: "chief_of_staff",
    founderId,
    organizationId: organization.id,
    sourceType: "chief_of_staff_goal",
    sourceId: goalId,
    title: goal.title,
    kind: "delegation_summary",
    content: {
      title: goal.title,
      subtasks: goal.subtasks.map((s) => ({ title: s.title, agentKey: s.agent_key, state: s.state })),
      completedCount: goal.subtasks.filter((s) => s.state === "completed").length,
      cancelledCount: goal.subtasks.filter((s) => s.state === "cancelled").length,
    },
  });
}
