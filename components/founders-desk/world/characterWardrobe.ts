import * as T from "three";
import { clothSurface } from "./characterSurfaces";
import { ball, box, cylinder, group, material, rod, type Materials } from "./materials";

/**
 * Ported from the approved "Living Polish" character redesign. The
 * `detective` flag selects between Scout's exact approved fedora/coat/
 * satchel silhouette and the "creator" jacket/badge/tablet-pocket
 * silhouette Content Bot uses — reused unchanged for the five Operations
 * Wing agents (Milestone 8), who wear the "creator" silhouette in their
 * own accent color (no `.headphones()`/`.hat()` call for them — see
 * scout.ts), distinguished by color, desk, and prop rather than a sixth
 * bespoke costume. Tailored accessories attached to the existing
 * articulated rig; no animation or task state.
 *
 * `accentOverride` is new here (Milestone 8): the original patch's
 * `accent` parameter was accepted but never actually used — Scout and
 * Content Bot's cloth/lining colors were (and still are, when this is
 * omitted) hardcoded, which would have made all five new agents render
 * in Content Bot's exact jacket color with zero visual distinction.
 * Passed only for the five new agents, each with its own muted cloth/
 * lining pair derived from its accent (see scout.ts); omitted for Scout
 * and Content Bot, whose colors are byte-for-byte unchanged from the
 * approved design.
 */
export function characterWardrobe(m: Materials, accent: T.Material, detective: boolean, accentOverride?: { cloth: string; lining: string }) {
  const cloth = material(accentOverride?.cloth ?? (detective ? "#41423e" : "#3d5871"), .92);
  cloth.map = clothSurface();
  cloth.bumpMap = cloth.map; cloth.bumpScale = .0007;
  const lining = material(accentOverride?.lining ?? (detective ? "#195b4e" : "#617e95"), .86);
  lining.map = cloth.map;
  const leather = material("#996a43", .78);
  const leatherEdge = material("#6e4c32", .86);
  const dark = material("#293237", .9), stitch = material(detective ? "#727064" : "#7c92a1", .96);

  function panel(parent: T.Object3D, coords: [number, number][], z: number, surface: T.Material, depth = .024) {
    const shape = new T.Shape(); coords.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .009, bevelThickness: .007, bevelSegments: 4, steps: 1 });
    // The lapels wrap onto the curved torso instead of sitting as flat plates.
    const position = geo.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      position.setZ(i, position.getZ(i) - .29 * x * x + .009 * Math.sin(y * 12));
    }
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, surface); mesh.position.z = z; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function seam(parent: T.Object3D, points: T.Vector3[]) {
    const mesh = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 20, .0022, 4, false), stitch); parent.add(mesh);
  }
  function dress(hip: T.Group) {
    // Ivory undershirt remains visible between open coat fronts.
    box(hip, .15, .29, .05, 0, .245, .165, m.ivory, .025);
    const hem = detective ? -.025 : .025;
    for (const side of [-1, 1]) {
      const coords: [number, number][] = [[side * .026, .38], [side * .13, .38], [side * .20, .30], [side * .224, .10], [side * .213, hem], [side * .034, hem + .014], [side * .012, .10]];
      panel(hip, coords, .163, cloth, .042);
      // Lapels have a visible emerald/blue lining along their folded edge.
      const lapel: [number, number][] = [[side * .04, .405], [side * .145, .39], [side * .10, .28], [side * .15, .245], [side * .025, .16], [side * .005, .28]];
      panel(hip, lapel, .216, lining, .012);
      panel(hip, lapel.map(([x, y]) => [x + side * .007, y - .012]), .232, cloth, .012);
      const pocket = group(hip, side * .136, .103, .225); pocket.name = "jacket-pocket";
      box(pocket, .112, .096, .024, 0, 0, 0, cloth, .016);
      box(pocket, .122, .026, .033, 0, .04, .006, cloth, .008);
      seam(pocket, [new T.Vector3(-.049, .027, .022), new T.Vector3(-.049, -.038, .022), new T.Vector3(.049, -.038, .022), new T.Vector3(.049, .027, .022)]);
      seam(hip, [new T.Vector3(side * .19, .26, .216), new T.Vector3(side * .21, .08, .216), new T.Vector3(side * .19, hem + .016, .216)]);
    }
    for (const y of [.26, .175, .09]) ball(hip, .021, -.042, y, .272, m.brass, [1, 1, .34]);
    // Rear garment closes around the torso with a belt and split hem.
    box(hip, .38, .30, .055, 0, .20, -.166, cloth, .05);
    for (const side of [-1, 1]) box(hip, .185, detective ? .14 : .09, .04, side * .097, .045, -.17, cloth, .022);
    if (detective) box(hip, .31, .035, .022, 0, .18, -.201, leather, .008);
    if (!detective) {
      const triangle = new T.Shape(); triangle.moveTo(-.023, -.027); triangle.lineTo(.028, 0); triangle.lineTo(-.023, .027); triangle.closePath();
      const badge = new T.Mesh(new T.ExtrudeGeometry(triangle, { depth: .009, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 1 }), m.brass);
      badge.position.set(.122, .28, .253); hip.add(badge);
    }
  }
  function hat(head: T.Group) {
    const root = group(head, 0, .239, -.012); root.rotation.z = -.055; root.name = "detective-fedora";
    // A continuous crown with a centre dent and front pinch, rather than a domed ball.
    const rings = [{ r: .285, y: 0 }, { r: .278, y: .04 }, { r: .269, y: .10 }, { r: .245, y: .16 }, { r: .210, y: .212 }, { r: .145, y: .184 }, { r: .07, y: .159 }, { r: .001, y: .155 }];
    const points = new Float32Array(rings.length * 49 * 3), uv = new Float32Array(rings.length * 49 * 2), indices: number[] = [];
    rings.forEach((ring, j) => { for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
      const pinch = 1 - .24 * Math.max(0, z) * Math.min(1, j / 3);
      const n = j * 49 + i; points.set([x * ring.r * pinch, ring.y + .023 * Math.cos(2 * a) * (j > 3 ? 1 : 0), z * ring.r * .77], n * 3); uv.set([i / 48, j / 7], n * 2);
      if (j < rings.length - 1 && i < 48) { const b = n + 49; indices.push(n, b, n + 1, n + 1, b, b + 1); }
    } });
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(points, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals();
    const crown = new T.Mesh(geo, cloth); crown.castShadow = crown.receiveShadow = true; root.add(crown);
    // Curved brim with raised sides and a lowered front edge.
    const brimGeo = new T.CylinderGeometry(.421, .421, .016, 64, 1, false); const pos = brimGeo.attributes.position!;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setXYZ(i, x, pos.getY(i) + .027 * (x * x / .177) - .019 * Math.max(0, z / .421), z * .76); } brimGeo.computeVertexNormals();
    const brim = new T.Mesh(brimGeo, cloth); brim.castShadow = brim.receiveShadow = true; root.add(brim);
    const band = cylinder(root, .282, .286, .036, 0, .036, 0, lining, 48); band.scale.z = .775;
    ball(root, .023, -.214, .037, .14, m.brass, [1, 1, .28]);
    seam(root, [new T.Vector3(-.37, .013, .10), new T.Vector3(-.20, -.002, .278), new T.Vector3(0, -.011, .316), new T.Vector3(.20, -.002, .278), new T.Vector3(.37, .013, .10)]);
  }
  function headphones(body: T.Group) {
    const root = group(body, 0, .68, .04); root.name = "creator-headphones";
    const path = new T.CatmullRomCurve3([new T.Vector3(-.20, 0, .11), new T.Vector3(-.18, .035, -.09), new T.Vector3(0, .044, -.14), new T.Vector3(.18, .035, -.09), new T.Vector3(.20, 0, .11)]);
    const arch = new T.Mesh(new T.TubeGeometry(path, 32, .027, 10, false), dark); arch.castShadow = true; root.add(arch);
    for (const side of [-1, 1]) {
      const ear = group(root, side * .181, -.025, .128, -side * .35);
      // Separate cushion, brass rim, blue housing and centre cap.
      ball(ear, .098, 0, 0, 0, dark, [1, 1.12, .38]);
      const rim = cylinder(ear, .092, .092, .015, 0, 0, .029, m.brass, 32); rim.rotation.x = Math.PI / 2;
      const shell = cylinder(ear, .082, .089, .037, 0, 0, .053, lining, 32); shell.rotation.x = Math.PI / 2;
      const cap = cylinder(ear, .064, .064, .009, 0, 0, .077, cloth, 32); cap.rotation.x = Math.PI / 2;
    }
  }
  function satchel(body: T.Group) {
    const bag = group(body, .255, .392, .11, -.13); bag.name = detective ? "detective-satchel" : "creator-tablet-pocket";
    const surface = detective ? leather : cloth;
    box(bag, .215, .234, .108, 0, 0, 0, surface, .034);
    box(bag, .190, .117, .025, 0, .051, .062, surface, .023);
    seam(bag, [new T.Vector3(-.087, .09, .08), new T.Vector3(-.086, -.085, .073), new T.Vector3(.086, -.085, .073), new T.Vector3(.087, .09, .08)]);
    ball(bag, .020, 0, .037, .083, m.brass, [1, 1, .27]);
    if (detective) {
      box(bag, .102, .128, .037, -.027, .139, -.009, lining, .009);
      box(bag, .082, .116, .028, -.027, .139, -.006, m.paper, .004);
      for (const y of [.102, .132, .162]) rod(bag, new T.Vector3(-.088, y, .025), new T.Vector3(-.061, y, .025), .004, m.brass);
      const glass = new T.Mesh(new T.TorusGeometry(.047, .009, 8, 24), m.brass); glass.position.set(.055, .159, .02); bag.add(glass);
      rod(bag, new T.Vector3(.055, .122, .021), new T.Vector3(.055, .052, .021), .008, leatherEdge);
      const strap = box(body, .039, .50, .016, .005, .56, .274, leather, .007); strap.rotation.z = .77;
      seam(strap, [new T.Vector3(-.014, -.23, .011), new T.Vector3(-.014, .23, .011)]);
      seam(strap, [new T.Vector3(.014, -.23, .011), new T.Vector3(.014, .23, .011)]);
      const buckle = new T.Mesh(new T.TorusGeometry(.024, .005, 6, 4), m.brass); buckle.rotation.z = .77; buckle.position.set(.024, .567, .295); body.add(buckle);
    } else {
      const tablet = box(bag, .137, .163, .026, 0, .116, -.008, dark, .01); tablet.rotation.z = -.08;
      box(bag, .117, .134, .005, 0, .12, .008, material("#677981", .5), .005);
      ball(bag, .006, -.049, .186, .013, m.brass);
    }
  }
  return { cloth, lining, leather, dark, dress, hat, headphones, satchel };
}
