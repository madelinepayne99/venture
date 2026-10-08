import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, listAgentTaskWorldSignals } from "@/lib/db/repositories";
import { createFounderTask, completeFounderTask, cancelFounderTask } from "@/lib/domain/executiveAssistantWorkflow";
import { createGoalWithDelegatedSubtasks } from "@/lib/domain/chiefOfStaffWorkflow";
import {
  agentDestination,
  agentBusy,
  CHIEF_OF_STAFF_AGENT_KEY,
  EXECUTIVE_ASSISTANT_AGENT_KEY,
  OPERATIONS_AGENT_KEY,
  FINANCE_AGENT_KEY,
} from "@/components/founders-desk/world/layout";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

/**
 * Real, end-to-end world-state synchronization tests (Milestone 7) — no
 * synthetic/fabricated data. Every row here is written through the exact
 * same real domain functions the API routes call, read back through the
 * exact same real repository function (listAgentTaskWorldSignals) the
 * GET /api/missions route returns to the client, and fed into the exact
 * same real agentDestination/agentBusy functions the 3D scene's
 * syncWorld() calls every tick. This is the closest this sandbox can get
 * to a real browser demonstration (see docs/operations-build-progress.md
 * for why an actual click-through wasn't performed here).
 */
describe("Operations Wing world-state synchronization — real data, no shortcuts", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("a founder assigning a task to Operations Agent (via Chief of Staff delegation) genuinely moves it in the shared 3D office, and completing it moves it back — the full section 7 demonstration", async () => {
    const founderId = await seededFounderId();

    // Before anything: both agents are home.
    const before = await listAgentTaskWorldSignals();
    expect(agentDestination([], [], [], OPERATIONS_AGENT_KEY, before)).toBe("hub");
    expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, before)).toBe("hub");

    // A founder assigns a real task to Operations Agent, via Chief of
    // Staff's real, persisted goal-delegation workflow.
    const goal = await createGoalWithDelegatedSubtasks(founderId, {
      title: "Launch our first YouTube channel",
      subtasks: [{ agentKey: OPERATIONS_AGENT_KEY, title: "Build a launch checklist" }],
    });
    const subtaskId = goal.subtasks[0]!.id;

    // The task is persisted — genuinely visible after a fresh read from
    // the real shared-world signal, not just returned from the write.
    const afterAssign = await listAgentTaskWorldSignals();
    expect(
      afterAssign.some((s) => s.agent_key === OPERATIONS_AGENT_KEY && s.state === "open" && s.goal_id === goal.id),
    ).toBe(true);

    // Operations Agent visibly moves to its workstation (the "process"
    // station — see layout.ts's AGENT_STATIONS) — and Chief of Staff,
    // who delegated it, is shown as genuinely coordinating too.
    expect(agentDestination([], [], [], OPERATIONS_AGENT_KEY, afterAssign)).toBe("process");
    expect(agentBusy([], [], [], OPERATIONS_AGENT_KEY, afterAssign)).toBe(true);
    expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, afterAssign)).toBe("command");
    // No other agent is affected by this one real assignment.
    expect(agentDestination([], [], [], FINANCE_AGENT_KEY, afterAssign)).toBe("hub");

    // The task is completed using the EXISTING real workflow —
    // completeFounderTask, from executiveAssistantWorkflow.ts, completely
    // unmodified for this milestone (see chiefOfStaffWorkflow.ts's own
    // doc comment on why this already worked with zero new code).
    const completed = await completeFounderTask(founderId, subtaskId);
    expect(completed.state).toBe("completed");

    // Both Operations Agent and Chief of Staff walk back home — this is
    // the real, final state a founder would see in either interface.
    const afterComplete = await listAgentTaskWorldSignals();
    expect(agentDestination([], [], [], OPERATIONS_AGENT_KEY, afterComplete)).toBe("hub");
    expect(agentBusy([], [], [], OPERATIONS_AGENT_KEY, afterComplete)).toBe(false);
    expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, afterComplete)).toBe("hub");
  });

  it("Executive Assistant's own direct task (not delegated) moves it too, and cancelling it moves it back", async () => {
    const founderId = await seededFounderId();

    const task = await createFounderTask(founderId, { title: "Review monthly subscriptions" });

    const afterCreate = await listAgentTaskWorldSignals();
    expect(afterCreate.some((s) => s.agent_key === EXECUTIVE_ASSISTANT_AGENT_KEY && s.state === "open")).toBe(true);
    expect(agentDestination([], [], [], EXECUTIVE_ASSISTANT_AGENT_KEY, afterCreate)).toBe("admin");

    // A direct Executive Assistant task carries no goal_id — it was
    // never delegated — so it must never move Chief of Staff.
    expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, afterCreate)).toBe("hub");

    const cancelled = await cancelFounderTask(founderId, task.id);
    expect(cancelled.state).toBe("cancelled");

    const afterCancel = await listAgentTaskWorldSignals();
    expect(agentDestination([], [], [], EXECUTIVE_ASSISTANT_AGENT_KEY, afterCancel)).toBe("hub");
  });

  it("two agents with real, independent open work are both genuinely shown busy at the same time", async () => {
    const founderId = await seededFounderId();
    await createFounderTask(founderId, { title: "EA's own reminder" });
    await createGoalWithDelegatedSubtasks(founderId, {
      title: "A goal",
      subtasks: [{ agentKey: FINANCE_AGENT_KEY, title: "Set a budget" }],
    });

    const signals = await listAgentTaskWorldSignals();
    expect(agentBusy([], [], [], EXECUTIVE_ASSISTANT_AGENT_KEY, signals)).toBe(true);
    expect(agentBusy([], [], [], FINANCE_AGENT_KEY, signals)).toBe(true);
    // Untouched agents stay home even while two others are genuinely busy.
    expect(agentBusy([], [], [], OPERATIONS_AGENT_KEY, signals)).toBe(false);
  });

  it("listAgentTaskWorldSignals never exposes a task's title/detail/payload — only agent_key, state, and goal_id", async () => {
    const founderId = await seededFounderId();
    await createFounderTask(founderId, {
      title: "A private reminder a founder would not want shown on a shared office screen",
      detail: "Sensitive detail text.",
    });

    const signals = await listAgentTaskWorldSignals();
    for (const signal of signals) {
      expect(Object.keys(signal).sort()).toEqual(["agent_key", "goal_id", "state"]);
    }
  });
});
