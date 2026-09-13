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
  scoutReport: ScoutReport | null;
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

export function MissionDetail({ detail }: { detail: MissionDetailData | null }) {
  if (!detail) {
    return (
      <div className="rounded-2xl border border-hq-brass/20 bg-white/50 p-5 text-sm text-hq-slate shadow-desk">
        Select a mission to see what Scout is doing.
      </div>
    );
  }

  const { mission, stages, evidence, scoutReport, costs, activity } = detail;
  const totalCost = costs.reduce((sum, c) => sum + c.usd_cost, 0);

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
        <>
          <Section title="Interpreted mission">{scoutReport.interpreted_mission}</Section>

          <Section title="Verdict">
            <span className="font-semibold">{scoutReport.verdict.replace(/_/g, " ")}</span> —{" "}
            {scoutReport.verdict_rationale}
          </Section>

          <Section title="Potential customer">{scoutReport.potential_customer}</Section>
          <Section title="Evidence of demand">{scoutReport.evidence_of_demand}</Section>
          <Section title="Competition observations">{scoutReport.competition_observations}</Section>
          <Section title="Opportunity gaps">{scoutReport.opportunity_gaps}</Section>
          <Section title="Originality considerations">{scoutReport.originality_considerations}</Section>

          <Section title="Platform suitability">
            <p>
              <span className="font-medium">Etsy downloads:</span> {scoutReport.platform_suitability.etsy_downloads}
            </p>
            <p className="mt-1">
              <span className="font-medium">Amazon KDP (print-on-demand):</span>{" "}
              {scoutReport.platform_suitability.amazon_kdp_print_on_demand}
            </p>
          </Section>

          <Section title="Estimated production difficulty">
            <span className="font-semibold capitalize">{scoutReport.estimated_production_difficulty.level}</span> —{" "}
            {scoutReport.estimated_production_difficulty.rationale}
          </Section>

          <Section title="Likely costs">{scoutReport.likely_costs.estimate}</Section>

          <Section title="Important risks">
            <ul className="list-disc space-y-1 pl-4">
              {scoutReport.important_risks.map((risk, i) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          </Section>

          <Section title="Copyright / trademark concerns">
            {scoutReport.copyright_trademark_concerns.length === 0 ? (
              <p className="text-hq-slate">None identified — still worth a manual check before listing.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                {scoutReport.copyright_trademark_concerns.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Verified facts">
            <ul className="space-y-1">
              {scoutReport.verified_facts.map((fact, i) => (
                <li key={i}>
                  {fact.statement}
                  {fact.source_url && (
                    <a
                      href={fact.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 text-hq-teal underline"
                    >
                      source
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Scout's inferences (not verified facts)">
            <ul className="list-disc space-y-1 pl-4 italic text-hq-slate">
              {scoutReport.inferences.map((inf, i) => (
                <li key={i}>{inf}</li>
              ))}
            </ul>
          </Section>

          <Section title="Unresolved questions">
            <ul className="list-disc space-y-1 pl-4">
              {scoutReport.unresolved_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Section>

          <Section title="Recommended next action">{scoutReport.recommended_next_action}</Section>
        </>
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
