"use client";

import type { Mission, Project } from "@/lib/db/types";
import { StatusBadge } from "../StatusBadge";
import { MissionForm } from "../MissionForm";
import { MissionDetail, type MissionDetailData } from "../MissionDetail";
import { ProductionActions } from "../ProductionActions";
import { ExecutiveAssistantTasks } from "../ExecutiveAssistantTasks";
import { OperationsAgentChecklists } from "../OperationsAgentChecklists";
import { ChiefOfStaffPanel } from "../ChiefOfStaffPanel";
import { isCancellable } from "@/lib/domain/missionStates";
import { FocusCard, FocusSectionHeading, FocusEmptyState } from "./FocusPrimitives";

/**
 * Assigning work and reviewing genuine results (Mission 8 Focus View
 * redesign, item 3) — Scout/Content Bot missions take center stage (the
 * real, billed, agent-dispatching workflow); Executive Assistant,
 * Operations, and Chief of Staff's internal task-tracking tools sit
 * alongside as real but manual/delegation tools, same real components
 * and handlers FocusView already used, just laid out with real hierarchy
 * instead of one long sidebar stack.
 */
export function TasksSection({
  projects,
  defaultProjectId,
  missions,
  missionDetail,
  selectedMissionId,
  busyMissionId,
  onCreateMission,
  onSelectMission,
  onApprove,
  onCancel,
  onOpenApproveForProduction,
  onOpenCommissionPilot,
  onOpenProduceAgain,
  onOpenContentReview,
}: {
  projects: Project[];
  defaultProjectId: string | null;
  missions: Mission[];
  missionDetail: MissionDetailData | null;
  selectedMissionId: string | null;
  busyMissionId: string | null;
  onCreateMission: (title: string, brief: string, projectId: string) => Promise<void>;
  onSelectMission: (missionId: string) => void;
  onApprove: (missionId: string) => void;
  onCancel: (missionId: string) => void;
  onOpenApproveForProduction: () => void;
  onOpenCommissionPilot: () => void;
  onOpenProduceAgain: () => void;
  onOpenContentReview: (contentItemId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <FocusCard>
            <FocusSectionHeading
              title="Assign Scout a brief"
              description="It will come back with an honest, evidence-labeled research report — never a guaranteed outcome."
            />
            <div className="mt-4">
              <MissionForm projects={projects} defaultProjectId={defaultProjectId} onSubmit={onCreateMission} />
            </div>
          </FocusCard>

          <FocusCard>
            <FocusSectionHeading title="Missions" description={`${missions.length} total in this workspace.`} />
            <div className="mt-4">
              {missions.length === 0 ? (
                <FocusEmptyState title="No missions yet" body="Create the first one above." />
              ) : (
                <ul className="divide-y divide-focus-border">
                  {missions.map((mission) => (
                    <li key={mission.id} className="py-3">
                      <button
                        onClick={() => onSelectMission(mission.id)}
                        className={`w-full rounded-lg px-3 py-2 text-left transition hover:bg-focus-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-emerald ${
                          selectedMissionId === mission.id ? "bg-focus-ivory" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-focus-ink">{mission.title}</span>
                          <StatusBadge state={mission.state} />
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-focus-slate">{mission.brief}</p>
                      </button>

                      <div className="mt-2 flex gap-2 px-3">
                        {mission.state === "awaiting_founder_approval" && (
                          <button
                            disabled={busyMissionId === mission.id}
                            onClick={() => onApprove(mission.id)}
                            className="rounded-md bg-focus-emerald px-3 py-1 text-xs font-semibold text-white transition hover:bg-focus-emeraldLight disabled:opacity-50"
                          >
                            {busyMissionId === mission.id ? "Sending Scout…" : "Approve & send Scout"}
                          </button>
                        )}
                        {isCancellable(mission.state) && (
                          <button
                            disabled={busyMissionId === mission.id}
                            onClick={() => onCancel(mission.id)}
                            className="rounded-md border border-focus-border px-3 py-1 text-xs font-medium text-focus-slate hover:bg-focus-ivory disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                        {selectedMissionId === mission.id && missionDetail && (
                          <ProductionActions
                            detail={missionDetail}
                            busy={busyMissionId === mission.id}
                            onOpenApproveForProduction={onOpenApproveForProduction}
                            onOpenCommissionPilot={onOpenCommissionPilot}
                            onOpenProduceAgain={onOpenProduceAgain}
                            onOpenContentReview={onOpenContentReview}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FocusCard>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <FocusCard>
            <MissionDetail detail={missionDetail} />
          </FocusCard>
        </aside>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-focus-emerald">Internal tools & delegation</h3>
        <p className="mt-1 text-sm text-focus-slate">
          Executive Assistant, Operations, and Chief of Staff — real task tracking and delegation, separate from
          Scout/Content Bot&apos;s own billed agent work.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FocusCard>
            <ExecutiveAssistantTasks />
          </FocusCard>
          <FocusCard>
            <OperationsAgentChecklists />
          </FocusCard>
          <FocusCard>
            <ChiefOfStaffPanel />
          </FocusCard>
        </div>
      </div>
    </div>
  );
}
