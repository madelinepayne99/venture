import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getAgentByKey, getAgentTask } from "@/lib/db/repositories";
import { completeFounderTask, cancelFounderTask } from "@/lib/domain/executiveAssistantWorkflow";
import {
  createGoalWithDelegatedSubtasks,
  listFounderGoals,
  getFounderGoal,
  runDelegatedResearch,
  ChiefOfStaffValidationError,
  ChiefOfStaffGoalNotFoundError,
  ChiefOfStaffTaskNotFoundError,
  ChiefOfStaffResearchError,
  DELEGATABLE_AGENT_KEYS,
} from "@/lib/domain/chiefOfStaffWorkflow";
import { fakeAnthropicClient, fakeAnthropicMessage } from "./testUtils";
import type { BusinessAnalystReport } from "@/lib/agents/businessAnalyst/schema";

function makeReport(overrides: Partial<BusinessAnalystReport> = {}): BusinessAnalystReport {
  return {
    query: "How saturated is the printable planner niche on Etsy?",
    summary: "Demand signals are mixed; the niche shows real search volume but heavy existing supply.",
    opportunities: ["A few sub-niches (ADHD planners) show lower competition with real search volume."],
    risks: ["Saturation is high in the general planner category."],
    sources: [{ url: "https://www.etsy.com/example", title: "Etsy seller forum thread", published_date: "2026-01-01" }],
    ...overrides,
  };
}

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

describe("Chief of Staff is registered correctly", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("seeds chief_of_staff as active — the fifth and final Operations Wing agent", async () => {
    const agent = await getAgentByKey("chief_of_staff");
    expect(agent?.status).toBe("active");
  });
});

describe("createGoalWithDelegatedSubtasks — the goal-delegation acceptance test", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("creates a real, persisted goal with real subtasks delegated to the named agents", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Launch our first YouTube channel",
      subtasks: [
        { agentKey: "business_analyst", title: "Research the niche" },
        { agentKey: "operations_agent", title: "Build a launch checklist" },
        { agentKey: "finance_agent", title: "Set a monthly content budget" },
      ],
    });

    expect(goal.title).toBe("Launch our first YouTube channel");
    expect(goal.founder_id).toBe(founderId);
    expect(goal.subtasks).toHaveLength(3);
    expect(goal.subtasks.map((s) => s.agent_key).sort()).toEqual(
      ["business_analyst", "finance_agent", "operations_agent"].sort(),
    );
    expect(goal.subtasks.every((s) => s.state === "open")).toBe(true);
    expect(goal.subtasks.every((s) => s.task_type === "delegated_subtask")).toBe(true);
    expect(goal.subtasks.every((s) => s.goal_id === goal.id)).toBe(true);
  });

  it("is genuinely visible after a fresh read — not just returned from the write", async () => {
    const founderId = await seededFounderId();
    const created = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Real persistence check",
      subtasks: [{ agentKey: "finance_agent", title: "A real subtask" }],
    });

    const reread = await getFounderGoal(created.id, founderId);
    expect(reread.title).toBe("Real persistence check");
    expect(reread.subtasks).toHaveLength(1);
  });

  it("never delegates to Scout or Content Bot, even if asked to", async () => {
    const founderId = await seededFounderId();
    await expect(
      createGoalWithDelegatedSubtasks(founderId, {
        title: "Sneaky goal",
        subtasks: [{ agentKey: "scout", title: "Research something" }],
      }),
    ).rejects.toBeInstanceOf(ChiefOfStaffValidationError);

    await expect(
      createGoalWithDelegatedSubtasks(founderId, {
        title: "Sneaky goal 2",
        subtasks: [{ agentKey: "content_bot", title: "Produce something" }],
      }),
    ).rejects.toBeInstanceOf(ChiefOfStaffValidationError);
  });

  it("refuses to delegate to a planned (not-yet-real) agent", async () => {
    const founderId = await seededFounderId();
    await expect(
      createGoalWithDelegatedSubtasks(founderId, {
        title: "Goal",
        subtasks: [{ agentKey: "inventor", title: "Come up with an idea" }],
      }),
    ).rejects.toBeInstanceOf(ChiefOfStaffValidationError);
  });

  it("refuses to delegate to a nonexistent agent key", async () => {
    const founderId = await seededFounderId();
    await expect(
      createGoalWithDelegatedSubtasks(founderId, {
        title: "Goal",
        subtasks: [{ agentKey: "not_a_real_agent", title: "Do something" }],
      }),
    ).rejects.toBeInstanceOf(ChiefOfStaffValidationError);
  });

  it("rejects an empty title and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderGoals(founderId);

    await expect(
      createGoalWithDelegatedSubtasks(founderId, { title: "", subtasks: [{ agentKey: "finance_agent", title: "x" }] }),
    ).rejects.toBeInstanceOf(ChiefOfStaffValidationError);

    const after = await listFounderGoals(founderId);
    expect(after).toHaveLength(before.length);
  });

  it("rejects a goal with zero subtasks and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderGoals(founderId);

    await expect(createGoalWithDelegatedSubtasks(founderId, { title: "Goal with nothing to do" })).rejects.toBeInstanceOf(
      ChiefOfStaffValidationError,
    );

    const after = await listFounderGoals(founderId);
    expect(after).toHaveLength(before.length);
  });

  it("DELEGATABLE_AGENT_KEYS contains exactly the four non-mission Operations Wing agents", () => {
    expect([...DELEGATABLE_AGENT_KEYS].sort()).toEqual(
      ["business_analyst", "executive_assistant", "finance_agent", "operations_agent"].sort(),
    );
  });
});

describe("listFounderGoals / getFounderGoal — ownership isolation", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("only returns the calling founder's own goals", async () => {
    const founderId = await seededFounderId();
    await createGoalWithDelegatedSubtasks(founderId, {
      title: "Mine",
      subtasks: [{ agentKey: "finance_agent", title: "x" }],
    });

    const goals = await listFounderGoals(founderId);
    expect(goals.every((g) => g.founder_id === founderId)).toBe(true);
  });

  it("refuses to read a goal owned by a different founder", async () => {
    const founders = await listFounders();
    const owner = founders[0]!.id;
    const goal = await createGoalWithDelegatedSubtasks(owner, {
      title: "Not yours",
      subtasks: [{ agentKey: "finance_agent", title: "x" }],
    });

    const otherFounder = founders.find((f) => f.id !== owner);
    if (!otherFounder) return;

    await expect(getFounderGoal(goal.id, otherFounder.id)).rejects.toBeInstanceOf(ChiefOfStaffGoalNotFoundError);
  });

  it("throws ChiefOfStaffGoalNotFoundError for a nonexistent id", async () => {
    const founderId = await seededFounderId();
    await expect(getFounderGoal("does-not-exist", founderId)).rejects.toBeInstanceOf(ChiefOfStaffGoalNotFoundError);
  });
});

describe("a delegated subtask is a real agent_task — completable via the EXISTING Executive Assistant workflow", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("can be completed through completeFounderTask with zero new mutation code", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Goal",
      subtasks: [{ agentKey: "operations_agent", title: "Build the checklist" }],
    });
    const subtaskId = goal.subtasks[0]!.id;

    const completed = await completeFounderTask(founderId, subtaskId);
    expect(completed.state).toBe("completed");

    const reread = await getFounderGoal(goal.id, founderId);
    expect(reread.subtasks[0]!.state).toBe("completed");
  });

  it("can be cancelled through cancelFounderTask with zero new mutation code", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Goal",
      subtasks: [{ agentKey: "business_analyst", title: "Research it" }],
    });
    const subtaskId = goal.subtasks[0]!.id;

    const cancelled = await cancelFounderTask(founderId, subtaskId);
    expect(cancelled.state).toBe("cancelled");
  });
});

// Master Development Mission 6 — the real gap this closes: completing a
// subtask delegated to Business Analyst used to be the exact same manual
// checkbox as any other agent's subtask, even though Business Analyst
// has a genuine autonomous capability (real, billed research) the other
// three delegates don't. These tests prove the subtask is only ever
// marked complete once that real capability genuinely ran and succeeded
// — never a fabricated or simulated completion.
describe("runDelegatedResearch — Business Analyst subtasks actually run real research", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("runs the real research capability and only completes the subtask once it genuinely succeeds", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Launch our first YouTube channel",
      subtasks: [{ agentKey: "business_analyst", title: "How saturated is the printable planner niche on Etsy?" }],
    });
    const subtaskId = goal.subtasks[0]!.id;
    expect(subtaskId).toBeTruthy();

    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const completed = await runDelegatedResearch(founderId, subtaskId, { client });
    expect(completed.state).toBe("completed");
    const result = completed.result as { businessAnalystReportId: string };
    expect(result.businessAnalystReportId).toBeTruthy();

    // Genuinely persisted, not just returned from the call.
    const reread = await getAgentTask(subtaskId);
    expect(reread?.state).toBe("completed");
    expect((reread?.result as { businessAnalystReportId: string }).businessAnalystReportId).toBe(
      result.businessAnalystReportId,
    );
  });

  it("leaves the subtask open and throws a real, distinct error when research genuinely fails — never a fabricated completion", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Goal",
      subtasks: [{ agentKey: "business_analyst", title: "Research something real" }],
    });
    const subtaskId = goal.subtasks[0]!.id;

    // A response that isn't valid JSON at all — a genuine research failure.
    const client = fakeAnthropicClient([
      fakeAnthropicMessage(null, { content: [{ type: "text", text: "Sorry, I can't help with that.", citations: null }] }),
    ]);

    await expect(runDelegatedResearch(founderId, subtaskId, { client })).rejects.toBeInstanceOf(ChiefOfStaffResearchError);

    const reread = await getAgentTask(subtaskId);
    expect(reread?.state).toBe("open");
  });

  it("refuses to run research for a subtask delegated to a different agent", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Goal",
      subtasks: [{ agentKey: "operations_agent", title: "Build a checklist" }],
    });
    const subtaskId = goal.subtasks[0]!.id;

    await expect(runDelegatedResearch(founderId, subtaskId)).rejects.toBeInstanceOf(ChiefOfStaffValidationError);
  });

  it("refuses to run research twice for the same, already-completed subtask", async () => {
    const founderId = await seededFounderId();
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Goal",
      subtasks: [{ agentKey: "business_analyst", title: "Research it" }],
    });
    const subtaskId = goal.subtasks[0]!.id;

    const client1 = fakeAnthropicClient([fakeAnthropicMessage(makeReport())]);
    await runDelegatedResearch(founderId, subtaskId, { client: client1 });

    const client2 = fakeAnthropicClient([fakeAnthropicMessage(makeReport())]);
    await expect(runDelegatedResearch(founderId, subtaskId, { client: client2 })).rejects.toBeInstanceOf(
      ChiefOfStaffValidationError,
    );
  });

  it("refuses a nonexistent subtask id", async () => {
    const founderId = await seededFounderId();
    await expect(runDelegatedResearch(founderId, "does-not-exist")).rejects.toBeInstanceOf(ChiefOfStaffTaskNotFoundError);
  });

  it("refuses a subtask owned by a different founder", async () => {
    const founders = await listFounders();
    const owner = founders[0]!.id;
    const goal = await createGoalWithDelegatedSubtasks(owner, {
      title: "Not yours",
      subtasks: [{ agentKey: "business_analyst", title: "x" }],
    });
    const otherFounder = founders.find((f) => f.id !== owner);
    if (!otherFounder) return;

    await expect(runDelegatedResearch(otherFounder.id, goal.subtasks[0]!.id)).rejects.toBeInstanceOf(
      ChiefOfStaffTaskNotFoundError,
    );
  });
});
