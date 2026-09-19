import { describe, expect, it } from "vitest";
import { nextIdlePoint, IDLE_OFFSETS } from "../components/founders-desk/world/idle";
import { walkable, MARKS } from "../components/founders-desk/world/layout";

describe("idle wandering", () => {
  it("is fully deterministic — the same (home, seedTick) pair always produces the same point", () => {
    const home = MARKS.hub;
    for (let seedTick = 0; seedTick < 50; seedTick++) {
      const a = nextIdlePoint(home, seedTick);
      const b = nextIdlePoint(home, seedTick);
      expect(a).toEqual(b);
    }
  });

  it("cycles deterministically through the fixed offset set, never calling Math.random", () => {
    const home = MARKS.hub;
    const seen = new Set<string>();
    for (let seedTick = 0; seedTick < IDLE_OFFSETS.length * 3; seedTick++) {
      const p = nextIdlePoint(home, seedTick);
      seen.add(`${p.x.toFixed(5)},${p.z.toFixed(5)}`);
    }
    // Exactly IDLE_OFFSETS.length distinct points across 3 full cycles.
    expect(seen.size).toBe(IDLE_OFFSETS.length);
  });

  it("every fixed offset is a genuinely walkable point from every real agent home station", () => {
    for (const home of [MARKS.hub, MARKS.contentBotHome]) {
      for (let seedTick = 0; seedTick < IDLE_OFFSETS.length; seedTick++) {
        const point = nextIdlePoint(home, seedTick);
        expect(walkable(point), `${JSON.stringify(home)} + offset ${seedTick} -> ${JSON.stringify(point)}`).toBe(
          true,
        );
      }
    }
  });

  it("handles a negative or out-of-range seedTick the same as its positive modulo equivalent", () => {
    const home = MARKS.hub;
    expect(nextIdlePoint(home, -1)).toEqual(nextIdlePoint(home, IDLE_OFFSETS.length - 1));
    expect(nextIdlePoint(home, IDLE_OFFSETS.length)).toEqual(nextIdlePoint(home, 0));
  });
});
