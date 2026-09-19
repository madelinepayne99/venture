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
    expect(findPath(MARKS.hub, { x: 12, z: 0 })).toEqual([]);
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
});
