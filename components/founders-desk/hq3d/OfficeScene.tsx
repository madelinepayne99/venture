"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ROOMS, AGENT_WORKSPACES } from "@/lib/domain/officeLayout";
import { buildRoomGeometry } from "./RoomGeometry";
import { buildFurniture } from "./Furniture";
import { buildScoutCharacter } from "./ScoutCharacter";

/**
 * The office prototype's canvas root — direct Three.js, no React Three
 * Fiber, no drei, no react-reconciler. See the implementation report:
 * the R3F/drei approach crashed with `Cannot read properties of
 * undefined (reading 'ReactCurrentOwner')` across webpack dev, Turbopack
 * dev, and a clean production build — a genuine upstream incompatibility
 * between `@react-three/fiber`'s eager `createRenderer()` call and this
 * project's Next.js/React setup. Plain `three` has no reconciler
 * dependency at all, so this sidesteps the issue entirely, following the
 * same imperative-mount-inside-`useEffect` pattern the existing PixiJS
 * `HQScene.tsx` already uses successfully elsewhere in this codebase.
 *
 * Stage A only: static layout, static Scout pose, camera pan/zoom via
 * Three's own `OrbitControls` (bounded, no free rotation). No movement,
 * no click handlers, no demo sequence yet.
 */

const BUILDING_MIN_X = Math.min(...ROOMS.map((r) => r.bounds.x0));
const BUILDING_MAX_X = Math.max(...ROOMS.map((r) => r.bounds.x1));
const BUILDING_MIN_Z = Math.min(...ROOMS.map((r) => r.bounds.z0));
const BUILDING_MAX_Z = Math.max(...ROOMS.map((r) => r.bounds.z1));
const CENTER_X = (BUILDING_MIN_X + BUILDING_MAX_X) / 2;
const CENTER_Z = (BUILDING_MIN_Z + BUILDING_MAX_Z) / 2;

// Lowered from the original 22° near-top-down tilt so furniture depth
// (desk fronts, monitor faces) and character faces read at all, while
// still staying an elevated floor-plan view, not an eye-level walkthrough.
const CAMERA_DISTANCE = 16;
const CAMERA_POLAR_ANGLE = THREE.MathUtils.degToRad(40);
const CAMERA_Y = Math.cos(CAMERA_POLAR_ANGLE) * CAMERA_DISTANCE;
const CAMERA_Z_OFFSET = Math.sin(CAMERA_POLAR_ANGLE) * CAMERA_DISTANCE;

const PAN_BOUNDS = {
  minX: BUILDING_MIN_X - 2,
  maxX: BUILDING_MAX_X + 2,
  minZ: BUILDING_MIN_Z - 2,
  maxZ: BUILDING_MAX_Z + 2,
};

const BUILDING_SPAN = Math.max(BUILDING_MAX_X - BUILDING_MIN_X, BUILDING_MAX_Z - BUILDING_MIN_Z);

export default function OfficeScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#BEE6F2");

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    camera.position.set(CENTER_X, CAMERA_Y, CENTER_Z + CAMERA_Z_OFFSET);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    // --- Camera controls: Three's own OrbitControls, directly, bounded ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(CENTER_X, 0, CENTER_Z);
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.minDistance = 8;
    controls.maxDistance = 24;
    controls.minPolarAngle = CAMERA_POLAR_ANGLE;
    controls.maxPolarAngle = CAMERA_POLAR_ANGLE;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    // OrbitControls has no built-in pan-bounding box — clamp the target
    // (and shift the camera by the same delta) against the floor plan's
    // extent by hand, on every control change.
    controls.addEventListener("change", () => {
      const clampedX = THREE.MathUtils.clamp(controls.target.x, PAN_BOUNDS.minX, PAN_BOUNDS.maxX);
      const clampedZ = THREE.MathUtils.clamp(controls.target.z, PAN_BOUNDS.minZ, PAN_BOUNDS.maxZ);
      const dx = clampedX - controls.target.x;
      const dz = clampedZ - controls.target.z;
      if (dx !== 0 || dz !== 0) {
        controls.target.x = clampedX;
        controls.target.z = clampedZ;
        camera.position.x += dx;
        camera.position.z += dz;
      }
    });
    controls.update();

    // --- Lighting: a real shadow-mapped key light for grounding shadows,
    // not a faked blob decal. Ambient + hemisphere only fill shadow
    // detail; they never cast.
    scene.add(new THREE.AmbientLight("#FFF4DE", 0.45));
    scene.add(new THREE.HemisphereLight("#DCEBFF", "#C9B98C", 0.3));

    const directional = new THREE.DirectionalLight("#FFEFCB", 1.6);
    directional.position.set(CENTER_X - 6, 12, CENTER_Z + 8);
    directional.target.position.set(CENTER_X, 0, CENTER_Z);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    const shadowHalfSize = BUILDING_SPAN * 0.65;
    directional.shadow.camera.left = -shadowHalfSize;
    directional.shadow.camera.right = shadowHalfSize;
    directional.shadow.camera.top = shadowHalfSize;
    directional.shadow.camera.bottom = -shadowHalfSize;
    directional.shadow.camera.near = 1;
    directional.shadow.camera.far = 40;
    directional.shadow.bias = -0.0004;
    directional.shadow.normalBias = 0.02;
    scene.add(directional);
    scene.add(directional.target);

    // --- Scene content ---
    scene.add(buildRoomGeometry());
    scene.add(buildFurniture());

    const scoutWorkspace = AGENT_WORKSPACES.find((w) => w.agentKey === "scout");
    let scout: ReturnType<typeof buildScoutCharacter> | null = null;
    if (scoutWorkspace) {
      scout = buildScoutCharacter();
      scout.root.position.set(scoutWorkspace.deskAnchor.x, 0, scoutWorkspace.deskAnchor.z);
      scout.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
      });
      scene.add(scout.root);
    }

    // Every mesh already built (room + furniture) receives shadows; most
    // also cast (set individually where it matters in RoomGeometry.ts /
    // Furniture.ts). Blanket-enable receiveShadow here so floor/walls/desk
    // tops all pick up the directional light's shadow map without having
    // to touch either builder file for this lighting-only pass.
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.receiveShadow = true;
    });

    function resize() {
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    let animationFrame: number;
    function animate() {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of materials) m.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={hostRef} className="h-full w-full" />;
}
