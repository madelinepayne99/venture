"use client";

import type { Approval, ContentAsset, ContentVersion } from "@/lib/db/types";

type VersionWithAssets = ContentVersion & { assets: ContentAsset[] };

/**
 * Every version stays here forever, even after a later one exists — the
 * insert-only revision model (CLAUDE.md's Content Bot milestone, §9).
 * Selecting an earlier version plays and shows exactly its own real
 * assets; nothing here is overwritten by a later revision.
 */
export function ContentVersionHistory({
  versions,
  approvals,
  selectedVersionId,
  onSelectVersion,
}: {
  versions: VersionWithAssets[];
  approvals: Approval[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}) {
  if (versions.length === 0) {
    return <p className="text-xs text-hq-slate">No versions yet.</p>;
  }

  return (
    <ul className="space-y-1">
      {versions.map((v) => {
        const revisionNote = v.revision_approval_id
          ? (approvals.find((a) => a.id === v.revision_approval_id)?.note ?? null)
          : null;
        const decision = approvals.find((a) => a.content_version_id === v.id && a.decision !== "request_revision");
        return (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelectVersion(v.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-xs transition ${
                selectedVersionId === v.id
                  ? "border-hq-teal bg-hq-teal/10"
                  : "border-hq-brass/20 bg-white/50 hover:bg-hq-parchment/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-hq-ink">Version {v.version_number}</span>
                <span className="text-hq-slate">{v.status}</span>
              </div>
              {revisionNote && <p className="mt-1 text-hq-slate">Revision note: &ldquo;{revisionNote}&rdquo;</p>}
              {v.failure_reason && <p className="mt-1 text-status-danger">{v.failure_reason}</p>}
              {decision && (
                <p className="mt-1 text-hq-slate">
                  {decision.decision.replace(/_/g, " ")} by a founder
                  {decision.note ? ` — "${decision.note}"` : ""}
                </p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
