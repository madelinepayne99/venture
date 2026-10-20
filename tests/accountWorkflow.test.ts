import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  createFounder,
  getFounder,
  getOrganizationById,
  addOrganizationMember,
  getOrganizationMembership,
} from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { createAndSubmitMission } from "@/lib/domain/missionWorkflow";
import { recordCost } from "@/lib/db/repositories";
import {
  deleteFounderAccount,
  exportFounderData,
  AccountDeletionConfirmationError,
  AccountDeletionBlockedError,
  AccountAlreadyDeletedError,
  AccountNotFoundError,
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "@/lib/domain/accountWorkflow";
import { getActiveOrganizationForFounder, OrganizationNotFoundError } from "@/lib/domain/organizationWorkflow";

/**
 * Mission 10 — real account deletion and data export, tested against
 * isolated fictional founders/organizations only (never Ellis/Maddie's
 * real rows, which this suite never touches at all).
 */

describe("deleteFounderAccount", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("refuses without the exact confirmation phrase", async () => {
    const founder = await createFounder({ name: "Solo Founder" });
    await createOrganizationWithOwner(founder.id, "Solo Co");

    await expect(deleteFounderAccount(founder.id, "delete my account")).rejects.toThrow(AccountDeletionConfirmationError);
    await expect(deleteFounderAccount(founder.id, "")).rejects.toThrow(AccountDeletionConfirmationError);

    // Nothing was touched by the refused attempts.
    const stillThere = await getFounder(founder.id);
    expect(stillThere?.deleted_at).toBeNull();
  });

  it("a sole owner with no other real members: anonymizes the founder and closes the organization", async () => {
    const founder = await createFounder({ name: "Solo Founder", email: "solo-founder@example.test" });
    const { organization } = await createOrganizationWithOwner(founder.id, "Solo Co");

    const result = await deleteFounderAccount(founder.id, ACCOUNT_DELETION_CONFIRMATION_PHRASE);
    expect(result.organizationsClosed).toEqual([organization.id]);

    const anonymized = await getFounder(founder.id);
    expect(anonymized?.name).toBe("Deleted Founder");
    expect(anonymized?.email).toBeNull();
    expect(anonymized?.deleted_at).not.toBeNull();

    const closedOrg = await getOrganizationById(organization.id);
    expect(closedOrg?.closed_at).not.toBeNull();
    // Insert-only: the organization row itself still exists, just closed.
    expect(closedOrg).toBeDefined();

    // A closed organization is never selected as "active" again.
    await expect(getActiveOrganizationForFounder(founder.id)).rejects.toThrow(OrganizationNotFoundError);
  });

  it("refuses to delete an account that owns an organization with other real members still present", async () => {
    const owner = await createFounder({ name: "Owner Founder" });
    const { organization } = await createOrganizationWithOwner(owner.id, "Shared Co");
    const otherMember = await createFounder({ name: "Other Member" });
    await addOrganizationMember({ organizationId: organization.id, founderId: otherMember.id, role: "member" });

    await expect(deleteFounderAccount(owner.id, ACCOUNT_DELETION_CONFIRMATION_PHRASE)).rejects.toThrow(
      AccountDeletionBlockedError,
    );

    // Nothing was touched by the refused attempt — organization stays
    // open, owner's founder row stays real.
    const org = await getOrganizationById(organization.id);
    expect(org?.closed_at).toBeNull();
    const owner2 = await getFounder(owner.id);
    expect(owner2?.deleted_at).toBeNull();
  });

  it("a non-owner member can delete their own account without touching the organization", async () => {
    const owner = await createFounder({ name: "Owner Founder" });
    const { organization } = await createOrganizationWithOwner(owner.id, "Shared Co");
    const member = await createFounder({ name: "Member Founder", email: "member-founder@example.test" });
    await addOrganizationMember({ organizationId: organization.id, founderId: member.id, role: "member" });

    const result = await deleteFounderAccount(member.id, ACCOUNT_DELETION_CONFIRMATION_PHRASE);
    expect(result.organizationsClosed).toEqual([]);

    const org = await getOrganizationById(organization.id);
    expect(org?.closed_at).toBeNull();

    const deletedMember = await getFounder(member.id);
    expect(deletedMember?.name).toBe("Deleted Founder");
    expect(deletedMember?.email).toBeNull();

    // The owner's own account and organization are completely unaffected.
    const stillOwner = await getFounder(owner.id);
    expect(stillOwner?.deleted_at).toBeNull();
    const ownerMembership = await getOrganizationMembership(organization.id, owner.id);
    expect(ownerMembership).toBeDefined();
  });

  it("refuses to delete an already-deleted account", async () => {
    const founder = await createFounder({ name: "Solo Founder" });
    await createOrganizationWithOwner(founder.id, "Solo Co");
    await deleteFounderAccount(founder.id, ACCOUNT_DELETION_CONFIRMATION_PHRASE);

    await expect(deleteFounderAccount(founder.id, ACCOUNT_DELETION_CONFIRMATION_PHRASE)).rejects.toThrow(
      AccountAlreadyDeletedError,
    );
  });

  it("throws for a founder id that doesn't exist", async () => {
    await expect(deleteFounderAccount("not-a-real-founder-id", ACCOUNT_DELETION_CONFIRMATION_PHRASE)).rejects.toThrow(
      AccountNotFoundError,
    );
  });

  it("owning two organizations: one blocked by other members refuses the whole deletion, closing neither", async () => {
    const owner = await createFounder({ name: "Dual Owner" });
    const { organization: soloOrg } = await createOrganizationWithOwner(owner.id, "Dual Owner's Solo Co");
    const { organization: sharedOrg } = await createOrganizationWithOwner(owner.id, "Dual Owner's Shared Co");
    const otherMember = await createFounder({ name: "Other Member" });
    await addOrganizationMember({ organizationId: sharedOrg.id, founderId: otherMember.id, role: "member" });

    await expect(deleteFounderAccount(owner.id, ACCOUNT_DELETION_CONFIRMATION_PHRASE)).rejects.toThrow(
      AccountDeletionBlockedError,
    );

    // Neither organization was closed — checked-before-mutated, not a
    // partial deletion that closes the safe one and refuses the other.
    const solo = await getOrganizationById(soloOrg.id);
    const shared = await getOrganizationById(sharedOrg.id);
    expect(solo?.closed_at).toBeNull();
    expect(shared?.closed_at).toBeNull();
  });
});

describe("exportFounderData", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("includes only the requesting founder's own real organizations, missions, and ledger data", async () => {
    const founderA = await createFounder({ name: "Founder A", email: "founder-a@example.test" });
    const { organization: orgA } = await createOrganizationWithOwner(founderA.id, "Org A");
    const founderB = await createFounder({ name: "Founder B" });
    const { organization: orgB } = await createOrganizationWithOwner(founderB.id, "Org B");

    await createAndSubmitMission({
      founderId: founderA.id,
      projectId: null,
      title: "Org A's real mission",
      brief: "A real fictional test brief for Org A.",
    });
    await recordCost({ missionId: null, organizationId: orgA.id, agentId: null, model: "claude-sonnet-5", usdCost: 1.23 });
    await recordCost({ missionId: null, organizationId: orgB.id, agentId: null, model: "claude-sonnet-5", usdCost: 99.99 });

    const exportA = await exportFounderData(founderA.id);

    expect(exportA.founder.id).toBe(founderA.id);
    expect(exportA.organizations).toHaveLength(1);
    expect(exportA.organizations[0]!.organization.id).toBe(orgA.id);
    expect(exportA.organizations[0]!.missions.map((m) => m.title)).toContain("Org A's real mission");
    expect(exportA.organizations[0]!.ledgerTotalUsd).toBeCloseTo(-1.23, 6);

    // Org B's data never appears anywhere in Founder A's export.
    const serialized = JSON.stringify(exportA);
    expect(serialized).not.toContain(orgB.id);
    expect(serialized).not.toContain("99.99");
  });

  it("throws for a founder id that doesn't exist", async () => {
    await expect(exportFounderData("not-a-real-founder-id")).rejects.toThrow(AccountNotFoundError);
  });
});
