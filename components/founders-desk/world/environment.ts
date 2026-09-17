import * as T from "three";
import { ball, box, canvasTexture, cylinder, group, material, type Materials } from "./materials";
import { books, commandDesk, cup, plant, researchFurniture, sofa } from "./furniture";

function landscapeTexture() {
  return canvasTexture((c, s) => {
    const sky = c.createLinearGradient(0, 0, 0, s); sky.addColorStop(0, "#91bac3"); sky.addColorStop(.64, "#e0e6d2"); sky.addColorStop(1, "#a9b69a");
    c.fillStyle = sky; c.fillRect(0, 0, s, s);
    c.fillStyle = "#f4e8c8"; c.beginPath(); c.arc(s * .75, s * .31, s * .09, 0, 7); c.fill();
    c.fillStyle = "#8fa7a1"; c.beginPath(); c.moveTo(0, s * .68); c.bezierCurveTo(s * .3, s * .53, s * .58, s * .79, s, s * .57); c.lineTo(s, s); c.lineTo(0, s); c.fill();
    c.fillStyle = "#b8c6ba"; c.fillRect(0, s * .79, s, s * .21);
    c.fillStyle = "#b0b59b"; c.beginPath(); c.moveTo(0, s * .88); c.quadraticCurveTo(s * .55, s * .75, s, s); c.lineTo(0, s); c.fill();
  });
}

function arch(parent: T.Object3D, x: number, z: number, m: Materials, w = 1.05, h = 1.63) {
  const g = group(parent, x, .73, z);
  const shape = new T.Shape(); const r = w / 2;
  shape.moveTo(-r, 0); shape.lineTo(r, 0); shape.lineTo(r, h - r); shape.absarc(0, h - r, r, 0, Math.PI, false); shape.lineTo(-r, 0);
  const pane = new T.Mesh(new T.ShapeGeometry(shape), new T.MeshBasicMaterial({ map: landscapeTexture(), color: "#eef2df" })); g.add(pane);
  // ShapeGeometry UVs are in world units; normalize them into the landscape.
  const uv = pane.geometry.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + r) / w, uv.getY(i) / h);
  const curve = new T.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => {
    const a = i / 24 * Math.PI; return new T.Vector3(Math.cos(a) * (r + .055), h - r + Math.sin(a) * (r + .055), .045);
  }));
  const trim = new T.Mesh(new T.TubeGeometry(curve, 24, .055, 8, false), m.ivory); trim.castShadow = true; g.add(trim);
  for (const side of [-1, 1]) box(g, .10, h - r, .13, side * (r + .055), (h - r) / 2, .035, m.ivory, .015);
  box(g, w + .25, .10, .29, 0, -.025, .065, m.marble, .015);
  box(g, .028, h - .04, .035, 0, h / 2, .055, m.brass);
  box(g, w, .028, .035, 0, .62, .055, m.brass);
}

function wall(parent: T.Object3D, m: Materials, x: number, z: number, w: number, d: number, h: number) {
  box(parent, w, h, d, x, h / 2, z, m.wall, .025);
  box(parent, w + .025, .065, d + .025, x, h + .012, z, m.ivory, .01);
  box(parent, w + .014, .12, d + .035, x, .065, z, m.ivory, .01);
}

function frame(parent: T.Object3D, m: Materials, w: number, h: number, texture: T.Texture) {
  box(parent, w + .1, h + .1, .05, 0, 0, 0, m.brass, .01);
  const art = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture })); art.position.z = .026; parent.add(art);
}

function rug(parent: T.Object3D, m: Materials, x: number, z: number, w: number, d: number, green = true) {
  box(parent, w, .017, d, x, .025, z, green ? m.green : m.linen, .05);
  const border = green ? material("#9a9869") : material("#9d8c68");
  for (const side of [-1, 1]) {
    box(parent, w - .14, .003, .016, x, .035, z + side * (d / 2 - .08), border);
    box(parent, .016, .003, d - .14, x + side * (w / 2 - .08), .035, z, border);
  }
}

export function buildEnvironment(scene: T.Scene, m: Materials) {
  const root = new T.Group(); scene.add(root);
  // Compact architectural slab with a bevel, on a calm, close-cropped garden bed.
  box(root, 11.2, .23, 9.02, 0, -.145, .27, m.ivory, .085);
  box(root, 11.06, .055, 8.86, 0, -.028, .27, m.brass, .04);
  box(root, 5.77, .055, 8.45, -2.325, -.001, .2, m.floor);
  box(root, 4.72, .055, 8.45, 2.97, -.001, .2, m.marble);
  box(root, .052, .009, 8.43, .55, .033, .2, m.brass);
  wall(root, m, 0, -4.08, 10.77, .2, 2.63);
  wall(root, m, -5.38, .2, .2, 8.77, 2.63);
  // Interior cutaway walls keep their footprint and door openings visible.
  wall(root, m, .55, -2.65, .19, 2.82, 1.88);
  wall(root, m, .55, -.44, .19, 1.6, .93);
  wall(root, m, .55, 3.42, .19, 2.36, .68);
  wall(root, m, 3.99, .2, 2.76, .19, .82);
  wall(root, m, .9, .2, .5, .19, .82);
  // Door jambs, brass thresholds, and a low perimeter give the floor plan real depth.
  for (const z of [.48, 2.20]) box(root, .23, 1.05, .085, .55, .525, z, m.ivory, .01);
  box(root, .28, .017, 1.72, .55, .041, 1.34, m.brass);
  for (const x of [1.19, 2.60]) box(root, .08, 1.0, .22, x, .5, .2, m.ivory, .01);
  box(root, 1.4, .017, .27, 1.9, .041, .2, m.brass);
  box(root, .14, .12, 8.75, 5.37, .06, .2, m.ivory, .01);
  box(root, 10.77, .12, .14, 0, .06, 4.53, m.ivory, .01);
  // Tall arched coastal windows and wall panelling.
  arch(root, -3.83, -3.963, m); arch(root, -2.5, -3.963, m); arch(root, -1.17, -3.963, m);
  arch(root, 1.51, -3.963, m, 1.22, 1.64);
  for (const x of [-4.73, -.25]) box(root, .06, 2.4, .06, x, 1.28, -3.94, m.ivory, .009);
  box(root, 5.66, .045, .06, -2.36, .52, -3.94, m.ivory, .008);
  rug(root, m, -2.8, -1, 4.3, 3.85);
  const desk = commandDesk(root, m); const research = researchFurniture(root, m);
  // Mission board faces into the founders' room, with no fictional mission cards.
  const board = group(root, -5.255, 1.48, -.4, Math.PI / 2); board.userData.target = "board";
  frame(board, m, 1.6, .92, canvasTexture((c, s) => {
    c.fillStyle = "#214b3f"; c.fillRect(0, 0, s, s);
    c.fillStyle = "#e4d4a9"; c.font = "500 29px Georgia"; c.fillText("THE NEXT CHAPTER", 39, 74);
    c.strokeStyle = "#738570"; c.lineWidth = 2; c.beginPath(); c.moveTo(40, 100); c.lineTo(469, 100); c.stroke();
    c.font = "19px sans-serif"; c.fillStyle = "#b6bda4"; c.fillText("Ideas start here.", 40, 155);
    c.fillStyle = "#e4ddc5"; c.fillRect(44, 207, 170, 186); c.fillStyle = "#c5ccb4"; c.fillRect(255, 218, 165, 158);
    c.fillStyle = "#b89a63"; c.beginPath(); c.arc(128, 214, 6, 0, 7); c.fill(); c.beginPath(); c.arc(337, 225, 6, 0, 7); c.fill();
    c.fillStyle = "#8c927e"; for (let i = 0; i < 4; i++) { c.fillRect(65, 253 + i * 24, 121 - i * 10, 3); c.fillRect(276, 263 + i * 23, 115 - i * 12, 3); }
  }));
  const credenza = group(root, -4.97, 0, .98, Math.PI / 2);
  box(credenza, 2.12, .7, .58, 0, .4, 0, m.wood, .035);
  box(credenza, 2.19, .06, .65, 0, .785, 0, m.marble, .025);
  for (const x of [-.7, 0, .7]) { box(credenza, .66, .56, .025, x, .42, .306, m.wood, .02); box(credenza, .12, .018, .027, x, .65, .324, m.brass, .005); }
  for (const x of [-.87, .87]) cylinder(credenza, .025, .025, .14, x, .07, .2, m.brass);
  books(credenza, -.6, .819, .0, m, 3, true);
  plant(credenza, .67, 0, m, .55, .82);
  // Founders' planning nook.
  rug(root, m, -2.95, 3.00, 3.22, 2.13, false);
  sofa(root, -3.87, 3.22, m, .95, .32, false);
  sofa(root, -1.92, 3.22, m, .95, -.32, false);
  cylinder(root, .38, .36, .055, -2.89, .43, 2.70, m.marble);
  cylinder(root, .16, .22, .39, -2.89, .218, 2.70, m.brass);
  books(root, -2.92, .464, 2.69, m, 1, true);
  // Reception is a usable lounge with coffee, not another agent workstation.
  const lounge = group(root, 0, 0, 0); lounge.userData.target = "lounge";
  rug(lounge, m, 3.45, 2.35, 3.14, 3.10, false);
  sofa(lounge, 3.83, 1.27, m, 2.18, 0);
  cylinder(lounge, .49, .47, .058, 3.48, .42, 2.67, m.marble);
  cylinder(lounge, .27, .33, .39, 3.48, .22, 2.67, m.wood);
  cup(lounge, 3.64, .454, 2.58, m); books(lounge, 3.34, .454, 2.71, m, 1, true);
  plant(root, -4.82, -3.15, m, 1.80);
  plant(root, -.27, -3.60, m, 1.34);
  plant(root, 4.66, 3.85, m, 1.50);
  plant(root, 4.85, -.49, m, .72);
  // Small coffee console on the low room divider.
  const coffee = group(root, 4.73, .855, .18, Math.PI);
  box(coffee, .33, .34, .24, 0, .17, 0, m.dark, .025);
  box(coffee, .23, .2, .015, 0, .16, .13, m.brass, .015);
  box(coffee, .3, .02, .2, 0, .04, .19, m.dark, .008); cup(coffee, 0, .052, .19, m);
  // Exterior: narrow planted border, no oversized grass backdrop.
  const stone = material("#babfa9", .95), gravel = material("#c9cbb9", .94);
  box(root, 11.98, .075, 9.9, 0, -.29, .27, stone, .16);
  for (let i = 0; i < 16; i++) {
    const x = -5.78, z = -4.1 + i * .55;
    ball(root, .23 + (i % 3) * .025, x, -.03, z, i % 2 ? m.leaf : m.leaf2, [.85, .87, 1.2]);
  }
  for (let i = 0; i < 12; i++) ball(root, .24, -5.18 + i * .86, -.02, -4.65, i % 2 ? m.leaf : m.leaf2, [1.2, .75, .85]);
  for (let i = 0; i < 4; i++) box(root, .83, .055, .42, 1.86, -.20, 4.9 + i * .51, m.marble, .035);
  // Tiny garden stones break the precision at the foundation edge.
  for (let i = 0; i < 45; i++) ball(root, .035 + i % 4 * .009, -5.62 - i % 3 * .11, -.20, -4.25 + i * .2, gravel, [1.2, .5, 1]);
  return { root, desk, research, board, lounge };
}
