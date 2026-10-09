import "server-only";
import { EMPLOYEE_REGISTRY, type EmployeeDefinition } from "@/lib/agents/employeeRegistry";
import {
  listAgents,
  getAgentByKey,
  listOrganizationAgents,
  getOrganizationAgent,
  setOrganizationAgentStatus,
  listMissionsForOrganization,
  listLeadAssignments,
  listContentItemsForMissions,
  listAgentTasksForOrganization,
} from "@/lib/db/repositories";
import type { Agent } from "@/lib/db/types";

/**
 * The Employee Directory's real recruit/remove workflow — now genuinely
 * organization-scoped (Master Development Mission 6, Phase E). "Recruit"
 * and "remove" are the real `organization_agents` table (active/planned,
 * one row per real organization+agent pair), replacing what used to be
 * the global `agents.status` column (Commercial MVP milestone). `agents`
 * itself stays exactly what it always was — the one shared, global
 * CATALOG of agent types that exist at all — never touched by recruiting
 * or removing within any one organization.
 *
 * Every function here takes a real, already-verified `organizationId` —
 * callers (API routes) resolve it server-side via
 * `getActiveOrganizationForFounder`/`requireOrganizationMembership` in
 * `lib/domain/organizationWorkflow.ts`, never from client input. This
 * module does not re-check membership itself; it trusts the organizationId
 * it's given exactly as far as the caller already verified it, the same
 * "the route proves identity, the domain function proves the operation"
 * split `requireFounderId()` already establishes for founders.
 *
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
  /** Scoped to the one real organization this directory was requested for — never another organization's recruitment. */
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

export async function listEmployeeDirectory(organizationId: string): Promise<EmployeeProfile[]> {
  const [agents, orgAgents] = await Promise.all([listAgents(), listOrganizationAgents(organizationId)]);
  const agentsByKey = new Map(agents.map((a) => [a.key, a]));
  const orgAgentsByKey = new Map(orgAgents.map((a) => [a.agent_key, a]));
  return EMPLOYEE_REGISTRY.map((definition) => {
    const agent = agentsByKey.get(definition.key) ?? null;
    const orgAgent = orgAgentsByKey.get(definition.key);
    return {
      definition,
      agent,
      recruited: orgAgent?.status === "active",
      integrationsReady: definition.requiredIntegrations.every(hasRealIntegration),
    };
  });
}

/**
 * Whether `agentKey` genuinely has real work in flight right now, within
 * THIS organization specifically — reuses the same real signals the
 * shared 3D office already reads (missions/leadAssignments/contentItems
 * for Scout/Content Bot; agent_tasks for the five Operations Wing
 * agents, with Chief of Staff's own goal_id-based special case), now
 * scoped by real organization_id rather than read globally. A mission
 * genuinely owned by a different organization can never block (or wrongly
 * permit) removing an agent here — the exact cross-tenant leak this
 * migration exists to close.
 */
async function hasActiveWork(organizationId: string, agentKey: string): Promise<boolean> {
  const OPEN_TASK_STATES = new Set(["open", "in_progress"]);

  if (agentKey === "scout" || agentKey === "content_bot") {
    const missions = await listMissionsForOrganization(organizationId);
    const missionIds = new Set(missions.map((m) => m.id));
    // listLeadAssignments() is deliberately global (the shared 3D office's
    // own doc comment explains why) — filtered here down to only this
    // organization's real missions before it's used for anything.
    const allLeadAssignments = await listLeadAssignments();
    const led = new Set(
      allLeadAssignments.filter((a) => a.agent_key === agentKey && missionIds.has(a.mission_id)).map((a) => a.mission_id),
    );

    if (agentKey === "scout") {
      return missions.some((m) => m.state === "researching" && led.has(m.id));
    }
    const items = await listContentItemsForMissions(missions.filter((m) => led.has(m.id)).map((m) => m.id));
    return items.some((c) => c.state === "planning" || c.state === "generating");
  }

  const tasks = await listAgentTasksForOrganization(organizationId, agentKey === "chief_of_staff" ? undefined : { agentKey });
  if (agentKey === "chief_of_staff") {
    return tasks.some((t) => t.goal_id != null && OPEN_TASK_STATES.has(t.state));
  }
  return tasks.some((t) => OPEN_TASK_STATES.has(t.state));
}

export async function recruitEmployee(organizationId: string, key: string): Promise<void> {
  const definition = EMPLOYEE_REGISTRY.find((d) => d.key === key);
  if (!definition) throw new EmployeeNotFoundError(key);
  if (!definition.recruitable) throw new EmployeeNotRecruitableError(key);
  const existing = await getAgentByKey(key);
  if (!existing) throw new EmployeeNotFoundError(key);
  await setOrganizationAgentStatus(organizationId, key, "active");
}

export async function removeEmployee(organizationId: string, key: string): Promise<void> {
  const definition = EMPLOYEE_REGISTRY.find((d) => d.key === key);
  if (!definition) throw new EmployeeNotFoundError(key);
  const existing = await getAgentByKey(key);
  if (!existing) throw new EmployeeNotFoundError(key);
  const orgAgent = await getOrganizationAgent(organizationId, key);
  if (orgAgent?.status !== "active") return; // already not recruited in this organization — no-op, not an error
  if (await hasActiveWork(organizationId, key)) throw new EmployeeHasActiveWorkError(key);
  await setOrganizationAgentStatus(organizationId, key, "planned");
}
