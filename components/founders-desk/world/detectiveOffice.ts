import * as T from 'three';
import { box, group, cylinder, material, canvasTexture, rod, type Materials } from './materials';
import { books, lamp } from './furniture';

/**
 * Ported verbatim from the approved "Living Polish" redesign (Milestone 8
 * integration). Stationery is set dressing, never fabricated mission
 * evidence.
 */
export function dressDetectiveOffice(parent: T.Object3D, m: Materials) {
  const root = group(parent, 0, 0, 0); root.name = 'detective-office-details';
  const emerald = material('#173e34', .87), trim = material('#365e48', .78);
  // Panelling sits behind the existing arched window and bookcase.
  box(root, 4.63, 2.55, .024, 2.97, 1.30, -3.979, emerald);
  box(root, .024, 1.8, 2.78, .657, .96, -2.65, emerald);
  for (const x of [.78, 2.2, 3.55, 5.17]) box(root, .035, 2.5, .036, x, 1.29, -3.955, trim, .008);
  for (const y of [.15, .57, 2.53]) box(root, 4.59, .034, .039, 2.97, y, -3.95, trim, .007);
  for (const z of [-3.86, -3.1, -2.35, -1.35]) box(root, .04, 1.7, .035, .68, .98, z, trim, .007);
  // Patterned study rug, kept clear of the threshold.
  const texture = canvasTexture((c, s) => {
    c.fillStyle = '#284c40'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 5; i++) { c.strokeStyle = i % 2 ? '#9b8059' : '#705e42'; c.lineWidth = 4; c.strokeRect(12 + i * 9, 12 + i * 9, s - 24 - i * 18, s - 24 - i * 18); }
    c.strokeStyle = '#a58d65'; c.lineWidth = 2;
    for (let x = 88; x < s - 70; x += 56) for (let y = 88; y < s - 70; y += 56) { c.beginPath(); c.moveTo(x, y - 15); c.lineTo(x + 13, y); c.lineTo(x, y + 15); c.lineTo(x - 13, y); c.closePath(); c.stroke(); }
  });
  const rug = material('#ffffff', .95); rug.map = texture;
  box(root, 3.8, .018, 3.4, 3.13, .037, -1.94, rug, .025);
  // Shallow filing chest beside the window, within its registered obstacle.
  const cabinet = group(root, 1.27, 0, -3.27);
  box(cabinet, .71, .87, .59, 0, .47, 0, m.wood, .025);
  for (const y of [.22, .48, .74]) {
    box(cabinet, .63, .22, .025, 0, y, .31, m.wood, .013);
    box(cabinet, .17, .065, .018, 0, y + .025, .332, m.brass, .006);
    box(cabinet, .12, .029, .02, 0, y + .025, .344, m.paper, .003);
    rod(cabinet, new T.Vector3(-.09, y - .045, .35), new T.Vector3(.09, y - .045, .35), .012, m.brass);
  }
  books(cabinet, -.2, .92, 0, m, 4); lamp(cabinet, .23, .92, -.03, m, Math.PI);
  // Organised blank case stationery, facing across the room from the divider.
  const board = group(root, .705, 1.29, -2.48, Math.PI / 2);
  box(board, 1.49, 1.04, .06, 0, 0, 0, m.wood, .025);
  box(board, 1.37, .92, .025, 0, 0, .045, material('#99794f', .95), .01);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const x = -.46 + col * .46, y = -.22 + row * .44;
    const card = box(board, .32, .30, .008, x, y, .065, m.paper, .008); card.rotation.z = (col - 1) * .045;
    cylinder(board, .014, .014, .014, x, y + .12, .08, m.brass).rotation.x = Math.PI / 2;
    for (let j = 0; j < 3; j++) box(board, .20 - j * .03, .008, .005, x - .025, y + .035 - j * .041, .073, trim);
  }
  // Desk folios and a real dimensional magnifying glass prop.
  box(root, .45, .034, .31, 3.67, .727, -1.91, material('#b69965'), .009);
  box(root, .36, .01, .26, 3.67, .749, -1.91, m.paper, .005);
  const magnifier = group(root, 2.49, .722, -1.83); magnifier.rotation.x = -Math.PI / 2;
  const rim = new T.Mesh(new T.TorusGeometry(.077, .009, 8, 32), m.brass); magnifier.add(rim);
  rod(magnifier, new T.Vector3(0, -.073, 0), new T.Vector3(0, -.20, 0), .014, m.wood);
  // Warm light is architectural ambience, not a claim of active research.
  const light = new T.PointLight('#ffd69a', .6, 2.8, 2); light.position.set(4.14, 1.17, -2.25); root.add(light);
  // Drawer pedestals make the existing research table read as a substantial study desk.
  for (const x of [1.97, 4.23]) {
    box(root, .44, .53, .74, x, .33, -2.17, m.wood, .023);
    for (const y of [.18, .35, .52]) { box(root, .40, .14, .018, x, y, -1.79, m.wood, .008); box(root, .13, .014, .02, x, y + .025, -1.772, m.brass, .004); }
  }
  return root;
}
