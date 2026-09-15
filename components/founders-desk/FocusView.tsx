import type { Agent, LedgerEntry, Mission, Project, WorkspaceType } from "@/lib/db/types";
import { StatusBadge } from "./StatusBadge";
import { MissionForm } from "./MissionForm";
import { MissionDetail, type MissionDetailData } from "./MissionDetail";
import { AgentRoster } from "./AgentRoster";
import { Ledger } from "./Ledger";
import { WorkspacePanel } from "./WorkspacePanel";
import { isCancellable } from "@/lib/domain/missionStates";

/**
 * The clean professional dashboard — the original Founders' Desk layout,
 * now scoped to whichever workspace the top workspace bar has selected
 * (missions here are already filtered to the active workspace by
 * FoundersDeskApp). Exactly the same real data, handlers, and components
 * HQ View uses; only the layout differs.
 */
export function FocusView({
  agents,
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
}: {
  agents: Agent[];
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
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr_420px]">
      <aside className="space-y-6">
        <AgentRoster agents={agents} />
        <Ledger entries={ledgerEntries} totalUsd={ledgerTotal} />
      </aside>

      <section className="space-y-6">
        <WorkspacePanel projects={projects} onCreate={onCreateWorkspace} />

        <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
          <h2 className="font-display text-lg font-semibold text-hq-ink">Create a mission</h2>
          <p className="mt-1 text-sm text-hq-slate">
            Give Scout a brief. It will come back with an honest, evidence-labeled research
            report — never a guaranteed outcome.
          </p>
          <MissionForm projects={projects} defaultProjectId={defaultProjectId} onSubmit={onCreateMission} />
        </div>

        <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
          <h2 className="font-display text-lg font-semibold text-hq-ink">Missions</h2>
          {missions.length === 0 ? (
            <p className="mt-3 text-sm text-hq-slate">
              No missions yet in this workspace — create the first one above.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-hq-brass/10">
              {missions.map((mission) => (
                <li key={mission.id} className="py-3">
                  <button
                    onClick={() => onSelectMission(mission.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition hover:bg-hq-parchment/60 ${
                      selectedMissionId === mission.id ? "bg-hq-parchment/80" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-hq-ink">{mission.title}</span>
                      <StatusBadge state={mission.state} />
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-hq-slate">{mission.brief}</p>
                  </button>

                  <div className="mt-2 flex gap-2 px-3">
                    {mission.state === "awaiting_founder_approval" && (
                      <button
                        disabled={busyMissionId === mission.id}
                        onClick={() => onApprove(mission.id)}
                        className="rounded-md bg-hq-teal px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busyMissionId === mission.id ? "Sending Scout…" : "Approve & send Scout"}
                      </button>
                    )}
                    {isCancellable(mission.state) && (
                      <button
                        disabled={busyMissionId === mission.id}
                        onClick={() => onCancel(mission.id)}
                        className="rounded-md border border-hq-slate/30 px-3 py-1 text-xs font-medium text-hq-slate disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside>
        <MissionDetail detail={missionDetail} />
      </aside>
    </div>
  );
}
