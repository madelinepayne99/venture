"use client";

import { useState } from "react";
import type { ContentItemState } from "@/lib/db/types";
import { isContentItemCancellable } from "@/lib/domain/contentItemStates";
import { isRecoverableFailureCategory } from "@/lib/domain/contentFailureCategories";

/**
 * The three real founder review decisions (CLAUDE.md's Content Bot
 * milestone, §11) — Approve, Reject, Send back with notes — plus a direct
 * Cancel for production still in flight ("planning"/"generating"/
 * "blocked"), plus the narrow Retry Production action for a "failed" item
 * whose persisted failure_category is a genuinely recoverable technical/
 * provider problem (see contentFailureClassification.ts's own doc comment
 * for the real bug this exists for). Only rendered when the item is
 * genuinely in a state a founder can act on; "Approve" specifically only
 * from "awaiting_review" (approving a blocked piece makes no sense — it
 * must be revised or rejected first). Cancel is deliberately never offered
 * from "publishing" — see contentItemStates.ts, that edge doesn't exist.
 *
 * Retry Production is deliberately a SEPARATE control from "Send back with
 * notes", never merged into it: a creative revision and a technical retry
 * are different events a founder must always be able to tell apart in
 * Venture HQ, not just in the backend's audit trail.
 */
export function ContentDecisionBar({
  state,
  failureCategory,
  busy,
  onDecide,
  onRetry,
  onCancel,
}: {
  state: ContentItemState;
  failureCategory: string | null;
  busy: boolean;
  onDecide: (decision: "approve" | "reject" | "revise", note?: string) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [showRevise, setShowRevise] = useState(false);

  const canDecide = state === "awaiting_review" || state === "blocked" || state === "ready_to_publish";
  const canApprove = state === "awaiting_review";
  const canCancel = isContentItemCancellable(state);
  const canRetry = state === "failed" && isRecoverableFailureCategory(failureCategory);

  if (!canDecide && !canCancel && !canRetry) return null;

  return (
    <div className="space-y-2 rounded-md border border-hq-brass/20 bg-white/60 p-3">
      {canRetry && (
        <div className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">Production stopped because of a technical/provider problem</span> — not a
          safety or creative issue. Retrying will reuse the existing plan and creative direction exactly as they
          are; nothing about the concept needs to change.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="rounded-md border-2 border-dashed border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-50"
          >
            Retry Production
          </button>
        )}
        {canApprove && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("approve")}
            className="rounded-md bg-status-success px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Approve
          </button>
        )}
        {canDecide && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("reject")}
            className="rounded-md bg-status-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Reject
          </button>
        )}
        {canDecide && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowRevise((v) => !v)}
            className="rounded-md border border-hq-slate/30 px-3 py-1.5 text-xs font-medium text-hq-slate"
          >
            Send back with notes
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-hq-slate/30 px-3 py-1.5 text-xs font-medium text-hq-slate disabled:opacity-50"
          >
            Cancel production
          </button>
        )}
      </div>
      {showRevise && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What should Content Bot change?"
            className="w-full rounded-md border border-hq-brass/30 bg-white px-2 py-1.5 text-xs text-hq-ink"
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => {
              onDecide("revise", note.trim());
              setNote("");
              setShowRevise(false);
            }}
            className="rounded-md bg-hq-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Send back
          </button>
        </div>
      )}
    </div>
  );
}
