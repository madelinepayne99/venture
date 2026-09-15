"use client";

import { useState, type FormEvent } from "react";
import type { Project } from "@/lib/db/types";

export function MissionForm({
  projects,
  defaultProjectId,
  onSubmit,
}: {
  projects: Project[];
  /** Pre-selects the currently active workspace, if any, so a mission created from within a workspace defaults to it. */
  defaultProjectId?: string | null;
  onSubmit: (title: string, brief: string, projectId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSubmitting(true);
    try {
      await onSubmit(title, brief, projectId);
      setTitle("");
      setBrief("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">Workspace</label>
        {projects.length === 0 ? (
          <p className="mt-1 text-sm text-hq-slate">
            No workspaces yet — create one below before submitting a mission.
          </p>
        ) : (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
            required
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} — {project.workspace_type === "commerce" ? "Commerce" : "Service Business"}
              </option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Preschool counting worksheets"
          className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
          required
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">
          Brief for Scout
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Describe the opportunity you want researched — audience, theme, platform..."
          className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
          rows={3}
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !projectId}
        className="rounded-md bg-hq-brass px-4 py-2 text-sm font-semibold text-white transition hover:bg-hq-brassDark disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit mission"}
      </button>
    </form>
  );
}
