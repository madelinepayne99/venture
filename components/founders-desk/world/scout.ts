import * as T from "three";
import { faceGeometry } from "./characterSurfaces";
import { buildScreenFace } from "./screenFace";
import { characterWardrobe } from "./characterWardrobe";
import { ball, box, canvasTexture, cylinder, group, material, type Materials } from "./materials";

export type CharacterLife = { greeting?: boolean; acknowledging?: boolean; lookYaw?: number; seated?: boolean; seatOffset?: number; activity?: "rest" | "observe" | "coffee" | "desk" | "lounge" };

/**
 * Shared animated skeleton with individually tailored, approved character
 * identities — ported from the approved "Living Polish" redesign
 * (Milestone 8 integration; see docs/operations-build-progress.md).
 * `persona` picks the wardrobe silhouette: "detective" is Scout's exact
 * approved fedora/coat/satchel design; "creator" is Content Bot's exact
 * approved jacket/headphones/tablet-pocket design (used verbatim, byte-
 * for-byte unchanged, for Content Bot) and is ALSO reused, in its own
 * accent color and without headphones, for the five Operations Wing
 * agents — a deliberate, honestly-scoped choice: giving each of them a
 * fully bespoke sixth/seventh/... costume was judged not worth the real
 * risk of unverifiable geometry bugs in a sandbox with no way to take a
 * screenshot (see CLAUDE.md's own standing caution on exactly this
 * trade-off for the Content Studio's first iteration). Distinct identity
 * comes from accent color + desk + prop, the same approach already used
 * once for this very rig in Milestone 7, now layered under the approved
 * wardrobe/screen-face system instead of the plain lens-eye rig.
 */
function buildAgentCharacter(
  m: Materials,
  accent: T.Material,
  persona: "detective" | "creator",
  inkColor: string,
  defaultHappy: boolean,
  accentOverride?: { cloth: string; lining: string },
  wearsHeadphones = false,
) {
  const detective = persona === "detective";
  const wardrobe = characterWardrobe(m, accent, detective, accentOverride);
  const { cloth: fabric, dark: shoe } = wardrobe;
  const root = new T.Group();
  const shadowTexture = canvasTexture((c, s) => {
    const gradient = c.createRadialGradient(s / 2, s / 2, s * .08, s / 2, s / 2, s * .5);
    gradient.addColorStop(0, 'rgba(29,34,28,.24)'); gradient.addColorStop(.55, 'rgba(29,34,28,.12)'); gradient.addColorStop(1, 'rgba(29,34,28,0)');
    c.fillStyle = gradient; c.fillRect(0, 0, s, s);
  }, 128);
  const contactShadow = new T.Mesh(new T.PlaneGeometry(.80, .63), new T.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }));
  contactShadow.name = 'agent-contact-shadow'; contactShadow.rotation.x = -Math.PI / 2; contactShadow.position.y = .022; root.add(contactShadow);
  const body = group(root, 0, 0, 0);
  body.name = "body";
  const hip = group(body, 0, .29, 0);
  ball(hip, .223, 0, .19, 0, m.ivory, [1, 1, .79]);
  ball(hip, .229, 0, .23, 0, fabric, [1, .82, .82]);
  wardrobe.dress(hip);
  cylinder(body, .097, .11, .065, 0, .73, 0, m.brass);
  const head = group(body, 0, .947, 0); head.name = "head";
  const face = new T.Mesh(faceGeometry(), m.ivory); face.castShadow = face.receiveShadow = true; head.add(face);
  const { eyes, expression } = buildScreenFace(head, inkColor, defaultHappy);
  for (const side of [-1, 1]) {
    cylinder(head, .090, .090, .023, side * .355, -.014, -.014, m.brass, 32).rotation.z = Math.PI / 2;
    cylinder(head, .064, .064, .008, side * .37, -.014, -.014, m.brass, 32).rotation.z = Math.PI / 2;
  }
  if (detective) wardrobe.hat(head); else if (wearsHeadphones) wardrobe.headphones(body);
  const arms: T.Group[] = [], forearms: T.Group[] = [], legs: T.Group[] = [], knees: T.Group[] = [];
  for (const side of [-1, 1]) {
    const a = group(body, side * .267, .657, .015); a.name = "arm"; arms.push(a);
    cylinder(a, .079, .073, detective ? .16 : .12, side * .007, -.086, 0, fabric);
    cylinder(a, .080, .080, .023, side * .009, detective ? -.161 : -.137, 0, fabric);
    ball(a, .082, 0, -.015, 0, fabric, [1, 1.03, .91]);
    cylinder(a, .057, .061, .16, side * .015, -.116, 0, m.ivory);
    ball(a, .055, side * .02, -.211, 0, m.dark);
    const forearm = group(a, side * .02, -.211, 0); forearms.push(forearm);
    cylinder(forearm, .063, .070, .08, side * .006, -.049, .007, m.ivory);
    cylinder(forearm, .071, .071, .022, side * .006, -.082, .007, m.brass);
    ball(forearm, .075, side * .008, -.133, .015, m.ivory, [.9, 1, .8]);
    // Rounded mitten silhouette with an opposing thumb, matching the approved hands.
    ball(forearm, .041, -side * .057, -.117, .049, m.ivory, [.73, 1, .8]);
    const leg = group(body, side * .128, .306, 0); leg.name = "leg"; legs.push(leg);
    ball(leg, .075, 0, 0, 0, m.brass);
    cylinder(leg, .062, .076, .14, 0, -.107, 0, m.ivory);
    ball(leg, .07, 0, -.191, .008, m.brass);
    const knee = group(leg, 0, -.191, .008); knee.name = "knee"; knees.push(knee);
    box(knee, .193, .127, .259, 0, -.049, .044, shoe, .06);
    box(knee, .197, .028, .262, 0, -.099, .043, wardrobe.leather, .013);
    ball(knee, .101, 0, -.049, .114, shoe, [.92, .59, .75]);
  }
  wardrobe.satchel(body);
  root.scale.setScalar(1.04);
  let seat = 0, lastTime: number | undefined;
  const curious = persona === "creator" && defaultHappy;
  return {
    root,
    // Position remains the navigable approach mark. The articulated body settles into its chair.
    animate(time: number, moving: boolean, working: boolean, reduced: boolean, life: CharacterLife = {}) {
      const dt = lastTime === undefined ? 0 : Math.max(0, Math.min(.05, time - lastTime)); lastTime = time;
      const wantSeat = !moving && !!life.seated;
      seat = reduced || dt === 0 ? Number(wantSeat) : T.MathUtils.damp(seat, Number(wantSeat), 12, dt);
      contactShadow.visible = seat < .15;
      if (moving) seat = 0; // Stand before travelling; never drag a seated rig along a route.
      const gait = Math.sin(time * (curious ? 10.0 : 9.2));
      const cycle = (time + (curious ? 1.8 : 0)) % (curious ? 9.7 : 12.3);
      const gesture = reduced || moving || working ? 0 : Math.sin(Math.PI * T.MathUtils.clamp((cycle - 5) / 2.2, 0, 1));
      const breathing = reduced ? 0 : Math.sin(time * (curious ? 1.85 : 1.45)) * .004;
      body.position.y = seat * .30 + (moving && !reduced ? Math.abs(gait) * .018 : breathing);
      body.position.z = seat * (life.seatOffset ?? 0);
      body.rotation.x = seat * .07;
      body.rotation.z = reduced || moving ? 0 : Math.sin(time * .65) * .012 * (1 - seat);
      legs.forEach((leg, i) => {
        leg.rotation.x = -seat * Math.PI / 2 + (!reduced && moving ? gait * .53 * (i ? 1 : -1) : 0);
        knees[i]!.rotation.x = seat * Math.PI / 2;
      });
      arms.forEach((arm, i) => {
        arm.rotation.z = 0;
        forearms[i]!.rotation.x = 0;
        arm.rotation.x = moving ? (reduced ? 0 : gait * .43 * (i ? -1 : 1)) : working ? -1.30 + (reduced ? 0 : Math.sin(time * 3.4 + i) * .035) : -.06;
      });
      if (seat > .1 && life.activity === 'lounge') {
        arms.forEach((arm, i) => { arm.rotation.x = -.65 * seat; forearms[i]!.rotation.x = -.55 * seat; });
      }
      // Small sleeve adjustment / considering pose. No imaginary object is held or consumed.
      if (gesture && seat < .1 && !life.greeting && !life.acknowledging) {
        arms[0]!.rotation.x -= gesture * (curious ? .52 : .35);
        arms[0]!.rotation.z = -gesture * .12;
        forearms[0]!.rotation.x = -gesture * .55;
      }
      if (!moving && !reduced && (life.acknowledging || (!working && life.greeting))) {
        arms[1]!.rotation.x = -1.65;
        arms[1]!.rotation.z = -.42 + Math.sin(time * (curious ? 6 : 4.5)) * .08;
        forearms[1]!.rotation.x = -1.15;
      }
      const look = !reduced && !moving ? Math.sin(time * (curious ? .72 : .39)) * (curious ? .17 : .10) : 0;
      const attentive = !reduced && life.lookYaw !== undefined;
      const headGoal = attentive ? T.MathUtils.clamp(life.lookYaw!, -.65, .65) : working ? -.03 : look;
      head.rotation.y = reduced ? 0 : T.MathUtils.damp(head.rotation.y, headGoal, 9, dt);
      head.rotation.x = reduced ? 0 : life.acknowledging ? Math.sin(time * 7) * .06 : life.activity === "observe" ? -.035 : working ? .04 : gesture * .05;
      head.rotation.z = reduced || moving ? 0 : Math.sin(time * .72) * (curious ? .024 : .014);
      // A quick, smooth eyelid-like lens closure, with different phases for each employee.
      const blinkTime = (time + (curious ? 2.1 : 0)) % (curious ? 5.8 : 7.1);
      const blink = reduced ? 0 : blinkTime < .18 ? Math.sin(blinkTime / .18 * Math.PI) : 0;
      expression(working, !reduced && (!!life.greeting || !!life.acknowledging));
      eyes.forEach(eye => { eye.scale.y = 1 - blink * .92; });
    },
  };
}

/** Detective Scout; the articulated model turns as a whole, never mirrored. Approved design, unchanged. */
export function buildScout(m: Materials) {
  return buildAgentCharacter(m, m.green, "detective", '#e6f5d9', false);
}

/** Content Bot; approved design, unchanged. */
export function buildContentBot(m: Materials) {
  return buildAgentCharacter(m, m.sapphire, "creator", '#91d1fa', true, undefined, true);
}

// --- Operations Wing (Milestone 7, re-dressed under Milestone 8's approved
// wardrobe/screen-face system) --- the same "creator" silhouette as Content
// Bot, in each agent's own accent color and ink tint, without headphones —
// see this file's own doc comment above for why.
export function buildChiefOfStaff(m: Materials) {
  return buildAgentCharacter(m, m.gold, "creator", '#f5e3b3', true, { cloth: "#5a4a2e", lining: "#8a6a35" });
}
export function buildExecutiveAssistant(m: Materials) {
  return buildAgentCharacter(m, m.plum, "creator", '#f0c9e0', true, { cloth: "#4a3344", lining: "#6e4a5c" });
}
export function buildFinanceAgent(m: Materials) {
  return buildAgentCharacter(m, m.bronze, "creator", '#f2cfa0', true, { cloth: "#4a3420", lining: "#6e4a28" });
}
export function buildBusinessAnalyst(m: Materials) {
  return buildAgentCharacter(m, m.indigo, "creator", '#c9c6f5', true, { cloth: "#332e52", lining: "#4a4470" });
}
export function buildOperationsAgent(m: Materials) {
  return buildAgentCharacter(m, m.slate, "creator", '#bfe0e8', true, { cloth: "#2c3d45", lining: "#3e5760" });
}
