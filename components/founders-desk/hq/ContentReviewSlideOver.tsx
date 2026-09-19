"use client";

import { useEffect, useState } from "react";
import type { Approval, ContentAsset, ContentItem, ContentVersion, CostEntry, Mission } from "@/lib/db/types";
import { ContentItemStatusBadge } from "./ContentItemStatusBadge";
import { ContentVideoPlayer } from "./ContentVideoPlayer";
import { ContentVersionHistory } from "./ContentVersionHistory";
import { ContentAssetList } from "./ContentAssetList";
import { ContentCostSummary } from "./ContentCostSummary";
import { ContentDecisionBar } from "./ContentDecisionBar";

export interface ContentItemDetailData {
  item: ContentItem;
  mission: Mission | null;
  versions: Array<ContentVersion & { assets: ContentAsset[] }>;
  stages: Array<{ id: string; stage_name: string; status: string; detail: string | null }>;
  approvals: Approval[];
  costs: CostEntry[];
  spentUsd: number;
}

/**
 * Content Bot's own review panel — a real, watchable finished piece
 * (never a placeholder), the complete version history, and the three real
 * founder decisions. Mirrors MissionSlideOver's shell exactly (see
 * CLAUDE.md's HQ Office UI milestone), rendered from both HQ View and
 * Focus View via the same ProductionActions entry point.
 */
export function ContentReviewSlideOver({
  detail,
  busy,
  onDecide,
  onCancel,
  onClose,
}: {
  detail: ContentItemDetailData | null;
  busy: boolean;
  onDecide: (decision: "approve" | "reject" | "revise", contentVersionId: string, note?: string) => void;
  onCancel: (contentItemId: string) => void;
  onClose: () => void;
}) {
  const open = detail !== null;
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!detail) {
      setSelectedVersionId(null);
      return;
    }
    setSelectedVersionId((current) => {
      if (current && detail.versions.some((v) => v.id === current)) return current;
      return detail.versions.at(-1)?.id ?? null;
    });
  }, [detail]);

  const selectedVersion =
    detail?.versions.find((v) => v.id === selectedVersionId) ?? detail?.versions.at(-1) ?? null;
  const planTitle = (selectedVersion?.plan as { title?: string } | null)?.title;

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-hq-ink/20 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-lg transform bg-hq-cream shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Production review"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-hq-brass/20 p-4">
          <h2 className="font-display text-lg font-semibold text-hq-tealDark">Production</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close production panel"
            className="rounded-md px-2 py-1 text-hq-slate hover:bg-hq-parchment"
          >
            ✕
          </button>
        </div>

        {detail && (
          <div className="h-[calc(100%-57px)] space-y-4 overflow-y-auto p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-hq-ink">
                {planTitle ?? detail.mission?.title ?? "Untitled piece"}
              </h3>
              <ContentItemStatusBadge state={detail.item.state} />
            </div>
            {detail.item.failure_reason && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-status-danger">{detail.item.failure_reason}</p>
            )}

            {selectedVersion && <ContentVideoPlayer assets={selectedVersion.assets} />}

            {selectedVersion && (
              <ContentDecisionBar
                state={detail.item.state}
                busy={busy}
                onDecide={(decision, note) => onDecide(decision, selectedVersion.id, note)}
                onCancel={() => onCancel(detail.item.id)}
              />
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">Versions</p>
              <div className="mt-1">
                <ContentVersionHistory
                  versions={detail.versions}
                  approvals={detail.approvals}
                  selectedVersionId={selectedVersion?.id ?? null}
                  onSelectVersion={setSelectedVersionId}
                />
              </div>
            </div>

            {selectedVersion && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">Assets</p>
                <div className="mt-1">
                  <ContentAssetList assets={selectedVersion.assets} />
                </div>
              </div>
            )}

            <ContentCostSummary costs={detail.costs} spentUsd={detail.spentUsd} />
          </div>
        )}
      </div>
    </>
  );
}
