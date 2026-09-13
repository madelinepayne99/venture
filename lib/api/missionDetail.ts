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

export function getMissionDetail(missionId: string) {
  const mission = getMission(missionId);
  if (!mission) return null;

  const deliverables = listDeliverables(missionId);
  const scoutReport = deliverables.find((d) => d.kind === "scout_research_report")?.content as
    | ScoutReport
    | undefined;

  return {
    mission,
    stages: listStages(missionId),
    assignments: listAssignments(missionId),
    evidence: listEvidence(missionId),
    deliverables,
    scoutReport: scoutReport ?? null,
    costs: listCosts(missionId),
    approvals: listApprovals(missionId),
    activity: listActivity(missionId),
  };
}
