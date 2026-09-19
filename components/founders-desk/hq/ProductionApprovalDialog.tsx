"use client";

import { useEffect, useState } from "react";
import type { Evidence, Mission } from "@/lib/db/types";
import type { ScoutReport } from "@/lib/agents/scout/schema";
import type { AudienceContext } from "@/lib/media/types";

export interface ProductionApprovalInput {
  targetPlatform: AudienceContext["platform"];
  audience: AudienceContext["audience"];
  contentType: AudienceContext["contentType"];
  selectedEvidenceIds: string[];
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
 * The real "Approve for Production" gate (CLAUDE.md's Content Bot
 * milestone, §4) — distinct from the approval that dispatches Scout to
 * research in the first place. Only ever rendered when Scout's own report
 * genuinely carries a production_recommendation; the founder still makes
 * every real choice here (platform, audience, content type, which evidence
 * Content Bot is allowed to cite) — nothing is inferred or defaulted
 * silently past what the founder can see and change.
 */
export function ProductionApprovalDialog({
  open,
  mission,
  report,
  evidence,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mission: Mission;
  report: ScoutReport | null;
  evidence: Evidence[];
  busy: boolean;
  error: string | null;
  onSubmit: (input: ProductionApprovalInput) => void;
  onClose: () => void;
}) {
  const recommendation = report?.production_recommendation ?? null;

  const [platform, setPlatform] = useState<AudienceContext["platform"]>(
    recommendation?.target_platforms[0] ?? "youtube_shorts",
  );
  const [audience, setAudience] = useState<AudienceContext["audience"]>("general");
  const [contentType, setContentType] = useState<AudienceContext["contentType"]>("educational");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(evidence.filter((e) => e.is_verified_fact).map((e) => e.id)),
  );
  const [founderNotes, setFounderNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !recommendation) return null;

  function toggleEvidence(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      targetPlatform: platform,
      audience,
      contentType,
      selectedEvidenceIds: Array.from(selectedIds),
      founderNotes: founderNotes.trim() || null,
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-night-bg/70" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-hq-cream p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Approve for production"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-hq-tealDark">Approve for production</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-hq-slate hover:bg-hq-parchment"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-hq-slate">
          Scout&apos;s recommendation for &ldquo;{mission.title}&rdquo; — review it, then decide what Content Bot
          should actually make.
        </p>

        <div className="mt-3 space-y-2 rounded-lg border border-hq-brass/20 bg-white/60 p-3 text-sm">
          <p>
            <span className="font-semibold">Format:</span> {recommendation.content_format}
          </p>
          <p>
            <span className="font-semibold">Hook:</span> {recommendation.hook_pattern}
          </p>
          <p>
            <span className="font-semibold">Why it works:</span> {recommendation.why_it_works}
          </p>
          <p>
            <span className="font-semibold">Suggested original angle:</span>{" "}
            {recommendation.suggested_original_angle}
          </p>
          {recommendation.do_not_imitate.length > 0 && (
            <p>
              <span className="font-semibold">Do not imitate:</span> {recommendation.do_not_imitate.join(", ")}
            </p>
          )}
          <p className="text-xs text-hq-slate">
            Saturation: {recommendation.saturation} · Repeatability: {recommendation.repeatability.replace(/_/g, " ")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-hq-slate">
              Platform
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as AudienceContext["platform"])}
                className="mt-1 w-full rounded-md border border-hq-brass/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
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
                className="mt-1 w-full rounded-md border border-hq-brass/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
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
                className="mt-1 w-full rounded-md border border-hq-brass/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
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
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-hq-brass/20 bg-white/50 p-2">
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
              className="mt-1 w-full rounded-md border border-hq-brass/30 bg-white px-2 py-1.5 text-sm text-hq-ink"
              placeholder="Anything Content Bot should specifically keep in mind…"
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
              disabled={busy || selectedIds.size === 0}
              className="rounded-md bg-hq-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Assigning Content Bot…" : "Approve for production"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
