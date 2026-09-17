import type {
  ActivityEntry,
  AgentAssignment,
  Approval,
  CostEntry,
  Deliverable,
  Evidence,
  Mission,
} from "@/lib/db/types";
import type { ScoutReport } from "@/lib/agents/scout/schema";
import { StatusBadge } from "./StatusBadge";

export interface MissionDetailData {
  mission: Mission;
  stages: Array<{ id: string; stage_name: string; status: string; detail: string | null }>;
  assignments: AgentAssignment[];
  evidence: Evidence[];
  deliverables: Deliverable[];
  /** Pass 1's report — never overwritten once pass 2 runs. */
  scoutReport: ScoutReport | null;
  /** Pass 2's report — only present once the mission genuinely had a second research pass. */
  followupReport: ScoutReport | null;
  costs: CostEntry[];
  approvals: Approval[];
  activity: ActivityEntry[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hq-brass/10 pt-3 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-hq-slate">{title}</h4>
      <div className="mt-1 text-sm text-hq-ink">{children}</div>
    </div>
  );
}

/** One report's full body — reused for both pass 1 and pass 2, so neither shape drifts from the other. */
function ScoutReportBody({ report }: { report: ScoutReport }) {
  return (
    <>
      <Section title="Interpreted mission">{report.interpreted_mission}</Section>

      <Section title="Verdict">
        <span className="font-semibold">{report.verdict.replace(/_/g, " ")}</span> —{" "}
        {report.verdict_rationale}
      </Section>

      <Section title="Potential customer">{report.potential_customer}</Section>
      <Section title="Evidence of demand">{report.evidence_of_demand}</Section>
      <Section title="Competition observations">{report.competition_observations}</Section>

      {report.workspace_type === "commerce" && (
        <>
          <Section title="Opportunity gaps">{report.opportunity_gaps}</Section>
          <Section title="Originality considerations">{report.originality_considerations}</Section>

          <Section title="Platform suitability">
            <p>
              <span className="font-medium">Etsy downloads:</span>{" "}
              {report.platform_suitability.etsy_downloads}
            </p>
            <p className="mt-1">
              <span className="font-medium">Amazon KDP (print-on-demand):</span>{" "}
              {report.platform_suitability.amazon_kdp_print_on_demand}
            </p>
          </Section>

          <Section title="Estimated production difficulty">
            <span className="font-semibold capitalize">{report.estimated_production_difficulty.level}</span>{" "}
            — {report.estimated_production_difficulty.rationale}
          </Section>

          <Section title="Likely costs">{report.likely_costs.estimate}</Section>

          <Section title="Copyright / trademark concerns">
            {report.copyright_trademark_concerns.length === 0 ? (
              <p className="text-hq-slate">None identified — still worth a manual check before listing.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                {report.copyright_trademark_concerns.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {report.workspace_type === "service_business" && (
        <>
          <Section title="Service delivery considerations">{report.service_delivery_considerations}</Section>
          <Section title="Client retention / acquisition gaps">
            {report.client_retention_or_acquisition_gaps}
          </Section>

          <Section title="Pricing / service model considerations">
            <p>{report.pricing_or_service_model_considerations.summary}</p>
            {report.pricing_or_service_model_considerations.considerations.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {report.pricing_or_service_model_considerations.considerations.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Legal, privacy &amp; advertising notes">
            {report.regulatory_and_compliance_notes.length === 0 ? (
              <p className="text-hq-slate">None identified — still worth a manual check.</p>
            ) : (
              <ul className="space-y-2">
                {report.regulatory_and_compliance_notes.map((n, i) => (
                  <li key={i}>
                    <span
                      className={`mr-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                        n.source_quality === "primary_regulator"
                          ? "bg-status-success/15 text-status-success"
                          : "bg-status-danger/15 text-status-danger"
                      }`}
                    >
                      {n.source_quality === "primary_regulator" ? "Primary regulator" : "Secondary — verify independently"}
                    </span>
                    {n.note}
                    {n.source_url && (
                      <a href={n.source_url} target="_blank" rel="noreferrer" className="ml-1 text-hq-teal underline">
                        source
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section title="Important risks">
        <ul className="list-disc space-y-1 pl-4">
          {report.important_risks.map((risk, i) => (
            <li key={i}>{risk}</li>
          ))}
        </ul>
      </Section>

      <Section title="Verified facts">
        <ul className="space-y-1">
          {report.verified_facts.map((fact, i) => (
            <li key={i}>
              {fact.statement}
              {fact.source_url && (
                <a href={fact.source_url} target="_blank" rel="noreferrer" className="ml-1 text-hq-teal underline">
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Scout's inferences (not verified facts)">
        <ul className="list-disc space-y-1 pl-4 italic text-hq-slate">
          {report.inferences.map((inf, i) => (
            <li key={i}>{inf}</li>
          ))}
        </ul>
      </Section>

      <Section title="Unresolved questions">
        <ul className="list-disc space-y-1 pl-4">
          {report.unresolved_questions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </Section>

      <Section title="Recommended next action">{report.recommended_next_action}</Section>
    </>
  );
}

/**
 * The one clear, founder-facing signal for what "ready_for_founders_review"
 * actually means for this specific mission. A mission reaches this state
 * two structurally different ways (see missionWorkflow.ts's
 * nextStateForVerdict) — Scout genuinely recommending review, or two
 * automatic research passes both ending inconclusive — and mission.state
 * alone can't tell them apart, since both land in the same state by
 * design (see CLAUDE.md's evidence-loop milestone for why: reusing
 * ready_for_founders_review rather than adding a second mission state
 * keeps the future founder-approval-to-Content-Bot hand-off a single
 * gate). final_status/the report's own verdict carries the real
 * distinction; this banner is what makes it visible rather than requiring
 * a founder to read the whole report to notice.
 */
function FounderReviewBanner({ mission, latestVerdict }: { mission: Mission; latestVerdict: ScoutReport["verdict"] | undefined }) {
  if (mission.state === "rejected") {
    return (
      <div className="rounded-md border border-status-danger/30 bg-red-50 px-3 py-2 text-sm text-status-danger">
        <span className="font-semibold">Scout recommends rejection.</span> This opportunity is not worth pursuing.
      </div>
    );
  }

  if (mission.state !== "ready_for_founders_review") return null;

  const inconclusive = mission.final_status === "investigate_further" || latestVerdict === "investigate_further";

  if (inconclusive) {
    return (
      <div className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <p className="font-semibold uppercase tracking-wide text-xs text-amber-700">Founder review</p>
        <p className="mt-0.5">
          <span className="font-semibold">
            Evidence inconclusive after {mission.research_pass_count} investigation
            {mission.research_pass_count === 1 ? "" : "s"}.
          </span>{" "}
          Scout could not establish enough evidence to recommend this opportunity, and automatic research has
          stopped. This is not a recommendation either way — read the evidence below and decide.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-status-success/30 bg-status-success/10 px-3 py-2 text-sm text-hq-ink">
      <span className="font-semibold text-status-success">Scout recommends founder review.</span> Enough
      evidence was found to bring this to Ellis and Maddie for a decision.
    </div>
  );
}

export function MissionDetail({ detail }: { detail: MissionDetailData | null }) {
  if (!detail) {
    return (
      <div className="rounded-2xl border border-hq-brass/20 bg-white/50 p-5 text-sm text-hq-slate shadow-desk">
        Select a mission to see what Scout is doing.
      </div>
    );
  }

  const { mission, stages, evidence, scoutReport, followupReport, costs, activity } = detail;
  const totalCost = costs.reduce((sum, c) => sum + (c.usd_cost ?? 0), 0);
  const hasUnpricedCost = costs.some((c) => c.usd_cost === null);
  const latestReport = followupReport ?? scoutReport ?? undefined;

  return (
    <div className="max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-hq-ink">{mission.title}</h3>
          <StatusBadge state={mission.state} />
        </div>
        <p className="mt-1 text-sm text-hq-slate">{mission.brief}</p>
        {mission.failure_reason && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-status-danger">
            {mission.failure_reason}
          </p>
        )}
        <div className="mt-2">
          <FounderReviewBanner mission={mission} latestVerdict={latestReport?.verdict} />
        </div>
      </div>

      {stages.length > 0 && (
        <Section title="What Scout is doing">
          <ul className="space-y-1">
            {stages.map((stage) => (
              <li key={stage.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    stage.status === "completed"
                      ? "bg-status-success"
                      : stage.status === "failed"
                        ? "bg-status-danger"
                        : "bg-hq-brass"
                  }`}
                />
                <span className="capitalize">{stage.stage_name.replace(/_/g, " ")}</span>
                <span className="text-xs text-hq-slate">— {stage.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {scoutReport && (
        <div className="space-y-4">
          {followupReport && (
            <p className="text-xs font-bold uppercase tracking-wide text-hq-brass">Initial research</p>
          )}
          <ScoutReportBody report={scoutReport} />
        </div>
      )}

      {followupReport && (
        <div className="space-y-4 border-t-2 border-hq-brass/30 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-hq-brass">
            Follow-up investigation (pass {mission.research_pass_count})
          </p>
          <p className="text-xs text-hq-slate">
            A targeted second pass, focused specifically on the unresolved questions the initial research left
            open — not a repeat of the original research.
          </p>
          <ScoutReportBody report={followupReport} />
        </div>
      )}

      {evidence.length > 0 && (
        <Section title="Sources">
          <ul className="space-y-1">
            {evidence.map((e) => (
              <li key={e.id} className="text-xs">
                {e.source_url ? (
                  <a href={e.source_url} target="_blank" rel="noreferrer" className="text-hq-teal underline">
                    {e.source_title ?? e.source_url}
                  </a>
                ) : (
                  <span className="text-hq-slate">{e.snippet}</span>
                )}
                {e.source_date && <span className="ml-1 text-hq-slate">({e.source_date})</span>}
                <span className="ml-1 rounded bg-hq-parchment px-1 text-hq-slate">
                  {e.is_verified_fact ? "cited fact" : "consulted source"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {costs.length > 0 && (
        <Section title="Cost of this mission">
          ${totalCost.toFixed(4)} across {costs.length} model call{costs.length === 1 ? "" : "s"}
          {hasUnpricedCost && " (some usage has unknown pricing and is not included in this total)"}
        </Section>
      )}

      <Section title="Activity">
        <ul className="space-y-1 text-xs text-hq-slate">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="font-medium text-hq-ink">{a.action.replace(/_/g, " ")}</span>
              {" — "}
              {a.actor}
              {a.detail ? ` — ${a.detail}` : ""}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
