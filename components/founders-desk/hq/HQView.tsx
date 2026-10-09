import type { ContentItem, Mission, MissionLeadAssignment, Project } from "@/lib/db/types";
import type { AgentTaskSignal } from "../world/layout";
import { REAL_WORKSPACE_TYPES, mostRecentProjectOfType } from "./WorkspaceBar";
import { Room } from "./Room";

const ROOM_LABELS: Record<string, string> = {
  commerce: "Research & strategy office",
  service_business: "Service-operations office",
};

/**
 * One company world; business tabs filter the mission board, not agent
 * life (Milestone 8 integration, adopting the approved "Living Polish"
 * architecture). Previously (Milestones 4.1-7) each workspace tab mounted
 * its OWN separate Room/OfficeWorld instance, filtered to that tab's own
 * missions — meaning Scout/Content Bot's position and idle state were
 * silently reset every time a founder switched tabs, and (worse) a
 * mission's real state could make an agent appear busy in one tab's
 * scene while idle in another's, for the exact same real mission. That
 * directly contradicted CLAUDE.md's own Milestone 4.6 principle ("the
 * founders' desk, Scout's research desk, and Content Bot's workstation
 * all exist in the ONE HQ scene regardless of which workspace") — this
 * fixes it: one Room, one OfficeWorld, mounted once, receiving the real
 * unfiltered missions/leadAssignments/contentItems/agentTaskSignals
 * regardless of which workspace tab is active. Only the mission board
 * list inside Room.tsx filters by the active project — the physical
 * scene and every agent's real position never do.
 */
export function HQView({
  projects,
  activeProjectId,
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
}: {
  projects: Project[];
  activeProjectId: string | null;
  missions: Mission[];
  leadAssignments: MissionLeadAssignment[];
  contentItems: ContentItem[];
  // Global, unfiltered — see this file's own doc comment above.
  agentTaskSignals: readonly AgentTaskSignal[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onAssignWork: () => void;
  onOpenContentItem: (contentItemId: string) => void;
  onOpenAgentPanel: (agentKey: string) => void;
  /** Real count of items genuinely awaiting Founders' Desk review across
   * all seven agents right now (Commercial MVP Milestone 4) — surfaced as
   * a notification badge on the existing mission board. Not room-scoped:
   * the five Operations Wing agents' deliverables aren't workspace-bound,
   * so this is one real, honest total, not a per-room figure. */
  pendingReviewCount: number;
}) {
  const available = REAL_WORKSPACE_TYPES.map(({ type }) => mostRecentProjectOfType(projects, type))
    .filter((project): project is Project => project !== null);

  if (available.length === 0) {
    return (
      <div className="overflow-hidden rounded-3xl border border-hq-brass/30 bg-night-bg p-10 text-center shadow-desk">
        <p className="text-sm text-night-textDim">
          The office is unfurnished — no workspace exists yet. Create one from the workspace bar
          above, or switch to Focus View to get started.
        </p>
      </div>
    );
  }

  const project = available.find((p) => p.id === activeProjectId) ?? available[0]!;

  return (
    <div className="overflow-hidden rounded-3xl border border-hq-brass/30 shadow-desk">
      <Room
        project={project}
        roomLabel={ROOM_LABELS[project.workspace_type] ?? "Office"}
        missions={missions}
        leadAssignments={leadAssignments}
        contentItems={contentItems}
        agentTaskSignals={agentTaskSignals}
        selectedMissionId={selectedMissionId}
        onSelectMission={onSelectMission}
        onAssignWork={onAssignWork}
        onOpenContentItem={onOpenContentItem}
        onOpenAgentPanel={onOpenAgentPanel}
        pendingReviewCount={pendingReviewCount}
        interactive
      />
      <p aria-live="polite" className="sr-only">
        Mission board: {project.name}
      </p>
    </div>
  );
}
