"use client";

import { useEffect } from "react";
import { isCancellable } from "@/lib/domain/missionStates";
import { MissionDetail, type MissionDetailData } from "../MissionDetail";

/**
 * The HQ view's right-side slide-out panel. It renders the exact same
 * MissionDetail component Focus View shows inline — same real mission
 * detail, evidence, and cost — plus the real founder actions (Approve /
 * Cancel) that Focus View's mission list renders next to each mission.
 * Presentation only: no data here doesn't already exist in Focus View.
 */
export function MissionSlideOver({
  detail,
  busyMissionId,
  onApprove,
  onCancel,
  onClose,
}: {
  detail: MissionDetailData | null;
  busyMissionId: string | null;
  onApprove: (missionId: string) => void;
  onCancel: (missionId: string) => void;
  onClose: () => void;
}) {
  const open = detail !== null;

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const mission = detail?.mission;
  const isBusy = mission ? busyMissionId === mission.id : false;

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
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-md transform bg-hq-cream shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Mission detail"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-hq-brass/20 p-4">
          <h2 className="font-display text-lg font-semibold text-hq-tealDark">Mission</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close mission panel"
            className="rounded-md px-2 py-1 text-hq-slate hover:bg-hq-parchment"
          >
            ✕
          </button>
        </div>

        {mission && (
          <div className="flex gap-2 border-b border-hq-brass/10 px-4 py-3">
            {mission.state === "awaiting_founder_approval" && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onApprove(mission.id)}
                className="rounded-md bg-hq-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isBusy ? "Sending Scout…" : "Approve & send Scout"}
              </button>
            )}
            {isCancellable(mission.state) && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onCancel(mission.id)}
                className="rounded-md border border-hq-slate/30 px-3 py-1.5 text-xs font-medium text-hq-slate disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        <div className="h-[calc(100%-57px)] overflow-y-auto p-4">
          <MissionDetail detail={detail} />
        </div>
      </div>
    </>
  );
}
