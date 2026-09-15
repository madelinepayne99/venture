import type { Founder, Mission, Project } from "@/lib/db/types";
import { FounderDesk } from "./FounderDesk";
import { ScoutDesk } from "./ScoutDesk";
import { MissionDock } from "./MissionDock";

/**
 * The stylised office scene — a visual layer over the exact same real
 * data Focus View shows. Nothing here is invented: founder desks come
 * from the real founders table, Scout only "works" when a real mission is
 * genuinely "researching", and the dock lists real missions. Toggling to
 * Focus View changes none of this data, only how it's presented.
 */
export function HQView({
  activeProject,
  founders,
  signedInFounderName,
  missions,
  selectedMissionId,
  onSelectMission,
}: {
  activeProject: Project | null;
  founders: Founder[];
  signedInFounderName: string;
  missions: Mission[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
}) {
  const isServiceBusiness = activeProject?.workspace_type === "service_business";
  const researchingMission = missions.find((m) => m.state === "researching") ?? null;

  if (!activeProject) {
    return (
      <div className="rounded-3xl border border-hq-brass/20 bg-white/70 p-10 text-center shadow-desk">
        <p className="text-sm text-hq-slate">
          No workspace selected yet. Create one from the workspace bar above, or switch to Focus
          View to get started.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-3xl border border-hq-brass/20 shadow-desk ${
        isServiceBusiness
          ? "bg-gradient-to-b from-hq-teal/10 via-hq-cream to-hq-cream"
          : "bg-gradient-to-b from-hq-brass/10 via-hq-cream to-hq-cream"
      }`}
    >
      {/* Window strip — purely decorative, gives the "high-rise" framing. */}
      <div className="flex gap-2 px-6 pt-6" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-8 flex-1 rounded-t-lg bg-gradient-to-b from-hq-tealDark/15 to-transparent"
          />
        ))}
      </div>

      <div className="px-6 pb-8 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-hq-slate">
          {activeProject.name} · {isServiceBusiness ? "Service-operations room" : "Research & strategy room"}
        </p>

        <div className="mt-8 flex flex-wrap items-end gap-10">
          {founders.map((founder) => (
            <FounderDesk
              key={founder.id}
              name={founder.name}
              isSignedInFounder={founder.name === signedInFounderName}
            />
          ))}

          <div className="h-12 w-px self-stretch bg-hq-brass/15" aria-hidden="true" />

          <ScoutDesk
            isWorking={Boolean(researchingMission)}
            onClick={researchingMission ? () => onSelectMission(researchingMission.id) : undefined}
          />
        </div>
      </div>

      <div className="border-t border-hq-brass/10 bg-white/50 px-6 py-4">
        <MissionDock
          missions={missions}
          selectedMissionId={selectedMissionId}
          onSelectMission={onSelectMission}
        />
      </div>
    </div>
  );
}
