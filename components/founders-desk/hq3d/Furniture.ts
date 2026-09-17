import * as THREE from "three";
import { FOUNDERS_DESK, FURNITURE, OFFICE_PALETTE, type FurniturePiece, type Rect } from "@/lib/domain/officeLayout";

function rectCenter(r: Rect) {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}
function rectSize(r: Rect) {
  return { w: r.x1 - r.x0, d: r.z1 - r.z0 };
}

/**
 * Direct Three.js port of the former R3F `Furniture.tsx` — same
 * per-kind builders, same data source, no `RoundedBox` (a drei helper;
 * plain `BoxGeometry` reads fine at this scale/camera angle).
 */
/**
 * `skipIds` lets a caller (the isometric recomposition scene) omit
 * specific procedural pieces it's replacing with real loaded assets
 * instead, without forking this builder or touching every other piece
 * it still renders procedurally. `skipFoundersChairs` is separate from
 * skipping the `founders_desk` piece itself — the desk's single
 * continuous top and built-in two monitors stay procedural (stretching
 * an imported model to a 3.6m shared desk would distort it), while the
 * two empty placeholder chairs are what a caller replaces with real
 * loaded chair models.
 */
export function buildFurniture(opts: { skipIds?: string[]; skipFoundersChairs?: boolean } = {}): THREE.Group {
  const skip = new Set(opts.skipIds ?? []);
  const group = new THREE.Group();
  group.name = "Furniture";
  for (const piece of FURNITURE) {
    if (skip.has(piece.id)) continue;
    const built = buildPiece(piece);
    built.name = piece.id;
    group.add(built);
  }
  group.add(buildDeskRug());
  if (!opts.skipFoundersChairs) {
    for (const seat of FOUNDERS_DESK.seats) {
      const chair = buildEmptyChair(seat.pos);
      chair.name = `chair_${seat.id}`;
      group.add(chair);
    }
  }
  return group;
}

function buildPiece(piece: FurniturePiece): THREE.Group {
  const c = rectCenter(piece.bounds);
  const s = rectSize(piece.bounds);
  const rotationY = piece.rotationY ?? 0;
  switch (piece.kind) {
    case "desk":
      return buildDesk(c, s, rotationY, 2);
    case "workstation_desk":
      return buildDesk(c, s, rotationY, 1);
    case "board":
      return buildWallBoard(c, s);
    case "shelf":
      return buildShelf(c, s);
    case "planter":
      return buildPlanter(c);
    case "bench":
      return buildBench(c, s, rotationY);
    default:
      return new THREE.Group();
  }
}

function buildDesk(
  center: { x: number; z: number },
  size: { w: number; d: number },
  rotationY: number,
  monitors: number
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  group.rotation.y = rotationY;

  const deskTopY = 0.72;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(size.w, 0.06, size.d),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.walnut, roughness: 0.4 })
  );
  top.position.y = deskTopY;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const banding = new THREE.Mesh(
    new THREE.BoxGeometry(size.w + 0.015, 0.012, size.d + 0.015),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.brass, roughness: 0.3, metalness: 0.7 })
  );
  banding.position.y = deskTopY - 0.031;
  group.add(banding);

  const legMaterial = new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.walnutDark, roughness: 0.5 });
  const legPositions: [number, number][] = [
    [-size.w / 2 + 0.08, -size.d / 2 + 0.08],
    [size.w / 2 - 0.08, -size.d / 2 + 0.08],
    [-size.w / 2 + 0.08, size.d / 2 - 0.08],
    [size.w / 2 - 0.08, size.d / 2 - 0.08],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, deskTopY - 0.06, 0.06), legMaterial);
    leg.position.set(lx, deskTopY / 2 - 0.03, lz);
    leg.castShadow = true;
    group.add(leg);
  }

  for (let i = 0; i < monitors; i++) {
    const spread = monitors > 1 ? size.w * 0.22 : 0;
    const mx = monitors > 1 ? (i === 0 ? -spread : spread) : 0;
    const monitor = new THREE.Group();
    monitor.position.set(mx, deskTopY, -size.d / 2 + 0.14);

    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: "#2B2B2B", roughness: 0.6 })
    );
    stand.position.y = 0.02;
    monitor.add(stand);

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.24, 0.03),
      new THREE.MeshStandardMaterial({ color: "#1D1D1D", roughness: 0.4 })
    );
    bezel.position.y = 0.16;
    bezel.castShadow = true;
    monitor.add(bezel);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.2, 0.005),
      new THREE.MeshStandardMaterial({
        color: "#2E5C4E",
        emissive: "#1B4A3D",
        emissiveIntensity: 0.4,
        roughness: 0.3,
      })
    );
    screen.position.set(0, 0.16, 0.017);
    monitor.add(screen);

    group.add(monitor);
  }

  // Small brass desk lamp
  const lamp = new THREE.Group();
  lamp.position.set(size.w / 2 - 0.2, deskTopY, size.d / 2 - 0.15);
  const brassMat = new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.brass, metalness: 0.7, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 12), brassMat);
  lamp.add(base);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), brassMat);
  arm.position.y = 0.14;
  lamp.add(arm);
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.09, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: OFFICE_PALETTE.brassLight,
      metalness: 0.5,
      roughness: 0.35,
      side: THREE.DoubleSide,
    })
  );
  shade.position.set(0.05, 0.27, 0);
  shade.rotation.z = -0.5;
  lamp.add(shade);
  group.add(lamp);

  return group;
}

function buildWallBoard(center: { x: number; z: number }, size: { w: number; d: number }): THREE.Group {
  const group = new THREE.Group();
  const boardH = 0.9;
  const boardY = 1.1;
  group.position.set(center.x, boardY, center.z);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(size.w, boardH, 0.03),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.brass, roughness: 0.35, metalness: 0.55 })
  );
  frame.castShadow = true;
  group.add(frame);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(size.w - 0.08, boardH - 0.08, 0.006),
    new THREE.MeshStandardMaterial({ color: "#F8F3E6", roughness: 0.85 })
  );
  panel.position.z = 0.018;
  group.add(panel);

  return group;
}

function buildShelf(center: { x: number; z: number }, size: { w: number; d: number }): THREE.Group {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  const unitH = 1.35;

  const carcass = new THREE.Mesh(
    new THREE.BoxGeometry(size.w, unitH, size.d),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.walnut, roughness: 0.45 })
  );
  carcass.position.y = unitH / 2;
  carcass.castShadow = true;
  carcass.receiveShadow = true;
  group.add(carcass);

  const bookColors = [OFFICE_PALETTE.emerald, OFFICE_PALETTE.brass, "#8A6A2E", OFFICE_PALETTE.emeraldDark];
  for (const y of [0.42, 0.78, 1.14]) {
    for (let i = 0; i < 4; i++) {
      const bx = -size.w / 2 + 0.2 + (i * (size.w - 0.4)) / 3;
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.09, 0.09),
        new THREE.MeshStandardMaterial({ color: bookColors[i % 4], roughness: 0.7 })
      );
      book.position.set(bx, y + 0.04, size.d / 2 - 0.02);
      group.add(book);
    }
  }

  return group;
}

function buildPlanter(center: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.16, 0.36, 16),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.walnut, roughness: 0.5 })
  );
  pot.position.y = 0.18;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.015, 8, 24),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.brass, metalness: 0.6, roughness: 0.3 })
  );
  rim.position.y = 0.37;
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  const frondMaterial = new THREE.MeshStandardMaterial({ color: "#4C7A45", roughness: 0.85 });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 6), frondMaterial);
    frond.position.set(Math.cos(angle) * 0.05, 0.62, Math.sin(angle) * 0.05);
    frond.rotation.set(0.5, angle, 0);
    frond.castShadow = true;
    group.add(frond);
  }

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.025, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: "#3B5E34", roughness: 0.8 })
  );
  trunk.position.y = 0.42;
  group.add(trunk);

  return group;
}

function buildBench(
  center: { x: number; z: number },
  size: { w: number; d: number },
  rotationY: number
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  group.rotation.y = rotationY;

  const seatBox = new THREE.Mesh(
    new THREE.BoxGeometry(size.w, 0.42, size.d),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.walnut, roughness: 0.45 })
  );
  seatBox.position.y = 0.21;
  seatBox.castShadow = true;
  seatBox.receiveShadow = true;
  group.add(seatBox);

  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(size.w - 0.06, 0.06, size.d - 0.06),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.emerald, roughness: 0.6 })
  );
  cushion.position.y = 0.44;
  group.add(cushion);

  return group;
}

function buildDeskRug(): THREE.Mesh {
  // Sized to the new, smaller founders' office (5m wide) — the old 4.6m
  // rug was tuned for a 17m-strip-era 4m desk and would nearly touch
  // both side walls here.
  const c = { x: FOUNDERS_DESK.anchor.x, z: FOUNDERS_DESK.anchor.z + 0.7 };
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 2.2),
    new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.rugAccent, roughness: 0.95 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(c.x, 0.006, c.z);
  return rug;
}

/**
 * An empty, ready-to-sit chair — real furniture, not a placeholder
 * figure. No founder sits here yet; see the implementation plan's
 * confirmed asset-gap call (no approved Ellis/Maddie reference art
 * exists, so no figure is invented to fill the seat).
 */
function buildEmptyChair(center: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);

  const brassMat = new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.brass, metalness: 0.6, roughness: 0.35 });
  const emeraldMat = new THREE.MeshStandardMaterial({ color: OFFICE_PALETTE.emerald, roughness: 0.55 });

  const centerLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 8), brassMat);
  centerLeg.position.y = 0.23;
  group.add(centerLeg);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.38), emeraldMat);
  seat.position.y = 0.46;
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.06), emeraldMat);
  back.position.set(0, 0.68, -0.16);
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);

  const legPositions: [number, number][] = [
    [-0.16, -0.16],
    [0.16, -0.16],
    [-0.16, 0.16],
    [0.16, 0.16],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.46, 6), brassMat);
    leg.position.set(lx, 0.23, lz);
    group.add(leg);
  }

  return group;
}
