import * as THREE from "three";
import { OFFICE_PALETTE, ROOMS, WALLS, type Rect } from "@/lib/domain/officeLayout";

const WALL_HEIGHT = 1.6;
const FLOOR_Y = 0;

function rectCenter(r: Rect) {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}
function rectSize(r: Rect) {
  return { w: r.x1 - r.x0, d: r.z1 - r.z0 };
}

/**
 * Direct Three.js port of the former R3F `RoomGeometry.tsx` — same
 * geometry, same data source (`officeLayout.ts`), built imperatively
 * instead of declared as JSX. Walls/floor/doorway gaps come straight
 * from `WALLS` (doorway gaps already exist because `WALLS` simply omits
 * wall segments across each doorway span).
 *
 * `hiddenWallIds` skips specific wall segments at render time — the
 * fixed isometric camera looks from a consistent direction, so whichever
 * perimeter walls face it almost head-on (see `officeLayout.ts`'s
 * `perimeter_south`/`perimeter_east` comment) would otherwise block the
 * interior from view. The wall data itself is untouched; this is a
 * render-time omission, not a layout change.
 */
export function buildRoomGeometry(opts: { hiddenWallIds?: string[] } = {}): THREE.Group {
  const hidden = new Set(opts.hiddenWallIds ?? []);
  const group = new THREE.Group();
  group.name = "RoomGeometry";

  const buildingMinX = Math.min(...ROOMS.map((r) => r.bounds.x0));
  const buildingMaxX = Math.max(...ROOMS.map((r) => r.bounds.x1));
  const buildingMinZ = Math.min(...ROOMS.map((r) => r.bounds.z0));
  const buildingMaxZ = Math.max(...ROOMS.map((r) => r.bounds.z1));
  const buildingW = buildingMaxX - buildingMinX;
  const buildingD = buildingMaxZ - buildingMinZ;
  const buildingCx = (buildingMinX + buildingMaxX) / 2;
  const buildingCz = (buildingMinZ + buildingMaxZ) / 2;

  // Exterior ground — a modest margin around the building's own footprint
  // rather than a fixed +26, which dwarfed the old 17-wide building and
  // would look even more disproportionate around this compact ~10x9 one.
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(buildingW + 6, buildingD + 6),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.exteriorGrass, roughness: 1 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(buildingCx, -0.03, buildingCz);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  group.add(buildExteriorPlanting(buildingMinX, buildingMaxX, buildingMinZ, buildingMaxZ));

  // Interior floor
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(buildingW, buildingD),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.marbleFloor, roughness: 0.35, metalness: 0.05 })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(buildingCx, FLOOR_Y, buildingCz);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Circulation accent runner
  const circulationRoom = ROOMS.find((r) => r.id === "circulation");
  if (circulationRoom) {
    const c = rectCenter(circulationRoom.bounds);
    const s = rectSize(circulationRoom.bounds);
    const runner = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w, s.d * 0.7),
      new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.rugAccent, roughness: 0.9 })
    );
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(c.x, FLOOR_Y + 0.005, c.z);
    group.add(runner);
  }

  // Walls + brass trim caps
  const wallMaterial = new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.wall, roughness: 0.7 });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: OFFICE_PALETTE.wallTrim,
    roughness: 0.3,
    metalness: 0.6,
  });
  for (const wall of WALLS) {
    if (hidden.has(wall.id)) continue;
    const c = rectCenter(wall.bounds);
    const s = rectSize(wall.bounds);
    const w = Math.max(s.w, 0.01);
    const d = Math.max(s.d, 0.01);

    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMaterial);
    wallMesh.position.set(c.x, WALL_HEIGHT / 2, c.z);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    group.add(wallMesh);

    const trimMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.02), trimMaterial);
    trimMesh.position.set(c.x, WALL_HEIGHT + 0.02, c.z);
    group.add(trimMesh);
  }

  return group;
}

function buildExteriorPlanting(minX: number, maxX: number, minZ: number, maxZ: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "ExteriorPlanting";
  const bushes: Array<[number, number]> = [
    [minX - 1.4, minZ + 1],
    [minX - 1.4, maxZ - 1],
    [maxX + 1.4, minZ + 1],
    [maxX + 1.4, maxZ - 1],
    [(minX + maxX) / 2, maxZ + 1.6],
  ];
  const lowerMaterial = new THREE.MeshStandardMaterial({ color: "#4C7A45", roughness: 0.9 });
  const upperMaterial = new THREE.MeshStandardMaterial({ color: "#5C8B52", roughness: 0.9 });
  for (const [x, z] of bushes) {
    const bush = new THREE.Group();
    bush.position.set(x, 0, z);
    const lower = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), lowerMaterial);
    lower.position.y = 0.22;
    lower.castShadow = true;
    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), upperMaterial);
    upper.position.y = 0.4;
    upper.castShadow = true;
    bush.add(lower, upper);
    group.add(bush);
  }
  return group;
}
