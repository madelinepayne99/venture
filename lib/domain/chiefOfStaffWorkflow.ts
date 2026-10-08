import "server-only";
import {
  createChiefOfStaffGoal,
  listChiefOfStaffGoalsForFounder,
  getChiefOfStaffGoalWithSubtasks,
  createAgentTask,
  getAgentByKey,
} from "@/lib/db/repositories";
import type { ChiefOfStaffGoal, ChiefOfStaffGoalWithSubtasks } from "@/lib/db/types";

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
