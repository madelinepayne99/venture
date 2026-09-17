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
  it("keeps Scout in research until the last researching mission leaves", () => {
    expect(researchDestination([])).toBe("hub");
    expect(researchDestination([{ state: "researching" }, { state: "researching" }])).toBe("research");
    expect(researchDestination([{ state: "failed" }, { state: "researching" }])).toBe("research");
    expect(researchDestination([{ state: "awaiting_evidence" }, { state: "cancelled" }])).toBe("hub");
  });
});
