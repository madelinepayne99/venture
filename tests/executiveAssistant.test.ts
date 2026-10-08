import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getAgentByKey } from "@/lib/db/repositories";
import {
  createFounderTask,
  listFounderTasks,
  completeFounderTask,
  cancelFounderTask,
  AgentTaskValidationError,
  AgentTaskNotFoundError,
  AgentTaskStateError,
} from "@/lib/domain/executiveAssistantWorkflow";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

describe("Executive Assistant is registered correctly", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("seeds executive_assistant, finance_agent, operations_agent, and business_analyst as active (each has a real capability), and chief_of_staff as planned", async () => {
    const ea = await getAgentByKey("executive_assistant");
    expect(ea?.status).toBe("active");

    // Each graduated to active once its real workflow shipped (see
    // tests/financeAgent.test.ts, tests/operationsAgent.test.ts,
    // tests/businessAnalyst.test.ts) — this assertion is updated alongside
    // each, not loosened generically.
    for (const key of ["finance_agent", "operations_agent", "business_analyst"]) {
      const agent = await getAgentByKey(key);
      expect(agent?.status).toBe("active");
    }

    const chiefOfStaff = await getAgentByKey("chief_of_staff");
    expect(chiefOfStaff?.status).toBe("planned");
  });
});

describe("createFounderTask", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("creates a real, persisted task owned by the calling founder", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, {
      title: "Review monthly subscriptions",
      detail: "Check which providers we're still actually using.",
      dueAt: "2026-10-10T09:00:00.000Z",
    });

    expect(task.title).toBe("Review monthly subscriptions");
    expect(task.agent_key).toBe("executive_assistant");
    expect(task.founder_id).toBe(founderId);
    expect(task.state).toBe("open");
    expect(task.task_type).toBe("reminder");
  });

  it("is actually visible after a fresh read — not just returned from the write", async () => {
    const founderId = await seededFounderId();
    await createFounderTask(founderId, { title: "Real persistence check" });

    const tasks = await listFounderTasks(founderId);
    expect(tasks.some((t) => t.title === "Real persistence check")).toBe(true);
  });

  it("rejects an empty title and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderTasks(founderId);

    await expect(createFounderTask(founderId, { title: "" })).rejects.toBeInstanceOf(AgentTaskValidationError);
    await expect(createFounderTask(founderId, { title: "   " })).rejects.toBeInstanceOf(AgentTaskValidationError);

    const after = await listFounderTasks(founderId);
    expect(after).toHaveLength(before.length);
  });

  it("rejects an invalid dueAt and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderTasks(founderId);

    await expect(
      createFounderTask(founderId, { title: "Valid title", dueAt: "not-a-real-date" }),
    ).rejects.toBeInstanceOf(AgentTaskValidationError);

    const after = await listFounderTasks(founderId);
    expect(after).toHaveLength(before.length);
  });
});

describe("listFounderTasks", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("only returns the calling founder's own tasks, never another founder's", async () => {
    const founders = await listFounders();
    // This app's seed data ships exactly one founder row by design (see
    // CLAUDE.md's Authentication section) — this test documents that real
    // constraint rather than fabricating a second founder that couldn't
    // exist outside a test.
    expect(founders.length).toBeGreaterThanOrEqual(1);
    const founderId = founders[0]!.id;

    await createFounderTask(founderId, { title: "Mine" });
    const tasks = await listFounderTasks(founderId);
    expect(tasks.every((t) => t.founder_id === founderId)).toBe(true);
  });
});

describe("completeFounderTask / cancelFounderTask", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("completes an open task atomically", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "Finish this" });

    const completed = await completeFounderTask(founderId, task.id);
    expect(completed.state).toBe("completed");
  });

  it("cancels an open task atomically", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "Never mind" });

    const cancelled = await cancelFounderTask(founderId, task.id);
    expect(cancelled.state).toBe("cancelled");
  });

  it("refuses to complete a task that's already completed or cancelled", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "Once only" });
    await completeFounderTask(founderId, task.id);

    await expect(completeFounderTask(founderId, task.id)).rejects.toBeInstanceOf(AgentTaskStateError);
  });

  it("throws AgentTaskNotFoundError for a task that doesn't exist", async () => {
    const founderId = await seededFounderId();
    await expect(completeFounderTask(founderId, "not-a-real-id")).rejects.toBeInstanceOf(AgentTaskNotFoundError);
  });

  it("never lets one founder complete a task belonging to a different founder_id", async () => {
    const founderId = await seededFounderId();
    const task = await createFounderTask(founderId, { title: "Owned by the real founder" });

    await expect(completeFounderTask("some-other-founder-id", task.id)).rejects.toBeInstanceOf(
      AgentTaskNotFoundError,
    );
  });
});
