import "server-only";
import {
  getMission,
  listStages,
  listAssignments,
  listEvidence,
  listDeliverables,
  listCosts,
  listApprovals,
  listActivity,
} from "@/lib/db/repositories";
import type { ScoutReport } from "@/lib/agents/scout/schema";

export async function getMissionDetail(missionId: string) {
  const mission = await getMission(missionId);
  if (!mission) return null;

  const [stages, assignments, evidence, deliverables, costs, approvals, activity] = await Promise.all([
    listStages(missionId),
    listAssignments(missionId),
    listEvidence(missionId),
    listDeliverables(missionId),
    listCosts(missionId),
    listApprovals(missionId),
    listActivity(missionId),
  ]);

  const scoutReport = deliverables.find((d) => d.kind === "scout_research_report")?.content as
    | ScoutReport
    | undefined;

  return {
    mission,
    stages,
    assignments,
    evidence,
    deliverables,
    scoutReport: scoutReport ?? null,
    costs,
    approvals,
    activity,
  };
}
