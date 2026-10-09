import "server-only";
import {
  createChiefOfStaffGoal,
  listChiefOfStaffGoalsForFounder,
  getChiefOfStaffGoalWithSubtasks,
  createAgentTask,
  getAgentByKey,
  getAgentTask,
  updateAgentTaskState,
} from "@/lib/db/repositories";
import type { ChiefOfStaffGoal, ChiefOfStaffGoalWithSubtasks, AgentTask } from "@/lib/db/types";
import { requestResearch, type RequestResearchDeps } from "@/lib/domain/businessAnalystWorkflow";

/**
 * Chief of Staff's one real, tested capability: breaking a founder's goal
 * into real subtasks delegated to the other active Operations Wing
 * agents. Deliberately last of the five to be built (per the founders'
 * own ordering) — delegation only means something once there's more than
 * one real agent to delegate to.
 *
 * Reuses agent_tasks entirely (createAgentTask with goalId set) rather
 * than inventing a parallel task system — the "reuse existing infra
 * wherever practical" principle. A delegated subtask is completed or
 * cancelled through the EXISTING /api/agent-tasks/[id] route and
 * executiveAssistantWorkflow.ts's completeFounderTask/cancelFounderTask,
 * unchanged — those functions check only founder ownership, never
 * agent_key, so they already work for a subtask delegated to any agent.
 */

export class ChiefOfStaffValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ChiefOfStaffValidationError";
  }
}

export class ChiefOfStaffGoalNotFoundError extends Error {
  constructor(id: string) {
    super(`Goal ${id} not found.`);
    this.name = "ChiefOfStaffGoalNotFoundError";
  }
}

export class ChiefOfStaffTaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Delegated subtask ${id} not found.`);
    this.name = "ChiefOfStaffTaskNotFoundError";
  }
}

/**
 * A real research run, triggered as part of Chief of Staff's own
 * delegation, failed — carries the real (failed) report's id so a
 * founder can inspect exactly what happened via Business Analyst's own
 * panel, rather than a silent or fabricated completion.
 */
export class ChiefOfStaffResearchError extends Error {
  constructor(
    readonly reportId: string,
    reportError: string | null,
  ) {
    super(`Delegated research failed: ${reportError ?? "unknown error"}`);
    this.name = "ChiefOfStaffResearchError";
  }
}

/**
 * The only agents a goal's subtasks may be delegated to. Scout and
 * Content Bot are deliberately excluded — they're mission-dispatched
 * (see CLAUDE.md's "protect Scout and Content Bot" instruction), and
 * creating an agent_tasks row naming either of them would fabricate
 * activity that doesn't actually make either one do anything: neither
 * agent reads agent_tasks. Chief of Staff itself is excluded too —
 * delegating to yourself isn't delegation. A hardcoded allowlist, not
 * just a DB `status` check, so this stays correct even if a future
 * agent's status flips to "active" without an explicit decision about
 * whether it's agent_tasks-dispatchable at all.
 */
export const DELEGATABLE_AGENT_KEYS = [
  "executive_assistant",
  "finance_agent",
  "operations_agent",
  "business_analyst",
] as const;

export interface SubtaskInput {
  agentKey?: string;
  title?: string;
  detail?: string | null;
}

export interface CreateGoalInput {
  title?: string;
  subtasks?: SubtaskInput[];
}

async function validateCreateGoalInput(input: CreateGoalInput): Promise<string[]> {
  const errors: string[] = [];
  const title = input.title?.trim();
  if (!title) errors.push("A goal needs a non-empty title.");
  if (title && title.length > 500) errors.push("Goal title must be 500 characters or fewer.");

  const subtasks = input.subtasks ?? [];
  if (subtasks.length === 0) errors.push("A goal needs at least one delegated subtask.");
  if (subtasks.length > 20) errors.push("A goal may have at most 20 delegated subtasks.");

  for (const subtask of subtasks) {
    const subtitle = subtask.title?.trim();
    if (!subtitle) {
      errors.push("Every subtask needs a non-empty title.");
      continue;
    }
    if (!subtask.agentKey || !(DELEGATABLE_AGENT_KEYS as readonly string[]).includes(subtask.agentKey)) {
      errors.push(`"${subtitle}" must be delegated to one of: ${DELEGATABLE_AGENT_KEYS.join(", ")}.`);
      continue;
    }
    const agent = await getAgentByKey(subtask.agentKey);
    if (!agent || agent.status !== "active") {
      errors.push(`"${subtitle}" cannot be delegated to "${subtask.agentKey}" — that agent is not active.`);
    }
  }
  return errors;
}

export async function createGoalWithDelegatedSubtasks(
  founderId: string,
  input: CreateGoalInput,
): Promise<ChiefOfStaffGoalWithSubtasks> {
  const errors = await validateCreateGoalInput(input);
  if (errors.length) throw new ChiefOfStaffValidationError(errors);

  const goal = await createChiefOfStaffGoal({ founderId, title: input.title!.trim() });

  for (const subtask of input.subtasks!) {
    await createAgentTask({
      agentKey: subtask.agentKey!,
      founderId,
      taskType: "delegated_subtask",
      title: subtask.title!.trim(),
      detail: subtask.detail?.trim() || null,
      goalId: goal.id,
    });
  }

  const withSubtasks = await getChiefOfStaffGoalWithSubtasks(goal.id);
  if (!withSubtasks) throw new ChiefOfStaffGoalNotFoundError(goal.id);
  return withSubtasks;
}

export async function listFounderGoals(founderId: string): Promise<ChiefOfStaffGoal[]> {
  return listChiefOfStaffGoalsForFounder(founderId);
}

export async function getFounderGoal(id: string, founderId: string): Promise<ChiefOfStaffGoalWithSubtasks> {
  const goal = await getChiefOfStaffGoalWithSubtasks(id);
  if (!goal || goal.founder_id !== founderId) {
    throw new ChiefOfStaffGoalNotFoundError(id);
  }
  return goal;
}

/**
 * The real gap found in Master Development Mission 6's own workforce
 * verification: completing ANY delegated subtask — regardless of which
 * agent it names — went through the exact same generic
 * `completeFounderTask`/`cancelFounderTask` state flip, with no
 * agent-specific branching at all. For Executive Assistant/Finance/
 * Operations that's honestly correct (none of them has any autonomous
 * AI execution to invoke — they're founder-driven tools, same as
 * Executive Assistant's own "internal reminders" are explicitly
 * documented to be). But Business Analyst DOES have a genuine
 * autonomous capability (`requestResearch`, a real web-sourced Claude
 * call), and a subtask delegated to it was being "completed" by the
 * founder manually, as a bare checkbox, without that real capability
 * ever actually running — Chief of Staff was coordinating a to-do list,
 * not genuinely dispatching work to the one delegate that can act on
 * its own.
 *
 * This closes that gap the honest way: it reuses `requestResearch`
 * verbatim (no duplicated agent logic, no second code path that could
 * drift from Business Analyst's own panel), uses the real subtask's own
 * title/detail as the research question, and the subtask is marked
 * "completed" — atomically, with the real report's id recorded in its
 * `result` — ONLY when that real research genuinely finished
 * (`report.state === "completed"`). A failed run leaves the subtask
 * exactly where it was (still open/in_progress) and throws a real,
 * distinct error carrying the failed report's id — never a fabricated
 * completion, never a silently swallowed failure. Real cost is recorded
 * either way by `requestResearch` itself, exactly as it already is from
 * Business Analyst's own panel.
 */
export async function runDelegatedResearch(
  founderId: string,
  taskId: string,
  deps: RequestResearchDeps = {},
): Promise<AgentTask> {
  const task = await getAgentTask(taskId);
  if (!task || task.founder_id !== founderId) throw new ChiefOfStaffTaskNotFoundError(taskId);
  if (task.agent_key !== "business_analyst") {
    throw new ChiefOfStaffValidationError([`Subtask ${taskId} is not delegated to Business Analyst.`]);
  }
  if (!task.goal_id) {
    throw new ChiefOfStaffValidationError([`Subtask ${taskId} is not a Chief of Staff delegated subtask.`]);
  }
  if (task.state !== "open" && task.state !== "in_progress") {
    throw new ChiefOfStaffValidationError([`Subtask ${taskId} is already "${task.state}" — cannot run research again.`]);
  }

  const question = task.detail?.trim() || task.title;
  const report = await requestResearch(founderId, question, deps);

  if (report.state !== "completed") {
    throw new ChiefOfStaffResearchError(report.id, report.error);
  }

  await updateAgentTaskState(taskId, ["open", "in_progress"], "completed", {
    result: { businessAnalystReportId: report.id },
  });
  const fresh = await getAgentTask(taskId);
  return fresh!;
}
