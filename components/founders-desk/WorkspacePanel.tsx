"use client";

import { useState, type FormEvent } from "react";
import type { Project, WorkspaceType } from "@/lib/db/types";

const WORKSPACE_TYPE_LABELS: Record<WorkspaceType, string> = {
  commerce: "Commerce",
  service_business: "Service Business",
};

export function WorkspacePanel({
  projects,
  onCreate,
}: {
  projects: Project[];
  onCreate: (name: string, workspaceType: WorkspaceType) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>("commerce");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onCreate(name, workspaceType);
      setName("");
      setWorkspaceType("commerce");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Workspaces</h2>
      <p className="mt-1 text-sm text-hq-slate">
        Each workspace has one type, set when it&apos;s created — a workspace&apos;s type never
        changes afterward. Create a new one rather than repurposing an existing workspace.
      </p>

      {projects.length > 0 && (
        <ul className="mt-3 space-y-1">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex items-center justify-between gap-2 rounded-md bg-hq-parchment/60 px-3 py-2 text-sm"
            >
              <span className="font-medium text-hq-ink">{project.name}</span>
              <span className="rounded bg-white px-2 py-0.5 text-xs text-hq-slate">
                {WORKSPACE_TYPE_LABELS[project.workspace_type]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t border-hq-brass/10 pt-4">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">
            New workspace name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hair &amp; Beauty Clients"
            className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">
            Workspace type
          </label>
          <select
            value={workspaceType}
            onChange={(e) => setWorkspaceType(e.target.value as WorkspaceType)}
            className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
          >
            <option value="commerce">Commerce — Etsy downloads / Amazon KDP</option>
            <option value="service_business">Service Business — hairdressers, garages, and similar</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-md border border-hq-teal px-4 py-2 text-sm font-semibold text-hq-teal transition hover:bg-hq-teal hover:text-white disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </div>
  );
}
