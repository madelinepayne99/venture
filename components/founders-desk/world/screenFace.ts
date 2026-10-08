import * as T from 'three';
import { group } from './materials';

function roundedShape(w: number, h: number, r: number) {
  const s = new T.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}

/**
 * Ported from the approved "Living Polish" redesign, generalized from a
 * binary `detective` flag to an explicit ink color + default expression —
 * Scout and Content Bot pass their exact original approved colors
 * ('#e6f5d9' mint / '#91d1fa' blue) and defaults unchanged; the five
 * Operations Wing agents (Milestone 8) each get their own accent-tinted
 * glyph color instead of being forced into one of the original two.
 *
 * One inset display with simple expressive glyphs, never anatomical eyes.
 */
export function buildScreenFace(head: T.Object3D, inkColor: string, defaultHappy: boolean) {
  const glass = new T.MeshPhysicalMaterial({ color: '#172326', roughness: .27, metalness: .08, clearcoat: .7 });
  const vertices: number[] = [], indices: number[] = [];
  const power = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
  for (let ring = 0; ring <= 12; ring++) for (let i = 0; i <= 64; i++) {
    const r = ring / 12, a = i / 64 * Math.PI * 2, x = .295 * r * power(Math.cos(a)), y = .1425 * r * power(Math.sin(a));
    vertices.push(x, y, .268 - .60 * x * x - .12 * y * y);
    if (ring < 12 && i < 64) { const n = ring * 65 + i, b = n + 65; indices.push(n, b, n + 1, n + 1, b, b + 1); }
  }
  const surface = new T.BufferGeometry(); surface.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); surface.setIndex(indices); surface.computeVertexNormals();
  const panel = new T.Mesh(surface, glass); panel.position.y = -.008; panel.name = 'face-screen'; head.add(panel);
  const ink = new T.MeshBasicMaterial({ color: inkColor, toneMapped: false });
  const eyes: T.Group[] = [];
  const forms: { pill: T.Mesh; smile: T.Mesh }[] = [];
  for (const x of [-.12, .12]) {
    const eye = group(head, x, -.008, .27); eye.name = 'eye'; eyes.push(eye); eye.position.z = .270;
    const pill = new T.Mesh(new T.ShapeGeometry(roundedShape(.047, .125, .023), 16), ink); eye.add(pill);
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(-.043, -.015, .003), new T.Vector3(0, .066, .003), new T.Vector3(.043, -.015, .003));
    const smile = new T.Mesh(new T.TubeGeometry(curve, 20, .012, 8, false), ink); eye.add(smile);
    for (const x of [-.043, .043]) { const cap = new T.Mesh(new T.SphereGeometry(.012, 12, 8), ink); cap.position.set(x, -.015, .003); smile.add(cap); }
    forms.push({ pill, smile });
  }
  function expression(working: boolean, greeting: boolean) {
    const happy = !working && (defaultHappy || greeting);
    forms.forEach(({ pill, smile }) => { pill.visible = !happy; smile.visible = happy; });
    panel.userData.expression = working ? 'focused' : happy ? 'happy' : 'curious';
  }
  expression(false, false);
  return { eyes, expression };
}
