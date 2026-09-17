import * as T from "three";

/**
 * CPU rasterizer for browsers without WebGL (including the review browser).
 * Uses the same meshes, camera, hit testing and animation. Static geometry is
 * cached; only Scout is rasterized each frame. Native WebGL stays the default.
 */
type Vertex = { x: number; y: number; z: number; nx: number; ny: number; nz: number; u: number; v: number };
type TextureData = { data: Uint8ClampedArray; w: number; h: number; sx: number; sy: number; repeat: boolean };
type Triangle = { a: Vertex; b: Vertex; c: Vertex; mat: T.MeshStandardMaterial | T.MeshBasicMaterial; texture?: TextureData; shadow: boolean };
type RasterVertex = Vertex & { px: number; py: number; depth: number };
const sunlight = new T.Vector3(-3.5, 10, 6.5).normalize();

export class SoftwareRenderer {
  domElement = document.createElement("canvas");
  shadowMap = { enabled: false, type: T.PCFSoftShadowMap as T.ShadowMapType };
  outputColorSpace = T.SRGBColorSpace;
  toneMapping = T.ACESFilmicToneMapping;
  toneMappingExposure = 1.2;
  private ctx = this.domElement.getContext("2d", { alpha: false })!;
  private w = 0; private h = 0;
  private depth = new Float32Array(0);
  private pixels = new Uint8ClampedArray(0);
  private backgroundPixels = new Uint8ClampedArray(0);
  private backgroundDepth = new Float32Array(0);
  private signature = "";
  private textures = new Map<string, TextureData>();
  private lastRender = 0;
  private shadowDepth = new Float32Array(512 * 512);
  private lightMatrix = new T.Matrix4();
  private lastCamera = new T.Matrix4();
  private image?: ImageData;
  setPixelRatio() { /* Bound CPU work independently of device pixel ratio. */ }
  setSize(w: number, h: number) {
    const ratio = Math.min(1.35, 1800 / w, 1100 / h);
    this.w = Math.max(1, Math.round(w * ratio)); this.h = Math.max(1, Math.round(h * ratio));
    this.domElement.width = this.w; this.domElement.height = this.h;
    this.depth = new Float32Array(this.w * this.h);
    this.pixels = new Uint8ClampedArray(this.w * this.h * 4);
    this.image = new ImageData(this.pixels, this.w, this.h);
    this.signature = "";
  }
  private texture(map: T.Texture | null): TextureData | undefined {
    if (!map?.image) return undefined;
    const cached = this.textures.get(map.uuid); if (cached) return cached;
    const image = map.image as HTMLCanvasElement;
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    const value = { data: ctx.getImageData(0, 0, image.width, image.height).data, w: image.width, h: image.height, sx: map.repeat.x, sy: map.repeat.y, repeat: map.wrapS === T.RepeatWrapping };
    this.textures.set(map.uuid, value); return value;
  }
  private collect(scene: T.Scene, dynamic: boolean) {
    const triangles: Triangle[] = [];
    const normalMatrix = new T.Matrix3(), p = new T.Vector3(), n = new T.Vector3();
    scene.traverseVisible(object => {
      if (!(object instanceof T.Mesh) || !object.visible) return;
      let ancestor: T.Object3D | null = object, isDynamic = false;
      while (ancestor) { if (ancestor.userData.target === "scout" || ancestor.userData.dynamic) isDynamic = true; ancestor = ancestor.parent; }
      if (isDynamic !== dynamic) return;
      const geometry = object.geometry, pos = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv"), index = geometry.index;
      if (!pos) return;
      normalMatrix.getNormalMatrix(object.matrixWorld);
      const material = (Array.isArray(object.material) ? object.material[0] : object.material) as Triangle["mat"];
      if (!material?.color || material.transparent) return;
      const texture = this.texture(material.map);
      const vertex = (idx: number): Vertex => {
        p.fromBufferAttribute(pos, idx).applyMatrix4(object.matrixWorld);
        if (normals) n.fromBufferAttribute(normals, idx).applyMatrix3(normalMatrix).normalize(); else n.set(0, 1, 0);
        return { x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, u: uv?.getX(idx) ?? 0, v: uv?.getY(idx) ?? 0 };
      };
      const count = index?.count ?? pos.count;
      for (let i = 0; i < count; i += 3) triangles.push({ a: vertex(index ? index.getX(i) : i), b: vertex(index ? index.getX(i + 1) : i + 1), c: vertex(index ? index.getX(i + 2) : i + 2), mat: material, texture, shadow: object.castShadow });
    });
    return triangles;
  }
  private project(v: Vertex, matrix: T.Matrix4, w: number, h: number): RasterVertex {
    const e = matrix.elements, x = v.x, y = v.y, z = v.z;
    return { ...v, px: ((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * .5 + .5) * w,
      py: (.5 - (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * .5) * h,
      depth: e[2]! * x + e[6]! * y + e[10]! * z + e[14]! };
  }
  private shadow(triangles: Triangle[]) {
    const camera = new T.OrthographicCamera(-10, 10, 10, -10, .1, 40);
    camera.position.copy(sunlight).multiplyScalar(16); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    this.lightMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.shadowDepth.fill(Infinity);
    for (const tri of triangles) if (tri.shadow) this.raster(tri, this.lightMatrix, true, false);
  }
  private raster(tri: Triangle, matrix: T.Matrix4, shadowOnly: boolean, evening: boolean) {
    const w = shadowOnly ? 512 : this.w, h = shadowOnly ? 512 : this.h;
    const a = this.project(tri.a, matrix, w, h), b = this.project(tri.b, matrix, w, h), c = this.project(tri.c, matrix, w, h);
    const area = (b.px - a.px) * (c.py - a.py) - (b.py - a.py) * (c.px - a.px);
    if (Math.abs(area) < .01 || (!shadowOnly && area > 0 && tri.mat.side !== T.DoubleSide)) return;
    const minX = Math.max(0, Math.floor(Math.min(a.px, b.px, c.px))), maxX = Math.min(w - 1, Math.ceil(Math.max(a.px, b.px, c.px)));
    const minY = Math.max(0, Math.floor(Math.min(a.py, b.py, c.py))), maxY = Math.min(h - 1, Math.ceil(Math.max(a.py, b.py, c.py)));
    const inv = 1 / area, depths = shadowOnly ? this.shadowDepth : this.depth;
    const basic = tri.mat instanceof T.MeshBasicMaterial, color = tri.mat.color;
    const shade = (v: Vertex) => .77 + .31 * Math.max(0, v.nx * sunlight.x + v.ny * sunlight.y + v.nz * sunlight.z) + .1 * Math.max(0, v.ny);
    const la = shade(a), lb = shade(b), lc = shade(c);
    const tex = tri.texture, light = this.lightMatrix.elements;
    // Shared affine coefficients mean no per-fragment vector allocations.
    const dax = (b.py - c.py) * inv;
    const dbx = (c.py - a.py) * inv;
    const srgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055;
    const cr = srgb(color.r), cg = srgb(color.g), cb = srgb(color.b);
    for (let y = minY; y <= maxY; y++) {
      let wa = ((b.px - minX - .5) * (c.py - y - .5) - (b.py - y - .5) * (c.px - minX - .5)) * inv;
      let wb = ((c.px - minX - .5) * (a.py - y - .5) - (c.py - y - .5) * (a.px - minX - .5)) * inv;
      for (let x = minX; x <= maxX; x++, wa += dax, wb += dbx) {
        const wc = 1 - wa - wb; if (wa < -.00001 || wb < -.00001 || wc < -.00001) continue;
        const depth = a.depth * wa + b.depth * wb + c.depth * wc, index = y * w + x;
        if (depth >= depths[index]!) continue;
        depths[index] = depth; if (shadowOnly) continue;
        let intensity = basic ? 1 : la * wa + lb * wb + lc * wc;
        if (!basic) {
          const wx = a.x * wa + b.x * wb + c.x * wc, wy = a.y * wa + b.y * wb + c.y * wc, wz = a.z * wa + b.z * wb + c.z * wc;
          const sx = Math.floor(((light[0]! * wx + light[4]! * wy + light[8]! * wz + light[12]!) * .5 + .5) * 512);
          const sy = Math.floor((.5 - (light[1]! * wx + light[5]! * wy + light[9]! * wz + light[13]!) * .5) * 512);
          const sz = light[2]! * wx + light[6]! * wy + light[10]! * wz + light[14]!;
          if (sx > 0 && sx < 511 && sy > 0 && sy < 511) {
            let occlusion = 0;
            for (const offset of [0, 1, -1, 512, -512]) if (sz > this.shadowDepth[sy * 512 + sx + offset]! + .0018) occlusion++;
            intensity *= 1 - occlusion * .058;
          }
          if (evening) intensity *= .85;
        }
        let red = cr * 255, green = cg * 255, blue = cb * 255;
        if (tex) {
          let u = (a.u * wa + b.u * wb + c.u * wc) * tex.sx, v = (a.v * wa + b.v * wb + c.v * wc) * tex.sy;
          u = tex.repeat ? u - Math.floor(u) : Math.min(.999, Math.max(0, u));
          v = tex.repeat ? v - Math.floor(v) : Math.min(.999, Math.max(0, v));
          const ti = (Math.min(tex.h - 1, Math.floor((1 - v) * tex.h)) * tex.w + Math.min(tex.w - 1, Math.floor(u * tex.w))) * 4;
          red = cr * tex.data[ti]!; green = cg * tex.data[ti + 1]!; blue = cb * tex.data[ti + 2]!;
        }
        const pi = index * 4;
        this.pixels[pi] = Math.min(255, red * intensity * (evening ? 1.06 : 1));
        this.pixels[pi + 1] = Math.min(255, green * intensity);
        this.pixels[pi + 2] = Math.min(255, blue * intensity * (evening ? .9 : 1)); this.pixels[pi + 3] = 255;
      }
    }
  }
  render(scene: T.Scene, camera: T.Camera) {
    const now = performance.now(); if (now - this.lastRender < 90 || !this.w) return; this.lastRender = now;
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
    const matrix = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const signature = matrix.elements.map(x => x.toFixed(4)).join(",") + this.toneMappingExposure;
    const evening = this.toneMappingExposure < 1.2;
    if (signature !== this.signature) {
      this.signature = signature; this.depth.fill(Infinity);
      for (let i = 0; i < this.pixels.length; i += 4) { this.pixels[i] = 216; this.pixels[i + 1] = 223; this.pixels[i + 2] = 205; this.pixels[i + 3] = 255; }
      const triangles = this.collect(scene, false); this.shadow(triangles);
      for (const tri of triangles) this.raster(tri, matrix, false, evening);
      this.backgroundPixels = this.pixels.slice(); this.backgroundDepth = this.depth.slice();
    } else { this.pixels.set(this.backgroundPixels); this.depth.set(this.backgroundDepth); }
    for (const tri of this.collect(scene, true)) this.raster(tri, matrix, false, evening);
    this.ctx.putImageData(this.image!, 0, 0);
  }
  dispose() { this.textures.clear(); this.backgroundPixels = new Uint8ClampedArray(0); this.backgroundDepth = new Float32Array(0); }
}
