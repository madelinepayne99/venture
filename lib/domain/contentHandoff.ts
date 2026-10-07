import "server-only";
import type { Deliverable, Evidence, Mission, Project } from "@/lib/db/types";
import type { ScoutReport, ProductionRecommendation } from "@/lib/agents/scout/schema";

/**
 * The real Scout -> Content Bot hand-off data model — a frozen jsonb
 * snapshot built ONCE at the production gate from real rows (missions,
 * projects, the exact Scout deliverable, and the evidence the founder
 * selected), stored on content_items.brief. Frozen rather than
 * joined-at-read-time: the source rows are all insert-only, so freezing
 * changes nothing about correctness, but it does make the hand-off
 * reproducible and auditable — "here is exactly what Content Bot was
 * given" must still be answerable after later revisions, and it makes the
 * production prompt a pure function of one column.
 *
 * `source` distinguishes the two, mutually exclusive ways a content item
 * can ever come to exist — permanently and auditably, not just in an
 * activity-log sentence:
 *  - "scout_recommended": the normal path. Scout itself produced a
 *    structured production_recommendation; `founder_commission` is null.
 *  - "founder_commissioned": a founder deliberately chose to commission
 *    production from Scout's preserved research even though Scout did not
 *    formally recommend it (see buildFounderCommissionedBrief below).
 *    `production_recommendation` is null — nothing is ever inferred or
 *    fabricated on Scout's behalf — and `founder_commission` carries
 *    exactly what the founder typed, nothing more.
 * Scout's own real verdict, key findings, and deliverable id are carried
 * over verbatim in EITHER case — those are factual references to what
 * Scout actually produced, not a recommendation being reattributed to it.
 */
export type FounderCommission = {
  commissioned_by_founder_id: string;
  commissioned_at: string;
  /** The founder's own substitute for Scout's suggested_original_angle — required, never inferred. */
  concept: string;
  /** The founder's own substitute for Scout's why_it_works — required, never inferred. */
  creative_direction: string;
  /** Founder-authored, same role as Scout's own do_not_imitate list — empty array, never omitted. */
  do_not_imitate: string[];
};

export type ProductionBrief = {
  source: "scout_recommended" | "founder_commissioned";
  mission: { id: string; title: string; brief: string; interpreted_mission: string | null };
  project: { id: string; name: string; platform_focus: string | null; workspace_type: string } | null;
  scout: {
    deliverable_id: string;
    verdict: ScoutReport["verdict"];
    /** Verified facts' own statements, carried over verbatim — never re-summarized or reworded here. */
    key_findings: string[];
    /** Null exactly when source is "founder_commissioned" — never fabricated to fill this in. */
    production_recommendation: ProductionRecommendation | null;
  };
  /** Null exactly when source is "scout_recommended". */
  founder_commission: FounderCommission | null;
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

function buildEvidenceSnapshot(evidence: Evidence[], selectedEvidenceIds: string[]): ProductionBrief["evidence"] {
  const selected = new Set(selectedEvidenceIds);
  return evidence
    .filter((e) => selected.has(e.id))
    .map((e) => ({
      id: e.id,
      source_url: e.source_url,
      source_title: e.source_title,
      source_date: e.source_date,
      snippet: e.snippet,
      is_verified_fact: e.is_verified_fact,
    }));
}

function buildMissionAndProjectSnapshot(mission: Mission, project: Project | null) {
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
  };
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

  return {
    source: "scout_recommended",
    ...buildMissionAndProjectSnapshot(mission, project),
    scout: {
      deliverable_id: scoutDeliverable.id,
      verdict: report.verdict,
      key_findings: report.verified_facts.map((f) => f.statement),
      production_recommendation: report.production_recommendation,
    },
    founder_commission: null,
    evidence: buildEvidenceSnapshot(evidence, selectedEvidenceIds),
    founder_notes: founderNotes,
    frozen_at: new Date().toISOString(),
  };
}

export class FounderCommissionValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "FounderCommissionValidationError";
  }
}

/**
 * The override path's own brief builder — deliberately a separate
 * function from buildProductionBrief, not a mode flag on it, so the
 * normal path's "no production_recommendation -> throw" behavior stays
 * completely untouched. Never reads or requires report.production_recommendation
 * at all (the caller, commissionPilotAnyway, is what enforces that a real
 * Scout recommendation must use the normal path instead). concept and
 * creative_direction are the founder's own required words — there is no
 * default, no inference from Scout's prose, and no fallback value.
 */
export function buildFounderCommissionedBrief(input: {
  mission: Mission;
  project: Project | null;
  scoutDeliverable: Deliverable<ScoutReport>;
  evidence: Evidence[];
  selectedEvidenceIds: string[];
  founderNotes: string | null;
  founderId: string;
  concept: string;
  creativeDirection: string;
  doNotImitate?: string[];
}): ProductionBrief {
  const { mission, project, scoutDeliverable, evidence, selectedEvidenceIds, founderNotes, founderId } = input;
  const concept = input.concept.trim();
  const creativeDirection = input.creativeDirection.trim();

  const errors: string[] = [];
  if (!concept) errors.push("concept is required to commission production without Scout's own recommendation.");
  if (!creativeDirection) {
    errors.push("creativeDirection is required to commission production without Scout's own recommendation.");
  }
  if (errors.length > 0) {
    throw new FounderCommissionValidationError(errors);
  }

  const report = scoutDeliverable.content;

  return {
    source: "founder_commissioned",
    ...buildMissionAndProjectSnapshot(mission, project),
    scout: {
      deliverable_id: scoutDeliverable.id,
      verdict: report.verdict,
      key_findings: report.verified_facts.map((f) => f.statement),
      production_recommendation: null,
    },
    founder_commission: {
      commissioned_by_founder_id: founderId,
      commissioned_at: new Date().toISOString(),
      concept,
      creative_direction: creativeDirection,
      do_not_imitate: (input.doNotImitate ?? []).map((s) => s.trim()).filter(Boolean),
    },
    evidence: buildEvidenceSnapshot(evidence, selectedEvidenceIds),
    founder_notes: founderNotes,
    frozen_at: new Date().toISOString(),
  };
}
