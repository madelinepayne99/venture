"use client";

import { useMemo, useState } from "react";
import type { Mission, Project } from "@/lib/db/types";
import { StatusBadge } from "../StatusBadge";
import { MissionForm } from "../MissionForm";
import { MissionDetail, type MissionDetailData } from "../MissionDetail";
import { ProductionActions } from "../ProductionActions";
import { ExecutiveAssistantTasks } from "../ExecutiveAssistantTasks";
import { OperationsAgentChecklists } from "../OperationsAgentChecklists";
import { ChiefOfStaffPanel } from "../ChiefOfStaffPanel";
import { isCancellable, missionDockBucket, MISSION_DOCK_BUCKET_LABELS, type MissionDockBucket } from "@/lib/domain/missionStates";
import { FocusCard, FocusSectionHeading, FocusEmptyState } from "./FocusPrimitives";

const PAGE_SIZE = 8;
const ALL_BUCKETS = "all" as const;

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
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<MissionDockBucket | typeof ALL_BUCKETS>(ALL_BUCKETS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filteredMissions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return missions.filter((mission) => {
      const matchesSearch =
        !query || mission.title.toLowerCase().includes(query) || mission.brief.toLowerCase().includes(query);
      const matchesBucket = bucketFilter === ALL_BUCKETS || missionDockBucket(mission.state) === bucketFilter;
      return matchesSearch && matchesBucket;
    });
  }, [missions, search, bucketFilter]);

  const visibleMissions = filteredMissions.slice(0, visibleCount);
  const hasMore = filteredMissions.length > visibleMissions.length;

  // Any real, deliberate filter/search change resets pagination — never
  // show "load more" against a stale, pre-filter page offset.
  function updateSearch(value: string) {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  }
  function updateBucketFilter(value: MissionDockBucket | typeof ALL_BUCKETS) {
    setBucketFilter(value);
    setVisibleCount(PAGE_SIZE);
  }

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
            <FocusSectionHeading
              title="Missions"
              description={
                filteredMissions.length === missions.length
                  ? `${missions.length} total in this workspace.`
                  : `${filteredMissions.length} of ${missions.length} shown.`
              }
            />
            {missions.length > 0 && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => updateSearch(e.target.value)}
                  placeholder="Search by title or brief…"
                  aria-label="Search missions"
                  className="flex-1 rounded-md border border-focus-border px-3 py-1.5 text-sm text-focus-ink focus:border-focus-emerald focus:outline-none"
                />
                <select
                  value={bucketFilter}
                  onChange={(e) => updateBucketFilter(e.target.value as MissionDockBucket | typeof ALL_BUCKETS)}
                  aria-label="Filter missions by status"
                  className="rounded-md border border-focus-border bg-white px-3 py-1.5 text-sm text-focus-ink focus:border-focus-emerald focus:outline-none"
                >
                  <option value={ALL_BUCKETS}>All statuses</option>
                  {Object.entries(MISSION_DOCK_BUCKET_LABELS).map(([bucket, label]) => (
                    <option key={bucket} value={bucket}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="mt-4">
              {missions.length === 0 ? (
                <FocusEmptyState title="No missions yet" body="Create the first one above." />
              ) : filteredMissions.length === 0 ? (
                <FocusEmptyState title="No missions match" body="Try a different search term or status filter." />
              ) : (
                <ul className="divide-y divide-focus-border">
                  {visibleMissions.map((mission) => (
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
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="mt-4 w-full rounded-md border border-focus-border py-2 text-sm font-medium text-focus-emerald transition hover:bg-focus-ivory"
                >
                  Show more ({filteredMissions.length - visibleMissions.length} remaining)
                </button>
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
