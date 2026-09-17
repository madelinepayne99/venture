import type { Mission, MissionLeadAssignment, Project } from "@/lib/db/types";
import { REAL_WORKSPACE_TYPES, mostRecentProjectOfType } from "./WorkspaceBar";
import { Room } from "./Room";

const ROOM_LABELS: Record<string, string> = {
  commerce: "Research & strategy office",
  service_business: "Service-operations office",
};

/**
 * The HQ scene — a "dollhouse" building with one office suite per real
 * workspace the founders have created so far. Switching workspaces (via
 * the top workspace bar) slides between these rooms rather than swapping
 * a flat panel out from under the founder. A room only ever exists for a
 * workspace type that already has a real project behind it — Content
 * Studio and Game Studio, having none, never get a room; that's the same
 * "must not pretend to have agents" rule the workspace bar already
 * follows, just applied to the office view too.
 */
export function HQView({
  projects,
  activeProjectId,
  missions,
  leadAssignments,
  selectedMissionId,
  onSelectMission,
  onAssignWork,
}: {
  projects: Project[];
  activeProjectId: string | null;
  missions: Mission[];
  leadAssignments: MissionLeadAssignment[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onAssignWork: () => void;
}) {
  const rooms = REAL_WORKSPACE_TYPES.map(({ type }) => mostRecentProjectOfType(projects, type))
    .filter((project): project is Project => project !== null)
    .map((project) => {
      const roomMissions = missions.filter((m) => m.project_id === project.id);
      const roomMissionIds = new Set(roomMissions.map((m) => m.id));
      return {
        project,
        missions: roomMissions,
        leadAssignments: leadAssignments.filter((a) => roomMissionIds.has(a.mission_id)),
      };
    });

  if (rooms.length === 0) {
    return (
      <div className="overflow-hidden rounded-3xl border border-hq-brass/30 bg-night-bg p-10 text-center shadow-desk">
        <p className="text-sm text-night-textDim">
          The office is unfurnished — no workspace exists yet. Create one from the workspace bar
          above, or switch to Focus View to get started.
        </p>
      </div>
    );
  }

  const foundIndex = rooms.findIndex((r) => r.project.id === activeProjectId);
  const activeIndex = foundIndex === -1 ? 0 : foundIndex;

  return (
    <div>
      <div className="overflow-hidden rounded-3xl border border-hq-brass/30 shadow-desk">
        <div
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none motion-reduce:duration-0"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {rooms.map((room, i) => (
            <div key={room.project.id} className="w-full shrink-0" aria-hidden={i !== activeIndex}>
              <Room
                project={room.project}
                roomLabel={ROOM_LABELS[room.project.workspace_type] ?? "Office"}
                missions={room.missions}
                leadAssignments={room.leadAssignments}
                selectedMissionId={selectedMissionId}
                onSelectMission={onSelectMission}
                onAssignWork={onAssignWork}
                interactive={i === activeIndex}
              />
            </div>
          ))}
        </div>
      </div>

      {rooms.length > 1 && (
        <p aria-live="polite" className="sr-only">
          Now viewing {rooms[activeIndex]?.project.name}
        </p>
      )}
    </div>
  );
}
