import { describe, expect, it } from "vitest";
import { findPath, isGraphFullyConnected } from "@/lib/domain/officePathfinding";
import { NAV_GRAPH } from "@/lib/domain/officeLayout";

describe("office pathfinding", () => {
  it("finds a path from the founders' desk front to Scout's desk front", () => {
    const path = findPath("founders_desk_front", "scout_desk_front");
    expect(path).not.toBeNull();
    expect(path?.[0]?.id).toBe("founders_desk_front");
    expect(path?.[path.length - 1]?.id).toBe("scout_desk_front");
  });

  it("routes through both doorways in order, not around them", () => {
    const path = findPath("founders_desk_front", "scout_desk_front");
    const ids = path?.map((n) => n.id) ?? [];
    expect(ids).toEqual([
      "founders_desk_front",
      "founders_doorway",
      "corridor_mid",
      "scout_doorway",
      "scout_desk_front",
    ]);
  });

  it("is symmetric — the return path visits the same nodes in reverse", () => {
    const there = findPath("founders_desk_front", "scout_desk_front");
    const back = findPath("scout_desk_front", "founders_desk_front");
    expect(back?.map((n) => n.id)).toEqual([...(there?.map((n) => n.id) ?? [])].reverse());
  });

  it("returns a single-node path when the start and end are the same node", () => {
    const path = findPath("scout_desk_front", "scout_desk_front");
    expect(path?.map((n) => n.id)).toEqual(["scout_desk_front"]);
  });

  it("returns null for an unknown node id", () => {
    expect(findPath("nonexistent", "scout_desk_front")).toBeNull();
    expect(findPath("scout_desk_front", "nonexistent")).toBeNull();
  });

  it("path output is deterministic across repeated calls", () => {
    const a = findPath("founders_desk_front", "scout_desk_front");
    const b = findPath("founders_desk_front", "scout_desk_front");
    expect(a?.map((n) => n.id)).toEqual(b?.map((n) => n.id));
  });

  it("confirms the real office graph is fully connected", () => {
    expect(isGraphFullyConnected(NAV_GRAPH)).toBe(true);
  });

  it("detects a disconnected graph", () => {
    const disconnected = {
      nodes: [
        { id: "a", x: 0, z: 0 },
        { id: "b", x: 1, z: 0 },
        { id: "c", x: 5, z: 5 },
      ],
      edges: [["a", "b"]] as [string, string][],
    };
    expect(isGraphFullyConnected(disconnected)).toBe(false);
    expect(findPath("a", "c", disconnected)).toBeNull();
  });
});
