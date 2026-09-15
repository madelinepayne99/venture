import type { Founder, Mission, Project } from "@/lib/db/types";
import { RoomBackdrop } from "./RoomBackdrop";
import { Worker } from "./Worker";
import { MissionBoard } from "./MissionBoard";

/**
 * One office "suite" — a real workspace's room. Everything shown is real:
 * the founders come from the founders table, Scout only appears as
 * working when this workspace genuinely has a mission with
 * state === "researching", and the mission board lists this workspace's
 * real missions. `interactive` is false while this room is off-screen
 * during the HQ carousel's slide (see HQView.tsx) — its Scout desk,
 * "Assign work" trigger, and mission cards are still rendered (so the
 * slide animates smoothly) but are not reachable by click or keyboard
 * until it becomes the active room.
 */
export function Room({
  project,
  roomLabel,
  founders,
  signedInFounderName,
  missions,
  selectedMissionId,
  onSelectMission,
  onAssignWork,
  interactive,
}: {
  project: Project;
  roomLabel: string;
  founders: Founder[];
  signedInFounderName: string;
  missions: Mission[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onAssignWork: () => void;
  interactive: boolean;
}) {
  const researchingMission = missions.find((m) => m.state === "researching") ?? null;

  return (
    <div className="bg-night-bg">
      <div className="relative aspect-[1000/520] w-full overflow-hidden">
        <RoomBackdrop variant={project.workspace_type} />
        <div className="relative z-10 flex h-full flex-col px-8 pt-8">
          <p className="text-xs font-medium uppercase tracking-widest text-hq-brass/80">
            {project.name} · {roomLabel}
          </p>
          <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pb-6">
            {founders.map((founder) => (
              <Worker
                key={founder.id}
                kind="founder"
                label={founder.name}
                tone={founder.name === signedInFounderName ? "signed-in" : "peer"}
                isWorking={false}
              />
            ))}
            <Worker
              kind="scout"
              label="Scout"
              tone="scout"
              isWorking={Boolean(researchingMission)}
              onClick={researchingMission ? () => onSelectMission(researchingMission.id) : undefined}
              focusable={interactive}
            />
          </div>
        </div>
      </div>

      <MissionBoard
        missions={missions}
        selectedMissionId={selectedMissionId}
        onSelectMission={onSelectMission}
        onAssignWork={onAssignWork}
        focusable={interactive}
      />
    </div>
  );
}
