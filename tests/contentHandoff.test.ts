import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  getProject,
  getMission,
  listContentItemsForMissions,
  transitionMissionState,
  listDeliverables,
  listEvidence,
} from "@/lib/db/repositories";
import {
  buildProductionBrief,
  buildFounderCommissionedBrief,
  NoProductionRecommendationError,
  FounderCommissionValidationError,
} from "@/lib/domain/contentHandoff";
import { makeScoutReport, makeProductionRecommendation, setupMissionReadyForProduction } from "./testUtils";
import type { Deliverable } from "@/lib/db/types";
import type { ScoutReport } from "@/lib/agents/scout/schema";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

describe("buildProductionBrief (pure)", () => {
  it("throws when the report has no production_recommendation", () => {
    const report = makeScoutReport({ production_recommendation: undefined });
    expect(() =>
      buildProductionBrief({
        mission: { id: "m1", title: "t", brief: "b", state: "ready_for_founders_review" } as never,
        project: null,
        scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
        evidence: [],
        selectedEvidenceIds: [],
        founderNotes: null,
      }),
    ).toThrow(NoProductionRecommendationError);
  });

  it("freezes only the founder-selected evidence, never the mission's full evidence list", () => {
    const report = makeScoutReport({ production_recommendation: makeProductionRecommendation() });
    const evidence = [
      { id: "e1", mission_id: "m1", source_url: "https://a.example", source_title: "A", source_date: null, snippet: null, is_verified_fact: true },
      { id: "e2", mission_id: "m1", source_url: "https://b.example", source_title: "B", source_date: null, snippet: null, is_verified_fact: false },
    ];
    const brief = buildProductionBrief({
      mission: { id: "m1", title: "Mission title", brief: "brief text", interpreted_mission: null } as never,
      project: null,
      scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
      evidence: evidence as never,
      selectedEvidenceIds: ["e1"],
      founderNotes: "Keep it upbeat.",
    });

    expect(brief.evidence).toHaveLength(1);
    expect(brief.evidence[0]!.id).toBe("e1");
    expect(brief.founder_notes).toBe("Keep it upbeat.");
    expect(brief.scout.production_recommendation).toEqual(report.production_recommendation);
    expect(brief.scout.key_findings).toEqual(report.verified_facts.map((f) => f.statement));
  });

  it("carries a null project through unchanged", () => {
    const report = makeScoutReport({ production_recommendation: makeProductionRecommendation() });
    const brief = buildProductionBrief({
      mission: { id: "m1", title: "t", brief: "b", interpreted_mission: null } as never,
      project: null,
      scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
      evidence: [],
      selectedEvidenceIds: [],
      founderNotes: null,
    });
    expect(brief.project).toBeNull();
  });
});

describe("approveForProduction (real Postgres)", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  it("refuses a mission with no real production_recommendation", async () => {
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { NoProductionRecommendationError: NoRec } = await import("@/lib/domain/contentHandoff");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });

    await expect(
      approveForProduction(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
      }),
    ).rejects.toBeInstanceOf(NoRec);
  });

  it("creates a real content item whose frozen brief contains only the founder-selected evidence", async () => {
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);

    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
      founderNotes: "Keep it light.",
    });

    expect(item.state).toBe("planning");
    const brief = item.brief as { evidence: Array<{ id: string }>; founder_notes: string | null };
    expect(brief.evidence.map((e) => e.id)).toEqual([evidence[0]!.id]);
    expect(brief.founder_notes).toBe("Keep it light.");

    const updatedMission = await getMission(mission.id);
    const project = await getProject(updatedMission!.project_id!);
    expect(project).toBeTruthy();

    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
    expect(inngestModule.inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "content/production_requested", data: { contentItemId: item.id, missionId: mission.id } }),
    );
  });

  it("is idempotent under a genuinely concurrent duplicate approval — the mission transition is what serializes it", async () => {
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { MissionConcurrencyError } = await import("@/lib/domain/missionStates");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);

    const input = {
      targetPlatform: "youtube_shorts" as const,
      audience: "general" as const,
      contentType: "educational" as const,
      selectedEvidenceIds: [evidence[0]!.id],
    };

    const results = await Promise.allSettled([
      approveForProduction(mission.id, founderId, input),
      approveForProduction(mission.id, founderId, input),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(MissionConcurrencyError);

    // Exactly one real content item was ever created for this mission.
    const items = await listContentItemsForMissions([mission.id]);
    expect(items).toHaveLength(1);
  });
});

describe("buildFounderCommissionedBrief (pure)", () => {
  it("never requires production_recommendation to exist, and never reads it", () => {
    const report = makeScoutReport({ production_recommendation: undefined });
    const brief = buildFounderCommissionedBrief({
      mission: { id: "m1", title: "t", brief: "b", interpreted_mission: null } as never,
      project: null,
      scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
      evidence: [],
      selectedEvidenceIds: [],
      founderNotes: null,
      founderId: "founder-1",
      concept: "An original speculative-creature explainer.",
      creativeDirection: "Calm, factual narration over one AI-generated creature reveal.",
    });
    expect(brief.source).toBe("founder_commissioned");
    expect(brief.scout.production_recommendation).toBeNull();
  });

  it("throws when concept is missing or blank", () => {
    const report = makeScoutReport({ production_recommendation: undefined });
    expect(() =>
      buildFounderCommissionedBrief({
        mission: { id: "m1", title: "t", brief: "b", interpreted_mission: null } as never,
        project: null,
        scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
        evidence: [],
        selectedEvidenceIds: [],
        founderNotes: null,
        founderId: "founder-1",
        concept: "   ",
        creativeDirection: "Real direction.",
      }),
    ).toThrow(FounderCommissionValidationError);
  });

  it("throws when creativeDirection is missing or blank", () => {
    const report = makeScoutReport({ production_recommendation: undefined });
    expect(() =>
      buildFounderCommissionedBrief({
        mission: { id: "m1", title: "t", brief: "b", interpreted_mission: null } as never,
        project: null,
        scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
        evidence: [],
        selectedEvidenceIds: [],
        founderNotes: null,
        founderId: "founder-1",
        concept: "Real concept.",
        creativeDirection: "",
      }),
    ).toThrow(FounderCommissionValidationError);
  });

  it("carries the founder's exact words, who, and when — nothing inferred, nothing from Scout's prose", () => {
    const report = makeScoutReport({ production_recommendation: undefined, verdict_rationale: "Scout's own words, never used here." });
    const before = new Date();
    const brief = buildFounderCommissionedBrief({
      mission: { id: "m1", title: "t", brief: "b", interpreted_mission: null } as never,
      project: null,
      scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
      evidence: [],
      selectedEvidenceIds: [],
      founderNotes: null,
      founderId: "founder-42",
      concept: "  My own concept.  ",
      creativeDirection: "  My own direction.  ",
      doNotImitate: ["  Some Named Creator  ", "  "],
    });

    expect(brief.founder_commission).toEqual({
      commissioned_by_founder_id: "founder-42",
      commissioned_at: expect.any(String),
      concept: "My own concept.", // trimmed, not reworded
      creative_direction: "My own direction.",
      do_not_imitate: ["Some Named Creator"], // trimmed, blanks dropped
    });
    expect(new Date(brief.founder_commission!.commissioned_at).getTime()).toBeGreaterThanOrEqual(before.getTime());
    // Scout's own real, factual output is still carried over verbatim.
    expect(brief.scout.verdict).toBe(report.verdict);
    expect(brief.scout.key_findings).toEqual(report.verified_facts.map((f) => f.statement));
    expect(brief.scout.deliverable_id).toBe("d1");
  });

  it("do_not_imitate defaults to an empty array, never undefined", () => {
    const report = makeScoutReport({ production_recommendation: undefined });
    const brief = buildFounderCommissionedBrief({
      mission: { id: "m1", title: "t", brief: "b", interpreted_mission: null } as never,
      project: null,
      scoutDeliverable: { id: "d1", content: report } as Deliverable<ScoutReport>,
      evidence: [],
      selectedEvidenceIds: [],
      founderNotes: null,
      founderId: "founder-1",
      concept: "Concept.",
      creativeDirection: "Direction.",
    });
    expect(brief.founder_commission!.do_not_imitate).toEqual([]);
  });
});

describe("commissionPilotAnyway (real Postgres)", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  const commissionInput = {
    targetPlatform: "youtube_shorts" as const,
    audience: "general" as const,
    contentType: "educational" as const,
    concept: "An original speculative-creature explainer.",
    creativeDirection: "Calm, factual narration over one invented creature per video.",
  };

  it("refuses (ProductionRecommendationAlreadyExistsError) when Scout's report already has a real recommendation — use the normal path instead", async () => {
    const { commissionPilotAnyway, ProductionRecommendationAlreadyExistsError } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId); // default has a real recommendation

    await expect(
      commissionPilotAnyway(mission.id, founderId, { ...commissionInput, selectedEvidenceIds: [evidence[0]!.id] }),
    ).rejects.toBeInstanceOf(ProductionRecommendationAlreadyExistsError);
  });

  it("refuses (InsufficientEvidenceToCommissionError) when the preserved report has no meaningful evidence, regardless of verdict", async () => {
    const { commissionPilotAnyway, InsufficientEvidenceToCommissionError } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined, verified_facts: [], sources: [] },
    });

    // A real evidence ROW still exists (the fixture always records one) —
    // it's the REPORT's own verified_facts/sources that are empty, which is
    // what hasMeaningfulEvidence actually checks. Selecting it here only
    // clears the "at least one evidence id" input check, so this test
    // reaches the real evidence guardrail rather than input validation.
    await expect(
      commissionPilotAnyway(mission.id, founderId, { ...commissionInput, selectedEvidenceIds: [evidence[0]!.id] }),
    ).rejects.toBeInstanceOf(InsufficientEvidenceToCommissionError);
  });

  it("refuses (CommissionPilotValidationError) when concept or creativeDirection is missing, before touching the mission", async () => {
    const { commissionPilotAnyway, CommissionPilotValidationError } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });

    await expect(
      commissionPilotAnyway(mission.id, founderId, {
        ...commissionInput,
        concept: "",
        selectedEvidenceIds: [evidence[0]!.id],
      }),
    ).rejects.toBeInstanceOf(CommissionPilotValidationError);

    const untouched = await getMission(mission.id);
    expect(untouched?.state).toBe("ready_for_founders_review");
  });

  it("commissions a real content item, frozen with source \"founder_commissioned\" and no fabricated recommendation", async () => {
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });

    const item = await commissionPilotAnyway(mission.id, founderId, {
      ...commissionInput,
      selectedEvidenceIds: [evidence[0]!.id],
      founderNotes: "Keep it upbeat.",
    });

    expect(item.state).toBe("planning");
    const brief = item.brief as {
      source: string;
      scout: { production_recommendation: unknown };
      founder_commission: { commissioned_by_founder_id: string; concept: string } | null;
    };
    expect(brief.source).toBe("founder_commissioned");
    expect(brief.scout.production_recommendation).toBeNull();
    expect(brief.founder_commission?.commissioned_by_founder_id).toBe(founderId);
    expect(brief.founder_commission?.concept).toBe(commissionInput.concept);

    const updatedMission = await getMission(mission.id);
    expect(updatedMission?.state).toBe("in_production");

    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
    expect(inngestModule.inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "content/production_requested", data: { contentItemId: item.id, missionId: mission.id } }),
    );
  });

  it("records a distinct audit trail: who commissioned it and when, via the real approvals table — never the normal decision value", async () => {
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { listApprovalsForContentItem } = await import("@/lib/db/repositories");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });

    const before = new Date();
    const item = await commissionPilotAnyway(mission.id, founderId, {
      ...commissionInput,
      selectedEvidenceIds: [evidence[0]!.id],
    });

    const approvals = await listApprovalsForContentItem(item.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.decision).toBe("commission_pilot_anyway");
    expect(approvals[0]?.founder_id).toBe(founderId);
    expect(new Date(approvals[0]!.decided_at).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(approvals[0]?.content_item_id).toBe(item.id);
  });

  it("is idempotent under a genuinely concurrent duplicate commission — the same atomic mission transition serializes it", async () => {
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { MissionConcurrencyError } = await import("@/lib/domain/missionStates");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });

    const input = { ...commissionInput, selectedEvidenceIds: [evidence[0]!.id] };
    const results = await Promise.allSettled([
      commissionPilotAnyway(mission.id, founderId, input),
      commissionPilotAnyway(mission.id, founderId, input),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(MissionConcurrencyError);

    const items = await listContentItemsForMissions([mission.id]);
    expect(items).toHaveLength(1);
  });

  it("refuses from any state other than ready_for_founders_review (e.g. a mission still researching)", async () => {
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { IllegalMissionTransitionError } = await import("@/lib/domain/missionStates");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    await transitionMissionState(mission.id, ["ready_for_founders_review"], "in_production");
    // Now genuinely in_production — not ready_for_founders_review anymore.
    await transitionMissionState(mission.id, ["in_production"], "production_complete");

    await expect(
      commissionPilotAnyway(mission.id, founderId, { ...commissionInput, selectedEvidenceIds: [evidence[0]!.id] }),
    ).rejects.toBeInstanceOf(IllegalMissionTransitionError);
  });

  it("the existing normal approveForProduction path is completely unaffected by this override existing", async () => {
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId); // real recommendation present

    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });

    expect((item.brief as { source: string }).source).toBe("scout_recommended");
    const { listApprovalsForContentItem } = await import("@/lib/db/repositories");
    const approvals = await listApprovalsForContentItem(item.id);
    expect(approvals[0]?.decision).toBe("approve_for_production");
  });
});

describe("commissionPilotAnyway / approveForProduction — idempotent against a genuine duplicate call", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  it("a genuine duplicate commissionPilotAnyway call (mission already in_production, item already exists) returns the SAME item — no second item, no second dispatch", async () => {
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    const input = {
      targetPlatform: "youtube_shorts" as const,
      audience: "general" as const,
      contentType: "educational" as const,
      selectedEvidenceIds: [evidence[0]!.id],
      concept: "Concept.",
      creativeDirection: "Direction.",
    };

    const first = await commissionPilotAnyway(mission.id, founderId, input);
    const second = await commissionPilotAnyway(mission.id, founderId, input);

    expect(second.id).toBe(first.id);
    const items = await listContentItemsForMissions([mission.id]);
    expect(items).toHaveLength(1);
    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1); // never re-dispatched
  });

  it("a genuine duplicate approveForProduction call likewise resolves idempotently to the same item", async () => {
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const input = {
      targetPlatform: "youtube_shorts" as const,
      audience: "general" as const,
      contentType: "educational" as const,
      selectedEvidenceIds: [evidence[0]!.id],
    };

    const first = await approveForProduction(mission.id, founderId, input);
    const second = await approveForProduction(mission.id, founderId, input);

    expect(second.id).toBe(first.id);
    expect(await listContentItemsForMissions([mission.id])).toHaveLength(1);
  });

  it("a mission stranded in_production with NO content item throws the clear MissionStrandedInProductionError, not IllegalMissionTransitionError", async () => {
    const { commissionPilotAnyway, MissionStrandedInProductionError } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    // Manufacture exactly the real, live bug's data shape: transitioned,
    // nothing else ever committed.
    await transitionMissionState(mission.id, ["ready_for_founders_review"], "in_production");

    await expect(
      commissionPilotAnyway(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
        concept: "Concept.",
        creativeDirection: "Direction.",
      }),
    ).rejects.toBeInstanceOf(MissionStrandedInProductionError);
  });
});

describe("recoverStrandedProduction — narrow recovery for the exact live stranded-production bug", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  async function strandInProduction(reportOverrides: Record<string, unknown> = { production_recommendation: undefined }) {
    const { mission, evidence, report } = await setupMissionReadyForProduction(founderId, { reportOverrides });
    const transition = await transitionMissionState(mission.id, ["ready_for_founders_review"], "in_production");
    return { mission: transition.mission, evidence, report };
  }

  it("recovers a genuinely stranded mission back to ready_for_founders_review, preserving Scout's report/evidence exactly", async () => {
    const { recoverStrandedProduction } = await import("@/lib/domain/missionWorkflow");
    const { mission, report } = await strandInProduction();

    const recovered = await recoverStrandedProduction(mission.id);

    expect(recovered.state).toBe("ready_for_founders_review");
    expect(recovered.final_status).toBe("ready_for_founders_review");
    const deliverables = await listDeliverables(mission.id);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.content).toEqual(report); // byte-for-byte, never re-run
    const evid = await listEvidence(mission.id);
    expect(evid.length).toBeGreaterThan(0);
  });

  it("records a dedicated recovery activity entry explaining why it occurred", async () => {
    const { recoverStrandedProduction } = await import("@/lib/domain/missionWorkflow");
    const { mission } = await strandInProduction();

    await recoverStrandedProduction(mission.id);

    const { listActivity } = await import("@/lib/db/repositories");
    const recovery = (await listActivity(mission.id)).find((a) => a.action === "stranded_production_recovered");
    expect(recovery).toBeTruthy();
    expect(recovery?.actor).toBe("system");
    expect(recovery?.detail).toMatch(/production never actually began/i);
  });

  it("REFUSES when a content item already exists — real production genuinely started", async () => {
    const { recoverStrandedProduction, ProductionGenuinelyStartedError } = await import("@/lib/domain/missionWorkflow");
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    await commissionPilotAnyway(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
      concept: "Concept.",
      creativeDirection: "Direction.",
    });

    await expect(recoverStrandedProduction(mission.id)).rejects.toBeInstanceOf(ProductionGenuinelyStartedError);
    // And the real, genuine production state is completely untouched by the refusal.
    const untouched = await getMission(mission.id);
    expect(untouched?.state).toBe("in_production");
  });

  it("REFUSES when Content Bot is already assigned, even with no content item", async () => {
    const { recoverStrandedProduction, ProductionGenuinelyStartedError } = await import("@/lib/domain/missionWorkflow");
    const { mission } = await strandInProduction();
    const { getAgentByKey, assignAgent } = await import("@/lib/db/repositories");
    const contentBot = await getAgentByKey("content_bot");
    await assignAgent(mission.id, contentBot!.id, "lead");

    await expect(recoverStrandedProduction(mission.id)).rejects.toBeInstanceOf(ProductionGenuinelyStartedError);
  });

  it("REFUSES when a production dispatch/approval activity entry already exists, even with no item or assignment", async () => {
    const { recoverStrandedProduction, ProductionGenuinelyStartedError } = await import("@/lib/domain/missionWorkflow");
    const { mission } = await strandInProduction();
    const { recordActivity } = await import("@/lib/db/repositories");
    await recordActivity({ missionId: mission.id, actor: "system", action: "production_dispatch_failed", detail: "simulated" });

    await expect(recoverStrandedProduction(mission.id)).rejects.toBeInstanceOf(ProductionGenuinelyStartedError);
  });

  it("REFUSES when a production approval row already exists, even with no item/assignment/activity", async () => {
    const { recoverStrandedProduction, ProductionGenuinelyStartedError } = await import("@/lib/domain/missionWorkflow");
    const { mission } = await strandInProduction();
    const { recordApproval } = await import("@/lib/db/repositories");
    await recordApproval({ missionId: mission.id, founderId, decision: "commission_pilot_anyway" });

    await expect(recoverStrandedProduction(mission.id)).rejects.toBeInstanceOf(ProductionGenuinelyStartedError);
  });

  it("REFUSES structurally from any state other than in_production", async () => {
    const { recoverStrandedProduction } = await import("@/lib/domain/missionWorkflow");
    const { IllegalMissionTransitionError } = await import("@/lib/domain/missionStates");
    const { mission } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    }); // still ready_for_founders_review, never transitioned

    await expect(recoverStrandedProduction(mission.id)).rejects.toBeInstanceOf(IllegalMissionTransitionError);
  });

  it("after recovery, the normal Scout-recommended production path still works", async () => {
    const { recoverStrandedProduction } = await import("@/lib/domain/missionWorkflow");
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await strandInProduction({}); // real recommendation present (default)
    await recoverStrandedProduction(mission.id);

    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
    expect((item.brief as { source: string }).source).toBe("scout_recommended");
  });

  it("after recovery, founder-commissioned production still works (the exact real dd7ffd87-style case)", async () => {
    const { recoverStrandedProduction } = await import("@/lib/domain/missionWorkflow");
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await strandInProduction(); // no recommendation, matches the real live mission
    await recoverStrandedProduction(mission.id);

    const item = await commissionPilotAnyway(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
      concept: "An original speculative-creature explainer.",
      creativeDirection: "Calm narration.",
    });
    expect((item.brief as { source: string }).source).toBe("founder_commissioned");
  });
});
