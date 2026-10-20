import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder, openNextVersion, updateContentVersion, recordContentAsset, transitionContentItemState } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { setupMissionReadyForProduction, makeContentPlan, upgradeTestOrgToPaidPlan } from "./testUtils";
import {
  approveForProduction,
  cancelContentItem,
  approveContentVersion,
  getOwnedContentAsset,
  ContentAssetNotFoundError,
} from "@/lib/domain/contentWorkflow";
import { getMissionDetail } from "@/lib/api/missionDetail";
import { getContentItemDetail } from "@/lib/api/contentItemDetail";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

/**
 * Content Bot's own cross-organization isolation (Master Development
 * Mission 6 — "Audit and secure Content Bot's complete workflow,
 * including content-production routes, media assets, approvals and
 * publishing permissions"). Every one of these had the exact same real
 * gap Phase E already closed for Founders' Desk: a founderId parameter
 * that was never actually checked against the mission/content item being
 * acted on. Proven here with two genuinely separate real organizations,
 * the same Bakery HQ / Landscaping HQ pattern established in
 * tests/organizationIsolation.test.ts.
 */

interface TestOrg {
  founderId: string;
  organizationId: string;
}

async function makeTestOrganization(ownerName: string, orgName: string): Promise<TestOrg> {
  const founder = await createFounder({ name: ownerName });
  const { organization } = await createOrganizationWithOwner(founder.id, orgName);
  // Content Bot is a real paid agent with a real, separate video
  // allowance (Mission 8, Sections 14-15) — a fresh organization starts
  // on the free plan (0 video productions/month) by design. This file is
  // about cross-organization isolation of real production work, not
  // plan gating (covered separately), so upgrade here.
  await upgradeTestOrgToPaidPlan(organization.id);
  return { founderId: founder.id, organizationId: organization.id };
}

async function createRealAwaitingReviewItem(founderId: string) {
  const { mission, evidence } = await setupMissionReadyForProduction(founderId);
  const item = await approveForProduction(mission.id, founderId, {
    targetPlatform: "youtube_shorts",
    audience: "general",
    contentType: "educational",
    selectedEvidenceIds: [evidence[0]!.id],
  });

  const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
  await updateContentVersion(version.id, { plan: makeContentPlan({ claims: [] }) });
  await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
  const asset = await recordContentAsset({
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

  const inngestModule = await import("@/lib/inngest/client");
  vi.mocked(inngestModule.inngest.send).mockClear();

  return { item: settled.item, version, asset, mission };
}

describe("Content Bot — cross-organization isolation", () => {
  let bakery: TestOrg;
  let landscaping: TestOrg;

  beforeEach(async () => {
    await resetDbForTests();
    bakery = await makeTestOrganization("Bea the Baker", "Bakery HQ");
    landscaping = await makeTestOrganization("Lee the Landscaper", "Landscaping HQ");
  });

  it("approveForProduction refuses a mission that belongs to a different organization", async () => {
    const { mission, evidence } = await setupMissionReadyForProduction(bakery.founderId);

    await expect(
      approveForProduction(mission.id, landscaping.founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
      }),
    ).rejects.toThrow(`Mission ${mission.id} not found.`);
  });

  it("getMissionDetail returns null for another organization's real mission id", async () => {
    const { mission } = await setupMissionReadyForProduction(bakery.founderId);
    const asBakery = await getMissionDetail(mission.id, bakery.organizationId);
    const asLandscaping = await getMissionDetail(mission.id, landscaping.organizationId);
    expect(asBakery).not.toBeNull();
    expect(asLandscaping).toBeNull();
  });

  it("getContentItemDetail returns null for another organization's real content item id", async () => {
    const { item } = await createRealAwaitingReviewItem(bakery.founderId);
    const asBakery = await getContentItemDetail(item.id, bakery.organizationId);
    const asLandscaping = await getContentItemDetail(item.id, landscaping.organizationId);
    expect(asBakery).not.toBeNull();
    expect(asBakery!.item.id).toBe(item.id);
    expect(asLandscaping).toBeNull();
  });

  it("a founder from a different organization cannot cancel another organization's real content item", async () => {
    const { item } = await createRealAwaitingReviewItem(bakery.founderId);

    await expect(cancelContentItem(item.id, landscaping.founderId)).rejects.toThrow(
      `Content item ${item.id} not found.`,
    );

    // Bakery's own founder genuinely can — the refused cross-organization
    // attempt left the real item completely untouched.
    const cancelled = await cancelContentItem(item.id, bakery.founderId);
    expect(cancelled.state).toBe("cancelled");
  });

  it("a founder from a different organization cannot approve another organization's real content version", async () => {
    const { item, version } = await createRealAwaitingReviewItem(bakery.founderId);

    await expect(
      approveContentVersion(item.id, landscaping.founderId, { contentVersionId: version.id }),
    ).rejects.toThrow(`Content item ${item.id} not found.`);

    const approved = await approveContentVersion(item.id, bakery.founderId, { contentVersionId: version.id });
    expect(approved.state).toBe("ready_to_publish");
  });

  it("getOwnedContentAsset refuses real generated media bytes for a different organization — the stream route's own real check", async () => {
    const { asset } = await createRealAwaitingReviewItem(bakery.founderId);

    const ownedByBakery = await getOwnedContentAsset(asset.id, bakery.founderId);
    expect(ownedByBakery.id).toBe(asset.id);

    await expect(getOwnedContentAsset(asset.id, landscaping.founderId)).rejects.toBeInstanceOf(
      ContentAssetNotFoundError,
    );
  });
});
