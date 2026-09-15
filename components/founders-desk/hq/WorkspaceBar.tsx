"use client";

import type { Project, WorkspaceType } from "@/lib/db/types";

export const REAL_WORKSPACE_TYPES: Array<{ type: WorkspaceType; label: string; blurb: string }> = [
  { type: "commerce", label: "Commerce", blurb: "Etsy downloads & Amazon KDP" },
  { type: "service_business", label: "Local Services", blurb: "Hairdressers, garages & similar" },
];

/** The one place "most recent workspace of a type" is decided — shared by
 * this bar's own selection target and by HQView's office carousel, so the
 * two can never disagree about which project a workspace type resolves to. */
export function mostRecentProjectOfType(projects: Project[], type: WorkspaceType): Project | null {
  const matches = projects.filter((p) => p.workspace_type === type);
  return matches.length > 0 ? matches[matches.length - 1]! : null;
}

// Named here, in the UI only — these are not real workspace_type values
// (see lib/db/schema.ts's workspaceTypeValues) and have no project, no
// agent, and no capability behind them. They exist purely so founders can
// see what's coming without the app pretending they already work.
const PLANNED_WORKSPACES = [
  { key: "content", label: "Content Studio" },
  { key: "game", label: "Game Studio" },
];

export function WorkspaceBar({
  projects,
  activeProjectId,
  onSelectProject,
  onRequestCreateWorkspace,
}: {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onRequestCreateWorkspace: (workspaceType: WorkspaceType) => void;
}) {
  return (
    <nav
      aria-label="Workspace"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-hq-brass/20 bg-white/70 p-2 shadow-desk"
    >
      {REAL_WORKSPACE_TYPES.map(({ type, label, blurb }) => {
        const projectsOfType = projects.filter((p) => p.workspace_type === type);
        const isActive = projectsOfType.some((p) => p.id === activeProjectId);

        if (projectsOfType.length === 0) {
          return (
            <button
              key={type}
              type="button"
              onClick={() => onRequestCreateWorkspace(type)}
              title={`No ${label} workspace yet — create one`}
              className="rounded-xl border border-dashed border-hq-brass/40 px-4 py-2 text-left text-sm text-hq-slate transition hover:border-hq-brass hover:text-hq-ink"
            >
              <span className="font-medium">{label}</span>
              <span className="ml-2 text-xs text-hq-brassDark">+ Create</span>
            </button>
          );
        }

        const mostRecent = mostRecentProjectOfType(projects, type)!;

        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelectProject(isActive ? activeProjectId! : mostRecent.id)}
            aria-pressed={isActive}
            title={blurb}
            className={`rounded-xl px-4 py-2 text-left text-sm transition ${
              isActive
                ? "bg-hq-teal text-white shadow-desk"
                : "text-hq-ink hover:bg-hq-parchment/80"
            }`}
          >
            <span className="font-medium">{label}</span>
            {projectsOfType.length > 1 && (
              <span className={`ml-2 text-xs ${isActive ? "text-white/80" : "text-hq-slate"}`}>
                {projectsOfType.length} workspaces
              </span>
            )}
          </button>
        );
      })}

      <span className="mx-1 h-6 w-px bg-hq-brass/20" aria-hidden="true" />

      {PLANNED_WORKSPACES.map(({ key, label }) => (
        <span
          key={key}
          title={`${label} — planned, not yet built`}
          className="cursor-not-allowed rounded-xl border border-hq-slate/15 px-4 py-2 text-sm text-hq-slate/50"
        >
          {label}
          <span className="ml-2 rounded bg-hq-slate/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-hq-slate/60">
            Planned
          </span>
        </span>
      ))}
    </nav>
  );
}
