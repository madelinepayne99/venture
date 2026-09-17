import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Not called anywhere yet — no licensed/CC0 glTF assets exist in this
 * repo (see the Stage A visual-review report: this sandbox has no
 * network access to any 3D asset source, free or paid, so nothing has
 * been downloaded). This exists so that when real `.glb` files are added
 * under `public/hq3d-assets/`, swapping a procedural builder in
 * `Furniture.ts` for a loaded model is a one-line change per piece, not a
 * restructure: every `buildXxx()` function already returns a `THREE.Group`
 * positioned with its local origin at the floor (y = 0) under the piece's
 * footprint center, which is exactly the contract `placeModel` below
 * expects from a loaded scene too.
 *
 * Example future swap inside `Furniture.ts`'s `buildPiece()`:
 *   case "desk":
 *     return placeModel(await loadGLTFModel("/hq3d-assets/desk.glb"), size.w);
 */

export async function loadGLTFModel(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const root = new THREE.Group();
  root.add(gltf.scene);
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return root;
}

/**
 * Rescales a loaded model (whatever units its source used) so its
 * footprint matches this scene's own meter-scale units, then re-bases it
 * so the model's own floor sits at local y = 0 — matching every
 * procedural builder's convention, so callers never need to special-case
 * a loaded model's origin.
 */
export function placeModel(model: THREE.Group, targetWidth: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > 0) {
    const scale = targetWidth / size.x;
    model.scale.setScalar(scale);
  }
  const rescaledBox = new THREE.Box3().setFromObject(model);
  model.position.y -= rescaledBox.min.y;
  return model;
}

/**
 * Same floor re-basing as `placeModel`, but applies one literal scale
 * factor instead of independently width-matching each model — the right
 * choice when several pieces were authored together in the source pack's
 * own Blender scene (as KayKit's are: every glTF here shares the same
 * "furniture_texture" material and was exported from one file), so their
 * *relative* proportions are already correct and should be preserved
 * rather than each being independently stretched to a guessed width.
 * Derive `scale` once from one real, known dimension (e.g. a desk's real
 * height ÷ its raw glTF height) and reuse it for every piece in the
 * group.
 */
export function placeModelAtScale(model: THREE.Group, scale: number): THREE.Group {
  model.scale.setScalar(scale);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  return model;
}
