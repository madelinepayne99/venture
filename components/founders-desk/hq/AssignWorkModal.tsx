"use client";

import { useEffect } from "react";
import type { Project } from "@/lib/db/types";
import { MissionForm } from "../MissionForm";

/**
 * The in-world "Assign work" trigger's target — the exact same real
 * mission composer Focus View renders inline (`MissionForm`), just opened
 * as a modal so a founder never has to leave HQ View to create a mission.
 * `defaultProjectId` preselects whichever real workspace is currently
 * active; the same `onSubmit` handler FoundersDeskApp already passes to
 * Focus View's form is reused here, so submitting does exactly what it
 * already does — nothing new is invented.
 */
export function AssignWorkModal({
  open,
  projects,
  defaultProjectId,
  onSubmit,
  onClose,
}: {
  open: boolean;
  projects: Project[];
  defaultProjectId: string | null;
  onSubmit: (title: string, brief: string, projectId: string) => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(title: string, brief: string, projectId: string) {
    await onSubmit(title, brief, projectId);
    onClose();
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-night-bg/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-hq-cream p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Assign work"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-hq-tealDark">Assign work</h2>
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
          Give Scout a brief. It will come back with an honest, evidence-labeled research report —
          never a guaranteed outcome.
        </p>
        <MissionForm projects={projects} defaultProjectId={defaultProjectId} onSubmit={handleSubmit} />
      </div>
    </>
  );
}
