import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  getContentItem,
  listVersionsWithAssets,
  listCostsForContentItem,
  listActivity,
  recordCost,
  transitionContentItemState,
  openNextVersion,
  updateContentVersion,
  getLatestVersion,
} from "@/lib/db/repositories";
import { isRecoverableFailureCategory } from "@/lib/domain/contentFailureCategories";
import { makeContentPlan, makeCreativeStrategy, setupMissionReadyForProduction } from "./testUtils";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

vi.mock("@/lib/agents/contentBot", () => ({
  planContentVersion: vi.fn(),
  reviewContentSafety: vi.fn(),
  planCreativeStrategy: vi.fn(),
  reviewVisualQuality: vi.fn(),
  ContentBotError: class ContentBotError extends Error {
    usage: { model: string; inputTokens: number; outputTokens: number };
    constructor(message: string, usage: { model: string; inputTokens: number; outputTokens: number }) {
      super(message);
      this.name = "ContentBotError";
      this.usage = usage;
    }
  },
}));

describe("isRecoverableFailureCategory (the client-safe eligibility check ContentDecisionBar renders from)", () => {
  it("is true only for the closed allow-list of genuinely technical categories", () => {
    expect(isRecoverableFailureCategory("provider_auth")).toBe(true);
    expect(isRecoverableFailureCategory("provider_unavailable")).toBe(true);
    expect(isRecoverableFailureCategory("provider_network")).toBe(true);
  });

  it("is false for budget exhaustion, unclassified, and no category at all", () => {
    expect(isRecoverableFailureCategory("budget_exhausted")).toBe(false);
    expect(isRecoverableFailureCategory("unclassified")).toBe(false);
    expect(isRecoverableFailureCategory(null)).toBe(false);
    expect(isRecoverableFailureCategory(undefined)).toBe(false);
  });
});

describe("retryProductionAfterTechnicalFailure (real Postgres)", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
    // Cheap, real, no-network registry lookups — retryProductionAfterTechnicalFailure's
    // pre-flight config check instantiates these but never calls .generate() on
    // them, so no real ElevenLabs/fal.ai/Shotstack call is ever made here.
    vi.stubEnv("MEDIA_IMAGE_PROVIDER", "fal-ai");
    vi.stubEnv("MEDIA_VOICE_PROVIDER", "elevenlabs");
    vi.stubEnv("MEDIA_EDIT_PROVIDER", "shotstack");
  });

  /** Creates a real content item and drives it directly to "failed" with a given failure_category, without running the real (mocked-provider) pipeline — this file tests retryProductionAfterTechnicalFailure in isolation from planning/asset generation. */
  async function createFailedContentItem(
    failureCategory: string,
    opts: { viaFounderCommission?: boolean } = {},
  ) {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    let item;
    if (opts.viaFounderCommission) {
      const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
      // A founder-commissioned pilot has no production_recommendation on
      // the underlying report by default (setupMissionReadyForProduction's
      // fixture report already carries one) — set one to null via a fresh
      // mission is more work than needed; commissionPilotAnyway itself
      // requires the report have NO recommendation, so build one that way.
      const { mission: bareMission, evidence: bareEvidence } = await setupMissionReadyForProduction(founderId, {
        reportOverrides: { production_recommendation: undefined },
      });
      item = await commissionPilotAnyway(bareMission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [bareEvidence[0]!.id],
        concept: "An original speculative-creature explainer.",
        creativeDirection: "Calm, factual narration.",
      });
    } else {
      const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
      item = await approveForProduction(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
      });
    }

    // Simulate a version that got all the way through planning/safety (a
    // real, valid, already-paid-for plan) and only failed at the
    // asset-generation layer — exactly the live ElevenLabs 401 bug this
    // feature exists for.
    let version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    const plan = makeContentPlan({ claims: [] });
    version = await updateContentVersion(version.id, { plan });
    version = await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
    version = await updateContentVersion(version.id, { creative_strategy: makeCreativeStrategy() });
    const toGenerating = await transitionContentItemState(item.id, ["planning"], "generating", {
      generation_attempt_count: 1,
    });
    expect(toGenerating.ok).toBe(true);

    // A real, known cost already spent before the technical failure (e.g.
    // the planning + safety-review Claude calls) — this must survive the
    // retry untouched.
    await recordCost({
      missionId: item.mission_id,
      agentId: null,
      contentItemId: item.id,
      model: "claude-sonnet-5",
      usdCost: 0.015,
      provider: "anthropic",
      unit: "tokens",
      quantity: 800,
    });

    version = await updateContentVersion(version.id, {
      status: "failed",
      failure_reason: "Could not list ElevenLabs voices (401): missing_permissions voices_read.",
      completed_at: new Date().toISOString(),
    });
    const failed = await transitionContentItemState(item.id, ["generating"], "failed", {
      failure_reason: "Could not list ElevenLabs voices (401): missing_permissions voices_read.",
      failure_category: failureCategory,
    });
    expect(failed.ok).toBe(true);

    return { item: failed.item, failedVersion: version, mission };
  }

  it("succeeds for a genuinely recoverable provider failure — Retry Production is available", async () => {
    const { item } = await createFailedContentItem("provider_auth");
    expect(isRecoverableFailureCategory(item.failure_category)).toBe(true);

    const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    const retried = await retryProductionAfterTechnicalFailure(item.id, founderId);

    expect(retried.state).toBe("generating");
  });

  it("produces exactly one next attempt/version, carrying forward the failed version's plan and safety verdict", async () => {
    const { item, failedVersion } = await createFailedContentItem("provider_auth");

    const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    const retried = await retryProductionAfterTechnicalFailure(item.id, founderId);

    const versions = await listVersionsWithAssets(item.id);
    expect(versions).toHaveLength(2);

    const nextVersion = await getLatestVersion(item.id);
    expect(nextVersion).toBeDefined();
    expect(nextVersion!.id).not.toBe(failedVersion.id);
    expect(nextVersion!.parent_version_id).toBe(failedVersion.id);
    // The plan/safety verdict/creative strategy are all reused as-is — no
    // new Anthropic call was needed for any of them.
    expect(nextVersion!.plan).toEqual(failedVersion.plan);
    expect(nextVersion!.safety_verdict).toEqual({ verdict: "pass", reasons: [], concerns: [] });
    expect(nextVersion!.creative_strategy).toEqual(failedVersion.creative_strategy);
    // qc_report/qc_regeneration_count are deliberately NOT carried forward —
    // Visual QC must re-run against this new version's own fresh assets.
    expect(nextVersion!.qc_report).toBeNull();
    expect(nextVersion!.qc_regeneration_count).toBe(0);

    expect(retried.version_count).toBe(2);

    const contentBotModule = await import("@/lib/agents/contentBot");
    expect(contentBotModule.planContentVersion).not.toHaveBeenCalled();
    expect(contentBotModule.reviewContentSafety).not.toHaveBeenCalled();
    expect(contentBotModule.planCreativeStrategy).not.toHaveBeenCalled();
    expect(contentBotModule.reviewVisualQuality).not.toHaveBeenCalled();
  });

  it("is idempotent/concurrency-safe: a double-click cannot dispatch twice or create a duplicate version", async () => {
    const { item } = await createFailedContentItem("provider_unavailable");
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear(); // clear the dispatch already sent by setup's own approveForProduction

    const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    const results = await Promise.allSettled([
      retryProductionAfterTechnicalFailure(item.id, founderId),
      retryProductionAfterTechnicalFailure(item.id, founderId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.name).toBe("ContentItemConcurrencyError");

    const versions = await listVersionsWithAssets(item.id);
    expect(versions).toHaveLength(2); // the original failed version + exactly one retry, never a third

    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
  });

  it("preserves existing version history, activity, and cost accounting across the retry", async () => {
    const { item, failedVersion } = await createFailedContentItem("provider_network");
    const costsBefore = await listCostsForContentItem(item.id);
    const activityBefore = await listActivity(item.mission_id);

    const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    await retryProductionAfterTechnicalFailure(item.id, founderId);

    // The failed version itself is never rewritten or deleted.
    const versions = await listVersionsWithAssets(item.id);
    const stillThere = versions.find((v) => v.id === failedVersion.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.status).toBe("failed");
    expect(stillThere!.failure_reason).toContain("voices_read");

    // Every real cost recorded before the retry is still present afterward.
    const costsAfter = await listCostsForContentItem(item.id);
    expect(costsAfter.length).toBeGreaterThanOrEqual(costsBefore.length);
    for (const c of costsBefore) {
      expect(costsAfter.some((a) => a.id === c.id)).toBe(true);
    }

    // Every real activity entry recorded before the retry is still present,
    // plus a new, clearly-labeled retry entry distinguishing this from a
    // founder creative revision.
    const activityAfter = await listActivity(item.mission_id);
    for (const a of activityBefore) {
      expect(activityAfter.some((x) => x.id === a.id)).toBe(true);
    }
    expect(activityAfter.some((a) => a.action === "production_retry_requested")).toBe(true);
  });

  it("refuses a safety/copyright (guardrail) failure — blocked items are never eligible for technical retry", async () => {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
    const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
    await updateContentVersion(version.id, { status: "failed", failure_reason: "Named a specific existing IP." });
    const blocked = await transitionContentItemState(item.id, ["generating"], "blocked", {
      failure_reason: "Named a specific existing IP.",
      // deliberately no failure_category — a safety refusal never gets one (see contentWorkflow.ts's catch block)
    });
    expect(blocked.ok).toBe(true);
    expect(blocked.item.failure_category).toBeNull();

    const { retryProductionAfterTechnicalFailure, NotRecoverableFailureError } = await import(
      "@/lib/domain/contentWorkflow"
    );
    await expect(retryProductionAfterTechnicalFailure(item.id, founderId)).rejects.toThrow(NotRecoverableFailureError);
  });

  it("refuses a founder rejection — rejected items are never eligible for technical retry", async () => {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const { approveForProduction, requestContentRevision } = await import("@/lib/domain/contentWorkflow");
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
    const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    await updateContentVersion(version.id, { status: "complete", completed_at: new Date().toISOString() });
    await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
    const toReview = await transitionContentItemState(item.id, ["generating"], "awaiting_review");
    expect(toReview.ok).toBe(true);
    const rejected = await transitionContentItemState(item.id, ["awaiting_review"], "rejected", {});
    expect(rejected.ok).toBe(true);
    expect(rejected.item.failure_category).toBeNull();

    const { retryProductionAfterTechnicalFailure, NotRecoverableFailureError } = await import(
      "@/lib/domain/contentWorkflow"
    );
    await expect(retryProductionAfterTechnicalFailure(item.id, founderId)).rejects.toThrow(NotRecoverableFailureError);
    void requestContentRevision; // referenced in the "normal revision workflow" test below
  });

  it("refuses budget exhaustion — it is deliberately excluded from the recoverable allow-list", async () => {
    const { item } = await createFailedContentItem("budget_exhausted");

    const { retryProductionAfterTechnicalFailure, NotRecoverableFailureError } = await import(
      "@/lib/domain/contentWorkflow"
    );
    await expect(retryProductionAfterTechnicalFailure(item.id, founderId)).rejects.toThrow(NotRecoverableFailureError);
  });

  it("refuses a successfully-completed item — no failure_category means no eligibility, and the state-machine edge doesn't exist either", async () => {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
    const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    await updateContentVersion(version.id, { status: "complete", completed_at: new Date().toISOString() });
    await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
    const toReview = await transitionContentItemState(item.id, ["generating"], "awaiting_review");
    expect(toReview.ok).toBe(true);
    expect(toReview.item.failure_category).toBeNull();

    const { retryProductionAfterTechnicalFailure, NotRecoverableFailureError } = await import(
      "@/lib/domain/contentWorkflow"
    );
    await expect(retryProductionAfterTechnicalFailure(item.id, founderId)).rejects.toThrow(NotRecoverableFailureError);

    // Belt-and-suspenders: even if failure_category were somehow left over
    // from an earlier, unrelated failure while the item has since moved on,
    // the state machine itself has no "awaiting_review" -> "planning" edge —
    // the failed -> planning edge is the only one Retry Production ever uses.
    const contentItemStates = await import("@/lib/domain/contentItemStates");
    expect(contentItemStates.canTransitionContentItem("awaiting_review", "planning")).toBe(false);
    expect(contentItemStates.canTransitionContentItem("failed", "planning")).toBe(true);
  });

  it("retains founder-commissioned provenance through a retry — the brief's source is never rewritten", async () => {
    const { item } = await createFailedContentItem("provider_auth", { viaFounderCommission: true });
    const before = await getContentItem(item.id);
    expect((before!.brief as { source: string }).source).toBe("founder_commissioned");

    const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    const retried = await retryProductionAfterTechnicalFailure(item.id, founderId);

    expect((retried.brief as { source: string }).source).toBe("founder_commissioned");
    expect(retried.mission_id).toBe(item.mission_id);
    expect(retried.id).toBe(item.id); // same content item lineage, not a new item
  });

  it("leaves the normal founder creative-revision workflow unchanged — a technical retry never substitutes for it", async () => {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const { approveForProduction, requestContentRevision } = await import("@/lib/domain/contentWorkflow");
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
    const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    await updateContentVersion(version.id, { status: "complete", completed_at: new Date().toISOString() });
    await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
    const toReview = await transitionContentItemState(item.id, ["generating"], "awaiting_review");
    expect(toReview.ok).toBe(true);

    const revised = await requestContentRevision(item.id, founderId, {
      contentVersionId: version.id,
      note: "Make the hook stronger.",
    });

    expect(revised.state).toBe("revision_requested");
    const approvals = await import("@/lib/db/repositories").then((m) => m.listApprovalsForContentItem(item.id));
    expect(approvals.some((a) => a.decision === "request_revision")).toBe(true);
    expect(approvals.some((a) => a.decision === "retry_production")).toBe(false);
    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "production_retry_requested")).toBe(false);
  });
});
