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
  listContentItemsForMissions,
} from "@/lib/db/repositories";
import type { ScoutReport } from "@/lib/agents/scout/schema";

/**
 * `organizationId` is required and real-server-resolved by the caller
 * (never accepted from a client) — a mission belonging to a different
 * organization returns `null`, the exact same shape as a mission that
 * genuinely doesn't exist, so a founder outside an organization can
 * never tell the difference (Master Development Mission 6, Section 8).
 */
export async function getMissionDetail(missionId: string, organizationId: string) {
  const mission = await getMission(missionId);
  if (!mission || mission.organization_id !== organizationId) return null;

  const [stages, assignments, evidence, deliverables, costs, approvals, activity, contentItems] = await Promise.all([
    listStages(missionId),
    listAssignments(missionId),
    listEvidence(missionId),
    listDeliverables(missionId),
    listCosts(missionId),
    listApprovals(missionId),
    listActivity(missionId),
    listContentItemsForMissions([missionId]),
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
    contentItems,
  };
}
