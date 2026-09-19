import "server-only";
import type { Deliverable, Evidence, Mission, Project } from "@/lib/db/types";
import type { ScoutReport, ProductionRecommendation } from "@/lib/agents/scout/schema";

/**
 * The real Scout -> Content Bot hand-off data model — a frozen jsonb
 * snapshot built ONCE at the "approve for production" gate from real rows
 * (missions, projects, the exact Scout deliverable, and the evidence the
 * founder selected), stored on content_items.brief. Frozen rather than
 * joined-at-read-time: the source rows are all insert-only, so freezing
 * changes nothing about correctness, but it does make the hand-off
 * reproducible and auditable — "here is exactly what Content Bot was
 * given" must still be answerable after later revisions, and it makes the
 * production prompt a pure function of one column.
 */
export type ProductionBrief = {
  mission: { id: string; title: string; brief: string; interpreted_mission: string | null };
  project: { id: string; name: string; platform_focus: string | null; workspace_type: string } | null;
  scout: {
    deliverable_id: string;
    verdict: ScoutReport["verdict"];
    /** Verified facts' own statements, carried over verbatim — never re-summarized or reworded here. */
    key_findings: string[];
    production_recommendation: ProductionRecommendation;
  };
  evidence: Array<{
    id: string;
    source_url: string | null;
    source_title: string | null;
    source_date: string | null;
    snippet: string | null;
    is_verified_fact: boolean;
  }>;
  founder_notes: string | null;
  frozen_at: string;
};

export class NoProductionRecommendationError extends Error {
  constructor(missionId: string) {
    super(
      `Mission ${missionId}'s Scout report has no production_recommendation — Scout did not recommend this opportunity for production, so it cannot be approved for production.`,
    );
    this.name = "NoProductionRecommendationError";
  }
}

export function buildProductionBrief(input: {
  mission: Mission;
  project: Project | null;
  scoutDeliverable: Deliverable<ScoutReport>;
  evidence: Evidence[];
  selectedEvidenceIds: string[];
  founderNotes: string | null;
}): ProductionBrief {
  const { mission, project, scoutDeliverable, evidence, selectedEvidenceIds, founderNotes } = input;
  const report = scoutDeliverable.content;

  if (!report.production_recommendation) {
    throw new NoProductionRecommendationError(mission.id);
  }

  const selected = new Set(selectedEvidenceIds);
  const selectedEvidence = evidence.filter((e) => selected.has(e.id));

  return {
    mission: {
      id: mission.id,
      title: mission.title,
      brief: mission.brief,
      interpreted_mission: mission.interpreted_mission,
    },
    project: project
      ? {
          id: project.id,
          name: project.name,
          platform_focus: project.platform_focus,
          workspace_type: project.workspace_type,
        }
      : null,
    scout: {
      deliverable_id: scoutDeliverable.id,
      verdict: report.verdict,
      key_findings: report.verified_facts.map((f) => f.statement),
      production_recommendation: report.production_recommendation,
    },
    evidence: selectedEvidence.map((e) => ({
      id: e.id,
      source_url: e.source_url,
      source_title: e.source_title,
      source_date: e.source_date,
      snippet: e.snippet,
      is_verified_fact: e.is_verified_fact,
    })),
    founder_notes: founderNotes,
    frozen_at: new Date().toISOString(),
  };
}
