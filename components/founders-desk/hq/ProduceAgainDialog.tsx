"use client";

import { useEffect, useState } from "react";
import type { Evidence, Mission } from "@/lib/db/types";
import type { ScoutReport } from "@/lib/agents/scout/schema";
import type { AudienceContext } from "@/lib/media/types";

export interface ProduceAgainInput {
  targetPlatform: AudienceContext["platform"];
  audience: AudienceContext["audience"];
  contentType: AudienceContext["contentType"];
  selectedEvidenceIds: string[];
  concept: string;
  creativeDirection: string;
  founderNotes: string | null;
}

const PLATFORMS: Array<{ value: AudienceContext["platform"]; label: string }> = [
  { value: "youtube_shorts", label: "YouTube Shorts" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
];
const AUDIENCES: Array<{ value: AudienceContext["audience"]; label: string }> = [
  { value: "general", label: "General audience" },
  { value: "teen", label: "Teen" },
  { value: "kids", label: "Kids" },
];
const CONTENT_TYPES: Array<{ value: AudienceContext["contentType"]; label: string }> = [
  { value: "educational", label: "Educational" },
  { value: "comedy", label: "Comedy" },
  { value: "commentary", label: "Commentary" },
  { value: "product", label: "Product" },
  { value: "story", label: "Story / narrative" },
];

/**
 * "Produce Again" (see contentWorkflow.ts's produceAgainFromMission) —
 * starts a genuinely new, independent production from this mission's
 * existing, unmutated Scout research. Deliberately its own dialog, not a
 * mode flag on CommissionPilotDialog: this is not a founder overriding
 * Scout's judgment (no amber "override" treatment) — it's an ordinary,
 * expected action once research exists, so it uses the app's own primary
 * (teal/brass) palette instead. `initialValues` pre-fills sensible
 * defaults from the founder's most recent commission on this mission (a
 * convenience only — nothing is submitted until the founder explicitly
 * presses "Produce Again" below, exactly as this milestone's founder
 * requirements specify).
 */
export function ProduceAgainDialog({
  open,
  mission,
  report,
  evidence,
  initialValues,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mission: Mission;
  report: ScoutReport | null;
  evidence: Evidence[];
  initialValues?: Partial<ProduceAgainInput>;
  busy: boolean;
  error: string | null;
  onSubmit: (input: ProduceAgainInput) => void;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<AudienceContext["platform"]>(initialValues?.targetPlatform ?? "youtube_shorts");
  const [audience, setAudience] = useState<AudienceContext["audience"]>(initialValues?.audience ?? "general");
  const [contentType, setContentType] = useState<AudienceContext["contentType"]>(initialValues?.contentType ?? "educational");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () =>
      new Set(
        initialValues?.selectedEvidenceIds && initialValues.selectedEvidenceIds.length > 0
          ? initialValues.selectedEvidenceIds
          : evidence.filter((e) => e.is_verified_fact).map((e) => e.id),
      ),
  );
  const [concept, setConcept] = useState(initialValues?.concept ?? "");
  const [creativeDirection, setCreativeDirection] = useState(initialValues?.creativeDirection ?? "");
  const [founderNotes, setFounderNotes] = useState(initialValues?.founderNotes ?? "");

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !report) return null;

  function toggleEvidence(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit = selectedIds.size > 0 && concept.trim().length > 0 && creativeDirection.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      targetPlatform: platform,
      audience,
      contentType,
      selectedEvidenceIds: Array.from(selectedIds),
      concept: concept.trim(),
      creativeDirection: creativeDirection.trim(),
      founderNotes: founderNotes.trim() || null,
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-night-bg/70" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border-2 border-hq-teal bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Produce Again"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-hq-tealDark">Produce Again</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-hq-slate hover:bg-hq-parchment"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 rounded-md border border-hq-teal/30 bg-hq-teal/5 px-3 py-2 text-sm font-medium text-hq-tealDark">
          This starts a brand-new, independent production from this mission&apos;s existing research — Scout will
          not run again, and none of your earlier videos are changed. This is not a revision of a previous video.
        </p>
        <p className="mt-2 text-xs text-hq-slate">
          &ldquo;{mission.title}&rdquo; — review or adjust the concept and direction below (pre-filled from the most
          recent commission on this mission where available), then confirm to actually start this new production.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
            Concept <span className="text-status-danger">*</span>
            <textarea
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              rows={2}
              required
              className="mt-1 w-full rounded-md border border-hq-teal/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              placeholder="What should this new production actually be?"
            />
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
            Creative direction <span className="text-status-danger">*</span>
            <textarea
              value={creativeDirection}
              onChange={(e) => setCreativeDirection(e.target.value)}
              rows={2}
              required
              className="mt-1 w-full rounded-md border border-hq-teal/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              placeholder="Tone, format, why this take should work."
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
              Platform
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as AudienceContext["platform"])}
                className="mt-1 w-full rounded-md border border-hq-teal/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
              Audience
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as AudienceContext["audience"])}
                className="mt-1 w-full rounded-md border border-hq-teal/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
              Content type
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as AudienceContext["contentType"])}
                className="mt-1 w-full rounded-md border border-hq-teal/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              >
                {CONTENT_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">
              Evidence Content Bot may cite ({selectedIds.size} selected)
            </p>
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-hq-teal/30 bg-hq-parchment/40 p-2">
              {evidence.length === 0 && <li className="text-xs text-hq-slate">No evidence recorded on this mission.</li>}
              {evidence.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(e.id)}
                    onChange={() => toggleEvidence(e.id)}
                    className="mt-0.5"
                  />
                  <span>
                    {e.source_title ?? e.source_url ?? e.snippet ?? "Untitled source"}
                    {e.is_verified_fact ? (
                      <span className="ml-1 rounded bg-hq-teal/15 px-1 text-hq-teal">verified fact</span>
                    ) : (
                      <span className="ml-1 rounded bg-hq-parchment px-1 text-hq-slate">consulted source</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
            Notes for Content Bot (optional)
            <textarea
              value={founderNotes}
              onChange={(e) => setFounderNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-hq-teal/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              placeholder="Anything Content Bot should specifically keep in mind for THIS production…"
            />
          </label>

          {error && <p className="text-sm text-status-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-hq-slate/30 px-3 py-1.5 text-xs font-medium text-hq-slate"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !canSubmit}
              className="rounded-md border-2 border-dashed border-hq-teal bg-hq-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Starting…" : "Produce Again"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
