/** Physical navigation only. These values never describe mission progress. */
export type Point = { x: number; z: number };
export type Rect = { x: number; z: number; w: number; d: number };
export type WorldTarget =
  | "desk" | "scout" | "board" | "research" | "lounge" | "studio" | "content_bot"
  // Operations Wing (Milestone 7) — one target per new agent's own
  // character/desk, named after its real agents.key so the click handler
  // never needs a separate lookup table.
  | "chief_of_staff" | "executive_assistant" | "finance_agent" | "business_analyst" | "operations_agent";

export const MARKS = {
  hub: { x: -0.65, z: 0.7 },
  research: { x: 2.95, z: -1.29 },
  lounge: { x: 1.75, z: 2.45 },
  // Content Bot's own idle spot near the founders' desk — offset from
  // Scout's hub mark so the two characters don't visually stack when both
  // are idle at once (see CLAUDE.md's shared-world-architecture milestone:
  // one building, both agents visibly present, never overlapping).
  contentBotHome: { x: -0.9, z: 0.3 },
  // The Content Studio nook — placed inside the EXISTING building
  // footprint (verified walkable and reachable from every other real
  // destination) rather than a new east-wing room extension. A deliberate
  // smaller-footprint implementation of the plan's Content Studio room:
  // real, functional, and visually distinct (see studioFurniture in
  // furniture.ts), without the ~40% floor-plan growth the original plan
  // itself flagged as its highest-risk regression to founders' existing
  // view of Scout.
  studio: { x: 0, z: -2.1 },
  // --- Operations Wing (Milestone 7) ---------------------------------
  // A real east-wing extension — the "legitimate follow-up" CLAUDE.md's
  // Content Studio note explicitly deferred, now that five more agents
  // need their own desks rather than one. Each agent's working-station
  // mark sits just south of its own desk (see furniture.ts's
  // departmentDesk — the desk's own group origin is further north, at
  // the same x, closer to the new wing's back wall); each home/idle mark
  // sits further south again, in the open aisle, so "walk to workstation
  // when assigned work" is a real, visible walk every time, not a
  // same-point animation toggle.
  command: { x: 6.0, z: -2.7 },
  chiefOfStaffHome: { x: 6.0, z: -1.9 },
  admin: { x: 7.3, z: -2.7 },
  executiveAssistantHome: { x: 7.3, z: -1.9 },
  ledger: { x: 8.6, z: -2.7 },
  financeAgentHome: { x: 8.6, z: -1.9 },
  intel: { x: 9.9, z: -2.7 },
  businessAnalystHome: { x: 9.9, z: -1.9 },
  process: { x: 11.2, z: -2.7 },
  operationsAgentHome: { x: 11.2, z: -1.9 },
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
  // Operations Wing (Milestone 7) — one small obstacle per new desk,
  // matching furniture.ts's departmentDesk footprint (w: 1.0, d: .6)
  // exactly, the same "obstacle rect mirrors the rendered box" discipline
  // every existing entry above already follows. No new exterior-wall
  // obstacles are needed: the new wing's back wall sits entirely in the
  // z < -3.8 band the outer walkable() bound already excludes, exactly
  // like the original north/west walls needed none either.
  { x: 6.0, z: -3.35, w: 1.0, d: 0.6 },
  { x: 7.3, z: -3.35, w: 1.0, d: 0.6 },
  { x: 8.6, z: -3.35, w: 1.0, d: 0.6 },
  { x: 9.9, z: -3.35, w: 1.0, d: 0.6 },
  { x: 11.2, z: -3.35, w: 1.0, d: 0.6 },
];

// The east bound widened from 5.15 to 12.5 for the Operations Wing
// extension (Milestone 7) — z bounds are unchanged, since the new wing
// reuses the same depth as the rest of the building. See engine.ts's
// resize() for why the camera's own fixed framing was deliberately left
// untouched (panning further east reaches the new wing; the existing
// room's on-screen size/prominence never shrinks to make room for it).
export function walkable(p: Point, margin = 0.23) {
  return p.x > -5.13 + margin && p.x < 12.5 - margin &&
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

/** Scout and Content Bot — the two mission-dispatched agents this scene renders. */
export const SCOUT_AGENT_KEY = "scout";
export const CONTENT_BOT_AGENT_KEY = "content_bot";

// Operations Wing (Milestone 7) — the five agents dispatched through real
// agent_tasks rows (never missions/content_items — see CLAUDE.md's
// Operations Wing milestone). Named constants, same convention as Scout/
// Content Bot above, so the generic branch below never has to compare
// against a raw string literal.
export const CHIEF_OF_STAFF_AGENT_KEY = "chief_of_staff";
export const EXECUTIVE_ASSISTANT_AGENT_KEY = "executive_assistant";
export const FINANCE_AGENT_KEY = "finance_agent";
export const BUSINESS_ANALYST_AGENT_KEY = "business_analyst";
export const OPERATIONS_AGENT_KEY = "operations_agent";

export type AgentStation = "hub" | "research" | "studio" | "command" | "admin" | "ledger" | "intel" | "process";

/**
 * Each agent's home station and which real state pulls it to its own
 * working station — this is the whole "which agent goes where" policy in
 * one place. Adding a new agent is a new entry here, not a new function
 * (see CLAUDE.md's shared-world-architecture milestone). "hub" is a
 * convention, not a literal shared point — engine.ts's stationPoint()
 * resolves it to THAT rig's own `home` point (see createRig), which is
 * how Scout/Content Bot already sit at two different points while both
 * nominally being "home" — the five Operations Wing agents below use the
 * exact same mechanism with their own home points (MARKS.chiefOfStaffHome
 * etc.), not the Founders' Hub.
 */
export const AGENT_STATIONS: Record<string, { home: AgentStation; workingStation: AgentStation }> = {
  [SCOUT_AGENT_KEY]: { home: "hub", workingStation: "research" },
  [CONTENT_BOT_AGENT_KEY]: { home: "hub", workingStation: "studio" },
  [CHIEF_OF_STAFF_AGENT_KEY]: { home: "hub", workingStation: "command" },
  [EXECUTIVE_ASSISTANT_AGENT_KEY]: { home: "hub", workingStation: "admin" },
  [FINANCE_AGENT_KEY]: { home: "hub", workingStation: "ledger" },
  [BUSINESS_ANALYST_AGENT_KEY]: { home: "hub", workingStation: "intel" },
  [OPERATIONS_AGENT_KEY]: { home: "hub", workingStation: "process" },
};

const OPEN_TASK_STATES = new Set(["open", "in_progress"]);

/**
 * A lightweight, privacy-conscious projection of a real agent_tasks row —
 * only what the shared office scene needs to know an agent has real
 * outstanding work (never title/detail/payload, which can hold personal
 * reminder text — see lib/db/repositories.ts's listAgentTaskWorldSignals).
 */
export type AgentTaskSignal = { agent_key: string; state: string; goal_id: string | null };

/**
 * Whether the Operations Wing agent named by `agentKey` has real,
 * outstanding (not yet completed/cancelled) work right now — the generic
 * signal that pulls any of the five non-mission agents to their own desk.
 * Chief of Staff is the one deliberate special case: it DELEGATES rather
 * than receives tasks, so no agent_tasks row is ever created with
 * agent_key = "chief_of_staff" (see chiefOfStaffWorkflow.ts's
 * DELEGATABLE_AGENT_KEYS, which excludes it on purpose). Its own signal
 * is instead "does any goal it created still have an unresolved
 * (goal_id-bearing) subtask anywhere" — genuinely real, persisted data,
 * just read through the subtasks it delegated rather than a row naming
 * it directly.
 */
function hasOpenOperationsWork(agentTasks: readonly AgentTaskSignal[], agentKey: string): boolean {
  if (agentKey === CHIEF_OF_STAFF_AGENT_KEY) {
    return agentTasks.some(t => t.goal_id != null && OPEN_TASK_STATES.has(t.state));
  }
  return agentTasks.some(t => t.agent_key === agentKey && OPEN_TASK_STATES.has(t.state));
}

/**
 * Where an agent belongs right now, derived ONLY from its own real
 * assignment — never from "is any mission/content item/task anywhere
 * doing something." Scout is pulled to Research while a mission is
 * genuinely `researching` AND he is its real lead; Content Bot is pulled
 * to the Studio while a content item is genuinely `generating` AND it is
 * his real lead; each Operations Wing agent is pulled to its own desk
 * while it genuinely has an open agent_tasks row of its own (see
 * hasOpenOperationsWork above). This is the exact fix already proven
 * once for Scout (Milestone 4.3), generalized so every later agent
 * follows the identical pattern rather than reintroducing the
 * aggregate-state shortcut. `agentTasks` defaults to `[]` so every
 * existing caller written before this milestone keeps compiling and
 * behaving identically for Scout/Content Bot.
 */
export function agentDestination(
  missions: readonly { id: string; state: string }[],
  leadAssignments: readonly { mission_id: string; agent_key: string }[],
  contentItems: readonly { mission_id: string; state: string }[],
  agentKey: string,
  agentTasks: readonly AgentTaskSignal[] = [],
): AgentStation {
  const stations = AGENT_STATIONS[agentKey];
  if (!stations) return "hub";
  const led = new Set(leadAssignments.filter(a => a.agent_key === agentKey).map(a => a.mission_id));

  if (agentKey === SCOUT_AGENT_KEY) {
    return missions.some(m => m.state === "researching" && led.has(m.id)) ? stations.workingStation : stations.home;
  }
  if (agentKey === CONTENT_BOT_AGENT_KEY) {
    return contentItems.some(c => c.state === "generating" && led.has(c.mission_id)) ? stations.workingStation : stations.home;
  }
  return hasOpenOperationsWork(agentTasks, agentKey) ? stations.workingStation : stations.home;
}

/** Drives the "working" animation flag only — never position (see engine.ts's animate loop). */
export function agentBusy(
  missions: readonly { id: string; state: string }[],
  leadAssignments: readonly { mission_id: string; agent_key: string }[],
  contentItems: readonly { mission_id: string; state: string }[],
  agentKey: string,
  agentTasks: readonly AgentTaskSignal[] = [],
): boolean {
  const stations = AGENT_STATIONS[agentKey];
  if (!stations) return false;
  return agentDestination(missions, leadAssignments, contentItems, agentKey, agentTasks) === stations.workingStation;
}

/**
 * @deprecated Use agentDestination(missions, leadAssignments, contentItems, agentKey) instead —
 * kept only so existing callers/tests written before Content Bot existed
 * still pass unchanged.
 */
export function researchDestination(
  missions: readonly { id: string; state: string }[],
  leadAssignments: readonly { mission_id: string; agent_key: string }[],
  agentKey: string = SCOUT_AGENT_KEY,
): "hub" | "research" {
  return agentDestination(missions, leadAssignments, [], agentKey) === "research" ? "research" : "hub";
}
