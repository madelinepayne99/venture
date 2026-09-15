import type { Mission } from "@/lib/db/types";
import {
  MISSION_DOCK_BUCKETS,
  MISSION_DOCK_BUCKET_LABELS,
  missionDockBucket,
  type MissionDockBucket,
} from "@/lib/domain/missionStates";

const BUCKET_ACCENTS: Record<MissionDockBucket, string> = {
  draft: "#8A8F98",
  awaiting_approval: "#C89B3C",
  researching: "#1E7A4C",
  awaiting_evidence: "#9C7A2E",
  completed: "#1E7A4C",
  failed: "#B3462C",
};

/**
 * The real mission dock, styled as a physical wall-mounted board — a
 * brass-framed panel of ticket-style cards with a status accent bar,
 * rather than a plain dashboard row. The data and grouping are identical
 * to a plain dock (see lib/domain/missionStates.ts's missionDockBucket):
 * every mission shown here is a real row from the missions table,
 * grouped into the same 6 buckets, still fully readable and clickable.
 * Nothing here is decorative UI standing in for real state — approval,
 * evidence, and cost still only ever appear in the mission slide-over.
 * `onAssignWork`, when provided, renders the one in-world "+ Assign work"
 * trigger for this room's real mission composer (see Room.tsx).
 */
export function MissionBoard({
  missions,
  selectedMissionId,
  onSelectMission,
  onAssignWork,
  focusable = true,
}: {
  missions: Mission[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onAssignWork?: () => void;
  focusable?: boolean;
}) {
  return (
    <div className="relative z-10 mx-6 mb-6 rounded-2xl border border-hq-brass/30 bg-night-panel p-4 shadow-desk">
      {/* mounting rivets, purely decorative */}
      <span className="absolute left-4 top-3 h-1.5 w-1.5 rounded-full bg-hq-brass/50" aria-hidden="true" />
      <span className="absolute right-4 top-3 h-1.5 w-1.5 rounded-full bg-hq-brass/50" aria-hidden="true" />

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-hq-brass" aria-hidden="true" />
          <p className="font-display text-xs font-semibold uppercase tracking-widest text-hq-brass">
            Mission board
          </p>
        </div>
        {onAssignWork && (
          <button
            type="button"
            tabIndex={focusable ? 0 : -1}
            onClick={() => focusable && onAssignWork()}
            className="rounded-md border border-hq-brass/50 bg-hq-brass/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-hq-brass transition hover:bg-hq-brass/20"
          >
            + Assign work
          </button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1" role="list" aria-label="Missions by stage">
        {MISSION_DOCK_BUCKETS.map((bucket) => {
          const bucketMissions = missions.filter((m) => missionDockBucket(m.state) === bucket);
          const accent = BUCKET_ACCENTS[bucket];
          return (
            <div key={bucket} role="listitem" className="min-w-[152px] flex-1">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-night-textDim">
                {MISSION_DOCK_BUCKET_LABELS[bucket]} <span className="text-hq-brass">({bucketMissions.length})</span>
              </p>
              <div className="space-y-1.5">
                {bucketMissions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-night-border px-2 py-3 text-center text-[10px] text-night-textDim/60">
                    —
                  </div>
                ) : (
                  bucketMissions.map((mission) => (
                    <button
                      key={mission.id}
                      type="button"
                      tabIndex={focusable ? 0 : -1}
                      onClick={() => focusable && onSelectMission(mission.id)}
                      title={mission.title}
                      style={{ borderLeftColor: accent }}
                      className={`w-full truncate rounded-md border-l-4 px-2 py-1.5 text-left text-xs shadow transition ${
                        selectedMissionId === mission.id
                          ? "bg-hq-teal text-white"
                          : "bg-night-panelLight text-night-text hover:bg-night-border"
                      } ${bucket === "researching" ? "motion-safe:animate-hq-glow" : ""}`}
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
    </div>
  );
}
