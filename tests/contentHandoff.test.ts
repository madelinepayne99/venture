import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getProject, getMission, listContentItemsForMissions } from "@/lib/db/repositories";
import { buildProductionBrief, NoProductionRecommendationError } from "@/lib/domain/contentHandoff";
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
