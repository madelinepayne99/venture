"use client";

import type { MissionDetailData } from "./MissionDetail";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";

/**
 * The real entry points into Content Bot's production lifecycle, shared
 * by both HQ View (MissionSlideOver) and Focus View — same real data,
 * same handlers, only the surrounding layout differs (see CLAUDE.md's HQ
 * Office UI milestone's "two views of one dataset" principle).
 *
 * One Scout research mission may now host many independent productions
 * (CLAUDE.md's Content Bot multi-production milestone) — `contentItems` is
 * rendered here as the real list it already is (`getMissionDetail` has
 * always returned every content item for a mission; this component was
 * the one place that used to collapse it to `contentItems[0]`).
 *
 * Three mutually exclusive ways a founder can start THE FIRST production
 * on a mission, never inferred from mission state alone:
 *  - "Approve for production" — only when Scout's own latest report
 *    genuinely carries a production_recommendation.
 *  - "Commission Anyway" — the explicit founder override (see
 *    contentWorkflow.ts's commissionPilotAnyway), only when Scout's
 *    report has NO production_recommendation but still has real,
 *    evidence-backed research preserved.
 * Either way, only shown before any content item exists yet. Once at
 * least one production exists, "Produce Again" (see
 * contentWorkflow.ts's produceAgainFromMission) is what starts every
 * subsequent one — deliberately a separate action from the first two,
 * never folded into them, so a mission's first production and every later
 * one stay distinguishable in the real audit trail.
 */
export function ProductionActions({
  detail,
  busy,
  onOpenApproveForProduction,
  onOpenCommissionPilot,
  onOpenProduceAgain,
  onOpenContentReview,
}: {
  detail: MissionDetailData;
  busy: boolean;
  onOpenApproveForProduction: () => void;
  onOpenCommissionPilot: () => void;
  onOpenProduceAgain: () => void;
  onOpenContentReview: (contentItemId: string) => void;
}) {
  const { mission, contentItems } = detail;
  const latestReport = detail.followupReport ?? detail.scoutReport;
  const hasAnyProduction = contentItems.length > 0;

  const canApproveForProduction =
    !hasAnyProduction && mission.state === "ready_for_founders_review" && Boolean(latestReport?.production_recommendation);
  // The server (commissionPilotAnyway) is the real gate — it also checks
  // hasMeaningfulEvidence, which this client condition deliberately does
  // not try to duplicate. This just decides whether to show the
  // affordance at all; a genuinely ineligible mission gets a clear error
  // from the dialog instead.
  const canCommissionAnyway =
    !hasAnyProduction &&
    mission.state === "ready_for_founders_review" &&
    Boolean(latestReport) &&
    !latestReport?.production_recommendation;
  // produceAgainFromMission's own real gate is PRODUCIBLE_MISSION_STATES —
  // mirrored here only to decide whether to show the affordance at all;
  // the server re-checks everything for real.
  const canProduceAgain =
    hasAnyProduction &&
    (mission.state === "ready_for_founders_review" || mission.state === "in_production" || mission.state === "production_complete") &&
    Boolean(latestReport);

  if (!canApproveForProduction && !canCommissionAnyway && !hasAnyProduction) return null;

  return (
    <div className="space-y-2">
      {hasAnyProduction && (
        <ul className="space-y-1.5">
          {contentItems.map((item, index) => {
            const origin = (item.brief as ProductionBrief | undefined)?.source;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-hq-slate">
                  Production {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenContentReview(item.id)}
                  className="rounded-md border border-hq-teal/40 px-3 py-1.5 text-xs font-medium text-hq-teal"
                >
                  {item.state.replace(/_/g, " ")}
                </button>
                {origin === "founder_commissioned" && (
                  <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Founder Commissioned
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
        {canCommissionAnyway && (
          <button
            type="button"
            disabled={busy}
            onClick={onOpenCommissionPilot}
            title="Scout did not formally recommend this for production. You're choosing to proceed based on the research."
            className="rounded-md border-2 border-dashed border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-50"
          >
            Commission Anyway
          </button>
        )}
        {canProduceAgain && (
          <button
            type="button"
            disabled={busy}
            onClick={onOpenProduceAgain}
            title="Starts a brand-new, independent production from this mission's existing research — not a revision of an earlier video."
            className="rounded-md border-2 border-dashed border-hq-teal bg-hq-teal/10 px-3 py-1.5 text-xs font-semibold text-hq-teal disabled:opacity-50"
          >
            + Produce Again
          </button>
        )}
      </div>
    </div>
  );
}
