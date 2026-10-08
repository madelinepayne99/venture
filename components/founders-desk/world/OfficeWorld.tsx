"use client";

import React, { useEffect, useRef, useState } from "react";
import { createOfficeWorld, type WorldEngine } from "./engine";
import type { AgentTaskSignal, WorldTarget } from "./layout";
import type { WorldMission, WorldContent } from "./studioState";
import "./world.css";

type Props = {
  // One continuous company world (Milestone 8 integration) — these are
  // the SAME real, unfiltered missions/leadAssignments/contentItems in
  // every workspace tab; only the mission board UI filters by workspace
  // (see hq/Room.tsx). Scout/Content Bot's positions never reset on a
  // tab switch. Typed via WorldMission/WorldContent (title included) so
  // the Content Studio's real plaque/screens can show a real mission
  // title, not just a state.
  missions: readonly WorldMission[];
  leadAssignments: readonly { mission_id: string; agent_key: string }[];
  contentItems: readonly WorldContent[];
  // Operations Wing (Milestone 7) — global, NOT room/workspace-filtered
  // either: these five agents have no workspace concept at all, so the
  // same real signals apply in every room instance. Defaults to [] so
  // this stays a backwards-compatible, additive prop for any other
  // caller (e.g. hq3d-prototype).
  agentTaskSignals?: readonly AgentTaskSignal[];
  onSelect: (target: WorldTarget) => void;
  onEngine?: (engine: WorldEngine | null) => void;
  onArrival?: (place: "hub" | "research" | "explore") => void;
  onMovement?: (moving: boolean) => void;
};

/** Drop-in client view. Pass the company's real missions/lead assignments/content items and existing handlers. */
export function OfficeWorld(props: Props) {
  const host = useRef<HTMLDivElement>(null), engine = useRef<WorldEngine | null>(null), latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current) return;
    try {
      const view = createOfficeWorld(host.current, {
        onSelect: target => latest.current.onSelect(target),
        onArrival: place => latest.current.onArrival?.(place),
        onMovement: moving => latest.current.onMovement?.(moving),
        onError: setError,
      });
      engine.current = view;
      view.syncWorld(
        latest.current.missions, latest.current.leadAssignments, latest.current.contentItems,
        latest.current.agentTaskSignals ?? [], true,
      );
      latest.current.onEngine?.(view);
      return () => { view.dispose(); engine.current = null; latest.current.onEngine?.(null); };
    } catch (cause) {
      console.error("Venture world initialization failed", cause);
      setError("This browser could not open the 3D view. You can still use the accessible room controls or Focus view.");
    }
  }, []);
  useEffect(() => {
    engine.current?.syncWorld(props.missions, props.leadAssignments, props.contentItems, props.agentTaskSignals ?? []);
  }, [props.missions, props.leadAssignments, props.contentItems, props.agentTaskSignals]);
  return <div className="vw-host" ref={host}>
    {error && <div className="vw-error" role="status"><strong>The world needs a graphics connection</strong><p>{error}</p><button onClick={() => props.onSelect("desk")}>Open founders’ desk</button></div>}
  </div>;
}
