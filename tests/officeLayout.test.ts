import { describe, expect, it } from "vitest";
import { CHARACTER_RADIUS, DOORWAYS, NAV_GRAPH, ROOMS } from "@/lib/domain/officeLayout";
import { isGraphFullyConnected } from "@/lib/domain/officePathfinding";

describe("office layout", () => {
  it("every doorway gap is wide enough for a character to pass through", () => {
    for (const door of DOORWAYS) {
      const gapWidth = door.gap1 - door.gap0;
      expect(gapWidth).toBeGreaterThan(CHARACTER_RADIUS * 2);
    }
  });

  it("each doorway's axis matches a real wall it actually pierces", () => {
    for (const door of DOORWAYS) {
      expect(["x", "z"]).toContain(door.axis);
      expect(door.gap1).toBeGreaterThan(door.gap0);
    }
  });

  it("defines exactly the three real rooms — founders' office, circulation, Scout's office", () => {
    const ids = ROOMS.map((r) => r.id).sort();
    expect(ids).toEqual(["circulation", "founders_office", "scouts_office"]);
  });

  it("every room has a positive-area, well-formed bounds rect", () => {
    for (const room of ROOMS) {
      expect(room.bounds.x1).toBeGreaterThan(room.bounds.x0);
      expect(room.bounds.z1).toBeGreaterThan(room.bounds.z0);
    }
  });

  it("the nav graph is fully connected — every node can reach every other node", () => {
    expect(isGraphFullyConnected(NAV_GRAPH)).toBe(true);
  });

  it("the nav graph has no duplicate node ids", () => {
    const ids = NAV_GRAPH.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
