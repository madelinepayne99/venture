/** Physical navigation only. These values never describe mission progress. */
export type Point = { x: number; z: number };
export type Rect = { x: number; z: number; w: number; d: number };
export type WorldTarget = "desk" | "scout" | "board" | "research" | "lounge";

export const MARKS = {
  hub: { x: -0.65, z: 0.7 },
  research: { x: 2.95, z: -1.29 },
  lounge: { x: 1.75, z: 2.45 },
} satisfies Record<string, Point>;

// Wall gaps and furniture footprints are shared with the rendered composition.
export const OBSTACLES: Rect[] = [
  { x: 0.55, z: -1.8, w: 0.2, d: 4.4 },
  { x: 0.55, z: 3.42, w: 0.2, d: 2.36 },
  { x: 3.99, z: 0.2, w: 2.76, d: 0.2 },
  { x: 0.9, z: 0.2, w: 0.5, d: 0.2 },
  { x: -2.8, z: -1.5, w: 3.8, d: 1.35 },
  { x: -3.7, z: -0.05, w: 0.68, d: 0.72 },
  { x: -1.9, z: -0.05, w: 0.68, d: 0.72 },
  { x: 3.1, z: -2.15, w: 2.8, d: 1.0 },
  { x: 3.7, z: -3.7, w: 2.7, d: 0.5 },
  { x: -4.87, z: 0.9, w: 0.58, d: 2.1 },
  { x: -3.85, z: 3.24, w: 1.03, d: 1.02 },
  { x: -1.92, z: 3.24, w: 1.03, d: 1.02 },
  { x: -2.85, z: 2.67, w: 0.75, d: 0.75 },
  { x: 3.83, z: 1.27, w: 2.18, d: 0.84 },
  { x: 3.48, z: 2.67, w: 1.0, d: 0.85 },
  { x: 4.65, z: 3.85, w: 0.7, d: 0.65 },
  { x: -4.75, z: -3.28, w: 0.65, d: 0.65 },
];

export function walkable(p: Point, margin = 0.23) {
  return p.x > -5.13 + margin && p.x < 5.15 - margin &&
    p.z > -3.8 + margin && p.z < 4.4 - margin &&
    !OBSTACLES.some(r => Math.abs(p.x - r.x) < r.w / 2 + margin && Math.abs(p.z - r.z) < r.d / 2 + margin);
}

/** A small deterministic four-neighbour grid. No diagonal corner cutting. */
export function findPath(start: Point, destination: Point): Point[] {
  if (!walkable(destination)) return [];
  const step = 0.18;
  const key = (x: number, z: number) => `${x},${z}`;
  const cell = (p: Point) => ({ x: Math.round(p.x / step), z: Math.round(p.z / step) });
  const first = cell(start), goal = cell(destination);
  const queue = [first], seen = new Set([key(first.x, first.z)]);
  const parents = new Map<string, typeof first>();
  let finish: typeof first | undefined;
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if (node.x === goal.x && node.z === goal.z) { finish = node; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: node.x + dx, z: node.z + dz }, id = key(next.x, next.z);
      if (seen.has(id) || !walkable({ x: next.x * step, z: next.z * step })) continue;
      seen.add(id); parents.set(id, node); queue.push(next);
    }
  }
  if (!finish) return [];
  const path: Point[] = [];
  while (finish.x !== first.x || finish.z !== first.z) {
    path.unshift({ x: finish.x * step, z: finish.z * step });
    finish = parents.get(key(finish.x, finish.z))!;
  }
  path.push(destination);
  // Collapse collinear cells, preserving the safe right-angle turns.
  return path.filter((p, i) => {
    const before = i === 0 ? start : path[i - 1]!;
    const after = path[i + 1];
    if (!after) return true;
    return Math.abs((p.x - before.x) * (after.z - p.z) - (p.z - before.z) * (after.x - p.x)) > 0.00001;
  });
}

/** The one real agent this scene renders. A future second agent's own scene binds its own key here. */
export const SCOUT_AGENT_KEY = "scout";

/**
 * Where Scout belongs right now, derived from his own real assignment —
 * never from "is any mission in this room researching." A mission only
 * pulls Scout into the research room while it is both `researching` AND
 * he is genuinely its lead-assigned agent; a mission some other agent
 * leads (once other agents exist) can never move Scout's character.
 */
export function researchDestination(
  missions: readonly { id: string; state: string }[],
  leadAssignments: readonly { mission_id: string; agent_key: string }[],
  agentKey: string = SCOUT_AGENT_KEY,
): "hub" | "research" {
  const led = new Set(leadAssignments.filter(a => a.agent_key === agentKey).map(a => a.mission_id));
  return missions.some(m => m.state === "researching" && led.has(m.id)) ? "research" : "hub";
}
