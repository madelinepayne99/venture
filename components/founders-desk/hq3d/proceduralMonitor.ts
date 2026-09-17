import * as THREE from "three";

/**
 * Shared procedural monitor — no monitor model exists in the KayKit
 * Furniture Bits pack (it's a home-furniture set, not office
 * electronics), so every desk in the isometric recomposition still uses
 * this primitive. Kept in one place so `IsometricOfficeScene.tsx` and
 * `FurnitureCornerTrial.tsx` don't duplicate it.
 */
export function buildProceduralMonitor(): THREE.Group {
  const group = new THREE.Group();
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.04, 0.05),
    new THREE.MeshStandardMaterial({ color: "#2B2B2B", roughness: 0.6 })
  );
  stand.position.y = 0.02;
  stand.castShadow = true;
  group.add(stand);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.24, 0.03),
    new THREE.MeshStandardMaterial({ color: "#1D1D1D", roughness: 0.4 })
  );
  bezel.position.y = 0.16;
  bezel.castShadow = true;
  group.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.2, 0.005),
    new THREE.MeshStandardMaterial({
      color: "#2E5C4E",
      emissive: "#1B4A3D",
      emissiveIntensity: 0.4,
      roughness: 0.3,
    })
  );
  screen.position.set(0, 0.16, 0.017);
  group.add(screen);

  return group;
}
