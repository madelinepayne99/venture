import type { MissionState } from "@/lib/db/types";
import { MISSION_STATE_LABELS } from "@/lib/domain/missionStates";

const STATE_STYLES: Record<MissionState, string> = {
  draft: "bg-hq-parchment text-hq-slate",
  awaiting_founder_approval: "bg-hq-brass/20 text-hq-brassDark",
  queued: "bg-hq-brass/20 text-hq-brassDark",
  researching: "bg-hq-teal/15 text-hq-teal",
  awaiting_evidence: "bg-amber-100 text-amber-800",
  ready_for_founders_review: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-hq-parchment text-hq-slate",
  in_production: "bg-sky-100 text-sky-800",
  production_complete: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ state }: { state: MissionState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${STATE_STYLES[state]}`}
    >
      {MISSION_STATE_LABELS[state]}
    </span>
  );
}
