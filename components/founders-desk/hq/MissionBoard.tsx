import type { Mission } from "@/lib/db/types";
import {
  MISSION_DOCK_BUCKETS,
  MISSION_DOCK_BUCKET_LABELS,
  missionDockBucket,
} from "@/lib/domain/missionStates";

/**
 * The real mission dock, styled as a physical wall-mounted mission board
 * — a corkboard with pinned cards rather than a plain dashboard row. The
 * data and grouping are identical to a plain dock (see
 * lib/domain/missionStates.ts's missionDockBucket): every mission shown
 * here is a real row from the missions table, grouped into the same 6
 * buckets, still fully readable and clickable. Nothing here is decorative
 * UI standing in for real state — approval, evidence, and cost still only
 * ever appear in the mission slide-over.
 */
export function MissionBoard({
  missions,
  selectedMissionId,
  onSelectMission,
  focusable = true,
}: {
  missions: Mission[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  focusable?: boolean;
}) {
  return (
    <div
      className="relative z-10 mx-6 mb-6 rounded-2xl border-2 border-hq-brassDark/40 bg-[#F6EFDD] p-4 shadow-desk"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(32,38,43,0.06) 1px, transparent 1px)",
        backgroundSize: "10px 10px",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-hq-brassDark" aria-hidden="true" />
        <p className="font-display text-xs font-semibold uppercase tracking-wide text-hq-brassDark">
          Mission board
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1" role="list" aria-label="Missions by stage">
        {MISSION_DOCK_BUCKETS.map((bucket) => {
          const bucketMissions = missions.filter((m) => missionDockBucket(m.state) === bucket);
          return (
            <div key={bucket} role="listitem" className="min-w-[150px] flex-1">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-hq-slate">
                {MISSION_DOCK_BUCKET_LABELS[bucket]}{" "}
                <span className="text-hq-brassDark">({bucketMissions.length})</span>
              </p>
              <div className="space-y-1.5">
                {bucketMissions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-hq-brass/25 px-2 py-3 text-center text-[10px] text-hq-slate/50">
                    —
                  </div>
                ) : (
                  bucketMissions.map((mission, i) => (
                    <button
                      key={mission.id}
                      type="button"
                      tabIndex={focusable ? 0 : -1}
                      onClick={() => focusable && onSelectMission(mission.id)}
                      title={mission.title}
                      style={{ transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` }}
                      className={`relative w-full truncate rounded-sm px-2 py-1.5 text-left text-xs shadow transition ${
                        selectedMissionId === mission.id
                          ? "bg-hq-teal text-white"
                          : "bg-white text-hq-ink hover:bg-hq-parchment"
                      }`}
                    >
                      <span
                        className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-status-danger shadow"
                        aria-hidden="true"
                      />
                      {mission.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
