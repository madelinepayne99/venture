"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Agent,
  ContentItem,
  Founder,
  LedgerEntry,
  Mission,
  MissionLeadAssignment,
  Project,
  WorkspaceType,
} from "@/lib/db/types";
import { signOutAction } from "@/lib/auth/actions";
import type { MissionDetailData } from "./MissionDetail";
import { FocusView } from "./FocusView";
import { WorkspaceBar } from "./hq/WorkspaceBar";
import { HQView } from "./hq/HQView";
import { MissionSlideOver } from "./hq/MissionSlideOver";
import { AssignWorkModal } from "./hq/AssignWorkModal";
import { ProductionApprovalDialog, type ProductionApprovalInput } from "./hq/ProductionApprovalDialog";
import { ContentReviewSlideOver, type ContentItemDetailData } from "./hq/ContentReviewSlideOver";
import { useMissionPolling } from "./useMissionPolling";

interface Props {
  signedInFounderName: string;
  initialAgents: Agent[];
  initialMissions: Mission[];
  initialLeadAssignments: MissionLeadAssignment[];
  initialLedgerEntries: LedgerEntry[];
  initialLedgerTotal: number;
  initialProjects: Project[];
  initialFounders: Founder[];
}

// "awaiting_evidence" is always transient under the two-pass evidence loop
// (see missionWorkflow.ts's MAX_RESEARCH_PASSES / nextStateForVerdict): a
// mission only ever lands there when an automatic follow-up pass is about
// to be dispatched, never as a resting state. Without it here, polling
// would stop the instant pass 1 settles into it, and the frontend (and
// Scout's HQ animation) would silently freeze until a manual refresh even
// though the backend is correctly dispatching pass 2.
const POLLING_STATES = new Set(["queued", "researching", "awaiting_evidence"]);
// Content Bot's own non-resting states — a content item only ever sits
// here while real, automatic pipeline work is genuinely in flight (see
// CLAUDE.md's Content Bot milestone); "awaiting_review"/"blocked"/
// "ready_to_publish" are founder-actionable resting states, not polled.
const CONTENT_POLLING_STATES = new Set(["planning", "generating", "revision_requested"]);
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
  initialLeadAssignments,
  initialLedgerEntries,
  initialLedgerTotal,
  initialProjects,
  initialFounders,
}: Props) {
  const [agents] = useState(initialAgents);
  const [founders] = useState(initialFounders);
  const [missions, setMissions] = useState(initialMissions);
  const [leadAssignments, setLeadAssignments] = useState(initialLeadAssignments);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState(initialLedgerEntries);
  const [ledgerTotal, setLedgerTotal] = useState(initialLedgerTotal);
  const [projects, setProjects] = useState(initialProjects);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [missionDetail, setMissionDetail] = useState<MissionDetailData | null>(null);
  const [busyMissionId, setBusyMissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignWorkOpen, setAssignWorkOpen] = useState(false);
  const [approveForProductionOpen, setApproveForProductionOpen] = useState(false);
  const [approveForProductionError, setApproveForProductionError] = useState<string | null>(null);
  const [selectedContentItemId, setSelectedContentItemId] = useState<string | null>(null);
  const [contentItemDetail, setContentItemDetail] = useState<ContentItemDetailData | null>(null);
  const [busyContentItemId, setBusyContentItemId] = useState<string | null>(null);

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

  const visibleMissions = missions.filter((m) => m.project_id === activeProjectId);

  async function refreshMissions() {
    const res = await fetch("/api/missions");
    const data = await res.json();
    setMissions(data.missions);
    setLeadAssignments(data.leadAssignments);
    const freshContentItems = (data.contentItems ?? []) as ContentItem[];
    setContentItems(freshContentItems);
    return { missions: data.missions as Mission[], contentItems: freshContentItems };
  }

  async function loadContentItemDetail(contentItemId: string) {
    setSelectedContentItemId(contentItemId);
    const res = await fetch(`/api/content-items/${contentItemId}`);
    if (res.ok) {
      setContentItemDetail(await res.json());
    }
  }

  function closeContentItemPanel() {
    setSelectedContentItemId(null);
    setContentItemDetail(null);
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
  // rather than faking a progress state client-side. See
  // useMissionPolling's own doc comment for why the interval is keyed on
  // the derived `hasInFlightMission` boolean rather than on `missions`/
  // `missionDetail` directly — depending on values a tick's own fetch call
  // mutates was the actual bug that silently stopped Scout's HQ animation
  // from ever updating past "Ready" once a real mission was approved.
  const selectedMissionIdRef = useRef(selectedMissionId);
  selectedMissionIdRef.current = selectedMissionId;
  const missionDetailRef = useRef(missionDetail);
  missionDetailRef.current = missionDetail;
  const selectedContentItemIdRef = useRef(selectedContentItemId);
  selectedContentItemIdRef.current = selectedContentItemId;
  const contentItemDetailRef = useRef(contentItemDetail);
  contentItemDetailRef.current = contentItemDetail;

  const hasInFlightMission =
    missions.some((m) => POLLING_STATES.has(m.state)) || contentItems.some((c) => CONTENT_POLLING_STATES.has(c.state));

  useMissionPolling(
    hasInFlightMission,
    () => {
      (async () => {
        const { missions: freshMissions, contentItems: freshContentItems } = await refreshMissions();

        const currentSelectedId = selectedMissionIdRef.current;
        if (currentSelectedId) {
          // Refresh the detail panel if the selected mission was in flight as
          // of our last known detail snapshot, OR the list we just fetched
          // still shows it in flight. Checking only the pre-tick ref (as this
          // used to) misses the exact tick where a mission settles: that
          // tick's own fetch can land in the narrow window between the
          // mission's state going terminal and its deliverable actually being
          // written (see missionWorkflow.ts's settlement order), permanently
          // freezing the panel on an incomplete report with no state change
          // left to ever trigger another refresh. Checking the fresh list too
          // guarantees at least one more refresh after settlement is fully
          // committed.
          const selectedMission = freshMissions.find((m) => m.id === currentSelectedId);
          const wasInFlight = POLLING_STATES.has(missionDetailRef.current?.mission.state ?? "");
          const stillInFlight = selectedMission ? POLLING_STATES.has(selectedMission.state) : false;
          if (wasInFlight || stillInFlight) {
            loadDetail(currentSelectedId);
          }
        }

        // Same reasoning applied to the content-review panel: a content
        // item genuinely moving through Content Bot's pipeline (planning /
        // generating / revision_requested) must keep refreshing even
        // through the exact tick it settles, or the panel would freeze on
        // a stale "generating" state after the real work already finished.
        const currentSelectedContentItemId = selectedContentItemIdRef.current;
        if (currentSelectedContentItemId) {
          const selectedItem = freshContentItems.find((c) => c.id === currentSelectedContentItemId);
          const wasInFlight = CONTENT_POLLING_STATES.has(contentItemDetailRef.current?.item.state ?? "");
          const stillInFlight = selectedItem ? CONTENT_POLLING_STATES.has(selectedItem.state) : false;
          if (wasInFlight || stillInFlight) {
            loadContentItemDetail(currentSelectedContentItemId);
          }
        }
      })();
    },
    POLL_INTERVAL_MS,
  );

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

  async function handleApproveForProduction(input: ProductionApprovalInput) {
    if (!selectedMissionId) return;
    setApproveForProductionError(null);
    setBusyMissionId(selectedMissionId);
    try {
      const res = await fetch(`/api/missions/${selectedMissionId}/approve-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        setApproveForProductionError(data.error ?? "Could not approve this mission for production.");
        return;
      }
      setApproveForProductionOpen(false);
      await refreshMissions();
      await loadDetail(selectedMissionId);
      await loadContentItemDetail(data.contentItem.id);
    } finally {
      setBusyMissionId(null);
    }
  }

  async function handleContentDecision(
    contentItemId: string,
    decision: "approve" | "reject" | "revise",
    contentVersionId: string,
    note?: string,
  ) {
    setError(null);
    setBusyContentItemId(contentItemId);
    try {
      const res = await fetch(`/api/content-items/${contentItemId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, contentVersionId, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not record that decision.");
        return;
      }
      await refreshMissions();
      await loadContentItemDetail(contentItemId);
      if (selectedMissionId) await loadDetail(selectedMissionId);
    } finally {
      setBusyContentItemId(null);
    }
  }

  async function handleCancelContentItem(contentItemId: string) {
    setError(null);
    setBusyContentItemId(contentItemId);
    try {
      const res = await fetch(`/api/content-items/${contentItemId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not cancel production.");
        return;
      }
      await refreshMissions();
      await loadContentItemDetail(contentItemId);
      if (selectedMissionId) await loadDetail(selectedMissionId);
    } finally {
      setBusyContentItemId(null);
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
            projects={projects}
            activeProjectId={activeProjectId}
            missions={missions}
            leadAssignments={leadAssignments}
            contentItems={contentItems}
            selectedMissionId={selectedMissionId}
            onSelectMission={loadDetail}
            onAssignWork={() => setAssignWorkOpen(true)}
            onOpenContentItem={loadContentItemDetail}
          />
          <MissionSlideOver
            detail={missionDetail}
            busyMissionId={busyMissionId}
            onApprove={handleApprove}
            onCancel={handleCancel}
            onClose={closeMissionPanel}
            onOpenApproveForProduction={() => setApproveForProductionOpen(true)}
            onOpenContentReview={loadContentItemDetail}
          />
          <AssignWorkModal
            open={assignWorkOpen}
            projects={projects}
            defaultProjectId={activeProjectId}
            onSubmit={handleCreate}
            onClose={() => setAssignWorkOpen(false)}
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
          onOpenApproveForProduction={() => setApproveForProductionOpen(true)}
          onOpenContentReview={loadContentItemDetail}
        />
      )}

      {missionDetail && (
        <ProductionApprovalDialog
          open={approveForProductionOpen}
          mission={missionDetail.mission}
          report={missionDetail.followupReport ?? missionDetail.scoutReport}
          evidence={missionDetail.evidence}
          busy={busyMissionId === missionDetail.mission.id}
          error={approveForProductionError}
          onSubmit={handleApproveForProduction}
          onClose={() => {
            setApproveForProductionOpen(false);
            setApproveForProductionError(null);
          }}
        />
      )}

      <ContentReviewSlideOver
        detail={contentItemDetail}
        busy={busyContentItemId === contentItemDetail?.item.id}
        onDecide={(decision, contentVersionId, note) => {
          if (!contentItemDetail) return;
          handleContentDecision(contentItemDetail.item.id, decision, contentVersionId, note);
        }}
        onCancel={handleCancelContentItem}
        onClose={closeContentItemPanel}
      />
    </main>
  );
}
