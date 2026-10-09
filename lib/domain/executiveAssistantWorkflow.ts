import "server-only";
import {
  createAgentTask,
  listAgentTasksForFounder,
  getAgentTask,
  updateAgentTaskState,
  getAgentByKey,
} from "@/lib/db/repositories";
import type { AgentTask } from "@/lib/db/types";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

const AGENT_KEY = "executive_assistant";

export class AgentTaskValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "AgentTaskValidationError";
  }
}

export class AgentTaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent task ${id} not found.`);
    this.name = "AgentTaskNotFoundError";
  }
}

export class AgentTaskStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTaskStateError";
  }
}

export interface CreateTaskInput {
  title?: string;
  detail?: string | null;
  dueAt?: string | null;
}

function validateCreateTaskInput(input: CreateTaskInput): string[] {
  const errors: string[] = [];
  const title = input.title?.trim();
  if (!title) errors.push("A task needs a non-empty title.");
  if (title && title.length > 500) errors.push("Task title must be 500 characters or fewer.");
  if (input.dueAt) {
    const parsed = new Date(input.dueAt);
    if (Number.isNaN(parsed.getTime())) errors.push("dueAt must be a valid date/time.");
  }
  return errors;
}

/**
 * Executive Assistant's one real, tested capability: internal founder
 * tasks/reminders. No external account connection of any kind — this is
 * pure internal persistence, exactly what CLAUDE.md's own "do not fabricate
 * activity" rule requires before claiming anything bigger works.
 */
export async function createFounderTask(founderId: string, input: CreateTaskInput): Promise<AgentTask> {
  const errors = validateCreateTaskInput(input);
  if (errors.length) throw new AgentTaskValidationError(errors);

  const agent = await getAgentByKey(AGENT_KEY);
  if (!agent) {
    // Should never happen outside a database that hasn't run seedAgents yet
    // — fail loudly rather than silently writing an orphaned agent_key.
    throw new Error(`Agent "${AGENT_KEY}" is not registered — run seedAgents().`);
  }

  const organization = await getActiveOrganizationForFounder(founderId);
  return createAgentTask({
    agentKey: AGENT_KEY,
    founderId,
    organizationId: organization.id,
    taskType: "reminder",
    title: input.title!.trim(),
    detail: input.detail ?? null,
    dueAt: input.dueAt ?? null,
  });
}

export async function listFounderTasks(founderId: string): Promise<AgentTask[]> {
  return listAgentTasksForFounder(founderId, { agentKey: AGENT_KEY });
}

export async function completeFounderTask(founderId: string, taskId: string): Promise<AgentTask> {
  const existing = await getAgentTask(taskId);
  if (!existing || existing.founder_id !== founderId) throw new AgentTaskNotFoundError(taskId);

  const updated = await updateAgentTaskState(taskId, ["open", "in_progress"], "completed");
  if (!updated) {
    throw new AgentTaskStateError(`Task ${taskId} is already "${existing.state}" — cannot complete.`);
  }
  const fresh = await getAgentTask(taskId);
  return fresh!;
}

export async function cancelFounderTask(founderId: string, taskId: string): Promise<AgentTask> {
  const existing = await getAgentTask(taskId);
  if (!existing || existing.founder_id !== founderId) throw new AgentTaskNotFoundError(taskId);

  const updated = await updateAgentTaskState(taskId, ["open", "in_progress"], "cancelled");
  if (!updated) {
    throw new AgentTaskStateError(`Task ${taskId} is already "${existing.state}" — cannot cancel.`);
  }
  const fresh = await getAgentTask(taskId);
  return fresh!;
}
