import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildMaterials, material } from "./materials";
import { buildEnvironment } from "./environment";
import { buildScout } from "./scout";
import { findPath, MARKS, researchDestination, type Point, type WorldTarget } from "./layout";
import { SoftwareRenderer } from "./softwareRenderer";

export type WorldOptions = {
  onSelect: (target: WorldTarget) => void;
  onArrival?: (place: "hub" | "research" | "explore") => void;
  onMovement?: (moving: boolean) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
};
export type WorldEngine = ReturnType<typeof createOfficeWorld>;

/** Scene-only adapter: no API, storage, domain mutations, costs, or invented mission state. */
export function createOfficeWorld(host: HTMLDivElement, options: WorldOptions) {
  let disposed = false, frame = 0, lastTime = 0, elapsed = 0, reduced = false, exploring = false, working = false;
  let route: Point[] = [], arrival: "hub" | "research" | "explore" = "hub";
  let lastDestination: "hub" | "research" | undefined, moved = false;
  let pointerStart: { x: number; y: number } | null = null;
  const scene = new T.Scene(), m = buildMaterials();
  const camera = new T.OrthographicCamera(-8, 8, 6, -6, .1, 90);
  const probe = document.createElement("canvas"), context = probe.getContext("webgl2", { antialias: true, alpha: true });
  const renderer = context
    ? new T.WebGLRenderer({ canvas: probe, context, antialias: true, alpha: true })
    : new SoftwareRenderer();
  host.dataset.graphics = context ? "webgl" : "compatibility";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const canvas = renderer.domElement; canvas.className = "vw-canvas";
  canvas.setAttribute("aria-label", "Interactive Venture office. Use the room buttons for keyboard navigation.");
  host.appendChild(canvas);
  const controls = new OrbitControls(camera, canvas);
  controls.enableRotate = false; controls.enableDamping = true; controls.dampingFactor = .12;
  controls.minZoom = .7; controls.maxZoom = 2.8; controls.zoomSpeed = .7;
  controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
  controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_PAN };
  controls.screenSpacePanning = true;
  const target = new T.Vector3(0, .5, .18), offset = new T.Vector3(11, 14.5, 17);
  camera.position.copy(target).add(offset); controls.target.copy(target); controls.update();
  const ambient = new T.HemisphereLight("#f4f6ee", "#bdbaa3", 2.0); scene.add(ambient);
  const sun = new T.DirectionalLight("#fff0d5", 3.1); sun.position.set(-3.5, 10, 6.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .5, far: 30 });
  sun.shadow.normalBias = .018; sun.shadow.bias = -.00025; sun.shadow.radius = 3; scene.add(sun);
  const fill = new T.DirectionalLight("#d3e6eb", .5); fill.position.set(8, 6, -4); scene.add(fill);
  const ground = new T.Mesh(new T.PlaneGeometry(200, 200), material("#d7decd", 1));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.37; ground.receiveShadow = true; scene.add(ground);
  const environment = buildEnvironment(scene, m), scout = buildScout(m);
  scout.root.userData.target = "scout"; scout.root.position.set(MARKS.hub.x, .04, MARKS.hub.z); scout.root.rotation.y = .45; scene.add(scout.root);
  const scoutRing = new T.Mesh(new T.RingGeometry(.35, .382, 48), new T.MeshBasicMaterial({ color: "#d7ac5b", side: T.DoubleSide, transparent: true, opacity: .9 }));
  scoutRing.rotation.x = -Math.PI / 2; scoutRing.position.y = .045; scoutRing.visible = false; scene.add(scoutRing);
  const destinationRing = new T.Mesh(new T.RingGeometry(.18, .2, 32), new T.MeshBasicMaterial({ color: "#416a4d", side: T.DoubleSide, transparent: true, opacity: .7 }));
  destinationRing.rotation.x = -Math.PI / 2; destinationRing.visible = false; scene.add(destinationRing);

  const labels: { button: HTMLButtonElement; point: T.Vector3 }[] = [];
  const tag = (label: string, id: WorldTarget, point: T.Vector3) => {
    const button = document.createElement("button"); button.className = "vw-room-tag"; button.type = "button";
    button.textContent = label; button.dataset.worldTarget = id;
    button.setAttribute("aria-label", `Open ${label}`);
    button.addEventListener("click", () => options.onSelect(id)); host.appendChild(button); labels.push({ button, point });
    return button;
  };
  tag("Founders’ hub", "desk", new T.Vector3(-2.7, .03, 1.14));
  tag("Research room", "research", new T.Vector3(3.72, 2.6, -3.8));
  tag("The lounge", "lounge", new T.Vector3(3.7, .03, 3.79));
  const scoutTag = tag("Scout · Ready", "scout", new T.Vector3()); scoutTag.classList.add("vw-scout-tag");
  const scoutLabel = labels[labels.length - 1]!;
  const raycaster = new T.Raycaster(), mouse = new T.Vector2(), floorPlane = new T.Plane(new T.Vector3(0, 1, 0), -.04);
  const vector = new T.Vector3();
  let hover: WorldTarget | null = null;
  function pick(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    for (const hit of raycaster.intersectObjects([environment.root, scout.root], true)) {
      let object: T.Object3D | null = hit.object;
      while (object) { if (object.userData.target) return object.userData.target as WorldTarget; object = object.parent; }
      // Do not pick through walls/furniture to a hidden target.
      if (hit.object instanceof T.Mesh && hit.point.y > .25) return null;
    }
    return null;
  }
  function setMoving(value: boolean) { if (moved !== value) { moved = value; options.onMovement?.(value); } }
  function moveTo(point: Point, place: typeof arrival = "explore") {
    const path = findPath(scout.root.position, point);
    if (!path.length) return false;
    arrival = place;
    if (reduced) {
      route = []; scout.root.position.set(point.x, .04, point.z); scout.root.rotation.y = place === "research" ? Math.PI : .45;
      setMoving(false); options.onArrival?.(place); return true;
    }
    route = path; setMoving(true);
    destinationRing.position.set(point.x, .044, point.z); destinationRing.visible = place === "explore";
    return true;
  }
  const pointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; };
  const pointerMove = (event: PointerEvent) => {
    hover = pick(event); canvas.style.cursor = hover ? "pointer" : exploring ? "crosshair" : "grab";
  };
  const pointerUp = (event: PointerEvent) => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) { pointerStart = null; return; }
    pointerStart = null; const selected = pick(event);
    if (selected) options.onSelect(selected);
    else if (exploring && raycaster.ray.intersectPlane(floorPlane, vector)) moveTo({ x: vector.x, z: vector.z });
  };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerup", pointerUp);
  const contextLost = (event: Event) => { event.preventDefault(); options.onError?.("The 3D view paused. Reload the preview to reconnect your graphics device."); };
  canvas.addEventListener("webglcontextlost", contextLost);

  let baseHeight = 12;
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    // Project the whole furnished building into the fixed camera, then fit both axes.
    camera.updateMatrixWorld(); const corners: T.Vector3[] = [];
    for (const x of [-6, 6]) for (const z of [-4.7, 5.6]) for (const y of [-.4, 2.7]) corners.push(new T.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    const bounds = new T.Box3().setFromPoints(corners);
    baseHeight = Math.max(bounds.max.y - bounds.min.y + .6, (bounds.max.x - bounds.min.x + .8) / (w / h));
    camera.left = -baseHeight * w / h / 2; camera.right = -camera.left;
    camera.top = baseHeight / 2; camera.bottom = -camera.top; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  function motionChange() {
    reduced = media.matches;
    if (reduced && route.length) {
      const end = route[route.length - 1]!; scout.root.position.set(end.x, .04, end.z); route = [];
      setMoving(false); destinationRing.visible = false; options.onArrival?.(arrival);
    }
    controls.enableDamping = !reduced;
  }
  motionChange(); media.addEventListener("change", motionChange);
  function animate(time: number) {
    if (disposed) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0; lastTime = time;
    if (!document.hidden) elapsed += delta;
    if (route.length && !document.hidden) {
      const next = route[0]!, dx = next.x - scout.root.position.x, dz = next.z - scout.root.position.z, distance = Math.hypot(dx, dz);
      const step = 1.35 * delta;
      if (distance <= step) {
        scout.root.position.x = next.x; scout.root.position.z = next.z; route.shift();
        if (!route.length) {
          setMoving(false); destinationRing.visible = false;
          scout.root.rotation.y = arrival === "research" ? Math.PI : .45;
          options.onArrival?.(arrival);
        }
      } else {
        scout.root.position.x += dx / distance * step; scout.root.position.z += dz / distance * step;
        const yaw = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(yaw - scout.root.rotation.y), Math.cos(yaw - scout.root.rotation.y));
        scout.root.rotation.y += diff * Math.min(1, delta * 14);
      }
    }
    scout.animate(elapsed, route.length > 0, working && route.length === 0, reduced);
    scoutRing.visible = hover === "scout" || exploring;
    scoutRing.position.x = scout.root.position.x; scoutRing.position.z = scout.root.position.z;
    controls.update();
    // Keep panning bounded without changing the viewing direction.
    const cx = T.MathUtils.clamp(controls.target.x, -4, 4), cz = T.MathUtils.clamp(controls.target.z, -3, 3);
    camera.position.x += cx - controls.target.x; camera.position.z += cz - controls.target.z;
    controls.target.x = cx; controls.target.z = cz;
    scoutLabel.point.copy(scout.root.position).add(new T.Vector3(0, 1.41, 0));
    const scoutStatus = route.length ? "Scout · Walking" : working ? "Scout · Researching" : "Scout · Ready";
    if (scoutTag.textContent !== scoutStatus) {
      scoutTag.textContent = scoutStatus;
      scoutTag.setAttribute("aria-label", `Open ${scoutStatus}`);
    }
    for (const { button, point } of labels) {
      const pos = point.clone().project(camera), px = (pos.x + 1) / 2 * host.clientWidth, py = (-pos.y + 1) / 2 * host.clientHeight;
      button.style.transform = `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      button.style.visibility = Math.abs(pos.x) > .97 || Math.abs(pos.y) > .95 ? "hidden" : "visible";
    }
    if (!document.hidden && host.clientWidth && host.clientHeight) renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  frame = requestAnimationFrame(animate);
  host.dataset.worldReady = "true"; options.onReady?.();
  return {
    moveTo,
    setExploring(value: boolean) { exploring = value; },
    syncMissions(
      missions: readonly { id: string; state: string }[],
      leadAssignments: readonly { mission_id: string; agent_key: string }[],
      snap = false,
    ) {
      const next = researchDestination(missions, leadAssignments); working = next === "research";
      if (lastDestination === undefined || snap) {
        route = []; setMoving(false); const p = MARKS[next]; scout.root.position.set(p.x, .04, p.z); scout.root.rotation.y = next === "research" ? Math.PI : .45;
      } else if (next !== lastDestination) moveTo(MARKS[next], next);
      lastDestination = next;
    },
    focus(where: "all" | "desk" | "research" | "scout" | "lounge") {
      let p: T.Vector3;
      if (where === "all") { p = target; camera.zoom = 1; }
      else {
        p = where === "desk" ? new T.Vector3(-2.8, .5, -1) : where === "research" ? new T.Vector3(3, .5, -1.8) : where === "lounge" ? new T.Vector3(3, .35, 2) : scout.root.position.clone().add(new T.Vector3(0, .55, 0));
        camera.zoom = where === "scout" ? 2.7 : 1.65;
      }
      controls.target.copy(p); camera.position.copy(p).add(offset); camera.updateProjectionMatrix(); controls.update();
    },
    zoom(direction: number) { camera.zoom = T.MathUtils.clamp(camera.zoom * (direction > 0 ? 1.16 : 1 / 1.16), controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix(); },
    setEvening(value: boolean) {
      sun.color.set(value ? "#ffc986" : "#fff0d5"); sun.intensity = value ? 1.7 : 3.1;
      ambient.color.set(value ? "#b1c4cf" : "#f4f6ee"); ambient.intensity = value ? 1.1 : 2;
      renderer.toneMappingExposure = value ? 1.15 : 1.2;
      ground.material.color.set(value ? "#aab6ab" : "#d7decd");
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); media.removeEventListener("change", motionChange); controls.dispose();
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("webglcontextlost", contextLost);
      const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
      scene.traverse(object => { if (object instanceof T.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(mat => materials.add(mat)); } });
      materials.forEach(mat => { Object.values(mat).forEach(value => { if (value instanceof T.Texture) textures.add(value); }); mat.dispose(); });
      geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); sun.shadow.dispose(); renderer.dispose();
      labels.forEach(l => l.button.remove()); canvas.remove(); delete host.dataset.worldReady;
    },
  };
}
