import * as THREE from "three";

/**
 * Direct Three.js port of the former R3F `ScoutCharacter.tsx` — same
 * model, built against the same approved 2D reference
 * (`public/hq-scene/scout/{head,body,bag,footL,handL,...}.png`): wide
 * flattened-oval head, two large brass-rimmed emerald eyes with a
 * highlight dot, brass ear studs, a bulbous ivory body, a green
 * waistcoat with a diagonal brass-buckled strap and rivet buttons,
 * brass ball joints at both shoulders and hips with a dark socket under
 * each, ivory limb capsules, mitt-like hands with small dark "finger"
 * balls, ivory-and-green ankle boots, and a green satchel with a brass
 * stud — hung on the character's right side and never mirrored to the
 * left.
 *
 * Every joint lives in its own named `THREE.Group` (head, armL/armR,
 * legL/legR, the satchel) even though Stage A only ever poses them
 * statically — Stage B's walk-animation logic rotates these exact same
 * groups rather than rebuilding the rig.
 */

const SCOUT_COLOR = {
  ivory: "#F1E6D2",
  brass: "#C79A3E",
  eyeWhite: "#F7F4EC",
  eyeGreen: "#189A5C",
  eyeGreenDark: "#0E6A3F",
  vestGreen: "#1F7A4C",
  vestGreenDark: "#155C39",
  socketDark: "#23262C",
  bagGreen: "#1D6B45",
} as const;

export interface ScoutJoints {
  root: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  bag: THREE.Group;
}

function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...opts });
}

function buildEye(side: -1 | 1): THREE.Group {
  const group = new THREE.Group();
  group.position.set(side * 0.095, 0, 0.155);
  group.rotation.y = side * -0.35;

  const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.052, 20, 16), mat(SCOUT_COLOR.eyeWhite, { roughness: 0.3 }));
  group.add(sclera);

  const iris = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 16, 14),
    mat(SCOUT_COLOR.eyeGreen, {
      emissive: new THREE.Color(SCOUT_COLOR.eyeGreenDark),
      emissiveIntensity: 0.25,
      roughness: 0.2,
    })
  );
  iris.position.z = 0.03;
  group.add(iris);

  const highlight = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), mat("#FFFFFF", { roughness: 0.1 }));
  highlight.position.set(-0.012, 0.014, 0.055);
  group.add(highlight);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.004, 8, 24),
    mat(SCOUT_COLOR.socketDark, { roughness: 0.5 })
  );
  innerRing.position.z = 0.02;
  group.add(innerRing);

  const brassRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.058, 0.014, 10, 26),
    mat(SCOUT_COLOR.brass, { metalness: 0.65, roughness: 0.3 })
  );
  brassRing.position.z = 0.008;
  group.add(brassRing);

  return group;
}

function buildHead(): THREE.Group {
  const headJoint = new THREE.Group();
  headJoint.name = "ScoutHead";
  headJoint.position.y = 0.6;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 20), mat(SCOUT_COLOR.ivory));
  skull.scale.set(1.18, 0.86, 1.02);
  skull.castShadow = true;
  headJoint.add(skull);

  headJoint.add(buildEye(-1));
  headJoint.add(buildEye(1));

  const brassMat = mat(SCOUT_COLOR.brass, { metalness: 0.6, roughness: 0.3 });
  for (const side of [-1, 1] as const) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.025, 14), brassMat);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.225, -0.02, 0);
    headJoint.add(ear);
  }

  const neckStub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.06, 16), brassMat);
  neckStub.position.y = -0.19;
  headJoint.add(neckStub);

  return headJoint;
}

function buildArm(side: -1 | 1): THREE.Group {
  const shoulderJoint = new THREE.Group();
  shoulderJoint.name = side < 0 ? "ScoutArmL" : "ScoutArmR";
  shoulderJoint.position.set(side * 0.19, 0.5, 0);

  const brassMat = mat(SCOUT_COLOR.brass, { metalness: 0.55, roughness: 0.35 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 14), brassMat);
  dome.position.y = 0.02;
  dome.castShadow = true;
  shoulderJoint.add(dome);

  const socket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14),
    mat(SCOUT_COLOR.socketDark, { roughness: 0.6 })
  );
  socket.position.y = -0.03;
  shoulderJoint.add(socket);

  const upperArm = new THREE.Group();
  upperArm.position.set(side * 0.02, -0.13, 0.01);
  upperArm.rotation.set(0.12, 0, side * 0.14);
  shoulderJoint.add(upperArm);

  const armCapsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 6, 12), mat(SCOUT_COLOR.ivory));
  armCapsule.castShadow = true;
  upperArm.add(armCapsule);

  const wristRing = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.012, 8, 20), brassMat);
  wristRing.rotation.x = Math.PI / 2;
  wristRing.position.y = -0.09;
  upperArm.add(wristRing);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 12), mat(SCOUT_COLOR.ivory));
  hand.position.y = -0.14;
  hand.castShadow = true;
  upperArm.add(hand);

  const fingerMat = mat(SCOUT_COLOR.socketDark, { roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 3) * Math.PI - Math.PI / 2;
    const finger = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), fingerMat);
    finger.position.set(Math.cos(a) * 0.04, -0.18, Math.sin(a) * 0.03);
    upperArm.add(finger);
  }

  return shoulderJoint;
}

function buildLeg(side: -1 | 1): THREE.Group {
  const hipJoint = new THREE.Group();
  hipJoint.name = side < 0 ? "ScoutLegL" : "ScoutLegR";
  hipJoint.position.set(side * 0.095, 0.22, 0);

  const brassMat = mat(SCOUT_COLOR.brass, { metalness: 0.55, roughness: 0.35 });
  const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), brassMat);
  hipBall.castShadow = true;
  hipJoint.add(hipBall);

  const thigh = new THREE.Group();
  thigh.position.y = -0.1;
  hipJoint.add(thigh);

  const thighCapsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.12, 6, 12), mat(SCOUT_COLOR.ivory));
  thighCapsule.castShadow = true;
  thigh.add(thighCapsule);

  const ankleBall = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 12), mat(SCOUT_COLOR.brass, { metalness: 0.6, roughness: 0.3 }));
  ankleBall.position.y = -0.09;
  thigh.add(ankleBall);

  const foot = new THREE.Group();
  foot.position.set(0, -0.13, 0.015);
  thigh.add(foot);

  const ankleCollar = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 12), mat(SCOUT_COLOR.ivory));
  ankleCollar.castShadow = true;
  foot.add(ankleCollar);

  const sole = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 12), mat(SCOUT_COLOR.vestGreen, { roughness: 0.45 }));
  sole.scale.set(1, 0.7, 1.15);
  sole.position.set(0, -0.025, 0.01);
  sole.castShadow = true;
  sole.receiveShadow = true;
  foot.add(sole);

  const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), brassMat);
  rivet.rotation.z = Math.PI / 2;
  rivet.position.set(side * 0.045, 0, 0);
  foot.add(rivet);

  return hipJoint;
}

function buildSatchel(): THREE.Group {
  const bagJoint = new THREE.Group();
  bagJoint.name = "ScoutBag";
  bagJoint.position.set(0.2, 0.42, 0.02);
  bagJoint.rotation.z = -0.08;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.09, 0.055),
    mat(SCOUT_COLOR.bagGreen, { roughness: 0.55 })
  );
  body.castShadow = true;
  bagJoint.add(body);

  const stud = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.017, 0.012, 14),
    mat(SCOUT_COLOR.brass, { metalness: 0.6, roughness: 0.3 })
  );
  stud.position.set(0, 0.005, 0.03);
  bagJoint.add(stud);

  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.025, 0.02),
    mat(SCOUT_COLOR.vestGreenDark, { roughness: 0.6 })
  );
  strap.position.set(-0.16, 0.16, -0.01);
  strap.rotation.z = 0.95;
  bagJoint.add(strap);

  return bagJoint;
}

function buildBody(): THREE.Group {
  const group = new THREE.Group();
  group.position.y = 0.4;

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 20), mat(SCOUT_COLOR.ivory));
  torso.scale.set(1, 1.08, 0.98);
  torso.castShadow = true;
  torso.receiveShadow = true;
  group.add(torso);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.018, 10, 24),
    mat(SCOUT_COLOR.brass, { metalness: 0.6, roughness: 0.3 })
  );
  collar.position.y = 0.17;
  group.add(collar);

  const vest = new THREE.Mesh(
    new THREE.CylinderGeometry(0.195, 0.195, 0.24, 24, 1, true, Math.PI * 0.28, Math.PI * 1.44),
    mat(SCOUT_COLOR.vestGreen, { roughness: 0.5, side: THREE.DoubleSide })
  );
  vest.position.y = -0.03;
  vest.rotation.y = Math.PI;
  group.add(vest);

  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.32, 0.012),
    mat(SCOUT_COLOR.vestGreenDark, { roughness: 0.55 })
  );
  strap.position.set(0, -0.02, 0.16);
  strap.rotation.z = 0.55;
  group.add(strap);

  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.035, 0.012),
    mat(SCOUT_COLOR.brass, { metalness: 0.6, roughness: 0.3 })
  );
  buckle.position.set(0.02, -0.02, 0.192);
  group.add(buckle);

  const buttonMat = mat(SCOUT_COLOR.brass, { metalness: 0.6, roughness: 0.3 });
  const buttonYs = [0.07, -0.01, -0.09];
  buttonYs.forEach((y, i) => {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), buttonMat);
    button.position.set(-0.06, y, 0.185 - i * 0.01);
    group.add(button);
  });

  return group;
}

/** Builds the whole rig, statically posed. Returns the root plus every joint group for Stage B's animation to drive. */
export function buildScoutCharacter(): ScoutJoints {
  const root = new THREE.Group();
  root.name = "Scout";

  const body = buildBody();
  const head = buildHead();
  const armL = buildArm(-1);
  const armR = buildArm(1);
  const legL = buildLeg(-1);
  const legR = buildLeg(1);
  const bag = buildSatchel();

  root.add(body, head, armL, armR, legL, legR, bag);

  return { root, head, armL, armR, legL, legR, bag };
}
