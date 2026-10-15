import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listOrganizationMembershipsForFounder } from "@/lib/db/repositories";
import { ensureFounderAccount } from "@/lib/auth/allowList";
import { createOrganizationWithOwner, OrganizationValidationError } from "@/lib/domain/organizationWorkflow";
import { listEmployeeDirectory, recruitEmployee } from "@/lib/domain/employeeWorkflow";

/**
 * Mission 8, Sections 11-12 — the real new-customer journey, exercised
 * end to end at the domain-function level (the same mechanism
 * auth.ts's signIn callback and app/api/organizations/route.ts actually
 * call; a real GitHub OAuth round-trip can't run in this environment —
 * see CLAUDE.md's own standing note on this). Two independent fictional
 * customers prove the real sign-up → organization → recruitment path
 * produces genuinely isolated results, not just that the underlying
 * organization primitives are isolated (already proven exhaustively in
 * tests/organizationIsolation.test.ts).
 */

async function simulateNewCustomerSignUp(email: string, name: string, hqName: string, ventureStage: "new_venture" | "existing_business") {
  // Step 1: the real account-creation mechanism (auth.ts's signIn callback, gated by ALLOW_NEW_CUSTOMER_SIGNUP).
  const identity = await ensureFounderAccount(email, name);
  // Step 2: the real, now-UI-reachable organization creation (POST /api/organizations).
  const { organization } = await createOrganizationWithOwner(identity.founderId, hqName, ventureStage);
  return { founderId: identity.founderId, organization };
}

describe("the real new-customer journey (Mission 8)", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("a brand-new customer can sign up, create their HQ, and it's genuinely private to them", async () => {
    const { founderId, organization } = await simulateNewCustomerSignUp(
      "priya@example.test",
      "Priya",
      "Riverside Bakery",
      "existing_business",
    );

    expect(organization.name).toBe("Riverside Bakery");
    expect(organization.venture_stage).toBe("existing_business");
    expect(organization.owner_founder_id).toBe(founderId);

    const memberships = await listOrganizationMembershipsForFounder(founderId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe("owner");
  });

  it("rejects an invalid venture_stage rather than silently storing garbage", async () => {
    const identity = await ensureFounderAccount("bad-stage@example.test", "Bad Stage");
    await expect(
      // @ts-expect-error deliberately invalid input, proving the real server-side validation
      createOrganizationWithOwner(identity.founderId, "Some Business", "not_a_real_stage"),
    ).rejects.toBeInstanceOf(OrganizationValidationError);
  });

  it("two independent fictional customers get genuinely separate, isolated organizations", async () => {
    const priya = await simulateNewCustomerSignUp("priya2@example.test", "Priya", "Riverside Bakery", "existing_business");
    const tom = await simulateNewCustomerSignUp("tom@example.test", "Tom", "Tom's Landscaping", "new_venture");

    expect(priya.organization.id).not.toBe(tom.organization.id);

    // Each founder sees exactly their own organization, never the other's.
    const priyaMemberships = await listOrganizationMembershipsForFounder(priya.founderId);
    const tomMemberships = await listOrganizationMembershipsForFounder(tom.founderId);
    expect(priyaMemberships.map((m) => m.organization_id)).toEqual([priya.organization.id]);
    expect(tomMemberships.map((m) => m.organization_id)).toEqual([tom.organization.id]);

    // Recruiting an employee in one organization never appears in the other's.
    await recruitEmployee(priya.organization.id, "scout");

    const priyaDirectory = await listEmployeeDirectory(priya.organization.id);
    const tomDirectory = await listEmployeeDirectory(tom.organization.id);
    expect(priyaDirectory.find((e) => e.definition.key === "scout")?.recruited).toBe(true);
    expect(tomDirectory.find((e) => e.definition.key === "scout")?.recruited).toBe(false);
  });

  it("signing up twice with the same email never creates a second founder or a second organization", async () => {
    const first = await simulateNewCustomerSignUp("repeat@example.test", "Repeat Customer", "First HQ", "new_venture");
    // A genuine repeat sign-in (e.g. signing out and back in) re-resolves
    // the same real founder — it must never create a duplicate account.
    const identity = await ensureFounderAccount("repeat@example.test", "Repeat Customer");
    expect(identity.founderId).toBe(first.founderId);

    const memberships = await listOrganizationMembershipsForFounder(identity.founderId);
    expect(memberships).toHaveLength(1); // still just the one real organization from the original sign-up
  });

  it("Ellis and Maddie's real Founders' HQ is never affected by new customers signing up", async () => {
    const { listFounders } = await import("@/lib/db/repositories");
    const { getActiveOrganizationForFounder } = await import("@/lib/domain/organizationWorkflow");
    const founders = await listFounders();
    const ellis = founders.find((f) => f.name === "Ellis Scott")!;
    const ellisOrgBefore = await getActiveOrganizationForFounder(ellis.id);

    await simulateNewCustomerSignUp("new-customer-x@example.test", "New Customer", "New Co", "new_venture");
    await simulateNewCustomerSignUp("new-customer-y@example.test", "Another Customer", "Another Co", "existing_business");

    const ellisOrgAfter = await getActiveOrganizationForFounder(ellis.id);
    expect(ellisOrgAfter.id).toBe(ellisOrgBefore.id);
    expect(ellisOrgAfter.name).toBe(ellisOrgBefore.name);
  });

  it("the three not-yet-built employees stay clearly Coming Soon for a new customer, never recruitable", async () => {
    const { organization } = await simulateNewCustomerSignUp("newbiz@example.test", "New Biz", "New Biz HQ", "new_venture");
    const directory = await listEmployeeDirectory(organization.id);

    const comingSoon = directory.filter((e) => e.definition.implementationStatus === "coming_soon");
    expect(comingSoon).toHaveLength(3);
    expect(comingSoon.every((e) => !e.definition.recruitable && !e.recruited)).toBe(true);
  });
});
