import { describe, expect, it } from "vitest";
import { findPath, MARKS, researchDestination, walkable, type Point } from "../components/founders-desk/world/layout";

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
});
