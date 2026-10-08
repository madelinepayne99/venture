import { describe, expect, it } from "vitest";
import {
  findPath,
  MARKS,
  researchDestination,
  agentDestination,
  agentBusy,
  walkable,
  SCOUT_AGENT_KEY,
  CONTENT_BOT_AGENT_KEY,
  CHIEF_OF_STAFF_AGENT_KEY,
  EXECUTIVE_ASSISTANT_AGENT_KEY,
  FINANCE_AGENT_KEY,
  BUSINESS_ANALYST_AGENT_KEY,
  OPERATIONS_AGENT_KEY,
  type AgentTaskSignal,
  type Point,
} from "../components/founders-desk/world/layout";

function verifyRoute(start: Point, goal: Point) {
  const route = findPath(start, goal);
  expect(route.length).toBeGreaterThan(1);
  expect(route[route.length - 1]).toEqual(goal);
  let previous = start;
  for (const next of route) {
    const samples = Math.ceil(Math.hypot(next.x - previous.x, next.z - previous.z) / .025);
    for (let i = 1; i <= samples; i++) {
      const p = { x: previous.x + (next.x - previous.x) * i / samples, z: previous.z + (next.z - previous.z) * i / samples };
      expect(walkable(p), `Route crossed an obstacle at ${JSON.stringify(p)}`).toBe(true);
    }
    previous = next;
  }
}

describe("office world navigation", () => {
  it("routes through the real doorways in both directions without clipping furniture", () => {
    verifyRoute(MARKS.hub, MARKS.research); verifyRoute(MARKS.research, MARKS.hub);
  });
  it("connects the lounge to both working rooms", () => {
    verifyRoute(MARKS.hub, MARKS.lounge); verifyRoute(MARKS.lounge, MARKS.research);
  });
  it("rejects blocked destinations and positions outside the building", () => {
    expect(findPath(MARKS.hub, { x: -2.8, z: -1.5 })).toEqual([]);
    expect(findPath(MARKS.hub, { x: .55, z: -1 })).toEqual([]);
    // x: 12 is now genuinely inside the building — the Operations Wing
    // extension (Milestone 7) widened the walkable east bound from 5.15
    // to 12.5. This checks a point well beyond that new bound instead.
    expect(findPath(MARKS.hub, { x: 20, z: 0 })).toEqual([]);
  });
  it("keeps Scout in research until his last led, researching mission leaves", () => {
    expect(researchDestination([], [])).toBe("hub");
    expect(
      researchDestination(
        [{ id: "m1", state: "researching" }, { id: "m2", state: "researching" }],
        [{ mission_id: "m1", agent_key: "scout" }, { mission_id: "m2", agent_key: "scout" }],
      ),
    ).toBe("research");
    expect(
      researchDestination(
        [{ id: "m1", state: "failed" }, { id: "m2", state: "researching" }],
        [{ mission_id: "m2", agent_key: "scout" }],
      ),
    ).toBe("research");
    expect(
      researchDestination(
        [{ id: "m1", state: "awaiting_evidence" }, { id: "m2", state: "cancelled" }],
        [{ mission_id: "m1", agent_key: "scout" }],
      ),
    ).toBe("hub");
  });

  it("never moves Scout for a researching mission he isn't the real lead on", () => {
    // A mission genuinely researching, but with no assignment row at all yet
    // (e.g. the transition landed before assignAgent ran) — Scout must not
    // teleport into the research room on state alone.
    expect(researchDestination([{ id: "m1", state: "researching" }], [])).toBe("hub");
    // A mission researching and led by a different real agent — proves this
    // can never animate the wrong character once a second agent exists.
    expect(
      researchDestination(
        [{ id: "m1", state: "researching" }],
        [{ mission_id: "m1", agent_key: "inventor" }],
      ),
    ).toBe("hub");
    // Scout is assigned, but as a non-lead role wouldn't be recorded by
    // listLeadAssignments in the first place — simulated here by simply
    // omitting it, same outcome as the no-assignment case above.
    expect(
      researchDestination(
        [{ id: "m1", state: "researching" }, { id: "m2", state: "queued" }],
        [{ mission_id: "m2", agent_key: "scout" }],
      ),
    ).toBe("hub");
  });

  it("sends Scout back to the Research Room for a genuine second pass, using the same lead assignment pass 1 already created", () => {
    // The two-pass evidence loop (missionWorkflow.ts's MAX_RESEARCH_PASSES)
    // never creates a second agent_assignments row for pass 2 — the real
    // "lead" row from pass 1 is reused as-is (see runScoutPipeline's
    // hasAssignment guard). This proves the animation fix generalizes to a
    // real second pass with zero changes needed here: the mission simply
    // genuinely re-enters "researching," and the one, never-deleted
    // assignment row is all researchDestination needs to route Scout back.
    const leadAssignments = [{ mission_id: "m1", agent_key: "scout" }];
    // Pass 1 settles out of researching (e.g. into awaiting_evidence) — Scout heads home.
    expect(researchDestination([{ id: "m1", state: "awaiting_evidence" }], leadAssignments)).toBe("hub");
    // The automatic follow-up dispatch flips the same mission back to
    // "researching" — same mission id, same assignment row, no new insert.
    expect(researchDestination([{ id: "m1", state: "researching" }], leadAssignments)).toBe("research");
  });

  it("routes Content Bot to the studio only when a content item is genuinely generating AND he is its real lead", () => {
    expect(agentDestination([], [], [], CONTENT_BOT_AGENT_KEY)).toBe("hub");
    expect(
      agentDestination(
        [],
        [{ mission_id: "m1", agent_key: "content_bot" }],
        [{ mission_id: "m1", state: "generating" }],
        CONTENT_BOT_AGENT_KEY,
      ),
    ).toBe("studio");
    // Genuinely generating, but with no assignment row at all yet.
    expect(
      agentDestination([], [], [{ mission_id: "m1", state: "generating" }], CONTENT_BOT_AGENT_KEY),
    ).toBe("hub");
    // Generating, but led by a different real agent (Scout) — proves Content
    // Bot's own character can never be moved by Scout's work.
    expect(
      agentDestination(
        [],
        [{ mission_id: "m1", agent_key: "scout" }],
        [{ mission_id: "m1", state: "generating" }],
        CONTENT_BOT_AGENT_KEY,
      ),
    ).toBe("hub");
    // Settled out of generating — Content Bot heads home.
    expect(
      agentDestination(
        [],
        [{ mission_id: "m1", agent_key: "content_bot" }],
        [{ mission_id: "m1", state: "awaiting_review" }],
        CONTENT_BOT_AGENT_KEY,
      ),
    ).toBe("hub");
  });

  it("keeps Scout's and Content Bot's destinations fully independent — one agent's real work never moves the other's character", () => {
    const leadAssignments = [
      { mission_id: "research-mission", agent_key: "scout" },
      { mission_id: "production-mission", agent_key: "content_bot" },
    ];
    const missions = [{ id: "research-mission", state: "researching" }];
    const contentItems = [{ mission_id: "production-mission", state: "generating" }];

    expect(agentDestination(missions, leadAssignments, contentItems, SCOUT_AGENT_KEY)).toBe("research");
    expect(agentDestination(missions, leadAssignments, contentItems, CONTENT_BOT_AGENT_KEY)).toBe("studio");
    expect(agentBusy(missions, leadAssignments, contentItems, SCOUT_AGENT_KEY)).toBe(true);
    expect(agentBusy(missions, leadAssignments, contentItems, CONTENT_BOT_AGENT_KEY)).toBe(true);

    // Scout's mission settles; Content Bot's own work is entirely unaffected.
    const settledMissions = [{ id: "research-mission", state: "ready_for_founders_review" }];
    expect(agentDestination(settledMissions, leadAssignments, contentItems, SCOUT_AGENT_KEY)).toBe("hub");
    expect(agentBusy(settledMissions, leadAssignments, contentItems, SCOUT_AGENT_KEY)).toBe(false);
    expect(agentDestination(settledMissions, leadAssignments, contentItems, CONTENT_BOT_AGENT_KEY)).toBe("studio");
    expect(agentBusy(settledMissions, leadAssignments, contentItems, CONTENT_BOT_AGENT_KEY)).toBe(true);
  });

  it("an unknown agent key always resolves home — never a hidden default destination", () => {
    expect(agentDestination([], [], [], "some_future_agent")).toBe("hub");
    expect(agentBusy([], [], [], "some_future_agent")).toBe(false);
  });

  it("MARKS.studio and MARKS.contentBotHome are real, walkable points reachable from the hub", () => {
    expect(walkable(MARKS.studio)).toBe(true);
    expect(walkable(MARKS.contentBotHome)).toBe(true);
    verifyRoute(MARKS.hub, MARKS.studio);
    verifyRoute(MARKS.hub, MARKS.contentBotHome);
  });

  describe("Operations Wing (Milestone 7) — agent_tasks-driven destinations", () => {
    const OPS_AGENTS = [
      { key: EXECUTIVE_ASSISTANT_AGENT_KEY, station: "admin" },
      { key: FINANCE_AGENT_KEY, station: "ledger" },
      { key: BUSINESS_ANALYST_AGENT_KEY, station: "intel" },
      { key: OPERATIONS_AGENT_KEY, station: "process" },
    ] as const;

    it("every new desk and home mark is real, walkable, and reachable from the hub", () => {
      const marks = [
        "command", "chiefOfStaffHome", "admin", "executiveAssistantHome",
        "ledger", "financeAgentHome", "intel", "businessAnalystHome",
        "process", "operationsAgentHome",
      ] as const;
      for (const key of marks) {
        expect(walkable(MARKS[key]), `${key} should be walkable`).toBe(true);
        verifyRoute(MARKS.hub, MARKS[key]);
      }
    });

    it("stays home with no agent_tasks at all", () => {
      for (const { key } of OPS_AGENTS) {
        expect(agentDestination([], [], [], key, [])).toBe("hub");
        expect(agentBusy([], [], [], key, [])).toBe(false);
      }
    });

    it("walks to its own desk only while it genuinely has an open or in-progress task", () => {
      for (const { key, station } of OPS_AGENTS) {
        const openTasks: AgentTaskSignal[] = [{ agent_key: key, state: "open", goal_id: null }];
        expect(agentDestination([], [], [], key, openTasks)).toBe(station);
        expect(agentBusy([], [], [], key, openTasks)).toBe(true);

        const inProgressTasks: AgentTaskSignal[] = [{ agent_key: key, state: "in_progress", goal_id: null }];
        expect(agentDestination([], [], [], key, inProgressTasks)).toBe(station);

        const settledTasks: AgentTaskSignal[] = [{ agent_key: key, state: "completed", goal_id: null }];
        expect(agentDestination([], [], [], key, settledTasks)).toBe("hub");
        expect(agentBusy([], [], [], key, settledTasks)).toBe(false);

        const cancelledTasks: AgentTaskSignal[] = [{ agent_key: key, state: "cancelled", goal_id: null }];
        expect(agentDestination([], [], [], key, cancelledTasks)).toBe("hub");
      }
    });

    it("never moves one Operations Wing agent for another agent's real task", () => {
      const tasks: AgentTaskSignal[] = [{ agent_key: FINANCE_AGENT_KEY, state: "open", goal_id: null }];
      expect(agentDestination([], [], [], FINANCE_AGENT_KEY, tasks)).toBe("ledger");
      expect(agentDestination([], [], [], OPERATIONS_AGENT_KEY, tasks)).toBe("hub");
      expect(agentDestination([], [], [], BUSINESS_ANALYST_AGENT_KEY, tasks)).toBe("hub");
      expect(agentDestination([], [], [], EXECUTIVE_ASSISTANT_AGENT_KEY, tasks)).toBe("hub");
    });

    it("Chief of Staff is busy only while a goal it created has a real unresolved (goal_id-bearing) subtask — no row is ever created naming it directly", () => {
      // No agent_tasks row is ever created with agent_key: "chief_of_staff"
      // (see chiefOfStaffWorkflow.ts's DELEGATABLE_AGENT_KEYS) — this
      // proves that alone does NOT move him.
      const ownKeyTasks: AgentTaskSignal[] = [{ agent_key: CHIEF_OF_STAFF_AGENT_KEY, state: "open", goal_id: null }];
      expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, ownKeyTasks)).toBe("hub");

      // A real delegated subtask (goal_id set), still open, on a
      // DIFFERENT agent's row — this is what actually moves him.
      const delegatedOpen: AgentTaskSignal[] = [{ agent_key: FINANCE_AGENT_KEY, state: "open", goal_id: "goal-1" }];
      expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, delegatedOpen)).toBe("command");
      expect(agentBusy([], [], [], CHIEF_OF_STAFF_AGENT_KEY, delegatedOpen)).toBe(true);
      // Never moves the delegate's own character for Chief of Staff's sake.
      expect(agentDestination([], [], [], FINANCE_AGENT_KEY, delegatedOpen)).toBe("ledger");

      // Every delegated subtask settled — Chief of Staff heads home.
      const delegatedSettled: AgentTaskSignal[] = [{ agent_key: FINANCE_AGENT_KEY, state: "completed", goal_id: "goal-1" }];
      expect(agentDestination([], [], [], CHIEF_OF_STAFF_AGENT_KEY, delegatedSettled)).toBe("hub");
    });

    it("keeps Scout/Content Bot and the Operations Wing agents fully independent of each other", () => {
      const missions = [{ id: "m1", state: "researching" }];
      const leadAssignments = [{ mission_id: "m1", agent_key: "scout" }];
      const contentItems: { mission_id: string; state: string }[] = [];
      const agentTasks: AgentTaskSignal[] = [{ agent_key: OPERATIONS_AGENT_KEY, state: "open", goal_id: null }];

      expect(agentDestination(missions, leadAssignments, contentItems, SCOUT_AGENT_KEY, agentTasks)).toBe("research");
      expect(agentDestination(missions, leadAssignments, contentItems, OPERATIONS_AGENT_KEY, agentTasks)).toBe("process");
      expect(agentDestination(missions, leadAssignments, contentItems, CONTENT_BOT_AGENT_KEY, agentTasks)).toBe("hub");
    });

    it("the default agentTasks parameter ([]) keeps every pre-Milestone-7 caller behaving identically", () => {
      // No 5th argument at all — exactly how Scout/Content Bot callers
      // written before this milestone still call these functions.
      expect(agentDestination([], [], [], SCOUT_AGENT_KEY)).toBe("hub");
      expect(agentDestination([], [], [], FINANCE_AGENT_KEY)).toBe("hub");
      expect(agentBusy([], [], [], FINANCE_AGENT_KEY)).toBe(false);
    });
  });
});
