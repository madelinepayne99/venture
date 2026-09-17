import { Assets, Container, Sprite, type Texture } from "pixi.js";

/**
 * Scout's jointed rig — a direct port of the approved reference jointed-
 * motion prototype's canvas math (Scout-Motion-Preview.html, supplied by
 * the founders) into a persistent Pixi Container hierarchy. Every numeric
 * offset, pivot, and rotation formula below is copied unchanged from that
 * prototype's `piece`/`joint`/`leg`/`arm`/`scout` functions — this file
 * does not invent a new pose or gait, it only re-hosts the approved one
 * inside Pixi's retained scene graph instead of rebuilding draw calls
 * every frame on a 2D canvas.
 *
 * No mirroring anywhere: the left and right limbs are genuinely separate
 * cutout pieces (thighL/footL/upperL/handL vs thighR/footR/upperR/handR),
 * driven by phase-shifted rotation of the *same* pieces used for walking
 * in either screen direction — never a flipped copy standing in for an
 * opposite-facing pose. Known limitation, carried over honestly from the
 * source prototype's own README: this is a single camera view. Walking
 * right-to-left uses the identical gait as left-to-right, just translated
 * the other way — Scout does not turn to visually face the direction of
 * travel, because the supplied artwork has no profile/opposite-facing
 * view to turn into.
 */

export const SCOUT_PART_NAMES = [
  "head",
  "body",
  "bag",
  "upperL",
  "handL",
  "upperR",
  "handR",
  "thighL",
  "footL",
  "thighR",
  "footR",
] as const;

export type ScoutPartName = (typeof SCOUT_PART_NAMES)[number];
export type ScoutTextures = Record<ScoutPartName, Texture>;

const SCOUT_PART_URL: Record<ScoutPartName, string> = {
  head: "/hq-scene/scout/head.png",
  body: "/hq-scene/scout/body.png",
  bag: "/hq-scene/scout/bag.png",
  upperL: "/hq-scene/scout/upperL.png",
  handL: "/hq-scene/scout/handL.png",
  upperR: "/hq-scene/scout/upperR.png",
  handR: "/hq-scene/scout/handR.png",
  thighL: "/hq-scene/scout/thighL.png",
  footL: "/hq-scene/scout/footL.png",
  thighR: "/hq-scene/scout/thighR.png",
  footR: "/hq-scene/scout/footR.png",
};

export async function loadScoutTextures(): Promise<ScoutTextures> {
  const loaded = await Promise.all(
    SCOUT_PART_NAMES.map(async (name) => [name, await Assets.load(SCOUT_PART_URL[name])] as const)
  );
  return Object.fromEntries(loaded) as ScoutTextures;
}

function piece(parent: Container, texture: Texture, x: number, y: number, w: number, h: number): void {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0, 0);
  sprite.position.set(x, y);
  sprite.width = w;
  sprite.height = h;
  parent.addChild(sprite);
}

function joint(parent: Container, x: number, y: number): Container {
  const container = new Container();
  container.position.set(x, y);
  parent.addChild(container);
  return container;
}

interface LimbJoints {
  hipOrShoulder: Container;
  ankleOrWrist: Container;
}

export interface ScoutRig {
  /** Position/scale this — walking translation and any external placement happens here. */
  placement: Container;
  /** Recomputes every joint rotation and the idle/walk bob for phase `p`. */
  update(p: number, moving: boolean): void;
}

export function buildScoutRig(textures: ScoutTextures): ScoutRig {
  const placement = new Container();
  // Everything below lives inside a 0.98-scaled body group, exactly as the
  // prototype's `ctx.scale(.98,.98)` scales everything drawn after it
  // (including its own bob translate) but not the outer x/y placement.
  const bodyScale = new Container();
  bodyScale.scale.set(0.98, 0.98);
  placement.addChild(bodyScale);
  const bobGroup = new Container();
  bodyScale.addChild(bobGroup);

  function buildLeg(side: -1 | 1): LimbJoints {
    const hip = joint(bobGroup, side * 43, 133);
    piece(hip, textures[side < 0 ? "thighL" : "thighR"], -28, -9, 58, 69);
    const ankle = joint(hip, 0, 47);
    piece(ankle, textures[side < 0 ? "footL" : "footR"], -27, -8, 76, 70);
    return { hipOrShoulder: hip, ankleOrWrist: ankle };
  }

  function buildArm(side: -1 | 1): LimbJoints {
    const shoulder = joint(bobGroup, side * 78, 23);
    piece(shoulder, textures[side < 0 ? "upperL" : "upperR"], -20, -13, 44, 71);
    const wrist = joint(shoulder, 0, 45);
    piece(wrist, textures[side < 0 ? "handL" : "handR"], -22, -11, 48, 69);
    return { hipOrShoulder: shoulder, ankleOrWrist: wrist };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);
  const armL = buildArm(-1);
  const armR = buildArm(1);

  const headJoint = joint(bobGroup, 0, 3);
  piece(headJoint, textures.head, -123, -181, 264, 200);

  // Body drawn after limbs/head so it covers the shoulder/hip seams,
  // exactly matching the prototype's draw order.
  piece(bobGroup, textures.body, -90, -12, 180, 174);

  // Bag — always the same side, drawn last (on top of the body).
  const bagJoint = joint(bobGroup, 46, 82);
  piece(bagJoint, textures.bag, -9, -25, 91, 90);

  function setLeg(limb: LimbJoints, p: number) {
    const swing = 0.3 * Math.sin(p);
    const bend = 0.15 + 0.32 * Math.max(0, Math.cos(p));
    limb.hipOrShoulder.rotation = swing;
    limb.ankleOrWrist.rotation = -bend;
  }

  function setArm(limb: LimbJoints, side: -1 | 1, p: number) {
    limb.hipOrShoulder.rotation = 0.19 * Math.sin(p) + side * -0.06;
    limb.ankleOrWrist.rotation = side * -0.12;
  }

  function update(p: number, moving: boolean) {
    const bob = moving ? -3 * Math.cos(2 * p) : 1.4 * Math.sin(p);
    bobGroup.position.set(0, bob);

    setLeg(legL, moving ? p : 0);
    setLeg(legR, moving ? p + Math.PI : 0);
    setArm(armL, -1, moving ? p + Math.PI : 0);
    setArm(armR, 1, moving ? p : 0);

    headJoint.rotation = moving ? 0.006 * Math.sin(p) : 0.003 * Math.sin(p);
    bagJoint.rotation = moving ? 0.025 * Math.sin(p + 0.5) : 0;
  }

  // Resting pose on first paint, before any update() call.
  update(0, false);

  return { placement, update };
}
