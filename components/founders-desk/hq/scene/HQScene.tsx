"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Sprite, Texture } from "pixi.js";
import type { Mission } from "@/lib/db/types";
import { scoutLocationForMissions, type ScoutLocation } from "@/lib/domain/scoutLocation";
import { buildScoutRig, loadScoutTextures, type ScoutRig } from "./ScoutRig";

/**
 * The PixiJS HQ scene — founders' hub, a clear central corridor, and
 * Scout's separate research room, per the approved plan. The environment
 * is the founders' approved background art (`public/hq-scene/environment/
 * hq-background.png`, an empty room with no baked-in characters), used at
 * its native resolution rather than stretched to some arbitrary design
 * size — `DESIGN_WIDTH`/`DESIGN_HEIGHT` below ARE that image's real pixel
 * dimensions, so every other coordinate in this file (the desk's click
 * rect, Scout's hub/research standing marks) is a direct pixel reading
 * off the artwork itself, not a guess translated through a mismatched
 * design space. Scout is the one piece of real, approved character
 * artwork in this scene — see ScoutRig.ts.
 *
 * All real interaction and data flow through the same props/handlers
 * FoundersDeskApp already owns: `missions` is this room's real, already-
 * scoped mission list; `onSelectMission`/`onAssignWork` are the exact
 * functions MissionBoard's cards and "+ Assign work" button already call.
 * Nothing here fetches data or calls an API on its own.
 */

const BACKGROUND_URL = "/hq-scene/environment/hq-background.png";
// The background image's own native pixel dimensions — the design space
// IS the image, so nothing here stretches or letterboxes it.
const DESIGN_WIDTH = 2170;
const DESIGN_HEIGHT = 725;

// Every position below was read directly off the artwork (see the
// implementation report for the crop/inspection process): the left third
// is the founders' shared desk, the center is the archway corridor, the
// right third is Scout's research desk/shelving nook.
const FLOOR_Y = 390; // placement.y for Scout so its feet land on the rug, not the foreground ledge
const HUB_X = 1000; // open floor beside the founders' desk, at the corridor threshold
const RESEARCH_X = 1560; // open floor beside Scout's research desk/shelving
const WALK_SPEED_PX_PER_SEC = 190;
const PHASE_SPEED = (2 * Math.PI) / 1.25; // matches the reference prototype's gait frequency

// The founders' shared command desk, chairs, and monitors, read off the
// artwork's left third.
const DESK_RECT = { x: 170, y: 330, w: 680, h: 280 };
// A generous bounding box around Scout's rig (see ScoutRig.ts's joint
// offsets), centered on his current x position — wide/tall enough to
// cover head to feet at any gait phase without reaching into the desk
// or corridor's own click regions.
const SCOUT_HIT_HALF_WIDTH = 140;
const SCOUT_HIT_TOP = -185; // relative to FLOOR_Y
const SCOUT_HIT_BOTTOM = 250; // relative to FLOOR_Y

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function targetXFor(location: ScoutLocation): number {
  return location === "research_room" ? RESEARCH_X : HUB_X;
}

function pointInRect(p: { x: number; y: number }, rect: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

export default function HQScene({
  missions,
  onSelectMission,
  onAssignWork,
  interactive,
  projectId,
  roomLabel,
}: {
  missions: Mission[];
  onSelectMission: (missionId: string) => void;
  onAssignWork: () => void;
  interactive: boolean;
  projectId: string;
  roomLabel: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Kept in refs, not React state — the per-frame walk/idle tween runs on
  // Pixi's own ticker and must never trigger a React re-render itself.
  const missionsRef = useRef(missions);
  const onSelectMissionRef = useRef(onSelectMission);
  const onAssignWorkRef = useRef(onAssignWork);
  const interactiveRef = useRef(interactive);
  missionsRef.current = missions;
  onSelectMissionRef.current = onSelectMission;
  onAssignWorkRef.current = onAssignWork;
  interactiveRef.current = interactive;

  useEffect(() => {
    let destroyed = false;
    const app = new Application();
    let rig: ScoutRig | null = null;

    const currentX = { value: HUB_X };
    const targetX = { value: HUB_X };
    let moving = false;
    let phase = 0;
    // The last location Scout is actually AT (or walking to) — compared
    // every frame against the real, live-derived location so a genuine
    // change is caught exactly once, never replayed, never duplicated.
    let committedLocation: ScoutLocation = "founders_hub";

    function snapTo(location: ScoutLocation) {
      committedLocation = location;
      currentX.value = targetXFor(location);
      targetX.value = currentX.value;
      moving = false;
    }

    async function setup() {
      await app.init({
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
        autoDensity: true,
      });
      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }

      const canvas = app.canvas;
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.display = "block";
      hostRef.current?.appendChild(canvas);

      // --- Environment: the founders' approved background art ----------
      // The real, empty-of-characters room art — used at its native
      // resolution (see DESIGN_WIDTH/HEIGHT above), never stretched.
      const backgroundTexture = await Assets.load<Texture>(BACKGROUND_URL);
      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }
      const background = new Sprite(backgroundTexture);
      background.position.set(0, 0);
      background.width = DESIGN_WIDTH;
      background.height = DESIGN_HEIGHT;
      app.stage.addChild(background);

      // --- Scout ----------------------------------------------------------
      const textures = await loadScoutTextures();
      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }
      rig = buildScoutRig(textures);
      app.stage.addChild(rig.placement);

      // --- Click handling --------------------------------------------------
      // PixiJS's federated pointer-event hit-testing proved unreliable in
      // headless/software-WebGL environments during verification (the same
      // mapped point, hit-tested through Pixi's own EventBoundary, returned
      // a valid target on some calls and null on others within a single
      // click's over/move/down/up sequence — a Pixi-internal state issue
      // observed while tracing a failed "click Scout" test, not something
      // fixable from this file). A single native DOM click listener with
      // our own design-space coordinate mapping and rectangle hit-test is
      // simpler, deterministic, and exactly as real a click target.
      function designPointFromEvent(e: MouseEvent): { x: number; y: number } {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / rect.width) * DESIGN_WIDTH,
          y: ((e.clientY - rect.top) / rect.height) * DESIGN_HEIGHT,
        };
      }
      function scoutHitRect() {
        return {
          x: currentX.value - SCOUT_HIT_HALF_WIDTH,
          y: FLOOR_Y + SCOUT_HIT_TOP,
          w: SCOUT_HIT_HALF_WIDTH * 2,
          h: SCOUT_HIT_BOTTOM - SCOUT_HIT_TOP,
        };
      }
      canvas.addEventListener("click", (e) => {
        if (!interactiveRef.current) return;
        const p = designPointFromEvent(e);
        if (pointInRect(p, DESK_RECT)) {
          onAssignWorkRef.current();
          return;
        }
        if (pointInRect(p, scoutHitRect())) {
          const researching = missionsRef.current.find((m) => m.state === "researching");
          if (researching) onSelectMissionRef.current(researching.id);
          else onAssignWorkRef.current();
        }
      });
      canvas.addEventListener("mousemove", (e) => {
        if (!interactiveRef.current) {
          canvas.style.cursor = "default";
          return;
        }
        const p = designPointFromEvent(e);
        canvas.style.cursor = pointInRect(p, DESK_RECT) || pointInRect(p, scoutHitRect()) ? "pointer" : "default";
      });

      // Initial placement: snap to whatever the real state says right now
      // — this mount IS "initial load / workspace change", so there is no
      // journey to replay.
      snapTo(scoutLocationForMissions(missionsRef.current));
      rig.placement.position.set(currentX.value, FLOOR_Y);
      rig.update(0, false);

      app.ticker.add((ticker) => {
        if (!rig) return;
        const dt = ticker.deltaMS / 1000;
        phase += dt * PHASE_SPEED;

        // The one place a real transition is ever detected: compare the
        // live-derived location to what Scout is currently committed to.
        // A mismatch here is, by construction, a genuine change in the
        // real aggregate researching state since the last frame — never
        // inferred, never timer-driven.
        const desired = scoutLocationForMissions(missionsRef.current);
        if (desired !== committedLocation) {
          if (prefersReducedMotion()) {
            snapTo(desired);
          } else {
            // Retarget in place — if a walk is already underway this just
            // changes where the ongoing step converges to, never a second
            // tween and never a destination left stale.
            targetX.value = targetXFor(desired);
            committedLocation = desired;
          }
        }

        if (Math.abs(targetX.value - currentX.value) > 1) {
          moving = true;
          const step = WALK_SPEED_PX_PER_SEC * dt;
          const dir = targetX.value > currentX.value ? 1 : -1;
          currentX.value += dir * Math.min(step, Math.abs(targetX.value - currentX.value));
        } else {
          currentX.value = targetX.value;
          moving = false;
        }

        rig.placement.position.set(currentX.value, FLOOR_Y);
        rig.update(phase, moving);
      });
    }

    void setup();

    return () => {
      destroyed = true;
      try {
        app.destroy(true, { children: true });
      } catch {
        // Already destroyed or never finished initializing — fine.
      }
    };
    // Deliberately re-run the whole setup when the room identity changes
    // (a genuinely different workspace) so nothing carries over a stale
    // position from a different room's data. Mission/handler updates
    // flow through the refs above without remounting the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="relative">
      <div ref={hostRef} aria-hidden="true" />
      {/* Real, keyboard-reachable equivalents for the two canvas-only
          interactions this scene adds. MissionBoard's own visible
          "+ Assign work" button and mission cards are unaffected and
          remain the primary accessible path for those. */}
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        onClick={() => interactive && onAssignWork()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-hq-teal focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-white"
      >
        Open the shared command desk — assign work
      </button>
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        onClick={() => {
          if (!interactive) return;
          const researching = missions.find((m) => m.state === "researching");
          if (researching) onSelectMission(researching.id);
          else onAssignWork();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-hq-teal focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-white"
      >
        Open Scout — {missions.some((m) => m.state === "researching") ? "view the active mission" : "assign work"}
      </button>
      <p className="sr-only">{roomLabel}</p>
    </div>
  );
}
