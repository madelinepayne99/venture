"use client";

import { useEffect, useState } from "react";
import type { Agent, Founder, LedgerEntry, Mission, Project, WorkspaceType } from "@/lib/db/types";
import { signOutAction } from "@/lib/auth/actions";
import type { MissionDetailData } from "./MissionDetail";
import { FocusView } from "./FocusView";
import { WorkspaceBar } from "./hq/WorkspaceBar";
import { HQView } from "./hq/HQView";
import { MissionSlideOver } from "./hq/MissionSlideOver";

interface Props {
  signedInFounderName: string;
  initialAgents: Agent[];
  initialMissions: Mission[];
  initialLedgerEntries: LedgerEntry[];
  initialLedgerTotal: number;
  initialProjects: Project[];
  initialFounders: Founder[];
}

const POLLING_STATES = new Set(["queued", "researching"]);
const POLL_INTERVAL_MS = 3000;

type ViewMode = "hq" | "focus";
const VIEW_MODE_STORAGE_KEY = "venture-hq:view-mode";
const ACTIVE_PROJECT_STORAGE_KEY = "venture-hq:active-project-id";

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private browsing, disabled storage, etc. — fall back to defaults.
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not fatal — the preference just won't persist across reloads.
  }
}

export function FoundersDeskApp({
  signedInFounderName,
  initialAgents,
  initialMissions,
  initialLedgerEntries,
  initialLedgerTotal,
  initialProjects,
  initialFounders,
}: Props) {
  const [agents] = useState(initialAgents);
  const [founders] = useState(initialFounders);
  const [missions, setMissions] = useState(initialMissions);
  const [ledgerEntries, setLedgerEntries] = useState(initialLedgerEntries);
  const [ledgerTotal, setLedgerTotal] = useState(initialLedgerTotal);
  const [projects, setProjects] = useState(initialProjects);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [missionDetail, setMissionDetail] = useState<MissionDetailData | null>(null);
  const [busyMissionId, setBusyMissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // View mode and the active workspace are presentation/navigation state
  // only — never persisted server-side, never affecting what data is
  // fetched or what any founder action is allowed to do. Both are read
  // from localStorage after mount so the server-rendered markup is
  // identical regardless of a returning visitor's prior choice (avoids a
  // hydration mismatch), then applied — this is what makes "Venture opens
  // into the user's active/last-used real workspace" and the HQ/Focus
  // choice persist locally without any database migration.
  const [viewMode, setViewMode] = useState<ViewMode>("hq");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProjects[0]?.id ?? null);

  useEffect(() => {
    const storedView = readLocalStorage(VIEW_MODE_STORAGE_KEY);
    if (storedView === "hq" || storedView === "focus") setViewMode(storedView);

    const storedProjectId = readLocalStorage(ACTIVE_PROJECT_STORAGE_KEY);
    if (storedProjectId && initialProjects.some((p) => p.id === storedProjectId)) {
      setActiveProjectId(storedProjectId);
    }
    // Only ever run once, right after mount — this restores a saved
    // preference; it must not re-run and fight later user choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSetViewMode(mode: ViewMode) {
    setViewMode(mode);
    writeLocalStorage(VIEW_MODE_STORAGE_KEY, mode);
  }

  function handleSelectProject(projectId: string) {
    setActiveProjectId(projectId);
    writeLocalStorage(ACTIVE_PROJECT_STORAGE_KEY, projectId);
  }

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const visibleMissions = missions.filter((m) => m.project_id === activeProjectId);

  async function refreshMissions() {
    const res = await fetch("/api/missions");
    const data = await res.json();
    setMissions(data.missions);
  }

  async function refreshLedger() {
    const res = await fetch("/api/ledger");
    const data = await res.json();
    setLedgerEntries(data.entries);
    setLedgerTotal(data.totalUsd);
  }

  async function refreshProjects() {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data.projects);
  }

  async function loadDetail(missionId: string) {
    setSelectedMissionId(missionId);
    const res = await fetch(`/api/missions/${missionId}`);
    if (res.ok) {
      setMissionDetail(await res.json());
    }
  }

  function closeMissionPanel() {
    setSelectedMissionId(null);
    setMissionDetail(null);
  }

  // Scout's research now runs as a durable background job, not inline in
  // the approve request — the approve call returns as soon as the mission
  // is queued, well before Scout has actually done anything. This polls
  // for the real stage/state changes as the job actually makes them,
  // rather than faking a progress state client-side.
  useEffect(() => {
    const hasInFlightMission = missions.some((m) => POLLING_STATES.has(m.state));
    if (!hasInFlightMission) return;

    const interval = setInterval(() => {
      refreshMissions();
      if (selectedMissionId && POLLING_STATES.has(missionDetail?.mission.state ?? "")) {
        loadDetail(selectedMissionId);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions, selectedMissionId, missionDetail?.mission.state]);

  async function handleCreate(title: string, brief: string, projectId: string) {
    setError(null);
    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, brief, projectId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create the mission.");
      return;
    }
    await refreshMissions();
    await loadDetail(data.mission.id);
  }

  async function handleCreateWorkspace(name: string, workspaceType: WorkspaceType) {
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, workspaceType }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create the workspace.");
      return;
    }
    await refreshProjects();
    handleSelectProject(data.project.id);
  }

  async function handleApprove(missionId: string) {
    setError(null);
    setBusyMissionId(missionId);
    try {
      const res = await fetch(`/api/missions/${missionId}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not approve the mission.");
        return;
      }
      await refreshMissions();
      await refreshLedger();
      if (selectedMissionId === missionId) await loadDetail(missionId);
    } finally {
      setBusyMissionId(null);
    }
  }

  async function handleCancel(missionId: string) {
    setError(null);
    setBusyMissionId(missionId);
    try {
      const res = await fetch(`/api/missions/${missionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not cancel the mission.");
        return;
      }
      await refreshMissions();
      await refreshLedger();
      if (selectedMissionId === missionId) await loadDetail(missionId);
    } finally {
      setBusyMissionId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-hq-tealDark">Venture HQ</h1>
          <p className="mt-1 text-sm text-hq-slate">
            The founders&apos; desk — genuine missions, genuine agents, genuine results.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-hq-slate">
          <div
            role="group"
            aria-label="View"
            className="flex rounded-md border border-hq-brass/30 bg-white/70 p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => handleSetViewMode("hq")}
              aria-pressed={viewMode === "hq"}
              className={`rounded px-3 py-1 font-medium transition ${
                viewMode === "hq" ? "bg-hq-teal text-white" : "text-hq-slate hover:text-hq-ink"
              }`}
            >
              HQ View
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode("focus")}
              aria-pressed={viewMode === "focus"}
              className={`rounded px-3 py-1 font-medium transition ${
                viewMode === "focus" ? "bg-hq-teal text-white" : "text-hq-slate hover:text-hq-ink"
              }`}
            >
              Focus View
            </button>
          </div>
          <span>
            Signed in as <span className="font-medium text-hq-ink">{signedInFounderName}</span>
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md border border-hq-slate/30 px-3 py-1 text-xs font-medium text-hq-slate hover:bg-hq-parchment/60"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mb-6">
        <WorkspaceBar
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onRequestCreateWorkspace={() => handleSetViewMode("focus")}
        />
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-status-danger/30 bg-red-50 px-4 py-3 text-sm text-status-danger">
          {error}
        </div>
      )}

      {viewMode === "hq" ? (
        <>
          <HQView
            activeProject={activeProject}
            founders={founders}
            signedInFounderName={signedInFounderName}
            missions={visibleMissions}
            selectedMissionId={selectedMissionId}
            onSelectMission={loadDetail}
          />
          <MissionSlideOver
            detail={missionDetail}
            busyMissionId={busyMissionId}
            onApprove={handleApprove}
            onCancel={handleCancel}
            onClose={closeMissionPanel}
          />
        </>
      ) : (
        <FocusView
          agents={agents}
          ledgerEntries={ledgerEntries}
          ledgerTotal={ledgerTotal}
          projects={projects}
          defaultProjectId={activeProjectId}
          missions={visibleMissions}
          missionDetail={missionDetail}
          selectedMissionId={selectedMissionId}
          busyMissionId={busyMissionId}
          onCreateMission={handleCreate}
          onCreateWorkspace={handleCreateWorkspace}
          onSelectMission={loadDetail}
          onApprove={handleApprove}
          onCancel={handleCancel}
        />
      )}
    </main>
  );
}
