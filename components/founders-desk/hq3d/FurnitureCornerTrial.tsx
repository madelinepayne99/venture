"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadGLTFModel, placeModel } from "./modelLoader";
import { buildProceduralMonitor } from "./proceduralMonitor";

/**
 * The one-corner asset trial: real, licensed glTF furniture (KayKit
 * Furniture Bits 1.0 by Kay Lousberg, CC0 — see
 * `public/hq3d-assets/kaykit/KAYKIT_LICENSE.txt`) loaded via
 * `modelLoader.ts`, not procedural primitives. This is deliberately a
 * separate, standalone scene — it does not touch `Furniture.ts` or
 * `OfficeScene.tsx` (the main office/Stage A camera+lighting pass stays
 * paused exactly as delivered) so this trial can be judged on its own
 * before any decision to swap the main scene's furniture over.
 *
 * The pack has no monitor model (it's a home-furniture set — beds,
 * tables, chairs, lamps, cacti — not office electronics), so the monitor
 * here is still the same procedural primitive as `Furniture.ts`, kept
 * visually distinct on purpose rather than dressed up to look "finished."
 */

const KAYKIT_BASE = "/hq3d-assets/kaykit";

function buildBackdrop(): THREE.Group {
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshStandardMaterial({ color: "#DCD3BE", roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2.4),
    new THREE.MeshStandardMaterial({ color: "#EFE8D8", roughness: 0.95 })
  );
  wall.position.set(0, 1.2, -1.3);
  wall.receiveShadow = true;
  group.add(wall);

  // A simple window: frame + a lighter "glass" inset, flat against the
  // back wall — not a real opening, just enough to judge the corner
  // against a window the way the original brief asked for.
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 0.04),
    new THREE.MeshStandardMaterial({ color: "#6B4226", roughness: 0.55 })
  );
  frame.position.set(0.9, 1.5, -1.28);
  frame.castShadow = true;
  group.add(frame);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.95),
    new THREE.MeshStandardMaterial({ color: "#BEE6F2", roughness: 0.15, metalness: 0.1 })
  );
  glass.position.set(0.9, 1.5, -1.26);
  group.add(glass);

  const mullionV = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.95, 0.02),
    new THREE.MeshStandardMaterial({ color: "#6B4226", roughness: 0.55 })
  );
  mullionV.position.set(0.9, 1.5, -1.255);
  group.add(mullionV);

  const mullionH = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.03, 0.02),
    new THREE.MeshStandardMaterial({ color: "#6B4226", roughness: 0.55 })
  );
  mullionH.position.set(0.9, 1.5, -1.255);
  group.add(mullionH);

  return group;
}

export default function FurnitureCornerTrial() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#BEE6F2");

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 20);
    camera.position.set(1.9, 1.7, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.minDistance = 1.8;
    controls.maxDistance = 5;
    controls.minPolarAngle = THREE.MathUtils.degToRad(35);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.update();

    scene.add(new THREE.AmbientLight("#FFF4DE", 0.5));
    scene.add(new THREE.HemisphereLight("#DCEBFF", "#C9B98C", 0.3));
    const directional = new THREE.DirectionalLight("#FFEFCB", 1.5);
    directional.position.set(-2, 3.5, 2.5);
    directional.target.position.set(0, 0, 0);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.camera.left = -3;
    directional.shadow.camera.right = 3;
    directional.shadow.camera.top = 3;
    directional.shadow.camera.bottom = -3;
    directional.shadow.camera.near = 0.5;
    directional.shadow.camera.far = 12;
    directional.shadow.bias = -0.0004;
    scene.add(directional);
    scene.add(directional.target);

    scene.add(buildBackdrop());

    async function loadCorner() {
      const desk = placeModel(await loadGLTFModel(`${KAYKIT_BASE}/table_medium_long.gltf`), 1.6);
      if (cancelled) return;
      desk.position.set(0, 0, 0);
      scene.add(desk);
      desk.updateMatrixWorld(true);
      const deskBox = new THREE.Box3().setFromObject(desk);
      const deskTopY = deskBox.max.y;
      const deskBackZ = deskBox.min.z;
      const deskRightX = deskBox.max.x;

      const chairA = placeModel(await loadGLTFModel(`${KAYKIT_BASE}/armchair.gltf`), 0.55);
      if (cancelled) return;
      chairA.position.set(-0.55, 0, 0.75);
      chairA.rotation.y = Math.PI;
      scene.add(chairA);

      const chairB = placeModel(await loadGLTFModel(`${KAYKIT_BASE}/armchair.gltf`), 0.55);
      if (cancelled) return;
      chairB.position.set(0.55, 0, 0.75);
      chairB.rotation.y = Math.PI;
      scene.add(chairB);

      const lamp = placeModel(await loadGLTFModel(`${KAYKIT_BASE}/lamp_table.gltf`), 0.16);
      if (cancelled) return;
      lamp.position.set(deskRightX - 0.14, deskTopY, deskBackZ + 0.16);
      scene.add(lamp);

      const plant = placeModel(await loadGLTFModel(`${KAYKIT_BASE}/cactus_small_A.gltf`), 0.32);
      if (cancelled) return;
      plant.position.set(1.25, 0, 0.35);
      scene.add(plant);

      // Procedural monitor — no licensed model exists for this in the
      // KayKit pack, so it stays a clearly separate primitive rather than
      // being passed off as another loaded asset.
      const monitor = buildProceduralMonitor();
      monitor.position.set(-0.35, deskTopY, deskBackZ + 0.14);
      scene.add(monitor);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.receiveShadow = true;
      });
    }
    loadCorner().catch((err) => console.error("Furniture corner trial failed to load:", err));

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

  return <div ref={hostRef} className="h-full w-full" />;
}
