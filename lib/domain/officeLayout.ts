/**
 * Pure, framework-free data for the 3D office prototype — no Three.js
 * import, so it's unit-testable under plain Vitest the same way
 * `scoutLocation.ts` is. Every rectangle here is an axis-aligned
 * min/max box in floor-plan units (roughly meters); `x` runs left→right,
 * `z` runs "into the screen" under the isometric camera, `y` is up.
 *
 * This file is the single source of truth for the office's shape —
 * rooms, walls, doorway gaps, furniture footprints, the walkable
 * waypoint graph, and each real agent's workspace anchor. The rendering
 * layer (`components/founders-desk/hq3d/*`) only reads this data; it
 * never invents its own positions.
 *
 * Footprint: a compact, roughly square ~10x9m building (replacing an
 * earlier 17x6 strip that read as an empty corridor rather than a real
 * office) — founders' office on the left half, Scout's research office
 * at the rear-right, a small shared/reception area at the front-right,
 * connected by two real doorways with short walking routes between all
 * three rooms.
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Room {
  id: "founders_office" | "circulation" | "scouts_office";
  label: string;
  bounds: Rect;
}

export interface WallSegment {
  id: string;
  bounds: Rect;
}

export type FurnitureKind =
  | "desk"
  | "shelf"
  | "board"
  | "planter"
  | "bench"
  | "workstation_desk";

export interface FurniturePiece {
  id: string;
  kind: FurnitureKind;
  room: Room["id"];
  bounds: Rect;
  /** Rotation around Y in radians, 0 = footprint's long axis along X. */
  rotationY?: number;
}

export interface NavNode {
  id: string;
  x: number;
  z: number;
}

export interface NavGraph {
  nodes: NavNode[];
  /** Undirected edges, each entry a pair of node ids. */
  edges: [string, string][];
}

/**
 * A doorway pierces one wall. `axis: "x"` means a wall running along Z
 * at a fixed X (the gap spans a Z range); `axis: "z"` means a wall
 * running along X at a fixed Z (the gap spans an X range) — this
 * building has one of each (the founders↔circulation wall is vertical
 * in plan, the circulation↔scout wall is horizontal), which the old
 * single-strip layout never needed to distinguish since every doorway
 * there pierced the same kind of wall.
 */
export interface Doorway {
  id: string;
  axis: "x" | "z";
  /** The fixed coordinate of the wall the doorway pierces. */
  at: number;
  gap0: number;
  gap1: number;
}

/**
 * Anchors are geometry — real desk/seat/workstation positions — not
 * placeholder data. Nothing is rendered *at* the founders' seat anchors
 * yet (see CLAUDE.md/the implementation plan: no founder figures exist
 * until approved Ellis/Maddie reference art does), but the seats and
 * desk themselves are real furniture in the scene.
 */
export interface AgentWorkspace {
  /** Matches `agents.key` in the real schema (e.g. "scout"). */
  agentKey: string;
  room: Room["id"];
  /** Where the agent stands when actively at their workstation. */
  deskAnchor: { x: number; z: number };
  /** Where the agent stands when approaching/idling near the founders' desk. */
  approachAnchor: { x: number; z: number };
  /** The nav-graph node closest to this agent's own workstation. */
  deskNodeId: string;
}

export const CHARACTER_RADIUS = 0.35;
const WALL_THICKNESS = 0.2;

export const ROOMS: Room[] = [
  { id: "founders_office", label: "Founders' Office", bounds: { x0: 0, z0: 0, x1: 5, z1: 9 } },
  { id: "scouts_office", label: "Scout's Research Office", bounds: { x0: 5, z0: 0, x1: 10, z1: 4.5 } },
  { id: "circulation", label: "Reception", bounds: { x0: 5, z0: 4.5, x1: 10, z1: 9 } },
];

const BUILDING = { x0: 0, z0: 0, x1: 10, z1: 9 };

// Founders' office <-> reception: a vertical wall at x=5, gap in Z,
// positioned within reception's depth (4.5-9) so the route from the
// founders' desk crosses cleanly into the shared area.
const DOOR_A_AT = 5;
const DOOR_A_Z0 = 5.5;
const DOOR_A_Z1 = 7;

// Reception <-> Scout's office: a horizontal wall at z=4.5, gap in X,
// positioned within the shared x-range (5-10) of both rooms.
const DOOR_B_AT = 4.5;
const DOOR_B_X0 = 7;
const DOOR_B_X1 = 8.5;

export const DOORWAYS: Doorway[] = [
  { id: "founders_to_circulation", axis: "x", at: DOOR_A_AT, gap0: DOOR_A_Z0, gap1: DOOR_A_Z1 },
  { id: "circulation_to_scout", axis: "z", at: DOOR_B_AT, gap0: DOOR_B_X0, gap1: DOOR_B_X1 },
];

/**
 * Perimeter + the two interior dividing walls, each dividing wall split
 * into two segments around its doorway gap. No exterior door — the
 * building is a fully enclosed, roofless footprint viewed from above.
 * `perimeter_south` and `perimeter_east` face the fixed isometric
 * camera almost head-on and are hidden at render time
 * (`RoomGeometry.ts`'s `hiddenWallIds`) so the interior stays readable —
 * they still exist here as real geometry/collision-adjacent data, only
 * the render skips them.
 */
export const WALLS: WallSegment[] = [
  { id: "perimeter_north", bounds: { x0: BUILDING.x0, z0: -WALL_THICKNESS / 2, x1: BUILDING.x1, z1: WALL_THICKNESS / 2 } },
  { id: "perimeter_south", bounds: { x0: BUILDING.x0, z0: BUILDING.z1 - WALL_THICKNESS / 2, x1: BUILDING.x1, z1: BUILDING.z1 + WALL_THICKNESS / 2 } },
  { id: "perimeter_west", bounds: { x0: -WALL_THICKNESS / 2, z0: BUILDING.z0, x1: WALL_THICKNESS / 2, z1: BUILDING.z1 } },
  { id: "perimeter_east", bounds: { x0: BUILDING.x1 - WALL_THICKNESS / 2, z0: BUILDING.z0, x1: BUILDING.x1 + WALL_THICKNESS / 2, z1: BUILDING.z1 } },
  { id: "divider_a_north", bounds: { x0: DOOR_A_AT - WALL_THICKNESS / 2, z0: BUILDING.z0, x1: DOOR_A_AT + WALL_THICKNESS / 2, z1: DOOR_A_Z0 } },
  { id: "divider_a_south", bounds: { x0: DOOR_A_AT - WALL_THICKNESS / 2, z0: DOOR_A_Z1, x1: DOOR_A_AT + WALL_THICKNESS / 2, z1: BUILDING.z1 } },
  { id: "divider_b_west", bounds: { x0: 5, z0: DOOR_B_AT - WALL_THICKNESS / 2, x1: DOOR_B_X0, z1: DOOR_B_AT + WALL_THICKNESS / 2 } },
  { id: "divider_b_east", bounds: { x0: DOOR_B_X1, z0: DOOR_B_AT - WALL_THICKNESS / 2, x1: BUILDING.x1, z1: DOOR_B_AT + WALL_THICKNESS / 2 } },
];

export const FURNITURE: FurniturePiece[] = [
  // Founders' office — one continuous shared desk (see FOUNDERS_DESK for
  // seat anchors), a wall-mounted mission board behind it, a planter
  // tucked out of the walking route.
  { id: "founders_desk", kind: "desk", room: "founders_office", bounds: { x0: 0.9, z0: 1.2, x1: 4.5, z1: 2.4 } },
  { id: "mission_board", kind: "board", room: "founders_office", bounds: { x0: 1.7, z0: -0.05, x1: 3.7, z1: 0.1 } },
  { id: "founders_planter", kind: "planter", room: "founders_office", bounds: { x0: 0.3, z0: 7.8, x1: 0.9, z1: 8.4 } },
  // Reception / shared area
  { id: "reception_bench", kind: "bench", room: "circulation", bounds: { x0: 8.3, z0: 7.5, x1: 9.1, z1: 8.3 } },
  // Scout's office — one desk (his own single-person workspace, visibly
  // smaller than the founders' shared desk), evidence board on the back
  // wall behind him, a shelf, a planter.
  { id: "scout_workstation", kind: "workstation_desk", room: "scouts_office", bounds: { x0: 6.2, z0: 0.6, x1: 8.3, z1: 1.8 } },
  { id: "scout_evidence_board", kind: "board", room: "scouts_office", bounds: { x0: 6.4, z0: -0.05, x1: 8.1, z1: 0.1 } },
  { id: "scout_shelf", kind: "shelf", room: "scouts_office", bounds: { x0: 8.7, z0: 0.1, x1: 9.7, z1: 0.6 } },
  { id: "scout_planter", kind: "planter", room: "scouts_office", bounds: { x0: 9.3, z0: 3.6, x1: 9.9, z1: 4.2 } },
];

export const FOUNDERS_DESK = {
  anchor: { x: 2.7, z: 1.8 },
  seats: [
    { id: "ellis", pos: { x: 1.7, z: 3.15 } },
    { id: "maddie", pos: { x: 3.7, z: 3.15 } },
  ],
  approachNodeId: "founders_desk_front",
};

export const NAV_GRAPH: NavGraph = {
  nodes: [
    { id: "founders_desk_front", x: 2.7, z: 4.5 },
    { id: "founders_doorway", x: 5, z: 6.25 },
    { id: "corridor_mid", x: 7.75, z: 6 },
    { id: "scout_doorway", x: 7.75, z: 4.5 },
    { id: "scout_desk_front", x: 7.25, z: 2.8 },
  ],
  edges: [
    ["founders_desk_front", "founders_doorway"],
    ["founders_doorway", "corridor_mid"],
    ["corridor_mid", "scout_doorway"],
    ["scout_doorway", "scout_desk_front"],
  ],
};

export const AGENT_WORKSPACES: AgentWorkspace[] = [
  {
    agentKey: "scout",
    room: "scouts_office",
    deskAnchor: { x: 7.25, z: 2.3 },
    approachAnchor: { x: 2.7, z: 4.5 },
    deskNodeId: "scout_desk_front",
  },
];

/**
 * The office scene's own palette — scoped to this prototype only, the
 * same way Milestone 4.2's `night.*` Tailwind tokens were scoped only
 * to the old office scene rather than folded into the app's real
 * `BRAND.md` chrome palette. Three.js materials take raw color values,
 * not Tailwind classes, so this lives as a plain constant rather than a
 * Tailwind token set. Recorded in BRAND.md alongside this file.
 */
export const OFFICE_PALETTE = {
  marbleFloor: "#ECE2CE",
  marbleFloorVein: "#D7C6A2",
  wall: "#F5EFE3",
  wallTrim: "#C9A24B",
  walnut: "#6B4226",
  walnutDark: "#4A2C18",
  brass: "#C9A24B",
  brassLight: "#E7CC8B",
  emerald: "#115E4C",
  emeraldDark: "#0B3F33",
  rugAccent: "#0E4A3D",
  exteriorGrass: "#7FA65A",
  exteriorPath: "#D9CFBB",
  contactShadow: "#3A2E1F",
} as const;
