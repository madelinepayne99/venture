import * as T from "three";
import { ball, box, canvasTexture, cylinder, group, material, rod, type Materials } from "./materials";

export function monitor(parent: T.Object3D, x: number, y: number, z: number, m: Materials, variant = 0) {
  const g = group(parent, x, y, z);
  box(g, .32, .025, .22, 0, .015, 0, m.brass, .015);
  box(g, .055, .22, .05, 0, .12, -.035, m.dark, .014);
  box(g, .77, .46, .045, 0, .38, -.035, m.dark, .028);
  const tex = canvasTexture((c, s) => {
    c.fillStyle = variant ? "#eee9d9" : "#143c35"; c.fillRect(0, 0, s, s);
    c.fillStyle = variant ? "#194d40" : "#d1bf8a"; c.fillRect(28, 34, 138, 14);
    c.globalAlpha = .7;
    for (let i = 0; i < 5; i++) { c.fillRect(30, 92 + i * 48, 270 - i * 24, 6); }
    c.globalAlpha = 1; c.fillStyle = variant ? "#c7b898" : "#2d5d50"; c.fillRect(320, 90, 150, 308);
    c.fillStyle = variant ? "#718377" : "#adba93"; c.fillRect(342, 116, 102, 84);
    c.fillStyle = variant ? "#b68d54" : "#bd9c59"; c.fillRect(342, 225, 62, 10); c.fillRect(342, 250, 93, 7);
    c.fillStyle = "#526e60"; c.fillRect(30, 408, 170, 45);
  });
  const screen = new T.Mesh(new T.PlaneGeometry(.71, .393), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(0, .38, -.0105); g.add(screen);
  box(g, .47, .024, .16, 0, .025, .38, m.ivory, .015);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 10; k++) box(g, .032, .005, .028, -.19 + k * .041, .04, .329 + r * .039, m.paper, .003);
  ball(g, .052, .33, .042, .37, m.ivory, [.8, .5, 1.25]);
  return g;
}

export function lamp(parent: T.Object3D, x: number, y: number, z: number, m: Materials, angle = 0) {
  const g = group(parent, x, y, z, angle);
  cylinder(g, .12, .14, .036, 0, .018, 0, m.brass);
  rod(g, new T.Vector3(0, .03, 0), new T.Vector3(0, .37, 0), .018, m.brass);
  rod(g, new T.Vector3(0, .37, 0), new T.Vector3(.19, .53, .02), .017, m.brass);
  ball(g, .034, 0, .37, 0, m.dark);
  const hood = cylinder(g, .095, .15, .1, .21, .49, .02, m.green); hood.rotation.z = -.32;
  const glow = material("#ffecc0", .7); glow.emissive.set("#eac58b"); glow.emissiveIntensity = .7;
  const disc = cylinder(g, .12, .12, .007, .226, .443, .02, glow); disc.rotation.z = -.32;
  return g;
}

export function cup(parent: T.Object3D, x: number, y: number, z: number, m: Materials) {
  cylinder(parent, .052, .04, .11, x, y + .055, z, m.ivory);
  cylinder(parent, .044, .044, .003, x, y + .112, z, material("#5b3827"));
  const handle = new T.Mesh(new T.TorusGeometry(.031, .009, 7, 16), m.ivory); handle.position.set(x + .057, y + .06, z); parent.add(handle);
}

export function books(parent: T.Object3D, x: number, y: number, z: number, m: Materials, count = 5, horizontal = false) {
  const colors = [m.green, m.ivory, m.clay, m.dark, material("#bd9d65"), material("#7e8c83")];
  for (let i = 0; i < count; i++) {
    const h = .27 + (i % 3) * .04, mat = colors[i % colors.length]!;
    if (horizontal) {
      const b = group(parent, x, y + i * .049, z, (i % 2 ? .1 : -.08));
      box(b, .24, .039, .32, 0, .024, 0, m.paper, .005);
      box(b, .25, .007, .33, 0, .005, 0, mat); box(b, .25, .007, .33, 0, .043, 0, mat);
    } else {
      box(parent, .072, h, .21, x + i * .082, y + h / 2, z, mat, .008);
      box(parent, .045, .012, .003, x + i * .082, y + h - .06, z + .107, m.brass);
    }
  }
}

export function officeChair(parent: T.Object3D, x: number, z: number, m: Materials, angle = 0) {
  const g = group(parent, x, 0, z, angle);
  cylinder(g, .038, .045, .38, 0, .28, 0, m.brass);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5, ex = Math.sin(a) * .32, ez = Math.cos(a) * .32;
    rod(g, new T.Vector3(0, .15, 0), new T.Vector3(ex, .065, ez), .022, m.dark);
    ball(g, .045, ex, .048, ez, m.black, [1, 1, .6]);
  }
  box(g, .58, .13, .55, 0, .49, 0, m.green, .065);
  const back = box(g, .55, .55, .13, 0, .77, .255, m.green, .085); back.rotation.x = .08;
  box(g, .46, .075, .025, 0, .88, .173, m.green, .028);
  for (const side of [-1, 1]) {
    rod(g, new T.Vector3(side * .31, .48, .15), new T.Vector3(side * .31, .72, .14), .016, m.brass);
    box(g, .073, .045, .36, side * .31, .73, .02, m.dark, .02);
  }
  return g;
}

export function commandDesk(parent: T.Object3D, m: Materials) {
  const g = group(parent, -2.8, 0, -1.5); g.userData.target = "desk";
  box(g, 3.8, .14, 1.35, 0, .83, 0, m.wood, .055);
  box(g, 3.72, .018, 1.29, 0, .77, 0, m.brass, .035);
  for (const side of [-1, 1]) {
    box(g, .48, .68, 1.1, side * 1.55, .38, 0, m.wood, .035);
    box(g, .43, .045, 1.05, side * 1.55, .054, 0, m.brass, .014);
    for (let i = 0; i < 3; i++) {
      box(g, .42, .185, .025, side * 1.55, .22 + i * .2, .56, m.wood, .012);
      box(g, .18, .019, .031, side * 1.55, .235 + i * .2, .586, m.brass, .008);
    }
  }
  box(g, 2.65, .32, .07, 0, .55, -.4, m.wood, .01);
  for (const [i, x] of [-.9, .9].entries()) {
    box(g, 1.11, .012, .71, x, .908, .11, m.green, .06);
    monitor(g, x, .92, -.19, m, i);
    cup(g, x + .44, .919, .35, m);
  }
  lamp(g, -1.61, .9, -.32, m); lamp(g, 1.57, .9, -.32, m, Math.PI);
  books(g, 0, .903, .2, m, 2, true);
  const tray = box(g, .24, .055, .25, 0, .94, -.3, m.brass, .02);
  box(tray, .205, .014, .20, 0, .034, 0, m.paper, .005);
  officeChair(parent, -3.7, -.05, m, -.055); officeChair(parent, -1.9, -.05, m, .045);
  return g;
}

/**
 * Content Bot's own workstation — a compact editing desk with a monitor,
 * a small stack of reference books, and a camera-on-tripod prop reading
 * as "production," distinct from Scout's research desk. Lit by the same
 * warm palette as the rest of the room; distinguished by the cool
 * sapphire accents on the desk trim rather than a separate light color
 * (see CLAUDE.md's Content Bot milestone — this is a real, functional
 * workstation placed inside the existing building footprint, not a new
 * room extension).
 */
export function studioFurniture(parent: T.Object3D, m: Materials) {
  const g = group(parent, 0, 0, -3.0); g.userData.target = "studio";
  box(g, 1.7, .1, .78, 0, .62, 0, m.wood, .04);
  box(g, 1.64, .016, .73, 0, .565, 0, m.sapphire, .03);
  for (const side of [-1, 1]) box(g, .1, .58, .7, side * .78, .29, 0, m.wood, .03);
  monitor(g, 0, .68, -.2, m, 1);
  cup(g, .6, .655, .28, m);
  books(g, -.75, .655, .22, m, 3, true);
  // Root-relative (not g-relative — g is already offset to the studio
  // mark), positioned on the south side of the desk facing the monitor.
  officeChair(parent, 0, -2.5, m, 0);
  // A small camera-on-tripod prop — the one detail that reads as
  // "production," not research.
  const tripod = group(parent, .95, 0, -3.35);
  for (const side of [-1, 1]) for (const dz of [-1, 1]) {
    const leg = cylinder(tripod, .012, .012, .48, side * .1, .24, dz * .09, m.dark);
    leg.rotation.z = side * .18; leg.rotation.x = dz * .18;
  }
  const head = group(tripod, 0, .5, 0);
  box(head, .16, .12, .22, 0, 0, 0, m.dark, .02);
  cylinder(head, .045, .05, .06, 0, .09, .07, m.brass);
  ball(head, .03, 0, .09, .12, m.black);
  return g;
}

export function plant(parent: T.Object3D, x: number, z: number, m: Materials, height = 1.45, y = 0) {
  const g = group(parent, x, y, z);
  const factor = height / 1.45; g.scale.setScalar(factor);
  cylinder(g, .22, .155, .37, 0, .185, 0, m.ivory);
  cylinder(g, .224, .224, .026, 0, .353, 0, m.brass);
  cylinder(g, .192, .192, .012, 0, .37, 0, material("#4f4031"));
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399, tip = new T.Vector3(Math.cos(a) * (.34 + i % 2 * .13), .82 + i % 3 * .2, Math.sin(a) * (.34 + i % 2 * .13));
    const stemBase = new T.Vector3(0, .32, 0), mid = new T.Vector3(tip.x * .18, tip.y + .15, tip.z * .18);
    const curve = new T.QuadraticBezierCurve3(stemBase, mid, tip);
    const stem = new T.Mesh(new T.TubeGeometry(curve, 10, .01, 5, false), m.leaf); g.add(stem);
    // Broad, curved leaves with a raised spine; true geometry from both viewing directions.
    const start = curve.getPoint(.48), dir = tip.clone().sub(start), side = new T.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(.10);
    const center = start.clone().lerp(tip, .55); center.y += .09;
    const vertices = [...start.toArray(), ...center.clone().add(side).toArray(), ...tip.toArray(), ...center.clone().sub(side).toArray(), ...center.clone().add(new T.Vector3(0, .07, 0)).toArray()];
    const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3)); geo.setIndex([0,1,4,1,2,4,2,3,4,3,0,4]); geo.computeVertexNormals();
    const leafMat = (i % 2 ? m.leaf : m.leaf2).clone(); leafMat.side = T.DoubleSide;
    const leaf = new T.Mesh(geo, leafMat); leaf.castShadow = true; g.add(leaf);
  }
  return g;
}

export function sofa(parent: T.Object3D, x: number, z: number, m: Materials, width = 2.15, angle = 0, green = true) {
  const g = group(parent, x, 0, z, angle), cloth = green ? m.green : m.linen;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(g, .026, .02, .17, sx * (width / 2 - .12), .09, sz * .3, m.brass);
  box(g, width, .25, .8, 0, .28, 0, cloth, .075);
  box(g, width, .5, .2, 0, .63, -.32, cloth, .085);
  for (const side of [-1, 1]) box(g, .16, .35, .73, side * (width / 2 - .04), .48, .03, cloth, .075);
  const seats = width > 1.5 ? 3 : 1, inner = width - .25;
  for (let i = 0; i < seats; i++) {
    const sx = -inner / 2 + (i + .5) * inner / seats;
    box(g, inner / seats - .025, .16, .57, sx, .46, .04, cloth, .065);
    const pillow = box(g, inner / seats - .07, .3, .12, sx, .66, -.15, i === 1 ? m.linen : cloth, .055); pillow.rotation.x = -.13;
  }
  return g;
}

export function researchFurniture(parent: T.Object3D, m: Materials) {
  const g = group(parent, 3.1, 0, -2.15); g.userData.target = "research";
  box(g, 2.8, .11, 1.0, 0, .65, 0, m.wood, .045);
  for (const x of [-1.2, 1.2]) for (const z of [-.36, .36]) {
    box(g, .075, .62, .075, x, .31, z, m.brass, .01);
  }
  box(g, 2.55, .22, .06, 0, .47, -.37, m.wood, .01);
  monitor(g, -.3, .71, -.22, m, 1); lamp(g, 1.1, .71, -.22, m, Math.PI);
  books(g, .7, .71, .1, m, 3, true); cup(g, -.85, .71, .28, m);
  box(g, .36, .018, .29, .3, .725, .3, m.paper, .007);
  rod(g, new T.Vector3(.25, .74, .3), new T.Vector3(.5, .74, .2), .009, m.brass);
  const globe = group(g, -1.06, .71, -.13);
  cylinder(globe, .1, .13, .025, 0, .014, 0, m.brass); cylinder(globe, .014, .014, .12, 0, .07, 0, m.brass);
  ball(globe, .14, 0, .24, 0, m.green);
  const meridian = new T.Mesh(new T.TorusGeometry(.155, .008, 8, 40), m.brass); meridian.position.y = .24; meridian.rotation.z = -.3; globe.add(meridian);
  const shelf = group(parent, 3.69, 0, -3.71);
  box(shelf, 2.74, 2.36, .07, 0, 1.18, -.23, m.wood, .018);
  for (const x of [-1.37, 0, 1.37]) box(shelf, .085, 2.4, .48, x, 1.2, 0, m.wood, .015);
  for (const y of [.12, .63, 1.19, 1.76, 2.39]) box(shelf, 2.82, .075, .5, 0, y, 0, m.wood, .016);
  for (const x of [-.7, .7]) {
    box(shelf, 1.28, .48, .025, x, .365, .251, m.green, .014);
    cylinder(shelf, .026, .026, .035, x + .42, .41, .28, m.brass).rotation.x = Math.PI / 2;
  }
  books(shelf, -1.19, .68, .1, m, 8); books(shelf, .25, .68, .1, m, 3, true);
  books(shelf, -.99, 1.23, .05, m, 3, true); books(shelf, .18, 1.23, .1, m, 10);
  books(shelf, -1.19, 1.80, .1, m, 6); books(shelf, .26, 1.80, .1, m, 5);
  cylinder(shelf, .07, .095, .22, -.36, 1.35, .05, m.ivory);
  ball(shelf, .12, 1.02, 1.91, .06, m.brass);
  return g;
}
