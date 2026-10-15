"use client";

import { useState } from "react";
import type { Agent, LedgerEntry, Mission, Project, WorkspaceType } from "@/lib/db/types";
import type { MissionDetailData } from "./MissionDetail";
import { FocusNav, type FocusSection } from "./focus/FocusNav";
import { OverviewSection } from "./focus/OverviewSection";
import { EmployeesSection } from "./focus/EmployeesSection";
import { TasksSection } from "./focus/TasksSection";
import { FoundersDeskSection } from "./focus/FoundersDeskSection";
import { FinanceSection } from "./focus/FinanceSection";
import { ReportsSection } from "./focus/ReportsSection";
import { SettingsSection } from "./focus/SettingsSection";

const SECTION_STORAGE_KEY = "venture-hq-focus-section";

function readStoredSection(): FocusSection {
  if (typeof window === "undefined") return "overview";
  try {
    const stored = window.localStorage.getItem(SECTION_STORAGE_KEY);
    const valid: FocusSection[] = ["overview", "employees", "tasks", "foundersDesk", "finance", "reports", "settings"];
    return valid.includes(stored as FocusSection) ? (stored as FocusSection) : "overview";
  } catch {
    return "overview";
  }
}

/**
 * Focus View (Mission 8 redesign — "Refined Emerald & Ivory") — a real
 * business operating platform instead of a flat three-column dashboard.
 * Same real data and handlers HQ View uses, passed down unchanged from
 * FoundersDeskApp.tsx; only the presentation layer changed. The active
 * section is a client-side-only preference (localStorage, read after
 * mount to avoid a hydration mismatch — same pattern FoundersDeskApp.tsx
 * already uses for view-mode/workspace) — it changes what's rendered,
 * never what data is fetched or what a founder is allowed to do.
 */
export function FocusView({
  agents,
  pendingReviewCount,
  ledgerEntries,
  ledgerTotal,
  projects,
  defaultProjectId,
  missions,
  missionDetail,
  selectedMissionId,
  busyMissionId,
  onCreateMission,
  onCreateWorkspace,
  onSelectMission,
  onApprove,
  onCancel,
  onOpenApproveForProduction,
  onOpenCommissionPilot,
  onOpenProduceAgain,
  onOpenContentReview,
}: {
  agents: Agent[];
  pendingReviewCount: number;
  ledgerEntries: LedgerEntry[];
  ledgerTotal: number;
  projects: Project[];
  defaultProjectId: string | null;
  missions: Mission[];
  missionDetail: MissionDetailData | null;
  selectedMissionId: string | null;
  busyMissionId: string | null;
  onCreateMission: (title: string, brief: string, projectId: string) => Promise<void>;
  onCreateWorkspace: (name: string, workspaceType: WorkspaceType) => Promise<void>;
  onSelectMission: (missionId: string) => void;
  onApprove: (missionId: string) => void;
  onCancel: (missionId: string) => void;
  onOpenApproveForProduction: () => void;
  onOpenCommissionPilot: () => void;
  onOpenProduceAgain: () => void;
  onOpenContentReview: (contentItemId: string) => void;
}) {
  // Starts at "overview" on the server-rendered pass (matching
  // readStoredSection's own SSR fallback) and is corrected from
  // localStorage immediately after mount — the same hydration-safe
  // pattern FoundersDeskApp.tsx's own readLocalStorage already follows.
  const [section, setSection] = useState<FocusSection>("overview");
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && typeof window !== "undefined") {
    setHydrated(true);
    const stored = readStoredSection();
    if (stored !== section) setSection(stored);
  }

  function changeSection(next: FocusSection) {
    setSection(next);
    try {
      window.localStorage.setItem(SECTION_STORAGE_KEY, next);
    } catch {
      // Private browsing / blocked storage — a real, harmless no-op; the
      // section still changes for this view, it just won't be remembered.
    }
  }

  return (
    <div className="rounded-2xl border border-focus-border bg-focus-ivory shadow-sm">
      <div className="px-4 pt-2 sm:px-6">
        <FocusNav active={section} onChange={changeSection} pendingReviewCount={pendingReviewCount} />
      </div>

      {/* pb-20 (extra, beyond <main>'s own bottom padding): real clearance
          for the global, fixed-to-viewport-bottom EmployeeDirectory strip
          (components/founders-desk/EmployeeDirectory.tsx — rendered
          outside this component, shared with HQ View, not touched here)
          — found grazing the bottom of a tall section's last card during
          Mission 8's Focus View verification. */}
      <div className="p-4 pb-20 sm:p-6 sm:pb-24">
        {section === "overview" && (
          <OverviewSection
            missions={missions}
            agents={agents}
            pendingReviewCount={pendingReviewCount}
            onNavigate={changeSection}
          />
        )}
        {section === "employees" && <EmployeesSection />}
        {section === "tasks" && (
          <TasksSection
            projects={projects}
            defaultProjectId={defaultProjectId}
            missions={missions}
            missionDetail={missionDetail}
            selectedMissionId={selectedMissionId}
            busyMissionId={busyMissionId}
            onCreateMission={onCreateMission}
            onSelectMission={onSelectMission}
            onApprove={onApprove}
            onCancel={onCancel}
            onOpenApproveForProduction={onOpenApproveForProduction}
            onOpenCommissionPilot={onOpenCommissionPilot}
            onOpenProduceAgain={onOpenProduceAgain}
            onOpenContentReview={onOpenContentReview}
          />
        )}
        {section === "foundersDesk" && (
          <FoundersDeskSection onSelectMission={onSelectMission} onOpenContentItem={onOpenContentReview} />
        )}
        {section === "finance" && <FinanceSection ledgerEntries={ledgerEntries} ledgerTotal={ledgerTotal} />}
        {section === "reports" && <ReportsSection />}
        {section === "settings" && <SettingsSection projects={projects} onCreateWorkspace={onCreateWorkspace} />}
      </div>
    </div>
  );
}
