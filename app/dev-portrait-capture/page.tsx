"use client";

import { useEffect, useRef } from "react";
import * as T from "three";
import { buildMaterials } from "@/components/founders-desk/world/materials";
import {
  buildScout,
  buildContentBot,
  buildChiefOfStaff,
  buildExecutiveAssistant,
  buildFinanceAgent,
  buildBusinessAnalyst,
  buildOperationsAgent,
} from "@/components/founders-desk/world/scout";

// A genuinely temporary, dev-only capture harness (Commercial MVP
// Milestone — Employee Directory portrait rebuild). It builds ONE real
// agent rig using the exact same, unmodified character-building
// functions the live 3D office uses (lib: components/founders-desk/world/
// scout.ts + materials.ts — never duplicated or re-implemented here),
// frames it for a head-and-shoulders portrait, and renders a single
// still frame. Used once, via a headless browser, to export real static
// PNG portraits into public/employee-portraits/ — see
// docs/venture-hq-commercial-mvp-progress.md for why this approach was
// chosen over fabricated 2D art or paid image-generation. Not linked
// from any real navigation; safe to delete once the assets are captured
// (kept for now so a portrait can be regenerated if a rig ever changes).
const BUILDERS = {
  scout: buildScout,
  content_bot: buildContentBot,
  chief_of_staff: buildChiefOfStaff,
  executive_assistant: buildExecutiveAssistant,
  finance_agent: buildFinanceAgent,
  business_analyst: buildBusinessAnalyst,
  operations_agent: buildOperationsAgent,
} satisfies Record<string, (m: ReturnType<typeof buildMaterials>) => { root: T.Group; animate: (...a: never[]) => void }>;

export default function PortraitCapturePage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const params = new URLSearchParams(window.location.search);
    const agentKey = params.get("agent") ?? "scout";
    const builder = BUILDERS[agentKey as keyof typeof BUILDERS];
    if (!builder) {
      host.textContent = `Unknown agent: ${agentKey}`;
      return;
    }

    const SIZE = 640;
    const scene = new T.Scene();
    // A solid, deliberate backdrop in the app's own real brand palette
    // (BRAND.md's hq-parchment, #F3E9D2) rather than relying on canvas
    // alpha — guarantees a consistent "studio portrait" look wherever the
    // resulting PNG is displayed, independent of surrounding UI.
    scene.background = new T.Color("#F3E9D2");

    // Scout is the only persona wearing a hat (fedora) — he needs extra
    // headroom to keep it in frame; every other, bare-headed rig reads
    // better with a tighter, lower crop centered on the head itself.
    const camera = new T.PerspectiveCamera(30, 1, 0.1, 10);
    if (agentKey === "scout") {
      camera.position.set(0.86, 1.6, 2.05);
      camera.lookAt(0, 1.12, 0);
    } else {
      camera.position.set(0.78, 1.32, 1.9);
      camera.lookAt(0, 0.92, 0);
    }

    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(2);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = T.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.id = "portrait-canvas";

    // Simple, flattering 3-point portrait lighting — independent of the
    // real room's own lighting rig, since this is an isolated studio
    // shot, not a scene render.
    const key = new T.DirectionalLight(0xfff3e0, 2.4);
    key.position.set(1.6, 2.4, 1.8);
    key.castShadow = false;
    scene.add(key);
    const fill = new T.DirectionalLight(0xd9ecff, 0.9);
    fill.position.set(-1.8, 1.1, 1.0);
    scene.add(fill);
    const rim = new T.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-0.4, 1.6, -1.8);
    scene.add(rim);
    scene.add(new T.AmbientLight(0xffffff, 0.55));

    const m = buildMaterials();
    const character = builder(m);
    scene.add(character.root);
    // One stable, neutral frame — reduced=true freezes breathing/blink/
    // gesture so the capture is crisp and repeatable, not mid-animation.
    character.animate(0, false, false, true, { seated: false });

    renderer.render(scene, camera);
    (window as unknown as { __captureReady?: boolean }).__captureReady = true;

    return () => {
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} style={{ width: 640, height: 640, background: "transparent" }} />;
}
