"use client";

import { useEffect, useState } from "react";
import type { BusinessAnalystReportRecord } from "@/lib/db/types";
import type { BusinessAnalystReport } from "@/lib/agents/businessAnalyst/schema";

type ReportRow = BusinessAnalystReportRecord<BusinessAnalystReport>;

/**
 * Business Analyst's one real capability (Operations Wing, Milestone 6):
 * standalone sourced research — independent of Scout's mission pipeline.
 * A real research call can take tens of real seconds (genuine web search
 * + model call), so this shows an honest "researching…" state rather than
 * pretending it's instant. Self-contained, same pattern as the other
 * Operations Wing panels.
 */
export function BusinessAnalystPanel() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [reportBusy, setReportBusy] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/business-analyst/research");
    if (!res.ok) return;
    const data = await res.json();
    setReports(data.reports ?? []);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/business-analyst/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not run that research request.");
        return;
      }
      setQuery("");
      await refresh();
      if (body.report?.id) setExpanded(body.report.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Business Analyst — Research</h2>
      <p className="mt-1 text-xs text-hq-slate">
        Real web-sourced research, separate from Scout&apos;s mission pipeline. A request can take up to a
        minute.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-2">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. How saturated is the printable planner niche on Etsy right now?"
          rows={2}
          className="w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!query.trim() || submitting}
          className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Researching…" : "Run research"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      {loading ? (
        <p className="mt-3 text-sm text-hq-slate">Loading…</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {reports.length === 0 && <li className="text-sm text-hq-slate">No research requests yet.</li>}
          {reports.map((r) => (
            <li key={r.id} className="rounded-lg bg-hq-parchment/50 p-3">
              <button
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-sm font-medium text-hq-ink">{r.query}</span>
                <span
                  className={`text-xs font-semibold ${r.state === "completed" ? "text-emerald-700" : "text-red-600"}`}
                >
                  {r.state === "completed" ? "Completed" : "Failed"}
                </span>
              </button>
              {expanded === r.id && (
                <div className="mt-2 space-y-2 text-sm text-hq-ink">
                  {r.state === "failed" ? (
                    <p className="text-xs text-red-600">{r.error}</p>
                  ) : r.report ? (
                    <>
                      <p>{r.report.summary}</p>
                      {r.report.opportunities.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">
                            Opportunities
                          </p>
                          <ul className="list-disc pl-4 text-xs">
                            {r.report.opportunities.map((o, i) => (
                              <li key={i}>{o}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {r.report.risks.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">Risks</p>
                          <ul className="list-disc pl-4 text-xs">
                            {r.report.risks.map((risk, i) => (
                              <li key={i}>{risk}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {r.report.sources.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">Sources</p>
                          <ul className="list-disc pl-4 text-xs">
                            {r.report.sources.map((s, i) => (
                              <li key={i}>
                                <a href={s.url} target="_blank" rel="noreferrer" className="text-hq-teal underline">
                                  {s.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* Founders' Desk (Commercial MVP Milestone 4) — the
                          genuine completed report, with its real sources
                          and cost, sent for founder review. */}
                      <button
                        type="button"
                        disabled={reportBusy === r.id || submittedIds.has(r.id)}
                        onClick={async () => {
                          setReportBusy(r.id);
                          try {
                            const res = await fetch(`/api/business-analyst/research/${r.id}/submit-for-review`, { method: "POST" });
                            if (res.ok) setSubmittedIds((prev) => new Set(prev).add(r.id));
                          } finally {
                            setReportBusy(null);
                          }
                        }}
                        className="rounded-md border border-hq-brass/30 px-2 py-1 text-xs font-semibold text-hq-teal disabled:opacity-50"
                      >
                        {submittedIds.has(r.id) ? "Sent to Founders' Desk" : "Submit for review"}
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
