"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Mission, MissionLeadAssignment, Project } from "@/lib/db/types";
import { MissionBoard } from "./MissionBoard";

const OfficeWorld = dynamic(
  () => import("../world/OfficeWorld").then((mod) => mod.OfficeWorld),
  { ssr: false }
);

/**
 * One office "suite" — a real workspace's room, rendered with the
 * `components/founders-desk/world/` scene (direct Three.js — see its own
 * README, integrated verbatim per its "Integrate into the existing
 * Venture app" section). Everything the scene shows is derived from this
 * room's real missions and real lead assignments: `world/layout.ts`'s
 * `researchDestination` moves Scout to his research room only when a
 * mission is `researching` AND a real `agent_assignments` row names him
 * (not any agent) as its lead — never from mission state alone, so a
 * future second agent's work can never animate the wrong character. The
 * mission board below lists the same real missions Focus View would.
 *
 * The world's own `onSelect` targets are wired to the exact same real
 * handlers Focus View already uses — no new mission-creation path, no
 * new backend endpoint:
 *  - "desk" (and "scout"/"research" with nothing actually researching)
 *    open the real Assign Work modal.
 *  - "scout"/"research" while a mission is researching opens that
 *    mission's real detail slide-over.
 *  - "board" scrolls the real `MissionBoard` already rendered below the
 *    scene into view — the wall board and the dock are the same data,
 *    just two ways to reach it.
 *  - "lounge" has no backing feature yet; rather than silently doing
 *    nothing or fabricating one, clicking it shows a small, honestly
 *    labeled notice that there's nothing there yet.
 *
 * Only the active carousel room mounts a live scene (see `interactive`
 * below) — the world's own README asks for this specifically, so hidden
 * rooms never hold a second live WebGL context or remain reachable by
 * keyboard while off-screen.
 */
export function Room({
  project,
  roomLabel,
  missions,
  leadAssignments,
  selectedMissionId,
  onSelectMission,
  onAssignWork,
  interactive,
}: {
  project: Project;
  roomLabel: string;
  missions: Mission[];
  leadAssignments: MissionLeadAssignment[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onAssignWork: () => void;
  interactive: boolean;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [loungeNoticeOpen, setLoungeNoticeOpen] = useState(false);

  const activeResearch = missions.find((m) => m.state === "researching");

  function handleSelect(target: "desk" | "scout" | "board" | "research" | "lounge") {
    if (target === "desk") {
      onAssignWork();
    } else if (target === "scout" || target === "research") {
      if (activeResearch) onSelectMission(activeResearch.id);
      else onAssignWork();
    } else if (target === "board") {
      boardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      setLoungeNoticeOpen(true);
    }
  }

  return (
    <div className="bg-night-bg">
      <div className="relative w-full overflow-hidden" style={{ height: "70vh", minHeight: 420 }}>
        {interactive ? (
          <OfficeWorld
            workspaceId={project.id}
            missions={missions}
            leadAssignments={leadAssignments}
            onSelect={handleSelect}
          />
        ) : (
          <div className="h-full w-full bg-night-bg" aria-hidden="true" />
        )}
        {loungeNoticeOpen && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-hq-brass/40 bg-night-panel px-4 py-2 text-xs text-night-text shadow-desk"
          >
            The lounge — nothing to configure here yet.
            <button
              type="button"
              onClick={() => setLoungeNoticeOpen(false)}
              className="ml-3 text-hq-brass underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div ref={boardRef}>
        <MissionBoard
          missions={missions}
          selectedMissionId={selectedMissionId}
          onSelectMission={onSelectMission}
          onAssignWork={onAssignWork}
          focusable={interactive}
        />
      </div>
    </div>
  );
}
