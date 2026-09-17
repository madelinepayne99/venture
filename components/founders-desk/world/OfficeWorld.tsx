"use client";

import React, { useEffect, useRef, useState } from "react";
import { createOfficeWorld, type WorldEngine } from "./engine";
import type { WorldTarget } from "./layout";
import "./world.css";

type Props = {
  missions: readonly { id: string; state: string }[];
  leadAssignments: readonly { mission_id: string; agent_key: string }[];
  onSelect: (target: WorldTarget) => void;
  onEngine?: (engine: WorldEngine | null) => void;
  onArrival?: (place: "hub" | "research" | "explore") => void;
  onMovement?: (moving: boolean) => void;
  workspaceId?: string;
};

/** Drop-in client view. Pass the active workspace's real missions/lead assignments and existing handlers. */
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
      view.syncMissions(latest.current.missions, latest.current.leadAssignments, true);
      latest.current.onEngine?.(view);
      return () => { view.dispose(); engine.current = null; latest.current.onEngine?.(null); };
    } catch (cause) {
      console.error("Venture world initialization failed", cause);
      setError("This browser could not open the 3D view. You can still use the accessible room controls or Focus view.");
    }
  }, []);
  useEffect(() => {
    engine.current?.syncMissions(props.missions, props.leadAssignments);
  }, [props.missions, props.leadAssignments]);
  useEffect(() => {
    engine.current?.syncMissions(latest.current.missions, latest.current.leadAssignments, true);
  }, [props.workspaceId]);
  return <div className="vw-host" ref={host}>
    {error && <div className="vw-error" role="status"><strong>The world needs a graphics connection</strong><p>{error}</p><button onClick={() => props.onSelect("desk")}>Open founders’ desk</button></div>}
  </div>;
}
