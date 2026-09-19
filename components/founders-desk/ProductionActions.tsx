"use client";

import type { MissionDetailData } from "./MissionDetail";

/**
 * The real entry points into Content Bot's production lifecycle, shared
 * by both HQ View (MissionSlideOver) and Focus View — same real data,
 * same handlers, only the surrounding layout differs (see CLAUDE.md's HQ
 * Office UI milestone's "two views of one dataset" principle). Only
 * rendered when Scout's own latest report genuinely carries a
 * production_recommendation (never inferred), and only offers "Approve
 * for production" while no content item exists yet for this mission — one
 * content item in flight per mission, per the Content Bot milestone.
 */
export function ProductionActions({
  detail,
  busy,
  onOpenApproveForProduction,
  onOpenContentReview,
}: {
  detail: MissionDetailData;
  busy: boolean;
  onOpenApproveForProduction: () => void;
  onOpenContentReview: (contentItemId: string) => void;
}) {
  const { mission, contentItems } = detail;
  const latestReport = detail.followupReport ?? detail.scoutReport;
  const item = contentItems[0] ?? null;

  const canApproveForProduction =
    !item && mission.state === "ready_for_founders_review" && Boolean(latestReport?.production_recommendation);

  if (!canApproveForProduction && !item) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canApproveForProduction && (
        <button
          type="button"
          disabled={busy}
          onClick={onOpenApproveForProduction}
          className="rounded-md bg-hq-brass px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Approve for production
        </button>
      )}
      {item && (
        <button
          type="button"
          onClick={() => onOpenContentReview(item.id)}
          className="rounded-md border border-hq-teal/40 px-3 py-1.5 text-xs font-medium text-hq-teal"
        >
          View production ({item.state.replace(/_/g, " ")})
        </button>
      )}
    </div>
  );
}
