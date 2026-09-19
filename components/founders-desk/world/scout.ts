import * as T from "three";
import { ball, box, cylinder, group, rod, type Materials } from "./materials";

/**
 * The shared dimensional rig both real agents use — ivory body, brass
 * fittings, and one accent color swapped per agent (Scout's emerald,
 * Content Bot's sapphire — see materials.ts). This is what makes "reuse
 * Scout's exact model, in blue" mechanically true rather than aspirational:
 * a hand-duplicated second mesh would drift the first time anyone adjusts
 * a proportion. Each call returns its own rig with its own closure — no
 * shared runtime state between characters (see CLAUDE.md's
 * shared-world-architecture milestone).
 */
function buildAgentCharacter(m: Materials, accent: T.Material) {
  const root = new T.Group(), body = group(root, 0, 0, 0);
  const hip = group(body, 0, .29, 0);
  ball(hip, .245, 0, .17, 0, m.ivory, [.94, 1, .78]);
  ball(hip, .247, 0, .23, .008, accent, [.99, .8, .81]);
  const chest = box(hip, .36, .30, .06, 0, .23, .169, accent, .045);
  chest.rotation.x = -.06;
  // Angled lapels and three buttons make the waistcoat legible at game scale.
  const l = box(hip, .10, .19, .017, -.076, .329, .21, accent, .012); l.rotation.z = .45;
  const r = box(hip, .10, .19, .017, .076, .329, .21, accent, .012); r.rotation.z = -.45;
  for (const y of [.33, .25, .17]) ball(hip, .022, -.04, y, .222, m.brass, [1, 1, .45]);
  cylinder(body, .097, .11, .065, 0, .73, 0, m.brass);
  const head = group(body, 0, .947, 0);
  box(head, .69, .46, .47, 0, 0, 0, m.ivory, .185);
  // Eye assemblies are big lenses set into separate brass rings, not a visor.
  for (const x of [-.169, .169]) {
    const rim = cylinder(head, .143, .143, .045, x, .0, .217, m.brass, 40); rim.rotation.x = Math.PI / 2;
    ball(head, .125, x, 0, .244, m.dark, [1, 1.02, .31]);
    ball(head, .109, x, -.005, .268, m.ivory, [1, 1, .35]);
    ball(head, .086, x - .007, 0, .30, accent, [1, 1.04, .39]);
    ball(head, .048, x - .012, 0, .327, m.dark, [1, 1.06, .28]);
    ball(head, .025, x + .018, .039, .34, m.paper, [1, 1, .38]);
    ball(head, .011, x - .033, -.034, .334, m.paper, [1, 1, .3]);
  }
  for (const side of [-1, 1]) { const e = cylinder(head, .065, .065, .034, side * .35, -.01, -.015, m.brass); e.rotation.z = Math.PI / 2; }
  // A thin top seam keeps the rounded head from becoming a featureless sphere.
  const seam = new T.Mesh(new T.TorusGeometry(.22, .006, 6, 40), m.brass); seam.rotation.y = Math.PI / 2; seam.position.x = -.25; seam.scale.set(1, .90, 1); head.add(seam);
  const arms: T.Group[] = [], legs: T.Group[] = [];
  for (const side of [-1, 1]) {
    const a = group(body, side * .267, .657, .015); arms.push(a);
    ball(a, .067, 0, 0, 0, m.brass);
    cylinder(a, .057, .061, .16, side * .015, -.116, 0, m.ivory);
    ball(a, .055, side * .02, -.211, 0, m.dark);
    cylinder(a, .063, .070, .08, side * .026, -.26, .007, m.ivory);
    cylinder(a, .071, .071, .022, side * .026, -.293, .007, m.brass);
    ball(a, .075, side * .028, -.344, .015, m.ivory, [.9, 1, .8]);
    for (let finger = 0; finger < 3; finger++) ball(a, .022, side * .028 + (finger - 1) * .032, -.398, .041, m.dark, [.75, 1, .8]);
    const leg = group(body, side * .128, .306, 0); legs.push(leg);
    ball(leg, .075, 0, 0, 0, m.brass);
    cylinder(leg, .062, .076, .14, 0, -.107, 0, m.ivory);
    ball(leg, .07, 0, -.191, .008, m.brass);
    box(leg, .185, .124, .244, 0, -.242, .05, m.ivory, .055);
    ball(leg, .101, 0, -.24, .122, accent, [.92, .59, .75]);
  }
  const bag = group(body, .253, .397, .113, -.14);
  box(bag, .21, .25, .105, 0, 0, 0, accent, .055);
  box(bag, .175, .065, .023, 0, .073, .063, accent, .017);
  ball(bag, .022, 0, .06, .08, m.brass, [1, 1, .4]);
  box(bag, .132, .13, .035, -.006, .143, -.005, m.paper, .008);
  box(bag, .025, .14, .042, .014, .143, -.005, accent, .005);
  rod(body, new T.Vector3(-.17, .679, .163), new T.Vector3(.27, .47, .19), .019, accent);
  const buckle = new T.Mesh(new T.TorusGeometry(.033, .007, 6, 20), m.brass); buckle.position.set(.02, .587, .209); body.add(buckle);
  root.scale.setScalar(1.04);
  return {
    root,
    animate(time: number, moving: boolean, working: boolean, reduced: boolean) {
      const gait = Math.sin(time * 9.5);
      body.position.y = reduced ? 0 : moving ? Math.abs(Math.sin(time * 9.5)) * .018 : Math.sin(time * 1.7) * .004;
      legs.forEach((l, i) => { l.rotation.x = !reduced && moving ? gait * .53 * (i ? 1 : -1) : 0; });
      arms.forEach((a, i) => { a.rotation.x = moving ? (reduced ? 0 : gait * .43 * (i ? -1 : 1)) : working ? -1.63 + (reduced ? 0 : Math.sin(time * 4 + i) * .04) : -.06; });
      head.rotation.y = reduced || moving ? 0 : working ? -.06 : Math.sin(time * .55) * .09;
      head.rotation.z = reduced || moving ? 0 : Math.sin(time * .72) * .018;
    },
  };
}

/** Original ivory / emerald research companion. The model turns as a whole; no mirroring. */
export function buildScout(m: Materials) {
  return buildAgentCharacter(m, m.green);
}

/** Content Bot — the exact same rig as Scout, in his own sapphire accent (see materials.ts's palette.sapphire). */
export function buildContentBot(m: Materials) {
  return buildAgentCharacter(m, m.sapphire);
}
