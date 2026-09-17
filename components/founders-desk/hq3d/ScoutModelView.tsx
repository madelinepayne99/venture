"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildScoutCharacter } from "./ScoutCharacter";

/**
 * A standalone, neutral-lit character view — not the office scene. The
 * office camera is locked to a bounded near-top-down tilt (see
 * `OfficeScene.tsx`), which is the wrong angle to judge whether Scout's
 * model actually reads as the approved character; this component exists
 * specifically so that judgment can be made from a normal front
 * three-quarter angle, full body, against a plain backdrop instead of the
 * office floor. Same `buildScoutCharacter()` rig, no separate model.
 */

// Scout's rig is ~0.77 world units tall (head top ≈ 0.77, feet at 0) —
// frame the camera around that, not the office's building-scale numbers.
const TARGET_HEIGHT = 0.36;

export default function ScoutModelView() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#D9D4C7");

    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 20);
    // Distance chosen so Scout's full ~0.77m height AND his ~0.5m width
    // (arms + satchel) both fit this panel's narrow portrait aspect —
    // two earlier attempts each fit only one axis and clipped the other
    // (arm/satchel off the sides, then feet off the bottom). Roughly
    // eye-level, ~35° off front for a three-quarter angle, with margin.
    camera.position.set(1.6, 0.85, 2.3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, TARGET_HEIGHT, 0);
    controls.minDistance = 1.8;
    controls.maxDistance = 3.6;
    controls.minPolarAngle = THREE.MathUtils.degToRad(50);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.enablePan = false;
    controls.update();

    // Neutral three-point-ish studio lighting: a key light (with real
    // shadow), a soft fill, and a dim rim for edge separation from the
    // backdrop — a normal character-review setup, not the office's warm
    // "desk lamp at night" mood.
    scene.add(new THREE.AmbientLight("#FFFFFF", 0.55));
    const key = new THREE.DirectionalLight("#FFFBEF", 1.4);
    key.position.set(1.4, 1.8, 1.2);
    key.target.position.set(0, TARGET_HEIGHT, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1;
    key.shadow.camera.right = 1;
    key.shadow.camera.top = 1;
    key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 6;
    key.shadow.bias = -0.001;
    scene.add(key);
    scene.add(key.target);

    const fill = new THREE.DirectionalLight("#E9F0FF", 0.5);
    fill.position.set(-1.3, 0.9, 0.6);
    scene.add(fill);

    const rim = new THREE.DirectionalLight("#FFFFFF", 0.4);
    rim.position.set(-0.4, 1.1, -1.4);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 48),
      new THREE.MeshStandardMaterial({ color: "#C7C0AE", roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const scout = buildScoutCharacter();
    scout.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = true;
    });
    scene.add(scout.root);

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
