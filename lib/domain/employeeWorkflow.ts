import "server-only";
import { EMPLOYEE_REGISTRY, type EmployeeDefinition } from "@/lib/agents/employeeRegistry";
import {
  listAgents,
  getAgentByKey,
  setAgentStatus,
  listMissions,
  listLeadAssignments,
  listContentItemsForMissions,
  listAgentTaskWorldSignals,
} from "@/lib/db/repositories";
import type { Agent } from "@/lib/db/types";

/**
 * The Employee Directory's real recruit/remove workflow (Commercial MVP
 * milestone). "Recruit" and "remove" are the real `agents.status` column
 * (active/planned) under a customer-facing name — this app is still
 * single-tenant (founder-only; see CLAUDE.md's Authentication section),
 * so there is no separate per-business roster table to introduce yet.
 * Recruiting/removing an employee NEVER touches any other table —
 * missions, costs, deliverables, agent_tasks, chief_of_staff_goals all
 * stay exactly as they are, satisfying "removing an employee must not
 * delete historical tasks, files, approvals, or financial records" by
 * construction, not by extra code.
 */

export class EmployeeNotFoundError extends Error {
  constructor(key: string) {
    super(`"${key}" is not a real employee.`);
    this.name = "EmployeeNotFoundError";
  }
}
export class EmployeeNotRecruitableError extends Error {
  constructor(key: string) {
    super(`"${key}" is not recruitable yet — it's still Coming Soon.`);
    this.name = "EmployeeNotRecruitableError";
  }
}
export class EmployeeHasActiveWorkError extends Error {
  constructor(key: string) {
    super(`"${key}" has real work in progress right now — finish or cancel it before removing this employee.`);
    this.name = "EmployeeHasActiveWorkError";
  }
}

export interface EmployeeProfile {
  definition: EmployeeDefinition;
  /** null only for the three not-yet-built future employees, which have no `agents` row at all. */
  agent: Agent | null;
  recruited: boolean;
  /**
   * Whether every real integration this employee's capability depends on
   * is actually configured right now (Master Development Mission 5,
   * Section 4 — "Do not pretend customers can self-connect a provider if
   * that workflow does not exist" cuts both ways: don't show "Ready to
   * work" when it genuinely isn't, either). Computed server-side from
   * real `process.env` presence — the boolean crosses into client code,
   * never a key's value. `true` for every employee with no required
   * integrations at all (nothing to wait on).
   */
  integrationsReady: boolean;
}

/** Real presence check only — never reads or forwards an env var's actual value. */
function hasRealIntegration(envVarName: string): boolean {
  return Boolean(process.env[envVarName] && process.env[envVarName]!.length > 0);
}

export async function listEmployeeDirectory(): Promise<EmployeeProfile[]> {
  const agents = await listAgents();
  const byKey = new Map(agents.map((a) => [a.key, a]));
  return EMPLOYEE_REGISTRY.map((definition) => {
    const agent = byKey.get(definition.key) ?? null;
    return {
      definition,
      agent,
      recruited: agent?.status === "active",
      integrationsReady: definition.requiredIntegrations.every(hasRealIntegration),
    };
  });
}

/**
 * Whether `agentKey` genuinely has real work in flight right now —
 * reuses the exact same real signals the shared 3D office already reads
 * (missions/leadAssignments/contentItems for Scout/Content Bot;
 * agent_tasks for the five Operations Wing agents, with Chief of Staff's
 * own goal_id-based special case) rather than a new query.
 */
async function hasActiveWork(agentKey: string): Promise<boolean> {
  const OPEN_TASK_STATES = new Set(["open", "in_progress"]);

  if (agentKey === "scout") {
    const [missions, leadAssignments] = await Promise.all([listMissions(), listLeadAssignments()]);
    const led = new Set(leadAssignments.filter((a) => a.agent_key === "scout").map((a) => a.mission_id));
    return missions.some((m) => m.state === "researching" && led.has(m.id));
  }
  if (agentKey === "content_bot") {
    const [missions, leadAssignments] = await Promise.all([listMissions(), listLeadAssignments()]);
    const led = new Set(leadAssignments.filter((a) => a.agent_key === "content_bot").map((a) => a.mission_id));
    const items = await listContentItemsForMissions(missions.map((m) => m.id));
    return items.some((c) => (c.state === "planning" || c.state === "generating") && led.has(c.mission_id));
  }
  const signals = await listAgentTaskWorldSignals();
  if (agentKey === "chief_of_staff") {
    return signals.some((s) => s.goal_id != null && OPEN_TASK_STATES.has(s.state));
  }
  return signals.some((s) => s.agent_key === agentKey && OPEN_TASK_STATES.has(s.state));
}

export async function recruitEmployee(key: string): Promise<Agent> {
  const definition = EMPLOYEE_REGISTRY.find((d) => d.key === key);
  if (!definition) throw new EmployeeNotFoundError(key);
  if (!definition.recruitable) throw new EmployeeNotRecruitableError(key);
  const existing = await getAgentByKey(key);
  if (!existing) throw new EmployeeNotFoundError(key);
  const updated = await setAgentStatus(key, "active");
  return updated!;
}

export async function removeEmployee(key: string): Promise<Agent> {
  const definition = EMPLOYEE_REGISTRY.find((d) => d.key === key);
  if (!definition) throw new EmployeeNotFoundError(key);
  const existing = await getAgentByKey(key);
  if (!existing) throw new EmployeeNotFoundError(key);
  if (existing.status !== "active") return existing; // already not recruited — no-op, not an error
  if (await hasActiveWork(key)) throw new EmployeeHasActiveWorkError(key);
  const updated = await setAgentStatus(key, "planned");
  return updated!;
}
