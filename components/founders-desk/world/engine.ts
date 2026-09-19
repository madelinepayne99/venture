import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildMaterials, material } from "./materials";
import { buildEnvironment } from "./environment";
import { buildScout, buildContentBot } from "./scout";
import {
  findPath,
  MARKS,
  agentDestination,
  agentBusy,
  SCOUT_AGENT_KEY,
  CONTENT_BOT_AGENT_KEY,
  type AgentStation,
  type Point,
  type WorldTarget,
} from "./layout";
import { nextIdlePoint } from "./idle";
import { SoftwareRenderer } from "./softwareRenderer";

export type WorldOptions = {
  onSelect: (target: WorldTarget) => void;
  onArrival?: (place: "hub" | "research" | "explore") => void;
  onMovement?: (moving: boolean) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
};
export type WorldEngine = ReturnType<typeof createOfficeWorld>;

type Character = { root: T.Group; animate: (time: number, moving: boolean, working: boolean, reduced: boolean) => void };

/**
 * Per-agent runtime state — the whole point of this shape. Nothing here is
 * ever derived from "is anything happening anywhere"; every rig's route,
 * working flag, and idle behavior comes only from that agent's own real
 * assignment data (see layout.ts's agentDestination/agentBusy), so Scout
 * researching one mission and Content Bot producing another are visibly,
 * independently true at the same time (CLAUDE.md's shared-world-
 * architecture milestone).
 */
interface Rig {
  key: string;
  worldTarget: WorldTarget;
  char: Character;
  ring: T.Mesh;
  tag: HTMLButtonElement;
  tagOffset: T.Vector3;
  home: Point;
  workingRotation: number;
  homeRotation: number;
  route: Point[];
  routeKind: "sync" | "explore" | "idle";
  arrival: AgentStation;
  lastDestination: AgentStation | undefined;
  working: boolean;
  idleHoldUntilMs: number;
  idleSeedTick: number;
  idleLabel: string;
  workingLabel: string;
}

/** Scene-only adapter: no API, storage, domain mutations, costs, or invented mission state. */
export function createOfficeWorld(host: HTMLDivElement, options: WorldOptions) {
  let disposed = false, frame = 0, lastTime = 0, elapsed = 0, reduced = false, exploring = false, anyMoving = false;
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
  const environment = buildEnvironment(scene, m);

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
  tag("Content Studio", "studio", new T.Vector3(0, .03, -3.4));

  function createRig(
    key: string,
    worldTarget: WorldTarget,
    char: Character,
    home: Point,
    homeRotation: number,
    workingRotation: number,
    ringColor: string,
    idleLabel: string,
    workingLabel: string,
  ): Rig {
    char.root.userData.target = worldTarget;
    char.root.position.set(home.x, .04, home.z); char.root.rotation.y = homeRotation;
    scene.add(char.root);
    const ring = new T.Mesh(new T.RingGeometry(.35, .382, 48), new T.MeshBasicMaterial({ color: ringColor, side: T.DoubleSide, transparent: true, opacity: .9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .045; ring.visible = false; scene.add(ring);
    const button = tag(`${idleLabel} · Ready`, worldTarget, new T.Vector3());
    button.classList.add("vw-scout-tag");
    if (key === CONTENT_BOT_AGENT_KEY) button.classList.add("vw-content-bot-tag");
    return {
      key, worldTarget, char, ring, tag: button, tagOffset: new T.Vector3(0, 1.41, 0),
      home, homeRotation, workingRotation,
      route: [], routeKind: "sync", arrival: "hub", lastDestination: undefined, working: false,
      idleHoldUntilMs: 0, idleSeedTick: 0,
      idleLabel, workingLabel,
    };
  }

  const rigs: Rig[] = [
    createRig(SCOUT_AGENT_KEY, "scout", buildScout(m), MARKS.hub, .45, Math.PI, "#d7ac5b", "Scout", "Researching"),
    createRig(CONTENT_BOT_AGENT_KEY, "content_bot", buildContentBot(m), MARKS.contentBotHome, .2, Math.PI * .75, "#5a9bd6", "Content Bot", "Producing"),
  ];

  const destinationRing = new T.Mesh(new T.RingGeometry(.18, .2, 32), new T.MeshBasicMaterial({ color: "#416a4d", side: T.DoubleSide, transparent: true, opacity: .7 }));
  destinationRing.rotation.x = -Math.PI / 2; destinationRing.visible = false; scene.add(destinationRing);

  const raycaster = new T.Raycaster(), mouse = new T.Vector2(), floorPlane = new T.Plane(new T.Vector3(0, 1, 0), -.04);
  const vector = new T.Vector3();
  let hover: WorldTarget | null = null;
  function pick(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const pickable = [environment.root, ...rigs.map(r => r.char.root)];
    for (const hit of raycaster.intersectObjects(pickable, true)) {
      let object: T.Object3D | null = hit.object;
      while (object) { if (object.userData.target) return object.userData.target as WorldTarget; object = object.parent; }
      // Do not pick through walls/furniture to a hidden target.
      if (hit.object instanceof T.Mesh && hit.point.y > .25) return null;
    }
    return null;
  }
  function stationPoint(station: AgentStation, rig: Rig): Point {
    if (station === "hub") return rig.home;
    return MARKS[station];
  }
  function moveRigTo(rig: Rig, point: Point, place: AgentStation, kind: "sync" | "explore" | "idle") {
    const path = findPath(rig.char.root.position, point);
    if (!path.length) return false;
    rig.arrival = place; rig.routeKind = kind;
    if (reduced) {
      rig.route = []; rig.char.root.position.set(point.x, .04, point.z);
      rig.char.root.rotation.y = place === "hub" ? rig.homeRotation : rig.workingRotation;
      if (kind !== "idle") options.onArrival?.(place === "hub" ? "hub" : place === "research" ? "research" : "explore");
      return true;
    }
    rig.route = path;
    if (kind === "explore") { destinationRing.position.set(point.x, .044, point.z); destinationRing.visible = true; }
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
    else if (exploring && raycaster.ray.intersectPlane(floorPlane, vector)) moveRigTo(rigs[0]!, { x: vector.x, z: vector.z }, "hub", "explore");
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
    if (reduced) {
      for (const rig of rigs) {
        if (!rig.route.length) continue;
        const end = rig.route[rig.route.length - 1]!;
        rig.char.root.position.set(end.x, .04, end.z); rig.route = [];
        options.onArrival?.(rig.arrival === "hub" ? "hub" : rig.arrival === "research" ? "research" : "explore");
      }
      destinationRing.visible = false;
      anyMoving = false; options.onMovement?.(false);
    }
    controls.enableDamping = !reduced;
  }
  motionChange(); media.addEventListener("change", motionChange);

  function animate(time: number) {
    if (disposed) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0; lastTime = time;
    if (!document.hidden) elapsed += delta;

    for (const rig of rigs) {
      if (rig.route.length && !document.hidden) {
        const next = rig.route[0]!, dx = next.x - rig.char.root.position.x, dz = next.z - rig.char.root.position.z, distance = Math.hypot(dx, dz);
        const step = 1.35 * delta;
        if (distance <= step) {
          rig.char.root.position.x = next.x; rig.char.root.position.z = next.z; rig.route.shift();
          if (!rig.route.length) {
            if (rig.routeKind === "explore") destinationRing.visible = false;
            rig.char.root.rotation.y = rig.arrival === "hub" ? rig.homeRotation : rig.workingRotation;
            if (rig.routeKind !== "idle") {
              options.onArrival?.(rig.arrival === "hub" ? "hub" : rig.arrival === "research" ? "research" : "explore");
            }
          }
        } else {
          rig.char.root.position.x += dx / distance * step; rig.char.root.position.z += dz / distance * step;
          const yaw = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(yaw - rig.char.root.rotation.y), Math.cos(yaw - rig.char.root.rotation.y));
          rig.char.root.rotation.y += diff * Math.min(1, delta * 14);
        }
      }
      rig.char.animate(elapsed, rig.route.length > 0, rig.working && rig.route.length === 0, reduced);
      rig.ring.visible = hover === rig.worldTarget || exploring;
      rig.ring.position.x = rig.char.root.position.x; rig.ring.position.z = rig.char.root.position.z;
    }

    // Idle wandering — purely cosmetic ("someone is here"), never an
    // activity signal. Only ever considered for a rig with no real route
    // and no real work, and disabled entirely under reduced motion.
    if (!reduced && !document.hidden) {
      for (const rig of rigs) {
        if (rig.route.length || rig.working) continue;
        if (elapsed < rig.idleHoldUntilMs) continue;
        const point = nextIdlePoint(rig.home, rig.idleSeedTick);
        rig.idleSeedTick += 1;
        rig.idleHoldUntilMs = elapsed + 6 + (rig.idleSeedTick % 3) * 2;
        moveRigTo(rig, point, "hub", "idle");
      }
    }

    controls.update();
    // Keep panning bounded without changing the viewing direction.
    const cx = T.MathUtils.clamp(controls.target.x, -4, 4), cz = T.MathUtils.clamp(controls.target.z, -3, 3);
    camera.position.x += cx - controls.target.x; camera.position.z += cz - controls.target.z;
    controls.target.x = cx; controls.target.z = cz;

    // "Moving" reflects any real (non-idle) route — onMovement is a
    // scene-level hook, not per-agent, so it's true whenever at least one
    // rig is genuinely walking.
    const nowMoving = rigs.some(r => r.route.length > 0);
    if (nowMoving !== anyMoving) { anyMoving = nowMoving; options.onMovement?.(anyMoving); }

    for (const rig of rigs) {
      const labelEntry = labels.find(l => l.button === rig.tag)!;
      labelEntry.point.copy(rig.char.root.position).add(rig.tagOffset);
      const status = rig.route.length ? `${rig.idleLabel} · Walking` : rig.working ? `${rig.idleLabel} · ${rig.workingLabel}` : `${rig.idleLabel} · Ready`;
      if (rig.tag.textContent !== status) {
        rig.tag.textContent = status;
        rig.tag.setAttribute("aria-label", `Open ${status}`);
      }
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

  function findRig(key: string): Rig | undefined { return rigs.find(r => r.key === key); }

  return {
    moveTo(point: Point, place: "hub" | "research" | "explore" = "explore") {
      return moveRigTo(rigs[0]!, point, place === "explore" ? "hub" : place, "explore");
    },
    setExploring(value: boolean) { exploring = value; },
    /**
     * Replaces syncMissions: takes the full, unsliced real missions,
     * lead assignments, and content items every tick — each rig filters
     * by its OWN agent key internally (via agentDestination/agentBusy),
     * never pre-sliced by a caller. This is deliberate: pre-slicing per
     * agent in a React component is exactly where the "any mission
     * researching -> move Scout" bug class would return.
     */
    syncWorld(
      missions: readonly { id: string; state: string }[],
      leadAssignments: readonly { mission_id: string; agent_key: string }[],
      contentItems: readonly { mission_id: string; state: string }[],
      snap = false,
    ) {
      for (const rig of rigs) {
        const next = agentDestination(missions, leadAssignments, contentItems, rig.key);
        rig.working = agentBusy(missions, leadAssignments, contentItems, rig.key);
        const point = stationPoint(next, rig);
        if (rig.lastDestination === undefined || snap) {
          rig.route = [];
          rig.char.root.position.set(point.x, .04, point.z);
          rig.char.root.rotation.y = next === "hub" ? rig.homeRotation : rig.workingRotation;
        } else if (next !== rig.lastDestination) {
          moveRigTo(rig, point, next, "sync");
        }
        rig.lastDestination = next;
      }
    },
    focus(where: "all" | "desk" | "research" | "scout" | "lounge" | "studio" | "content_bot") {
      let p: T.Vector3;
      if (where === "all") { p = target; camera.zoom = 1; }
      else if (where === "scout" || where === "content_bot") {
        const rig = findRig(where === "scout" ? SCOUT_AGENT_KEY : CONTENT_BOT_AGENT_KEY)!;
        p = rig.char.root.position.clone().add(new T.Vector3(0, .55, 0));
        camera.zoom = 2.7;
      } else {
        p = where === "desk" ? new T.Vector3(-2.8, .5, -1)
          : where === "research" ? new T.Vector3(3, .5, -1.8)
          : where === "lounge" ? new T.Vector3(3, .35, 2)
          : new T.Vector3(0, .5, -2.1); // studio
        camera.zoom = 1.65;
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
