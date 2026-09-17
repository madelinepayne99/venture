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
  // Only present once the mission has genuinely had a second research
  // pass — never fabricated as an empty placeholder for a one-pass
  // mission (see MissionDetail.tsx, which only renders this section when
  // it's non-null).
  const followupReport = deliverables.find((d) => d.kind === "scout_followup_report")?.content as
    | ScoutReport
    | undefined;

  return {
    mission,
    stages,
    assignments,
    evidence,
    deliverables,
    scoutReport: scoutReport ?? null,
    followupReport: followupReport ?? null,
    costs,
    approvals,
    activity,
  };
}
