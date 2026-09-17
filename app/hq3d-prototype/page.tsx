"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

/**
 * An isolated, dev-only route for the 3D office prototype — never linked
 * from production navigation, not wired to `FoundersDeskApp.tsx`/
 * `HQView.tsx`/`Room.tsx`, no live mission data. Still behind the same
 * founder-auth middleware as every other route (no `routeGate.ts` change
 * needed — its matcher is already default-allow-when-authenticated).
 *
 * `IsometricOfficeScene` is direct Three.js — no React Three Fiber, no
 * drei, no react-reconciler (see the implementation report: the R3F/drei
 * approach crashed with `Cannot read properties of undefined (reading
 * 'ReactCurrentOwner')` across webpack dev, Turbopack dev, and a clean
 * production build — a genuine upstream incompatibility, not something
 * fixable from this file). `dynamic(..., { ssr: false })` here matches
 * the pattern `Room.tsx` already uses for the PixiJS `HQScene` — the
 * WebGL canvas only ever mounts client-side.
 *
 * The office gets the full main viewing area by default; Scout's
 * standalone model-study view lives behind a tab rather than a
 * permanent side panel, per the final layout pass's brief.
 */
const IsometricOfficeScene = dynamic(
  () => import("@/components/founders-desk/hq3d/IsometricOfficeScene"),
  { ssr: false }
);
const ScoutModelView = dynamic(() => import("@/components/founders-desk/hq3d/ScoutModelView"), { ssr: false });

type Tab = "office" | "scout";

export default function Hq3dPrototypePage() {
  const [tab, setTab] = useState<Tab>("office");

  return (
    <div className="flex h-screen flex-col bg-[#0B1420] text-white">
      <div className="border-b border-white/10 bg-[#0F1B2A] px-6 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          Dev prototype — not production
        </p>
        <h1 className="text-lg font-semibold">3D Office Prototype — compact connected layout</h1>
        <p className="mt-1 max-w-3xl text-xs text-white/60">
          Isolated route, local demo data only. No connection to real missions, no live handlers, not
          linked from the production app. Real KayKit chairs/lamp/plants + Scout&apos;s own desk; the
          founders&apos; shared desk, mission board, Scout&apos;s shelf/evidence board, and the reception
          bench are procedural. Drag to pan, scroll/pinch to zoom.
        </p>
      </div>
      <div className="flex border-b border-white/10 bg-[#0F1B2A] px-4">
        <button
          type="button"
          onClick={() => setTab("office")}
          className={`px-4 py-2 text-xs font-medium uppercase tracking-wide ${
            tab === "office" ? "border-b-2 border-amber-300 text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          Full office
        </button>
        <button
          type="button"
          onClick={() => setTab("scout")}
          className={`px-4 py-2 text-xs font-medium uppercase tracking-wide ${
            tab === "scout" ? "border-b-2 border-amber-300 text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          Scout model study
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <div className={tab === "office" ? "h-full w-full" : "hidden"}>
          <IsometricOfficeScene />
        </div>
        <div className={tab === "scout" ? "h-full w-full" : "hidden"}>
          <ScoutModelView />
        </div>
      </div>
    </div>
  );
}
