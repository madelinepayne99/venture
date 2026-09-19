import * as T from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export const palette = {
  ivory: "#eee7d5", plaster: "#e9dfc8", emerald: "#195a4d", ink: "#18372f",
  walnut: "#865034", brass: "#bc945c", paper: "#f6f0df", clay: "#b86d4e",
  // Content Bot's own accent color — cool sapphire/screen-blue, distinct
  // from Scout's emerald, reused unchanged across his waistcoat/eye
  // fittings the same way Scout's green already is (see scout.ts's
  // buildAgentCharacter). Never used for anything else in the scene.
  sapphire: "#1d4d7a",
};

export function material(color: string, roughness = 0.7, metalness = 0) {
  return new T.MeshStandardMaterial({ color, roughness, metalness });
}

function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

export function canvasTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void, s = 512) {
  const canvas = document.createElement("canvas"); canvas.width = s; canvas.height = s;
  draw(canvas.getContext("2d")!, s);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

export function woodTexture() {
  return canvasTexture((c, s) => {
    c.fillStyle = "#8b5838"; c.fillRect(0, 0, s, s); const rnd = random(104);
    for (let i = 0; i < 1100; i++) {
      const x = rnd() * s;
      c.strokeStyle = rnd() > 0.45 ? `rgba(46,24,13,${rnd() * 0.12})` : `rgba(234,182,116,${rnd() * 0.16})`;
      c.lineWidth = rnd() * 1.6; c.beginPath(); c.moveTo(x, 0);
      c.bezierCurveTo(x + rnd() * 14, s * .3, x - rnd() * 18, s * .7, x + rnd() * 9, s); c.stroke();
    }
  });
}

export function parquetTexture() {
  const texture = canvasTexture((c, s) => {
    c.fillStyle = "#997b56"; c.fillRect(0, 0, s, s);
    const rnd = random(27); c.save(); c.translate(s / 2, s / 2); c.rotate(Math.PI / 4);
    const w = 32, l = w * 4;
    for (let row = -20; row < 20; row++) for (let col = -10; col < 10; col++) {
      const x = col * (l + w) + row * w, y = row * w - col * (l + w);
      for (let turn = 0; turn < 2; turn++) {
        c.save(); c.translate(x + (turn ? l : 0), y); if (turn) c.rotate(Math.PI / 2);
        const n = rnd(); c.fillStyle = `hsl(31,${26 + n * 9}%,${42 + n * 17}%)`; c.fillRect(.5, .5, l - 1, w - 1);
        for (let grain = 0; grain < 10; grain++) {
          c.strokeStyle = `rgba(60,32,15,${.025 + rnd() * .08})`; c.beginPath();
          const gy = rnd() * w; c.moveTo(0, gy); c.quadraticCurveTo(l * .5, gy + 3, l, gy); c.stroke();
        }
        c.restore();
      }
    }
    c.restore();
  }, 1024);
  texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(2.3, 3.3); return texture;
}

export function marbleTexture() {
  const texture = canvasTexture((c, s) => {
    c.fillStyle = "#e7dfca"; c.fillRect(0, 0, s, s); const rnd = random(36);
    for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(118,96,63,${rnd() * .035})`; c.fillRect(rnd() * s, rnd() * s, 2, 2); }
    for (let i = 0; i < 23; i++) {
      const y = rnd() * s; c.strokeStyle = `rgba(147,128,102,${rnd() * .18})`; c.lineWidth = .5 + rnd() * 2;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s * .3, y + rnd() * 100, s * .6, y - rnd() * 180, s, y + 140); c.stroke();
    }
    c.strokeStyle = "#cbbda3"; c.lineWidth = 1.2; c.strokeRect(0, 0, s, s);
  });
  texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(3, 3); return texture;
}

export function fabricTexture() {
  return canvasTexture((c, s) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, s, s); const rnd = random(8);
    for (let i = 0; i < s; i += 3) {
      c.fillStyle = `rgba(22,37,23,${.035 + rnd() * .04})`; c.fillRect(i, 0, 1, s); c.fillRect(0, i, s, 1);
    }
  }, 128);
}

export function buildMaterials() {
  const wood = material("#ffffff", .52); wood.map = woodTexture();
  const floor = material("#ffffff", .78); floor.map = parquetTexture();
  const marble = material("#ffffff", .55); marble.map = marbleTexture();
  const green = material(palette.emerald, .84); green.map = fabricTexture();
  const linen = material("#d9c8a6", .93); linen.map = fabricTexture();
  const sapphire = material(palette.sapphire, .84); sapphire.map = fabricTexture();
  return { wood, floor, marble, green, linen, sapphire, wall: material(palette.plaster), ivory: material(palette.ivory, .4),
    brass: material(palette.brass, .34, .62), dark: material(palette.ink, .5), paper: material(palette.paper),
    clay: material(palette.clay), black: material("#222d2c", .5), leaf: material("#386a40"), leaf2: material("#5b8452"),
    screenBlue: material("#2f6ea8", .5, .1) };
}
export type Materials = ReturnType<typeof buildMaterials>;

export function box(parent: T.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material, radius = 0) {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)) : new T.BoxGeometry(w, h, d);
  const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function ball(parent: T.Object3D, radius: number, x: number, y: number, z: number, mat: T.Material, scale?: [number, number, number]) {
  const mesh = new T.Mesh(new T.SphereGeometry(radius, 20, 14), mat); mesh.position.set(x, y, z); if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function cylinder(parent: T.Object3D, top: number, bottom: number, height: number, x: number, y: number, z: number, mat: T.Material, segments = 24) {
  const mesh = new T.Mesh(new T.CylinderGeometry(top, bottom, height, segments), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function rod(parent: T.Object3D, a: T.Vector3, b: T.Vector3, radius: number, mat: T.Material) {
  const mesh = cylinder(parent, radius, radius, a.distanceTo(b), 0, 0, 0, mat, 10);
  mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()); return mesh;
}
export function group(parent: T.Object3D, x: number, y: number, z: number, angle = 0) {
  const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = angle; parent.add(g); return g;
}
