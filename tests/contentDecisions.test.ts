import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  getMission,
  getContentItem,
  listVersionsWithAssets,
  listApprovalsForContentItem,
  transitionContentItemState,
  openNextVersion,
  updateContentVersion,
  recordContentAsset,
} from "@/lib/db/repositories";
import { MAX_VERSIONS_PER_ITEM } from "@/lib/domain/contentProduction";
import { makeContentPlan, setupMissionReadyForProduction } from "./testUtils";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

async function createAwaitingReviewItem(founderId: string) {
  const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
  const { mission, evidence } = await setupMissionReadyForProduction(founderId);
  const item = await approveForProduction(mission.id, founderId, {
    targetPlatform: "youtube_shorts",
    audience: "general",
    contentType: "educational",
    selectedEvidenceIds: [evidence[0]!.id],
  });

  // Fast-forward straight to a real, finished v1 without re-running the
  // whole media pipeline — this file is about the review decisions
  // themselves, already covered end to end by contentProductionPipeline.test.ts.
  const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
  await updateContentVersion(version.id, { plan: makeContentPlan({ claims: [] }) });
  await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
  await recordContentAsset({
    contentVersionId: version.id,
    kind: "video",
    storageProvider: "local_disk",
    storageKey: `content/${item.id}/${version.id}/video.mp4`,
    contentType: "video/mp4",
    byteSize: 1000,
    durationSeconds: 45,
    width: 1080,
    height: 1920,
  });
  await updateContentVersion(version.id, { status: "complete", completed_at: new Date().toISOString() });
  await transitionContentItemState(item.id, ["planning"], "generating");
  const settled = await transitionContentItemState(item.id, ["generating"], "awaiting_review", {
    approved_version_id: null,
  });

  // approveForProduction above already sent its own real
  // content/production_requested event — clear it so every test's own
  // assertions about inngest.send only see what the DECISION under test
  // actually dispatched.
  const inngestModule = await import("@/lib/inngest/client");
  vi.mocked(inngestModule.inngest.send).mockClear();

  return { item: settled.item, version, mission };
}

describe("founder review decisions on a finished piece", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  it("approves the version — no Inngest event, the piece is simply ready to publish", async () => {
    const { approveContentVersion } = await import("@/lib/domain/contentWorkflow");
    const { item, version } = await createAwaitingReviewItem(founderId);

    const approved = await approveContentVersion(item.id, founderId, { contentVersionId: version.id });

    expect(approved.state).toBe("ready_to_publish");
    expect(approved.approved_version_id).toBe(version.id);
    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).not.toHaveBeenCalled();
  });

  it("refuses to approve a version that is no longer the item's latest", async () => {
    const { approveContentVersion, ContentDecisionValidationError } = await import("@/lib/domain/contentWorkflow");
    const { item } = await createAwaitingReviewItem(founderId);

    await expect(
      approveContentVersion(item.id, founderId, { contentVersionId: "not-the-real-latest-version" }),
    ).rejects.toBeInstanceOf(ContentDecisionValidationError);
  });

  it("rejects the piece and settles the mission into production_complete", async () => {
    const { rejectContentItem } = await import("@/lib/domain/contentWorkflow");
    const { item, version, mission } = await createAwaitingReviewItem(founderId);

    const rejected = await rejectContentItem(item.id, founderId, {
      contentVersionId: version.id,
      note: "Not the right angle for this audience.",
    });

    expect(rejected.state).toBe("rejected");
    const settledMission = await getMission(mission.id);
    expect(settledMission!.state).toBe("production_complete");

    const approvals = await listApprovalsForContentItem(item.id);
    expect(approvals.some((a) => a.decision === "reject_content")).toBe(true);
  });

  it("requires a real, non-empty note to send a piece back for another pass", async () => {
    const { requestContentRevision, ContentDecisionValidationError } = await import("@/lib/domain/contentWorkflow");
    const { item, version } = await createAwaitingReviewItem(founderId);

    await expect(
      requestContentRevision(item.id, founderId, { contentVersionId: version.id, note: "   " }),
    ).rejects.toBeInstanceOf(ContentDecisionValidationError);
  });

  it("sends the piece back with notes, dispatches a real revision event, and preserves v1 exactly as it was", async () => {
    const { requestContentRevision } = await import("@/lib/domain/contentWorkflow");
    const { item, version } = await createAwaitingReviewItem(founderId);

    const revised = await requestContentRevision(item.id, founderId, {
      contentVersionId: version.id,
      note: "Make the hook punchier.",
    });

    expect(revised.state).toBe("revision_requested");

    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(1);
    expect(inngestModule.inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "content/revision_requested" }),
    );

    // v1's own row and assets are completely untouched.
    const versions = await listVersionsWithAssets(item.id);
    const v1 = versions.find((v) => v.id === version.id)!;
    expect(v1.status).toBe("complete");
    expect(v1.assets).toHaveLength(1);
    expect(v1.assets[0]!.kind).toBe("video");
  });

  it("refuses another revision once the real version cap is already reached", async () => {
    const { requestContentRevision } = await import("@/lib/domain/contentWorkflow");
    const { ContentVersionCapExceededError } = await import("@/lib/domain/contentProduction");
    const { item, version } = await createAwaitingReviewItem(founderId);

    // A direct column write (not a real state transition — the item stays
    // "awaiting_review") to set up the cap without a five-revision round trip.
    const atCap = await transitionContentItemState(item.id, ["awaiting_review"], "awaiting_review", {
      version_count: MAX_VERSIONS_PER_ITEM,
    });
    expect(atCap.item.version_count).toBe(MAX_VERSIONS_PER_ITEM);

    await expect(
      requestContentRevision(item.id, founderId, { contentVersionId: version.id, note: "Once more." }),
    ).rejects.toBeInstanceOf(ContentVersionCapExceededError);
  });

  it("cancels production directly, without touching the mission", async () => {
    const { cancelContentItem } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });

    const cancelled = await cancelContentItem(item.id, founderId, "Changed our mind.");
    expect(cancelled.state).toBe("cancelled");

    const settledMission = await getMission(mission.id);
    // Cancelling the CONTENT ITEM directly is not the same as cancelling
    // the mission — the mission stays exactly where it was.
    expect(settledMission!.state).toBe("in_production");
  });

  it("cancelling the MISSION while production is in flight cascades to cancel its content item too", async () => {
    const { cancelMission } = await import("@/lib/domain/missionWorkflow");
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });

    const cancelledMission = await cancelMission(mission.id, founderId, "Changed direction.");
    expect(cancelledMission.state).toBe("cancelled");

    const settledItem = await getContentItem(item.id);
    expect(settledItem!.state).toBe("cancelled");
  });

  it("refuses to cancel a mission while its content item is genuinely publishing", async () => {
    const { cancelMission, MissionCancellationBlockedError } = await import("@/lib/domain/missionWorkflow");
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    const item = await approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
    await transitionContentItemState(item.id, ["planning"], "generating");
    await transitionContentItemState(item.id, ["generating"], "awaiting_review");
    await transitionContentItemState(item.id, ["awaiting_review"], "ready_to_publish");
    await transitionContentItemState(item.id, ["ready_to_publish"], "publishing");

    await expect(cancelMission(mission.id, founderId)).rejects.toBeInstanceOf(MissionCancellationBlockedError);
    const stillPublishing = await getContentItem(item.id);
    expect(stillPublishing!.state).toBe("publishing");
  });

  it("refuses to cancel a content item that is already terminal", async () => {
    const { cancelContentItem, rejectContentItem } = await import("@/lib/domain/contentWorkflow");
    const { item, version } = await createAwaitingReviewItem(founderId);
    await rejectContentItem(item.id, founderId, { contentVersionId: version.id });

    await expect(cancelContentItem(item.id, founderId)).rejects.toThrow();
    const stillRejected = await getContentItem(item.id);
    expect(stillRejected!.state).toBe("rejected");
  });
});
