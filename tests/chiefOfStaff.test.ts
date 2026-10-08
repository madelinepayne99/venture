import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getAgentByKey } from "@/lib/db/repositories";
import { completeFounderTask, cancelFounderTask } from "@/lib/domain/executiveAssistantWorkflow";
import {
  createGoalWithDelegatedSubtasks,
  listFounderGoals,
  getFounderGoal,
  ChiefOfStaffValidationError,
  ChiefOfStaffGoalNotFoundError,
  DELEGATABLE_AGENT_KEYS,
} from "@/lib/domain/chiefOfStaffWorkflow";

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
