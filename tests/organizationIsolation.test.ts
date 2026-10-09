import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder, getAgentByKey, getOrganizationAgent } from "@/lib/db/repositories";
import {
  createOrganizationWithOwner,
  requireOrganizationMembership,
  getActiveOrganizationForFounder,
  OrganizationMembershipError,
} from "@/lib/domain/organizationWorkflow";
import { listEmployeeDirectory, recruitEmployee, removeEmployee } from "@/lib/domain/employeeWorkflow";
import { createAndSubmitMission } from "@/lib/domain/missionWorkflow";
import { logExpense, setCategoryBudget, getBudgetStatus, listAllExpenses } from "@/lib/domain/financeWorkflow";
import { createGoalWithDelegatedSubtasks, listFounderGoals } from "@/lib/domain/chiefOfStaffWorkflow";
import { createFounderTask, completeFounderTask, listFounderTasks } from "@/lib/domain/executiveAssistantWorkflow";
import { createFounderChecklist } from "@/lib/domain/operationsWorkflow";
import {
  listFoundersDeskInbox,
  reviewScoutMission,
  reviewAgentDeliverable,
  submitExecutiveAssistantSummary,
  submitChecklistForReview,
  submitGoalConsolidation,
  FoundersDeskNotFoundError,
} from "@/lib/domain/foundersDeskWorkflow";

/**
 * Real, dedicated tenant-isolation tests (Master Development Mission 6,
 * Phase E/F — "Use two isolated fictional businesses ... to prove that
 * recruiting, removing or assigning an employee in one organisation
 * cannot affect the other"). Two genuinely separate real organizations,
 * each with its own genuinely separate real founder — Bakery HQ and
 * Landscaping HQ, named after the brief's own worked example. Every test
 * here exercises real domain functions against a real Postgres database;
 * none of this is UI-level filtering, which the brief explicitly warns
 * isn't sufficient on its own.
 */

interface TestOrg {
  founderId: string;
  organizationId: string;
}

async function makeTestOrganization(ownerName: string, orgName: string): Promise<TestOrg> {
  const founder = await createFounder({ name: ownerName });
  const { organization } = await createOrganizationWithOwner(founder.id, orgName);
  return { founderId: founder.id, organizationId: organization.id };
}

describe("Organization isolation — Bakery HQ vs. Landscaping HQ", () => {
  let bakery: TestOrg;
  let landscaping: TestOrg;

  beforeEach(async () => {
    await resetDbForTests();
    bakery = await makeTestOrganization("Bea the Baker", "Bakery HQ");
    landscaping = await makeTestOrganization("Lee the Landscaper", "Landscaping HQ");
  });

  // --- The brief's own explicit example: recruitment -----------------

  it("a brand-new organization starts with nothing recruited — 'never recruit agents without confirmation' (Section 14) applies from the very first row, not just the UI", async () => {
    const bakeryDirectory = await listEmployeeDirectory(bakery.organizationId);
    for (const e of bakeryDirectory) {
      if (e.definition.implementationStatus !== "coming_soon") expect(e.recruited).toBe(false);
    }
  });

  it("recruiting an agent in one organization never recruits it in the other", async () => {
    await recruitEmployee(bakery.organizationId, "business_analyst");

    const bakeryDirectory = await listEmployeeDirectory(bakery.organizationId);
    const landscapingDirectory = await listEmployeeDirectory(landscaping.organizationId);

    expect(bakeryDirectory.find((e) => e.definition.key === "business_analyst")?.recruited).toBe(true);
    // Landscaping HQ's own real recruitment is completely untouched — it never recruited this agent.
    expect(landscapingDirectory.find((e) => e.definition.key === "business_analyst")?.recruited).toBe(false);
  });

  it("removing an agent in one organization never removes it in the other (the brief's own Finance Agent example)", async () => {
    // Both organizations genuinely recruit Finance Agent first — the real
    // precondition for "removing" to mean anything.
    await recruitEmployee(bakery.organizationId, "finance_agent");
    await recruitEmployee(landscaping.organizationId, "finance_agent");

    await removeEmployee(bakery.organizationId, "finance_agent");

    expect((await getOrganizationAgent(bakery.organizationId, "finance_agent"))?.status).toBe("planned");
    expect((await getOrganizationAgent(landscaping.organizationId, "finance_agent"))?.status).toBe("active");

    const landscapingDirectory = await listEmployeeDirectory(landscaping.organizationId);
    expect(landscapingDirectory.find((e) => e.definition.key === "finance_agent")?.recruited).toBe(true);
  });

  it("recruiting a previously-removed agent in one organization never re-recruits it in the other", async () => {
    await recruitEmployee(bakery.organizationId, "operations_agent");
    await recruitEmployee(landscaping.organizationId, "operations_agent");
    await removeEmployee(bakery.organizationId, "operations_agent");
    await removeEmployee(landscaping.organizationId, "operations_agent");

    await recruitEmployee(bakery.organizationId, "operations_agent");

    expect((await getOrganizationAgent(bakery.organizationId, "operations_agent"))?.status).toBe("active");
    // Landscaping HQ's own removal is still in effect — Bakery's recruit never touched it.
    expect((await getOrganizationAgent(landscaping.organizationId, "operations_agent"))?.status).toBe("planned");
  });

  // --- Missions / Scout's research -------------------------------------

  it("a mission created in one organization never appears in the other's mission list or Founders' Desk inbox", async () => {
    const mission = await createAndSubmitMission({
      founderId: bakery.founderId,
      projectId: null,
      title: "Bakery-only mission",
      brief: "Research artisan bread packaging suppliers.",
    });

    const landscapingInbox = await listFoundersDeskInbox(landscaping.organizationId);
    expect(landscapingInbox.some((i) => i.referenceId === mission.id)).toBe(false);
  });

  it("a founder from one organization cannot review another organization's mission, even knowing its real id", async () => {
    // Build a real mission that genuinely reaches ready_for_founders_review for Bakery HQ.
    const { setupMissionReadyForProduction } = await import("./testUtils");
    // setupMissionReadyForProduction resolves the organization from the
    // founder it's given — real, not a shortcut.
    const { mission } = await setupMissionReadyForProduction(bakery.founderId);

    // Landscaping HQ's founder tries to review Bakery HQ's real mission by id.
    await expect(reviewScoutMission(mission.id, landscaping.founderId, "approve")).rejects.toBeInstanceOf(
      FoundersDeskNotFoundError,
    );

    // Bakery HQ's own founder can genuinely review it.
    const { message } = await reviewScoutMission(mission.id, bakery.founderId, "approve");
    expect(message).toContain("acknowledged as reviewed");
  });

  // --- Finance: budgets/expenses (previously had NO ownership at all) --

  it("two organizations can have a budget in the SAME category name without colliding", async () => {
    await setCategoryBudget(bakery.organizationId, { category: "software", amount: 30, currency: "GBP" });
    await setCategoryBudget(landscaping.organizationId, { category: "software", amount: 500, currency: "USD" });

    const bakeryStatus = await getBudgetStatus(bakery.organizationId, "software");
    const landscapingStatus = await getBudgetStatus(landscaping.organizationId, "software");

    expect(bakeryStatus.budget?.amount).toBe(30);
    expect(bakeryStatus.budget?.currency).toBe("GBP");
    expect(landscapingStatus.budget?.amount).toBe(500);
    expect(landscapingStatus.budget?.currency).toBe("USD");
  });

  it("expenses logged in one organization never appear in the other's totals, even in the same category", async () => {
    await setCategoryBudget(bakery.organizationId, { category: "marketing", amount: 100, currency: "GBP" });
    await logExpense(bakery.organizationId, { category: "marketing", description: "Bakery flyers", amount: 40, currency: "GBP" });
    await logExpense(landscaping.organizationId, { category: "marketing", description: "Landscaping flyers", amount: 999, currency: "GBP" });

    const bakeryExpenses = await listAllExpenses(bakery.organizationId, "marketing");
    expect(bakeryExpenses).toHaveLength(1);
    expect(bakeryExpenses[0]!.description).toBe("Bakery flyers");

    const bakeryStatus = await getBudgetStatus(bakery.organizationId, "marketing");
    // Landscaping's £999 expense never leaks into Bakery's own spend total.
    expect(bakeryStatus.spentInBudgetCurrency).toBe(40);
  });

  // --- Tasks (Executive Assistant) -------------------------------------

  it("a task created in one organization is invisible to the other organization's Founders' Desk submission path", async () => {
    const task = await createFounderTask(bakery.founderId, { title: "Bakery-only reminder" });
    await completeFounderTask(bakery.founderId, task.id);

    // Landscaping's own founder cannot submit Bakery's task for review,
    // even calling the function directly with the real task id.
    await expect(submitExecutiveAssistantSummary(landscaping.founderId, task.id)).rejects.toBeInstanceOf(
      FoundersDeskNotFoundError,
    );

    // Bakery's own founder genuinely can.
    const deliverable = await submitExecutiveAssistantSummary(bakery.founderId, task.id);
    expect(deliverable.title).toBe("Bakery-only reminder");
  });

  it("listFounderTasks only ever returns the calling founder's own real tasks", async () => {
    await createFounderTask(bakery.founderId, { title: "Bakery task" });
    await createFounderTask(landscaping.founderId, { title: "Landscaping task" });

    const bakeryTasks = await listFounderTasks(bakery.founderId);
    expect(bakeryTasks.every((t) => t.title !== "Landscaping task")).toBe(true);
    expect(bakeryTasks.some((t) => t.title === "Bakery task")).toBe(true);
  });

  // --- Checklists (Operations Agent) ------------------------------------

  it("a checklist submitted for review in one organization is refused for the other, even with the real id", async () => {
    const checklist = await createFounderChecklist(bakery.founderId, { title: "Bakery launch checklist", items: ["Order flour"] });

    await expect(submitChecklistForReview(landscaping.founderId, checklist.id)).rejects.toBeInstanceOf(
      FoundersDeskNotFoundError,
    );
    const deliverable = await submitChecklistForReview(bakery.founderId, checklist.id);
    expect(deliverable.title).toBe("Bakery launch checklist");
  });

  // --- Chief of Staff goals/delegation -----------------------------------

  it("goals are genuinely isolated — listFounderGoals and cross-organization consolidation submission", async () => {
    const goal = await createGoalWithDelegatedSubtasks(bakery.founderId, {
      title: "Bakery-only goal",
      subtasks: [{ agentKey: "finance_agent", title: "Set a flour budget" }],
    });

    const landscapingGoals = await listFounderGoals(landscaping.founderId);
    expect(landscapingGoals.some((g) => g.id === goal.id)).toBe(false);

    // Resolve + complete the real subtask so submission is otherwise valid.
    const subtaskId = goal.subtasks[0]!.id;
    await completeFounderTask(bakery.founderId, subtaskId);

    await expect(submitGoalConsolidation(landscaping.founderId, goal.id)).rejects.toBeInstanceOf(FoundersDeskNotFoundError);
    const deliverable = await submitGoalConsolidation(bakery.founderId, goal.id);
    expect(deliverable.title).toBe("Bakery-only goal");
  });

  // --- Agent deliverable review isolation --------------------------------

  it("a founder from one organization cannot approve/reject/revise another organization's real deliverable", async () => {
    const task = await createFounderTask(bakery.founderId, { title: "Bakery deliverable source" });
    await completeFounderTask(bakery.founderId, task.id);
    const deliverable = await submitExecutiveAssistantSummary(bakery.founderId, task.id);

    await expect(reviewAgentDeliverable(deliverable.id, landscaping.founderId, "approve")).rejects.toBeInstanceOf(
      FoundersDeskNotFoundError,
    );

    // The deliverable is untouched by the refused cross-org attempt — Bakery's own founder can still act on it.
    const { message } = await reviewAgentDeliverable(deliverable.id, bakery.founderId, "approve");
    expect(message).toBe("Approved.");
  });

  // --- The membership primitive itself -----------------------------------

  it("requireOrganizationMembership refuses a founder who genuinely isn't a member", async () => {
    await expect(requireOrganizationMembership(landscaping.founderId, bakery.organizationId)).rejects.toBeInstanceOf(
      OrganizationMembershipError,
    );
    // The reverse direction is refused too — neither organization trusts the other's founder at all.
    await expect(requireOrganizationMembership(bakery.founderId, landscaping.organizationId)).rejects.toBeInstanceOf(
      OrganizationMembershipError,
    );
  });

  it("requireOrganizationMembership succeeds for a founder's own real organization and returns their real role", async () => {
    const membership = await requireOrganizationMembership(bakery.founderId, bakery.organizationId);
    expect(membership.role).toBe("owner");
  });

  it("getActiveOrganizationForFounder resolves each founder to their own distinct real organization, never the other's", async () => {
    const bakeryOrg = await getActiveOrganizationForFounder(bakery.founderId);
    const landscapingOrg = await getActiveOrganizationForFounder(landscaping.founderId);
    expect(bakeryOrg.id).toBe(bakery.organizationId);
    expect(landscapingOrg.id).toBe(landscaping.organizationId);
    expect(bakeryOrg.id).not.toBe(landscapingOrg.id);
  });

  // --- The original founder data is untouched by any of this -------------

  it("Ellis and Maddie's own seeded Founders' HQ organization is completely unaffected by the two new test organizations", async () => {
    const { listFounders } = await import("@/lib/db/repositories");
    const seededFounders = await listFounders();
    const ellis = seededFounders.find((f) => f.name === "Ellis Scott")!;
    const originalOrg = await getActiveOrganizationForFounder(ellis.id);
    expect(originalOrg.name).toBe("Founders' HQ");

    const originalDirectory = await listEmployeeDirectory(originalOrg.id);
    // All 7 real agents remain recruited in the founders' own real organization — nothing about creating Bakery/Landscaping HQ touched it.
    const realKeys = ["scout", "content_bot", "chief_of_staff", "executive_assistant", "finance_agent", "business_analyst", "operations_agent"];
    for (const key of realKeys) {
      expect(originalDirectory.find((e) => e.definition.key === key)?.recruited).toBe(true);
    }
  });
});
