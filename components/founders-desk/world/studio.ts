import * as T from "three";
import { ball, box, canvasTexture, cylinder, group, material, rod, type Materials } from "./materials";
import { books, cup, officeChair, plant } from "./furniture";
import type { StudioStatus } from "./studioState";

/**
 * Ported verbatim from the approved "Living Polish" redesign (Milestone 8
 * integration) — Content Bot's real, dedicated production wing, replacing
 * Milestone 5's smaller-footprint `studioFurniture` (still defined in
 * furniture.ts, left in place but no longer called — see CLAUDE.md's own
 * note that the fuller room-extension design remained a legitimate
 * follow-up, not abandoned). A furnished extension in the existing HQ's
 * material language. No generated job content.
 */
export function buildContentStudio(parent: T.Object3D, m: Materials) {
  const root = group(parent, 0, 0, 0); root.userData.target = "studio";
  const blue = material("#496b86", .91); blue.map = m.sapphire.map;
  const softBlue = material("#91a5b1", .91), navy = material("#233b4e", .86);
  const hardware = material("#343c3f", .45, .25);
  // Inset blue rug and brass binding, leaving marble visible around it.
  box(root, 3.9, .018, 3.15, 7.66, .04, -1.1, blue, .06);
  for (const x of [5.79, 9.53]) box(root, .017, .003, 2.99, x, .051, -1.1, m.brass);
  for (const z of [-2.6, .4]) box(root, 3.75, .003, .017, 7.66, .051, z, m.brass);

  // The editing desk is a substantial single piece, with drawer units and rounded walnut edges.
  const desk = group(root, 7.5, 0, -1.45);
  box(desk, 2.85, .12, 1.05, 0, .75, 0, m.wood, .05);
  box(desk, 2.76, .022, 1.00, 0, .678, 0, m.brass, .018);
  for (const x of [-1.08, 1.08]) {
    box(desk, .48, .63, .82, x, .35, -.025, m.wood, .035);
    for (const y of [.23, .45, .64]) {
      box(desk, .43, .18, .026, x, y, .4, m.wood, .008);
      box(desk, .14, .016, .025, x, y + .035, .42, m.brass, .004);
    }
  }
  // Right-hand editing return, leaving the chair approach and doorway clear.
  box(root, .50, .12, 1.55, 8.68, .75, -.75, m.wood, .045);
  box(root, .44, .63, .50, 8.68, .35, -.20, m.wood, .03);
  const accentLight = material("#46647b", .6);
  box(desk, 2.60, .018, .018, 0, .67, .48, accentLight, .006);
  box(root, .018, .018, 1.40, 8.43, .67, -.75, accentLight, .006);
  box(desk, 1.8, .012, .43, -.1, .817, .23, navy, .025);
  officeChair(root, 7.5, -.48, { ...m, green: blue }, 0);

  const displays: { canvas: HTMLCanvasElement; texture: T.CanvasTexture; kind: "main" | "portrait" | "wall" | "sign" }[] = [];
  function screen(parent: T.Object3D, x: number, y: number, z: number, w: number, h: number, kind: typeof displays[number]["kind"], stand = true) {
    const g = group(parent, x, y, z);
    box(g, w + .055, h + .055, .06, 0, h / 2, 0, hardware, .025);
    if (stand) {
      box(g, .045, .14, .05, 0, -.05, -.02, m.brass, .005);
      box(g, .28, .018, .19, 0, -.12, .015, hardware, .02);
    }
    const canvas = document.createElement("canvas"); canvas.width = kind === "portrait" ? 384 : 1024; canvas.height = kind === "portrait" ? 640 : kind === "sign" ? 320 : 512;
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture, toneMapped: false }));
    mesh.position.set(0, h / 2, .031); g.add(mesh);
    displays.push({ canvas, texture, kind });
    return g;
  }
  screen(desk, -.30, .96, -.29, 1.10, .54, "main");
  screen(desk, .64, .96, -.26, .37, .65, "portrait").rotation.y = -.13;
  screen(desk, -.99, .96, -.18, .40, .39, "main").rotation.y = .2;
  // Keyboard, control surface, mouse, and pencil tray: occupied without fictional progress.
  box(desk, .68, .03, .22, -.25, .833, .21, m.ivory, .016);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) box(desk, .043, .006, .043, -.55 + c * .052, .852, .145 + r * .061, m.paper, .004);
  box(desk, .27, .035, .2, .42, .835, .23, hardware, .02);
  cylinder(desk, .071, .071, .026, .41, .867, .22, m.brass);
  ball(desk, .06, .7, .853, .24, m.ivory, [.75, .5, 1.3]);
  cup(desk, 1.15, .815, .24, m); books(desk, -.98, .815, .21, m, 2, true);
  // Paired nearfield speakers with inset cones.
  for (const x of [-1.27, 1.19]) {
    const g = group(desk, x, .82, -.29);
    box(g, .18, .30, .2, 0, .15, 0, navy, .02);
    const cone = cylinder(g, .058, .058, .012, 0, .105, .106, m.dark); cone.rotation.x = Math.PI / 2;
    ball(g, .025, 0, .228, .11, m.brass, [1, 1, .3]);
  }
  // Headphones hung on the desk edge.
  const headphones = group(desk, 1.43, .61, .12, Math.PI / 2);
  const band = new T.Mesh(new T.TorusGeometry(.105, .014, 8, 24, Math.PI), hardware); headphones.add(band);
  for (const x of [-.103, .103]) box(headphones, .045, .11, .07, x, -.02, 0, blue, .018);

  // Preview wall and low equipment cabinet. The preview stays dark until genuine state arrives.
  box(root, 2.65, .62, .62, 8.0, .36, -3.62, m.wood, .035);
  box(root, 2.72, .045, .67, 8.0, .69, -3.62, m.marble, .02);
  for (const x of [7.14, 8.0, 8.86]) {
    box(root, .81, .5, .025, x, .38, -3.297, navy, .016);
    box(root, .13, .018, .025, x, .56, -3.277, m.brass, .004);
  }
  screen(root, 8.0, 1.04, -3.93, 2.53, 1.35, "wall", false);
  books(root, 7.12, .72, -3.58, m, 3, true);
  cylinder(root, .075, .055, .18, 8.98, .82, -3.61, m.ivory);

  // A window-side acoustic treatment, not a neon wall.
  for (let i = 0; i < 5; i++) box(root, .19, 1.15, .095, 9.43 + i * .105, 1.72, -3.92, i % 2 ? blue : softBlue, .025);
  for (let i = 0; i < 4; i++) box(root, .09, 1.14, .21, 5.49, 1.66, -3.3 + i * .27, blue, .018);

  // Linen storyboard on the shared divider, facing into the studio; blank cards are stationery.
  const board = group(root, 5.49, 1.49, -1.38, Math.PI / 2);
  box(board, 1.65, .95, .065, 0, 0, 0, m.wood, .02);
  box(board, 1.54, .85, .025, 0, 0, .045, m.linen, .015);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const x = -.49 + c * .49, y = -.20 + r * .4;
    box(board, .38, .26, .008, x, y, .065, m.paper, .005);
    ball(board, .013, x, y + .11, .077, m.brass);
  }
  const caption = canvasTexture((c, s) => { c.fillStyle = "#e9dfcd"; c.fillRect(0, 0, s, s); c.fillStyle = "#395364"; c.font = "500 44px sans-serif"; c.textAlign = "center"; c.fillText("STORY / FRAME / SOUND", s / 2, s / 2 + 14); });
  const boardLabel = new T.Mesh(new T.PlaneGeometry(1.4, .15), new T.MeshBasicMaterial({ map: caption })); boardLabel.position.set(0, .61, .05); board.add(boardLabel);

  // Equipment shelf along the open cutaway edge: cases, lenses and folded fabric.
  const shelf = group(root, 9.46, 0, -1.65, -Math.PI / 2);
  for (const x of [-.65, .65]) box(shelf, .06, 1.5, .48, x, .77, 0, m.brass, .01);
  for (const y of [.17, .68, 1.19, 1.53]) box(shelf, 1.4, .06, .55, 0, y, 0, m.wood, .016);
  for (const x of [-.4, .15, .43]) {
    cylinder(shelf, .072, .072, .18, x, .8, .03, hardware);
    cylinder(shelf, .075, .075, .018, x, .87, .03, m.brass);
  }
  for (const x of [-.36, .31]) {
    box(shelf, .49, .26, .37, x, .33, 0, navy, .035);
    box(shelf, .15, .024, .022, x, .42, .2, m.brass, .006);
  }
  books(shelf, -.5, 1.225, 0, m, 5); box(shelf, .4, .12, .3, .37, 1.28, 0, softBlue, .035);

  // Recording station: camera, softbox, and a boom microphone with a pop filter.
  function tripod(x: number, z: number, height: number) {
    const g = group(root, x, 0, z);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; rod(g, new T.Vector3(0, height * .58, 0), new T.Vector3(Math.sin(a) * .28, .055, Math.cos(a) * .28), .018, hardware); }
    cylinder(g, .018, .025, height, 0, height / 2, 0, hardware); return g;
  }
  const camera = tripod(9.15, .65, .96); camera.rotation.y = -.85;
  box(camera, .27, .2, .18, 0, 1.02, 0, hardware, .022);
  const lens = cylinder(camera, .06, .067, .13, 0, 1.02, .14, m.dark); lens.rotation.x = Math.PI / 2;
  ball(camera, .053, 0, 1.02, .21, m.screenBlue, [1, 1, .22]);
  box(camera, .11, .065, .06, -.05, 1.155, 0, hardware, .014);
  const light = tripod(9.54, -.14, 1.35); light.rotation.y = -.8;
  box(light, .48, .57, .1, 0, 1.49, 0, hardware, .065);
  box(light, .42, .51, .015, 0, 1.49, .058, m.linen, .04);
  const mic = group(root, 8.72, 0, -.04);
  cylinder(mic, .17, .19, .035, 0, .055, 0, hardware);
  rod(mic, new T.Vector3(0, .065, 0), new T.Vector3(0, 1.04, 0), .018, hardware);
  rod(mic, new T.Vector3(0, 1.04, 0), new T.Vector3(-.27, 1.21, 0), .018, m.brass);
  const capsule = cylinder(mic, .045, .045, .18, -.27, 1.14, 0, hardware); capsule.rotation.z = -.35;
  const filter = cylinder(mic, .075, .075, .012, -.38, 1.15, .04, navy); filter.rotation.x = Math.PI / 2;
  rod(mic, new T.Vector3(-.27, 1.05, 0), new T.Vector3(-.38, 1.15, .04), .009, hardware);

  // Low storage at the front, preserving sightlines and a generous clear arrival area.
  box(root, 1.65, .5, .53, 8.78, .29, 2.5, m.wood, .035);
  box(root, 1.72, .05, .59, 8.78, .565, 2.5, m.marble, .02);
  for (const x of [8.24, 8.78, 9.32]) {
    box(root, .48, .38, .024, x, .31, 2.78, blue, .018);
    box(root, .11, .016, .028, x, .42, 2.8, m.brass, .004);
  }
  books(root, 8.23, .598, 2.5, m, 2, true); plant(root, 9.32, 2.48, m, .52, .59);
  plant(root, 6.0, -3.0, m, 1.2);

  // Physical entrance plaque. A matching keyboard control is projected by the engine.
  const sign = screen(root, 6.47, .38, 2.82, 1.6, .50, "sign", false);
  box(sign, 1.72, .61, .025, 0, .25, -.049, m.brass, .025);
  for (const x of [5.88, 7.06]) {
    box(root, .045, .39, .045, x, .20, 2.79, m.brass, .008);
    box(root, .22, .035, .24, x, .055, 2.79, m.wood, .012);
  }
  // Small steady approval beacon; no pulsing or invented production activity.
  const reviewMaterial = material("#706b5d", .48, .2);
  const reviewBeacon = ball(root, .065, 7.23, .88, 2.85, reviewMaterial);
  reviewBeacon.name = "studio-review-beacon";
  box(root, .18, .18, .035, 7.23, .88, 2.80, m.brass, .025);
  let signature = "";
  function update(status: StudioStatus) {
    const next = JSON.stringify(status); if (next === signature) return false; signature = next;
    accentLight.emissive.set(status.active ? "#356b98" : "#000000");
    accentLight.emissiveIntensity = status.active ? .45 : 0;
    const review = Boolean(status.reviewRequired);
    reviewMaterial.color.set(review ? "#dfb269" : "#706b5d");
    reviewMaterial.emissive.set(review ? "#b77e28" : "#000000");
    reviewMaterial.emissiveIntensity = review ? .55 : 0;
    reviewBeacon.userData.reviewRequired = review;
    for (const d of displays) {
      const c = d.canvas.getContext("2d")!, w = d.canvas.width, h = d.canvas.height;
      c.fillStyle = status.active ? "#1d3442" : "#1f292e"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "#71818a"; c.lineWidth = 2; c.strokeRect(18, 18, w - 36, h - 36);
      const title = (status.title || (status.state === "available" ? "A little space for big ideas." : ""));
      c.textAlign = "left"; c.fillStyle = "#b6bfc0";
      c.font = `500 ${d.kind === 'portrait' ? 19 : 23}px sans-serif`; c.fillText(d.kind === 'sign' ? "CONTENT STUDIO" : "VENTURE / CONTENT STUDIO", 38, 58);
      const label = d.kind === 'portrait' ? (status.active ? "PRODUCING" : "STANDBY") : status.label;
      c.font = `500 ${d.kind === 'sign' ? 35 : d.kind === 'portrait' ? 25 : 31}px sans-serif`;
      c.fillStyle = status.active ? "#b8d8e7" : status.state === 'awaiting_review' ? "#e4c38b" : "#d0d6d3";
      c.fillText(label, 38, d.kind === 'sign' ? 124 : 130, w - 76);
      c.font = `${d.kind === 'portrait' ? 18 : 23}px sans-serif`; c.fillStyle = "#a9b6b9";
      const words = title.split(/\s+/); let line = "", y = d.kind === 'sign' ? 190 : 198;
      for (const word of words) {
        if (c.measureText(line + word).width > w - 85 && line) { c.fillText(line, 38, y); line = ""; y += 32; }
        if (y > h - 64) break;
        line += word + " ";
      }
      if (y <= h - 64) c.fillText(line, 38, y);
      if (d.kind === 'wall' && status.state !== 'available') { c.fillStyle = "#84949d"; c.font = "20px sans-serif"; c.fillText("Project status • media preview not connected", 38, h - 44); }
      if (d.kind === 'main') { c.strokeStyle = "#425563"; for (let i = 0; i < 3; i++) { c.strokeRect(38, h - 150 + i * 32, w - 76, 23); } }
      if (status.count > 1 && d.kind === 'sign') { c.font = "18px sans-serif"; c.fillText(`${status.count} open items`, 38, h - 35); }
      d.texture.needsUpdate = true;
    }
    return true;
  }
  update({ state: "available", label: "AVAILABLE", title: "", active: false, count: 0 });
  return { root, update };
}
