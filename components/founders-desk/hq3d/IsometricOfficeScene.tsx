"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ROOMS, FURNITURE, FOUNDERS_DESK, AGENT_WORKSPACES, OFFICE_PALETTE } from "@/lib/domain/officeLayout";
import { buildRoomGeometry } from "./RoomGeometry";
import { buildFurniture } from "./Furniture";
import { buildScoutCharacter } from "./ScoutCharacter";
import { loadGLTFModel, placeModelAtScale } from "./modelLoader";
import { buildProceduralMonitor } from "./proceduralMonitor";

/**
 * Final bounded layout pass: a compact, connected ~10x9m building
 * (replacing the earlier 17x6 strip), a single continuous procedural
 * founders' desk (avoiding the previous two-KayKit-desks arrangement —
 * that never read as "one shared desk"), real KayKit chairs/lamp/plants,
 * and a fixed orthographic camera tuned to fill most of the frame with
 * the camera-facing perimeter walls hidden so the interior stays
 * readable.
 *
 * `data-assets-loaded` on the host element flips to `"true"` only once
 * every real asset has actually been added to the scene — screenshot
 * tooling should wait on that selector/attribute, not a guessed delay
 * (an earlier pass's screenshots looked broken because a fixed delay
 * fired before slower asset chains had finished).
 */

const KAYKIT_BASE = "/hq3d-assets/kaykit";

// One consistent scale factor for every KayKit piece, derived from a
// real, known dimension (desk height ~0.74m ÷ the pack's raw glTF
// height of 1.0 unit) — see `modelLoader.ts`'s `placeModelAtScale`.
const KAYKIT_SCALE = 0.74;
const EMERALD_TINT = new THREE.Color(OFFICE_PALETTE.emerald);

function tintUpholstery(model: THREE.Group, tint: THREE.Color) {
  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.color.set(tint);
        }
      }
    }
  });
}

function findBounds(id: string) {
  const piece = FURNITURE.find((f) => f.id === id);
  if (!piece) throw new Error(`Unknown furniture piece: ${id}`);
  return piece.bounds;
}

const BUILDING_MIN_X = Math.min(...ROOMS.map((r) => r.bounds.x0));
const BUILDING_MAX_X = Math.max(...ROOMS.map((r) => r.bounds.x1));
const BUILDING_MIN_Z = Math.min(...ROOMS.map((r) => r.bounds.z0));
const BUILDING_MAX_Z = Math.max(...ROOMS.map((r) => r.bounds.z1));
const CENTER_X = (BUILDING_MIN_X + BUILDING_MAX_X) / 2;
const CENTER_Z = (BUILDING_MIN_Z + BUILDING_MAX_Z) / 2;

// perimeter_south (larger-Z) and perimeter_east (larger-X) face this
// camera's offset direction almost head-on and would otherwise hide the
// interior — see officeLayout.ts's comment on these two wall ids.
const HIDDEN_WALL_IDS = ["perimeter_south", "perimeter_east"];

const POLAR_ANGLE = THREE.MathUtils.degToRad(55);
const AZIMUTH_ANGLE = THREE.MathUtils.degToRad(22);
const CAMERA_DISTANCE = 30;

// Derived once (see the implementation report) by projecting the
// building's 8 floor/wall-top corners onto this camera's actual
// right/up basis vectors, not guessed — the old 17x6 building's
// viewSize would leave this compact ~10x9 one occupying a small
// fraction of the frame.
const VIEW_SIZE = 4.9;
const TARGET_Y = 0.8;

const PAN_BOUNDS = {
  minX: BUILDING_MIN_X - 1,
  maxX: BUILDING_MAX_X + 1,
  minZ: BUILDING_MIN_Z - 1,
  maxZ: BUILDING_MAX_Z + 1,
};

export default function IsometricOfficeScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostEl = host;
    let cancelled = false;
    hostEl.dataset.assetsLoaded = "false";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#BEE6F2");

    const camera = new THREE.OrthographicCamera(-VIEW_SIZE, VIEW_SIZE, VIEW_SIZE, -VIEW_SIZE, 0.1, 80);
    const dir = new THREE.Vector3(
      Math.sin(POLAR_ANGLE) * Math.sin(AZIMUTH_ANGLE),
      Math.cos(POLAR_ANGLE),
      Math.sin(POLAR_ANGLE) * Math.cos(AZIMUTH_ANGLE)
    );
    camera.position.set(CENTER_X, TARGET_Y, CENTER_Z).addScaledVector(dir, CAMERA_DISTANCE);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed from this three.js version (silently
    // falls back to hard PCFShadowMap) — VSMShadowMap is the real soft-
    // shadow option now, with `shadow.radius`/`blurSamples` for softness.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(CENTER_X, TARGET_Y, CENTER_Z);
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.minZoom = 0.7;
    controls.maxZoom = 2.5;
    controls.minPolarAngle = POLAR_ANGLE;
    controls.maxPolarAngle = POLAR_ANGLE;
    controls.minAzimuthAngle = AZIMUTH_ANGLE;
    controls.maxAzimuthAngle = AZIMUTH_ANGLE;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
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

    scene.add(new THREE.AmbientLight("#FFF6E8", 0.7));
    scene.add(new THREE.HemisphereLight("#F3ECDA", "#D8CBA8", 0.45));
    const directional = new THREE.DirectionalLight("#FFF2D9", 1.05);
    directional.position.set(CENTER_X - 5, 10, CENTER_Z + 6);
    directional.target.position.set(CENTER_X, 0, CENTER_Z);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.radius = 6;
    directional.shadow.blurSamples = 20;
    const shadowHalf = Math.max(BUILDING_MAX_X - BUILDING_MIN_X, BUILDING_MAX_Z - BUILDING_MIN_Z) * 0.75;
    directional.shadow.camera.left = -shadowHalf;
    directional.shadow.camera.right = shadowHalf;
    directional.shadow.camera.top = shadowHalf;
    directional.shadow.camera.bottom = -shadowHalf;
    directional.shadow.camera.near = 1;
    directional.shadow.camera.far = 30;
    directional.shadow.bias = -0.0003;
    directional.shadow.normalBias = 0.02;
    scene.add(directional);
    scene.add(directional.target);

    // --- Existing prototype geometry, reused ---
    scene.add(buildRoomGeometry({ hiddenWallIds: HIDDEN_WALL_IDS }));
    const furnitureGroup = buildFurniture({
      skipIds: ["scout_workstation", "founders_planter", "scout_planter"],
      skipFoundersChairs: true,
    });
    scene.add(furnitureGroup);

    const scoutWorkspace = AGENT_WORKSPACES.find((w) => w.agentKey === "scout");
    if (scoutWorkspace) {
      const scout = buildScoutCharacter();
      scout.root.position.set(scoutWorkspace.deskAnchor.x, 0, scoutWorkspace.deskAnchor.z);
      scout.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
      });
      scene.add(scout.root);
    }

    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.receiveShadow = true;
    });

    // --- Real KayKit assets ---
    // Each distinct model is fetched exactly once, in parallel, then
    // placed by cloning — sequential per-placement fetches were slow
    // enough in an earlier pass that fixed-delay screenshots looked
    // broken before the chain had actually finished.
    async function loadRealAssets() {
      const [chairTemplate, lampTemplate, deskTemplate, plantTemplate] = await Promise.all([
        loadGLTFModel(`${KAYKIT_BASE}/chair_B.gltf`),
        loadGLTFModel(`${KAYKIT_BASE}/lamp_table.gltf`),
        loadGLTFModel(`${KAYKIT_BASE}/table_medium_long.gltf`),
        loadGLTFModel(`${KAYKIT_BASE}/cactus_small_A.gltf`),
      ]);
      if (cancelled) return;

      placeModelAtScale(chairTemplate, KAYKIT_SCALE);
      tintUpholstery(chairTemplate, EMERALD_TINT);
      placeModelAtScale(lampTemplate, KAYKIT_SCALE);
      placeModelAtScale(deskTemplate, KAYKIT_SCALE);
      placeModelAtScale(plantTemplate, KAYKIT_SCALE);

      // The procedural founders' desk (single continuous top, two
      // built-in monitors) is already in the scene via `furnitureGroup`
      // — only its two placeholder chairs were skipped. Query the real
      // built desk's own bounds rather than assuming its footprint, so
      // chair clearance is measured against what's actually there.
      const deskObj = furnitureGroup.getObjectByName("founders_desk");
      if (!deskObj) throw new Error("founders_desk not found in furniture group");
      deskObj.updateMatrixWorld(true);
      const deskBox = new THREE.Box3().setFromObject(deskObj);

      // This camera's offset direction makes *larger* z the side closer
      // to the camera (confirmed empirically in the previous pass — a
      // bright diagnostic material proved a chair placed at smaller z
      // was rendering, just fully occluded behind the desk's raised
      // tabletop). Chairs sit on the larger-z (near/unoccluded) side,
      // each in front of its own monitor.
      for (const seat of FOUNDERS_DESK.seats) {
        const chair = chairTemplate.clone(true);
        chair.position.x = seat.pos.x;
        chair.position.z = deskBox.max.z + 0.75;
        chair.rotation.y = Math.PI;
        scene.add(chair);
      }

      const lamp = lampTemplate.clone(true);
      lamp.position.set(deskBox.max.x - 0.18, deskBox.max.y, deskBox.min.z + 0.16);
      scene.add(lamp);

      // Scout's own single-person desk — a real, undistorted KayKit
      // model at its natural proportions, visibly smaller than the
      // founders' shared desk.
      const scoutDeskBounds = findBounds("scout_workstation");
      const scoutDeskCenter = {
        x: (scoutDeskBounds.x0 + scoutDeskBounds.x1) / 2,
        z: (scoutDeskBounds.z0 + scoutDeskBounds.z1) / 2,
      };
      const scoutDesk = deskTemplate.clone(true);
      scoutDesk.position.x = scoutDeskCenter.x;
      scoutDesk.position.z = scoutDeskCenter.z;
      scene.add(scoutDesk);
      scoutDesk.updateMatrixWorld(true);
      const scoutDeskBox = new THREE.Box3().setFromObject(scoutDesk);
      const scoutMonitor = buildProceduralMonitor();
      scoutMonitor.position.set(scoutDeskCenter.x, scoutDeskBox.max.y, scoutDeskBox.max.z - 0.14);
      scene.add(scoutMonitor);

      for (const plantId of ["founders_planter", "scout_planter"]) {
        const b = findBounds(plantId);
        const center = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
        const plant = plantTemplate.clone(true);
        plant.position.x = center.x;
        plant.position.z = center.z;
        scene.add(plant);
      }

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.receiveShadow = true;
      });

      if (!cancelled) hostEl.dataset.assetsLoaded = "true";
    }
    loadRealAssets().catch((err) => console.error("Isometric office asset load failed:", err));

    function resize() {
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const aspect = w / h;
      camera.left = -VIEW_SIZE * aspect;
      camera.right = VIEW_SIZE * aspect;
      camera.top = VIEW_SIZE;
      camera.bottom = -VIEW_SIZE;
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
      cancelled = true;
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

  return <div ref={hostRef} className="h-full w-full" data-assets-loaded="false" />;
}
