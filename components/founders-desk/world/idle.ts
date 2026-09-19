import type { Point } from "./layout";

/**
 * Purely cosmetic — "someone is here," never an activity signal. The real
 * "working" signal is agentBusy() in layout.ts (driven by a genuine
 * mission/content-item state and a real lead assignment); idle wandering
 * never touches that and is disabled entirely the instant an agent has
 * real work (see engine.ts's animate loop, which clears any idle route
 * the moment agentDestination stops resolving to "hub").
 *
 * Deterministic by construction — no Math.random() anywhere. A small,
 * fixed set of relative offsets (not a dynamic candidate search) means
 * this can never need a walkability check at runtime and can never wander
 * into a wall; the offsets below are verified walkable from every real
 * agent home station in tests/idleWander.test.ts.
 */
const IDLE_OFFSETS: Point[] = [
  { x: 0.3, z: 0.15 },
  { x: -0.25, z: 0.2 },
  { x: 0.15, z: -0.25 },
];

/** The next idle destination for an agent at `home` — the same (home, seedTick) pair always produces the same point. */
export function nextIdlePoint(home: Point, seedTick: number): Point {
  const offset = IDLE_OFFSETS[((seedTick % IDLE_OFFSETS.length) + IDLE_OFFSETS.length) % IDLE_OFFSETS.length]!;
  return { x: home.x + offset.x, z: home.z + offset.z };
}

export { IDLE_OFFSETS };
