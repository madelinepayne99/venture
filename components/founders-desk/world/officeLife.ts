import { MARKS, walkable, type Point } from "./layout";

/**
 * Ported from the approved "Living Polish" redesign (Milestone 8
 * integration) — Scout's and Content Bot's itineraries are byte-for-byte
 * unchanged. The five Operations Wing agents (Milestone 7) are new here:
 * each gets a modest, genuine itinerary (its own desk, its own home, and
 * one "visiting a neighbor" stop) using the exact same mechanism — real
 * leisure travel and body avoidance, not a scaled-down imitation of it.
 * Physical leisure, never a statement about work or mission progress.
 * Seconds start on arrival.
 */
export type IdleVisit = { point: Point; facing: number; pause: number; activity: string; seatOffset?: number; gesture?: "rest" | "observe" | "coffee" | "desk" | "lounge" };

export const IDLE_VISITS: Record<string, readonly IdleVisit[]> = {
  scout: [
    { point: { x: -3.593, z: 4.055 }, facing: .32, pause: 22, activity: "Taking a seat", gesture: "lounge", seatOffset: -.88 },
    { point: { x: 1.65, z: 3.6 }, facing: 1.6, pause: 17, activity: "In the lounge" },
    { point: { x: 1.45, z: -2.5 }, facing: Math.PI, pause: 19, activity: "By the window", gesture: "observe" },
    { point: MARKS.research, facing: Math.PI, pause: 12, activity: "At home desk", gesture: "desk" },
    { point: MARKS.hub, facing: .45, pause: 16, activity: "Available" },
  ],
  content_bot: [
    { point: { x: 4.65, z: 2.2 }, facing: Math.PI, pause: 19, activity: "Coffee break", gesture: "coffee" },
    { point: { x: 6.25, z: .6 }, facing: 1.4, pause: 15, activity: "In the studio", gesture: "observe" },
    { point: MARKS.studio, facing: Math.PI, pause: 16, activity: "At home desk", gesture: "desk" },
    { point: { x: -2.197, z: 4.055 }, facing: -.32, pause: 24, activity: "Taking a seat", gesture: "lounge", seatOffset: -.88 },
    { point: MARKS.contentBotHome, facing: .2, pause: 13, activity: "Available" },
  ],
  // --- Operations Wing (Milestone 7/8) --------------------------------
  chief_of_staff: [
    { point: MARKS.command, facing: Math.PI, pause: 14, activity: "At home desk", gesture: "desk" },
    { point: { x: 12.3, z: -1.9 }, facing: 1.4, pause: 11, activity: "Checking in with the team", gesture: "observe" },
    { point: MARKS.chiefOfStaffHome, facing: 0, pause: 15, activity: "Available" },
  ],
  executive_assistant: [
    { point: MARKS.admin, facing: Math.PI, pause: 14, activity: "At home desk", gesture: "desk" },
    { point: { x: 13.6, z: -1.9 }, facing: 1.4, pause: 11, activity: "Checking in with the team", gesture: "observe" },
    { point: MARKS.executiveAssistantHome, facing: 0, pause: 15, activity: "Available" },
  ],
  finance_agent: [
    { point: MARKS.ledger, facing: Math.PI, pause: 14, activity: "At home desk", gesture: "desk" },
    { point: { x: 14.9, z: -1.9 }, facing: 1.4, pause: 11, activity: "Checking in with the team", gesture: "observe" },
    { point: MARKS.financeAgentHome, facing: 0, pause: 15, activity: "Available" },
  ],
  business_analyst: [
    { point: MARKS.intel, facing: Math.PI, pause: 14, activity: "At home desk", gesture: "desk" },
    { point: { x: 16.2, z: -1.9 }, facing: 1.4, pause: 11, activity: "Checking in with the team", gesture: "observe" },
    { point: MARKS.businessAnalystHome, facing: 0, pause: 15, activity: "Available" },
  ],
  operations_agent: [
    { point: MARKS.process, facing: Math.PI, pause: 14, activity: "At home desk", gesture: "desk" },
    { point: { x: 12.0, z: -1.9 }, facing: -1.6, pause: 11, activity: "Checking in with the team", gesture: "observe" },
    { point: MARKS.operationsAgentHome, facing: 0, pause: 15, activity: "Available" },
  ],
};

export function nextVisit(key: string, tick: number, occupied: readonly Point[]): IdleVisit | undefined {
  const visits = IDLE_VISITS[key] ?? [];
  for (let i = 0; i < visits.length; i++) {
    const visit = visits[(tick + i) % visits.length]!;
    if (walkable(visit.point) && occupied.every(p => Math.hypot(p.x - visit.point.x, p.z - visit.point.z) > .9)) return visit;
  }
}

/** Stop before bodies overlap. Routing around a stopped peer is handled at a bounded cadence. */
export function safeStep(from: Point, to: Point, peers: readonly Point[], distance: number): Point | null {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const t = length ? Math.min(1, distance / length) : 1;
  const next = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
  if (peers.some(p => Math.hypot(p.x - next.x, p.z - next.z) < .73 && Math.hypot(p.x - next.x, p.z - next.z) < Math.hypot(p.x - from.x, p.z - from.z))) return null;
  return next;
}
