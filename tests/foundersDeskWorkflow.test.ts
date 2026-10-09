import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getAgentTask, listApprovals, getMission } from "@/lib/db/repositories";
import { createFounderTask, completeFounderTask } from "@/lib/domain/executiveAssistantWorkflow";
import { setCategoryBudget, logExpense } from "@/lib/domain/financeWorkflow";
import { createFounderChecklist, setItemDone } from "@/lib/domain/operationsWorkflow";
import { createGoalWithDelegatedSubtasks } from "@/lib/domain/chiefOfStaffWorkflow";
import { completeFounderTask as completeDelegatedSubtask } from "@/lib/domain/executiveAssistantWorkflow";
import {
  listFoundersDeskInbox,
  reviewScoutMission,
  reviewAgentDeliverable,
  submitExecutiveAssistantSummary,
  submitFinanceReport,
  submitChecklistForReview,
  submitGoalConsolidation,
  FoundersDeskValidationError,
  FoundersDeskStateError,
} from "@/lib/domain/foundersDeskWorkflow";
import { setupMissionReadyForProduction, fakeAnthropicClient, fakeAnthropicMessage } from "./testUtils";
import { requestResearch } from "@/lib/domain/businessAnalystWorkflow";
import { submitBusinessAnalystReport } from "@/lib/domain/foundersDeskWorkflow";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

describe("listFoundersDeskInbox — the real unified adapter", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("is empty with no real pending work anywhere", async () => {
    const inbox = await listFoundersDeskInbox();
    expect(inbox).toEqual([]);
  });

  it("lists a real Scout mission at ready_for_founders_review, and it disappears once reviewed", async () => {
    const founderId = await seededFounderId();
    const { mission } = await setupMissionReadyForProduction(founderId);

    const before = await listFoundersDeskInbox();
    expect(before.some((i) => i.source === "scout_mission" && i.referenceId === mission.id)).toBe(true);

    await reviewScoutMission(mission.id, founderId, "approve");

    const after = await listFoundersDeskInbox();
    expect(after.some((i) => i.source === "scout_mission" && i.referenceId === mission.id)).toBe(false);
  });

  it("lists a real agent_deliverable from Executive Assistant, and it disappears once reviewed", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "A real task" });
    await completeFounderTask(founderId, task.id);
    const deliverable = await submitExecutiveAssistantSummary(founderId, task.id);

    const before = await listFoundersDeskInbox();
    expect(before.some((i) => i.source === "agent_deliverable" && i.referenceId === deliverable.id)).toBe(true);

    await reviewAgentDeliverable(deliverable.id, founderId, "approve");

    const after = await listFoundersDeskInbox();
    expect(after.some((i) => i.referenceId === deliverable.id)).toBe(false);
  });
});

describe("reviewScoutMission — the real approvals-table adapter", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("approving records a real approvals row WITHOUT touching missions.state", async () => {
    const founderId = await seededFounderId();
    const { mission } = await setupMissionReadyForProduction(founderId);

    await reviewScoutMission(mission.id, founderId, "approve", "Looks solid.");

    const approvals = await listApprovals(mission.id);
    expect(approvals.some((a) => a.decision === "founders_desk_approved" && a.note === "Looks solid.")).toBe(true);

    const fresh = await getMission(mission.id);
    expect(fresh?.state).toBe("ready_for_founders_review"); // untouched — still reachable for Approve for Production
  });

  it("rejecting and 'revise' both record real, distinct decisions without fabricating a revision", async () => {
    const founderId = await seededFounderId();
    const { mission: m1 } = await setupMissionReadyForProduction(founderId);
    const result = await reviewScoutMission(m1.id, founderId, "reject", "Not worth pursuing.");
    expect(result.message).toContain("rejected");

    const { mission: m2 } = await setupMissionReadyForProduction(founderId);
    const revised = await reviewScoutMission(m2.id, founderId, "revise");
    expect(revised.message).toContain("doesn't have an automatic mission-revision workflow");
    const fresh = await getMission(m2.id);
    expect(fresh?.state).toBe("ready_for_founders_review"); // Scout's own state machine never touched
  });

  it("refuses to review a mission that isn't actually awaiting review", async () => {
    const founderId = await seededFounderId();
    const { mission } = await setupMissionReadyForProduction(founderId);
    await reviewScoutMission(mission.id, founderId, "approve");
    await expect(reviewScoutMission(mission.id, founderId, "approve")).rejects.toBeInstanceOf(FoundersDeskStateError);
  });
});

describe("Executive Assistant — submitExecutiveAssistantSummary", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("wraps a genuinely completed task's real data — refuses an incomplete one", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "Review monthly subscriptions", detail: "Check what we're still using." });

    await expect(submitExecutiveAssistantSummary(founderId, task.id)).rejects.toBeInstanceOf(FoundersDeskValidationError);

    await completeFounderTask(founderId, task.id);
    const deliverable = await submitExecutiveAssistantSummary(founderId, task.id);
    expect(deliverable.title).toBe("Review monthly subscriptions");
    expect((deliverable.content as { detail: string }).detail).toBe("Check what we're still using.");
  });
});

describe("Finance Agent — submitFinanceReport", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("wraps genuine recorded budget/expense data, never invented totals", async () => {
    const founderId = await seededFounderId();
    await setCategoryBudget({ category: "software", amount: 30, currency: "GBP" });
    await logExpense({ category: "software", description: "Subscription", amount: 12, currency: "GBP" });

    const deliverable = await submitFinanceReport(founderId, "software");
    const content = deliverable.content as { remaining: number; spentInBudgetCurrency: number };
    expect(content.spentInBudgetCurrency).toBe(12);
    expect(content.remaining).toBe(18);
  });

  it("refuses a report for a category with no real data at all", async () => {
    const founderId = await seededFounderId();
    await expect(submitFinanceReport(founderId, "nonexistent")).rejects.toBeInstanceOf(FoundersDeskValidationError);
  });
});

describe("Operations Agent — submitChecklistForReview", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("wraps the real checklist's real item states", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, { title: "Launch checklist", items: ["A", "B"] });
    await setItemDone(checklist.id, checklist.items[0]!.id, founderId, true);

    const deliverable = await submitChecklistForReview(founderId, checklist.id);
    const content = deliverable.content as { completeCount: number; totalCount: number };
    expect(content.completeCount).toBe(1);
    expect(content.totalCount).toBe(2);
  });
});

describe("Business Analyst — submitBusinessAnalystReport", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("wraps the real completed report's sources and cost", async () => {
    const founderId = await seededFounderId();
    const report = {
      query: "Test query",
      summary: "A real summary.",
      opportunities: ["A real opportunity."],
      risks: ["A real risk."],
      sources: [{ url: "https://example.com", title: "Example", published_date: null }],
    };
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);
    const saved = await requestResearch(founderId, report.query, { client });

    const deliverable = await submitBusinessAnalystReport(founderId, saved.id);
    const content = deliverable.content as { summary: string; usdCost: number };
    expect(content.summary).toBe("A real summary.");
    expect(content.usdCost).toBeGreaterThan(0);
  });
});

describe("Chief of Staff — submitGoalConsolidation", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("refuses to consolidate while a real subtask is still unresolved, and succeeds once resolved", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Launch channel",
      subtasks: [{ agentKey: "finance_agent", title: "Set budget" }],
    });

    await expect(submitGoalConsolidation(founderId, goal.id)).rejects.toBeInstanceOf(FoundersDeskValidationError);

    await completeDelegatedSubtask(founderId, goal.subtasks[0]!.id);
    const deliverable = await submitGoalConsolidation(founderId, goal.id);
    const content = deliverable.content as { completedCount: number };
    expect(content.completedCount).toBe(1);
  });
});

describe("reviewAgentDeliverable — revision creates a real follow-up task, never a fabricated redo", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("creates a real agent_tasks row when revision is requested", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "A task" });
    await completeFounderTask(founderId, task.id);
    const deliverable = await submitExecutiveAssistantSummary(founderId, task.id);

    const result = await reviewAgentDeliverable(deliverable.id, founderId, "revise", "Please redo with more detail.");
    expect(result.message).toContain("doesn't have an automatic revision capability");
    expect(result.deliverable.state).toBe("revision_requested");

    const { listFounderTasks } = await import("@/lib/domain/executiveAssistantWorkflow");
    const tasks = await listFounderTasks(founderId);
    const followUp = tasks.find((t) => t.task_type === "revision_follow_up");
    expect(followUp).toBeTruthy();
    expect(followUp?.detail).toBe("Please redo with more detail.");
  });

  it("refuses to double-review the same deliverable", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "A task" });
    await completeFounderTask(founderId, task.id);
    const deliverable = await submitExecutiveAssistantSummary(founderId, task.id);

    await reviewAgentDeliverable(deliverable.id, founderId, "approve");
    await expect(reviewAgentDeliverable(deliverable.id, founderId, "approve")).rejects.toBeInstanceOf(FoundersDeskStateError);
  });
});
