"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ContentItem, Mission, MissionLeadAssignment, Project } from "@/lib/db/types";
import type { AgentTaskSignal, WorldTarget } from "../world/layout";
import { studioStatus } from "../world/studioState";
import { MissionBoard } from "./MissionBoard";

// Operations Wing (Milestone 7) — the five agents dispatched through
// agent_tasks, not missions. Clicking any of their desks/characters opens
// the same real detail every one of them already has in Focus View (see
// AgentDetailSlideOver.tsx) — never a second display for the same data.
const OPERATIONS_WING_TARGETS = new Set([
  "chief_of_staff", "executive_assistant", "finance_agent", "business_analyst", "operations_agent",
]);

const OfficeWorld = dynamic(
  () => import("../world/OfficeWorld").then((mod) => mod.OfficeWorld),
  { ssr: false }
);

/**
 * The shared company world (Milestone 8 integration — see HQView.tsx's
 * own doc comment for why this is now a single, continuously-mounted
 * scene rather than one per workspace tab) rendered with the
 * `components/founders-desk/world/` scene (direct Three.js). Everything
 * the scene shows is derived from the real, unfiltered missions/lead
 * assignments/content items/agent-task signals passed in — only the
 * `MissionBoard` below is scoped to this room's own `project`.
 * `world/layout.ts`'s `agentDestination` moves each agent only when a
 * real mission/content item/agent_tasks row genuinely names it as lead —
 * never from aggregate state, so one agent's real work can never animate
 * the wrong character.
 *
 * The world's own `onSelect` targets are wired to the exact same real
 * handlers Focus View already uses — no new mission-creation path, no
 * new backend endpoint:
 *  - "desk" (and "scout"/"research" with nothing actually researching)
 *    open the real Assign Work modal.
 *  - "scout"/"research" while a mission Scout genuinely leads is
 *    researching opens that mission's real detail slide-over.
 *  - "board" scrolls the real `MissionBoard` already rendered below the
 *    scene into view — the wall board and the dock are the same data,
 *    just two ways to reach it.
 *  - "studio"/"content_bot" opens Content Bot's real current item via
 *    `studioStatus` (now covering every real content-item state, not
 *    just generating/planning — a founder can reach a review-required
 *    or failed item this way too, not only an in-flight one).
 *  - the five Operations Wing targets open that agent's real detail via
 *    `AgentDetailSlideOver`.
 *  - "lounge" has no backing feature yet; rather than silently doing
 *    nothing or fabricating one, clicking it shows a small, honestly
 *    labeled notice that there's nothing there yet.
 */
export function Room({
  project,
  roomLabel,
  missions,
  leadAssignments,
  contentItems,
  agentTaskSignals,
  selectedMissionId,
  onSelectMission,
  onAssignWork,
  onOpenContentItem,
  onOpenAgentPanel,
  pendingReviewCount,
  interactive,
}: {
  project: Project;
  roomLabel: string;
  missions: Mission[];
  leadAssignments: MissionLeadAssignment[];
  contentItems: ContentItem[];
  // Global, not room-scoped — see OfficeWorld.tsx's own doc comment.
  agentTaskSignals: readonly AgentTaskSignal[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onAssignWork: () => void;
  onOpenContentItem: (contentItemId: string) => void;
  onOpenAgentPanel: (agentKey: string) => void;
  /** See HQView.tsx's own doc comment — a real, global, non-room-scoped count. */
  pendingReviewCount: number;
  interactive: boolean;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [loungeNoticeOpen, setLoungeNoticeOpen] = useState(false);
  const [studioNoticeOpen, setStudioNoticeOpen] = useState(false);

  const scoutMissions = new Set(leadAssignments.filter((a) => a.agent_key === "scout").map((a) => a.mission_id));
  // Scoped to Scout's own real lead assignment — a real, found-via-the-
  // approved-patch tightening: the original check matched ANY researching
  // mission regardless of who leads it, harmless only because Scout is
  // currently the sole agent that ever sets this state.
  const activeResearch = missions.find((m) => m.state === "researching" && scoutMissions.has(m.id));
  // The studio plaque and its click action use the same real, assigned
  // content item — review-required and failed items remain reachable
  // instead of becoming an idle notice (see studioState.ts).
  const productionDisplay = studioStatus(missions, leadAssignments, contentItems);

  function handleSelect(target: WorldTarget) {
    if (OPERATIONS_WING_TARGETS.has(target)) {
      onOpenAgentPanel(target);
    } else if (target === "desk") {
      onAssignWork();
    } else if (target === "scout" || target === "research") {
      if (activeResearch) onSelectMission(activeResearch.id);
      else onAssignWork();
    } else if (target === "board") {
      boardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (target === "studio" || target === "content_bot") {
      if (productionDisplay.itemId) onOpenContentItem(productionDisplay.itemId);
      else setStudioNoticeOpen(true);
    } else {
      setLoungeNoticeOpen(true);
    }
  }

  return (
    <div className="bg-night-bg">
      <div className="relative w-full overflow-hidden" style={{ height: "70vh", minHeight: 420 }}>
        {interactive ? (
          <OfficeWorld
            missions={missions}
            leadAssignments={leadAssignments}
            contentItems={contentItems}
            agentTaskSignals={agentTaskSignals}
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
        {studioNoticeOpen && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-hq-brass/40 bg-night-panel px-4 py-2 text-xs text-night-text shadow-desk"
          >
            Content Bot has nothing in production right now.
            <button
              type="button"
              onClick={() => setStudioNoticeOpen(false)}
              className="ml-3 text-hq-brass underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div ref={boardRef}>
        <MissionBoard
          missions={missions.filter((m) => m.project_id === project.id)}
          selectedMissionId={selectedMissionId}
          onSelectMission={onSelectMission}
          onAssignWork={onAssignWork}
          focusable={interactive}
          pendingReviewCount={pendingReviewCount}
        />
      </div>
    </div>
  );
}
