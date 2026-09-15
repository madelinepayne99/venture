import type { Mission } from "@/lib/db/types";
import {
  MISSION_DOCK_BUCKETS,
  MISSION_DOCK_BUCKET_LABELS,
  missionDockBucket,
} from "@/lib/domain/missionStates";

// A compact summary of real missions in the active workspace, grouped into
// the 6 dock buckets (see lib/domain/missionStates.ts for exactly how the
// 9 real mission states map onto them). Every mission shown here is a real
// row from the missions table — nothing is synthesised for this view.
export function MissionDock({
  missions,
  selectedMissionId,
  onSelectMission,
}: {
  missions: Mission[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1" role="list" aria-label="Missions by stage">
      {MISSION_DOCK_BUCKETS.map((bucket) => {
        const bucketMissions = missions.filter((m) => missionDockBucket(m.state) === bucket);
        return (
          <div key={bucket} role="listitem" className="min-w-[150px] flex-1">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-hq-slate">
              {MISSION_DOCK_BUCKET_LABELS[bucket]}{" "}
              <span className="text-hq-brassDark">({bucketMissions.length})</span>
            </p>
            <div className="space-y-1">
              {bucketMissions.length === 0 ? (
                <p className="rounded-md border border-dashed border-hq-brass/20 px-2 py-3 text-center text-[10px] text-hq-slate/50">
                  —
                </p>
              ) : (
                bucketMissions.map((mission) => (
                  <button
                    key={mission.id}
                    type="button"
                    onClick={() => onSelectMission(mission.id)}
                    className={`w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition ${
                      selectedMissionId === mission.id
                        ? "bg-hq-teal text-white"
                        : "bg-hq-parchment/70 text-hq-ink hover:bg-hq-parchment"
                    }`}
                    title={mission.title}
                  >
                    {mission.title}
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
