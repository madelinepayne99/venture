import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { setupMissionReadyForProduction, upgradeTestOrgToPaidPlan } from "./testUtils";
import { produceAgainFromMission, commissionPilotAnyway, getOwnedContentAsset } from "@/lib/domain/contentWorkflow";
import { ContentAssetNotFoundError } from "@/lib/domain/contentWorkflow";
import { createAndSubmitMission, MissionValidationError } from "@/lib/domain/missionWorkflow";
import { createProject } from "@/lib/db/repositories";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

/**
 * Mission 11 — "Operation Lockdown." A real, live-reproduced cross-tenant
 * authorization-ordering bug found during the systematic route audit:
 * `produceAgainFromMission`'s idempotency-replay branch returned a full
 * `ContentItem` row BEFORE the function had verified the caller's own
 * organization actually owns `missionId` — and `idempotencyKey` is raw,
 * unvalidated client input (see `app/api/missions/[id]/produce-again/route.ts`).
 * A caller from an unrelated organization who supplied a real (missionId,
 * contentItemId) pair belonging to someone else's org — for example one
 * leaked via logs, a referrer header, or simple enumeration — received
 * that organization's content item with no membership check at all.
 * Fixed by moving the organization-ownership check before the replay
 * lookup. This file proves the fix with the exact exploit shape, and
 * covers the adjacent real ownership checks in the same module
 * (`commissionPilotAnyway`, `getOwnedContentAsset`) for the same class of
 * bug.
 */
describe("cross-tenant content-production security (Mission 11)", () => {
  beforeEach(async () => {
    await resetDbForTests();
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
  });

  async function makeOrg(name: string) {
    const founder = await createFounder({ name });
    const { organization } = await createOrganizationWithOwner(founder.id, `${name} Org`);
    await upgradeTestOrgToPaidPlan(organization.id);
    return { founderId: founder.id, organizationId: organization.id };
  }

  const COMMISSION_INPUT = {
    targetPlatform: "youtube_shorts" as const,
    audience: "general" as const,
    contentType: "educational" as const,
    concept: "The original production.",
    creativeDirection: "The original creative direction.",
  };

  it("produceAgainFromMission: an attacker who supplies a real idempotencyKey belonging to ANOTHER organization's content item for a mission they name never receives it", async () => {
    const owner = await makeOrg("Victim");
    const attacker = await makeOrg("Attacker");

    const { mission, evidence } = await setupMissionReadyForProduction(owner.founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    const realItem = await commissionPilotAnyway(mission.id, owner.founderId, {
      ...COMMISSION_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
    });

    // The exact exploit shape: the attacker names the VICTIM's real
    // mission id AND supplies the VICTIM's real content item id as their
    // own client-chosen idempotencyKey — both values a determined
    // attacker could plausibly have observed (e.g. leaked via logs,
    // referrer headers, or a prior unrelated response) without ever being
    // a member of the victim's organization.
    await expect(
      produceAgainFromMission(mission.id, attacker.founderId, {
        ...COMMISSION_INPUT,
        // Non-empty so input validation passes and the real ownership
        // check is what's actually being exercised here — these ids
        // don't need to be real for this specific assertion, since the
        // ownership check (now correctly ordered before any evidence
        // lookup) must refuse before evidence is ever considered.
        selectedEvidenceIds: [randomUUID()],
        idempotencyKey: realItem.id,
      }),
    ).rejects.toThrow(`Mission ${mission.id} not found.`);

    // The real content item itself is completely unaffected by the
    // refused attempt — this is a pure read-side authorization bug, not
    // a mutation, but worth confirming nothing was disturbed.
    const { getContentItem } = await import("@/lib/db/repositories");
    const stillReal = await getContentItem(realItem.id);
    expect(stillReal?.id).toBe(realItem.id);
  });

  it("produceAgainFromMission: refuses a mission the caller's organization doesn't own, even with a fresh idempotencyKey (the ordinary, already-covered case)", async () => {
    const owner = await makeOrg("Victim2");
    const attacker = await makeOrg("Attacker2");
    const { mission, evidence } = await setupMissionReadyForProduction(owner.founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    await commissionPilotAnyway(mission.id, owner.founderId, {
      ...COMMISSION_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
    });

    await expect(
      produceAgainFromMission(mission.id, attacker.founderId, {
        ...COMMISSION_INPUT,
        selectedEvidenceIds: [randomUUID()],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(`Mission ${mission.id} not found.`);
  });

  it("commissionPilotAnyway: refuses a mission belonging to another organization", async () => {
    const owner = await makeOrg("Victim3");
    const attacker = await makeOrg("Attacker3");
    const { mission, evidence } = await setupMissionReadyForProduction(owner.founderId, {
      reportOverrides: { production_recommendation: undefined },
    });

    await expect(
      commissionPilotAnyway(mission.id, attacker.founderId, {
        ...COMMISSION_INPUT,
        selectedEvidenceIds: [evidence[0]!.id],
      }),
    ).rejects.toThrow(`Mission ${mission.id} not found.`);
  });

  it("getOwnedContentAsset: refuses an asset belonging to another organization's content item", async () => {
    const owner = await makeOrg("Victim4");
    const attacker = await makeOrg("Attacker4");
    const { mission, evidence } = await setupMissionReadyForProduction(owner.founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    const item = await commissionPilotAnyway(mission.id, owner.founderId, {
      ...COMMISSION_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
    });

    const { openNextVersion, recordContentAsset } = await import("@/lib/db/repositories");
    const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    const asset = await recordContentAsset({
      contentVersionId: version.id,
      kind: "thumbnail",
      storageProvider: "local_disk",
      storageKey: `fake/${randomUUID()}.png`,
      contentType: "image/png",
      byteSize: 1234,
      checksumSha256: "a".repeat(64),
      width: 512,
      height: 512,
    });

    // The owner can fetch their own asset.
    await expect(getOwnedContentAsset(asset.id, owner.founderId)).resolves.toMatchObject({ id: asset.id });

    // An unrelated organization cannot — and gets the same "not found"
    // shape a real missing asset would, never a distinguishing error.
    await expect(getOwnedContentAsset(asset.id, attacker.founderId)).rejects.toThrow(ContentAssetNotFoundError);
  });

  it("createAndSubmitMission: refuses a client-supplied projectId belonging to another organization", async () => {
    const victim = await makeOrg("ProjectVictim");
    const attacker = await makeOrg("ProjectAttacker");

    const victimProject = await createProject({
      name: "Victim's real workspace",
      organizationId: victim.organizationId,
      workspaceType: "commerce",
    });

    // The attacker names a real project id that genuinely exists — just
    // not one their own organization owns.
    await expect(
      createAndSubmitMission({
        founderId: attacker.founderId,
        projectId: victimProject.id,
        title: "Attacker mission cross-linked to someone else's project",
        brief: "This should never be allowed to attach to another organization's real project.",
      }),
    ).rejects.toThrow(MissionValidationError);

    // Confirm nothing was created at all — a refused mission creation
    // leaves no partial/mis-attributed row behind.
    const { listMissionsForOrganization } = await import("@/lib/db/repositories");
    const attackerMissions = await listMissionsForOrganization(attacker.organizationId);
    expect(attackerMissions).toHaveLength(0);
  });

  it("createAndSubmitMission: still allows a real project the caller's own organization owns", async () => {
    const owner = await makeOrg("ProjectOwner");
    const ownProject = await createProject({
      name: "My own real workspace",
      organizationId: owner.organizationId,
      workspaceType: "commerce",
    });

    const mission = await createAndSubmitMission({
      founderId: owner.founderId,
      projectId: ownProject.id,
      title: "A legitimate mission for my own project",
      brief: "This should succeed exactly as it always has for a real, owned project.",
    });
    expect(mission.project_id).toBe(ownProject.id);
  });
});
