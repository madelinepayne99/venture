import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { getAgentByKey } from "@/lib/db/repositories";
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
import { EMPLOYEE_REGISTRY } from "@/lib/agents/employeeRegistry";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

describe("Employee Directory — the real registry merged with real agent status", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("lists exactly the 10 registry entries, each with its real agent row or null", async () => {
    const directory = await listEmployeeDirectory();
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
    const directory = await listEmployeeDirectory();
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
    const removed = await removeEmployee("operations_agent");
    expect(removed.status).toBe("planned");

    const directory = await listEmployeeDirectory();
    expect(directory.find((e) => e.definition.key === "operations_agent")?.recruited).toBe(false);

    const recruited = await recruitEmployee("operations_agent");
    expect(recruited.status).toBe("active");
  });

  it("removing an already-removed agent is a harmless no-op, not an error", async () => {
    await removeEmployee("finance_agent");
    const again = await removeEmployee("finance_agent");
    expect(again.status).toBe("planned");
  });

  it("refuses to recruit a Coming Soon employee", async () => {
    await expect(recruitEmployee("website_developer")).rejects.toBeInstanceOf(EmployeeNotRecruitableError);
  });

  it("throws for a nonexistent employee key on both recruit and remove", async () => {
    await expect(recruitEmployee("not_a_real_employee")).rejects.toBeInstanceOf(EmployeeNotFoundError);
    await expect(removeEmployee("not_a_real_employee")).rejects.toBeInstanceOf(EmployeeNotFoundError);
  });

  it("refuses to remove Executive Assistant while it genuinely has an open task, and allows it once resolved", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "A real open reminder" });

    await expect(removeEmployee("executive_assistant")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);

    const { completeFounderTask } = await import("@/lib/domain/executiveAssistantWorkflow");
    await completeFounderTask(founderId, task.id);

    const removed = await removeEmployee("executive_assistant");
    expect(removed.status).toBe("planned");
  });

  it("refuses to remove Chief of Staff while a goal it delegated still has an unresolved subtask", async () => {
    const founderId = await seededFounderId();
    await createGoalWithDelegatedSubtasks(founderId, {
      title: "A real goal",
      subtasks: [{ agentKey: "finance_agent", title: "x" }],
    });

    await expect(removeEmployee("chief_of_staff")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);
    // The delegate itself is also genuinely busy — same real signal.
    await expect(removeEmployee("finance_agent")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);
  });

  it("refuses to remove Scout while a mission he genuinely leads is researching, and allows it once settled", async () => {
    const founderId = await seededFounderId();
    const project = await createProject({ name: "Test workspace", workspaceType: "commerce" });
    const mission = await createMission({ founderId, projectId: project.id, title: "Test", brief: "A real research brief for this test." });
    await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
    await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
    await transitionMissionState(mission.id, ["queued"], "researching");
    const scout = await getAgentByKey("scout");
    await assignAgent(mission.id, scout!.id, "lead");

    await expect(removeEmployee("scout")).rejects.toBeInstanceOf(EmployeeHasActiveWorkError);

    await transitionMissionState(mission.id, ["researching"], "failed", { failure_reason: "test teardown" });
    const removed = await removeEmployee("scout");
    expect(removed.status).toBe("planned");
  });

  it("removing an employee never touches its historical data (tasks/goals survive)", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "A historical reminder" });
    const { completeFounderTask, listFounderTasks } = await import("@/lib/domain/executiveAssistantWorkflow");
    await completeFounderTask(founderId, task.id);

    await removeEmployee("executive_assistant");

    const tasks = await listFounderTasks(founderId);
    expect(tasks.some((t) => t.id === task.id && t.state === "completed")).toBe(true);
  });
});
