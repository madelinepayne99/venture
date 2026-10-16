import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { getAgentByKey, getOrganizationAgent } from "@/lib/db/repositories";
import { createGoalWithDelegatedSubtasks } from "@/lib/domain/chiefOfStaffWorkflow";
import { createFounderTask } from "@/lib/domain/executiveAssistantWorkflow";
import { listFounders } from "@/lib/db/repositories";
import { createProject, createMission, transitionMissionState, assignAgent } from "@/lib/db/repositories";
import {
  listEmployeeDirectory,
  recruitEmployee,
  removeEmployee,
  EmployeeNotFoundError,
  EmployeeNotRecruitableError,
  EmployeeHasActiveWorkError,
} from "@/lib/domain/employeeWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { EMPLOYEE_REGISTRY } from "@/lib/agents/employeeRegistry";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

async function seededOrganizationId(): Promise<string> {
  return (await getActiveOrganizationForFounder(await seededFounderId())).id;
}

describe("Employee Directory — the real registry merged with real organization-scoped status", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("lists exactly the 10 registry entries, each with its real agent row or null", async () => {
    const organizationId = await seededOrganizationId();
    const directory = await listEmployeeDirectory(organizationId);
    expect(directory).toHaveLength(EMPLOYEE_REGISTRY.length);
    expect(directory).toHaveLength(10);

    const scout = directory.find((e) => e.definition.key === "scout")!;
    expect(scout.agent).toBeTruthy();
    expect(scout.recruited).toBe(true); // already active — a real, working agent

    const future = directory.find((e) => e.definition.key === "website_developer")!;
    expect(future.agent).toBeNull(); // never seeded — no fabricated row
    expect(future.recruited).toBe(false);
    expect(future.definition.implementationStatus).toBe("coming_soon");
  });

  it("all seven real agents start recruited; all three future ones never are", async () => {
    const organizationId = await seededOrganizationId();
    const directory = await listEmployeeDirectory(organizationId);
    const realKeys = ["scout", "content_bot", "chief_of_staff", "executive_assistant", "finance_agent", "business_analyst", "operations_agent"];
    for (const key of realKeys) {
      expect(directory.find((e) => e.definition.key === key)?.recruited).toBe(true);
    }
    for (const key of ["website_developer", "ai_receptionist", "sales_specialist"]) {
      expect(directory.find((e) => e.definition.key === key)?.recruited).toBe(false);
    }
  });
});

describe("recruitEmployee / removeEmployee", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("removing a real, idle agent sets it to planned, and recruiting it again sets it back to active", async () => {
    const organizationId = await seededOrganizationId();
    await removeEmployee(organizationId, "operations_agent");
    expect((await getOrganizationAgent(organizationId, "operations_agent"))?.status).toBe("planned");

    const directory = await listEmployeeDirectory(organizationId);
    expect(directory.find((e) => e.definition.key === "operations_agent")?.recruited).toBe(false);

    await recruitEmployee(organizationId, "operations_agent");
    expect((await getOrganizationAgent(organizationId, "operations_agent"))?.status).toBe("active");
  });

  it("removing an already-removed agent is a harmless no-op, not an error", async () => {
    const organizationId = await seededOrganizationId();
    await removeEmployee(organizationId, "finance_agent");
    await removeEmployee(organizationId, "finance_agent");
    expect((await getOrganizationAgent(organizationId, "finance_agent"))?.status).toBe("planned");
  });

  it("refuses to recruit a Coming Soon employee", async () => {
    const organizationId = await seededOrganizationId();
    await expect(recruitEmployee(organizationId, "website_developer")).rejects.toBeInstanceOf(EmployeeNotRecruitableError);
  });

  it("throws for a nonexistent employee key on both recruit and remove", async () => {
    const organizationId = await seededOrganizationId();
    await expect(recruitEmployee(organizationId, "not_a_real_employee")).rejects.toBeInstanceOf(EmployeeNotFoundError);
    await expect(removeEmployee(organizationId, "not_a_real_employee")).rejects.toBeInstanceOf(EmployeeNotFoundError);
  });

  it("refuses to remove Executive Assistant while it genuinely has an open task, and allows it once resolved", async () => {
    const founderId = await seededFounderId();
    const organizationId = await seededOrganizationId();
    const task = await createFounderTask(founderId, { title: "A real open reminder" });

    await expect(removeEmployee(organizationId, "executive_assistant")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);

    const { completeFounderTask } = await import("@/lib/domain/executiveAssistantWorkflow");
    await completeFounderTask(founderId, task.id);

    await removeEmployee(organizationId, "executive_assistant");
    expect((await getOrganizationAgent(organizationId, "executive_assistant"))?.status).toBe("planned");
  });

  it("refuses to remove Chief of Staff while a goal it delegated still has an unresolved subtask", async () => {
    const founderId = await seededFounderId();
    const organizationId = await seededOrganizationId();
    await createGoalWithDelegatedSubtasks(founderId, {
      title: "A real goal",
      subtasks: [{ agentKey: "finance_agent", title: "x" }],
    });

    await expect(removeEmployee(organizationId, "chief_of_staff")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);
    // The delegate itself is also genuinely busy — same real signal.
    await expect(removeEmployee(organizationId, "finance_agent")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);
  });

  it("refuses to remove Scout while a mission he genuinely leads is researching, and allows it once settled", async () => {
    const founderId = await seededFounderId();
    const organizationId = await seededOrganizationId();
    const project = await createProject({ name: "Test workspace", organizationId, workspaceType: "commerce" });
    const mission = await createMission({ founderId, organizationId, projectId: project.id, title: "Test", brief: "A real research brief for this test." });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "researching");
    const scout = await getAgentByKey("scout");
    await assignAgent(mission.id, scout!.id, "lead");

    await expect(removeEmployee(organizationId, "scout")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);

    await transitionMissionState(mission.id, ["researching"], "failed", { failure_reason: "test teardown" });
    await removeEmployee(organizationId, "scout");
    expect((await getOrganizationAgent(organizationId, "scout"))?.status).toBe("planned");
  });

  it("removing an employee never touches its historical data (tasks/goals survive)", async () => {
    const founderId = await seededFounderId();
    const organizationId = await seededOrganizationId();
    const task = await createFounderTask(founderId, { title: "A historical reminder" });
    const { completeFounderTask, listFounderTasks } = await import("@/lib/domain/executiveAssistantWorkflow");
    await completeFounderTask(founderId, task.id);

    await removeEmployee(organizationId, "executive_assistant");

    const tasks = await listFounderTasks(founderId);
    expect(tasks.some((t) => t.id === task.id && t.state === "completed")).toBe(true);
  });
});
