import * as T from "three";
import { canvasTexture } from "./materials";

/**
 * Ported verbatim from the approved "Living Polish" character redesign
 * (see docs/operations-build-progress.md's Milestone 8 integration notes)
 * — a smooth signed-power face shell and a subtle cloth-weave texture,
 * reused by every agent's rig (characterWardrobe.ts, scout.ts).
 */

/** Smooth signed-power form: rounded face and chin without box corner seams. */
export function faceGeometry() {
  const width = 64, height = 40, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const power = (v: number, n: number) => Math.sign(v) * Math.pow(Math.abs(v), n);
  for (let j = 0; j <= height; j++) for (let i = 0; i <= width; i++) {
    const v = -Math.PI / 2 + j / height * Math.PI, u = i / width * Math.PI * 2;
    const round = power(Math.cos(v), .78), sy = power(Math.sin(v), .78);
    positions.push(.358 * round * power(Math.cos(u), .8) * (1 - .035 * Math.max(0, -sy)), .247 * sy, .25 * round * power(Math.sin(u), .8));
    uvs.push(i / width, j / height);
    if (j < height && i < width) { const a = j * (width + 1) + i, b = a + width + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  // Merge the duplicate longitude seam normals for continuous ceramic shading.
  const normal = geometry.getAttribute('normal')!;
  for (let j = 0; j <= height; j++) {
    const a = j * (width + 1), b = a + width, n = new T.Vector3(normal.getX(a) + normal.getX(b), normal.getY(a) + normal.getY(b), normal.getZ(a) + normal.getZ(b)).normalize();
    normal.setXYZ(a, n.x, n.y, n.z); normal.setXYZ(b, n.x, n.y, n.z);
  }
  return geometry;
}
export function clothSurface() {
  return canvasTexture((c, s) => {
    c.fillStyle = '#f8f7f5'; c.fillRect(0, 0, s, s);
    let seed = 17; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < 6500; i++) { const n = 215 + Math.floor(rnd() * 35); c.fillStyle = `rgba(${n},${n},${n},.16)`; c.fillRect(rnd() * s, rnd() * s, 1, 1); }
    for (let y = 0; y < s; y += 4) { c.strokeStyle = 'rgba(65,64,59,.025)'; c.beginPath(); c.moveTo(0, y); c.lineTo(s, y); c.stroke(); }
  }, 256);
}
