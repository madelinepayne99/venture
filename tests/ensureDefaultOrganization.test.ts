import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, getDb, ensureDefaultOrganization } from "@/lib/db/client";
import { createFounder } from "@/lib/db/repositories";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * A real, serious cross-tenant access-control bug, caught live during
 * Mission 8's self-service sign-up testing (not a hypothetical): this
 * function's founder-membership backfill originally ran unconditionally
 * on every call, for every founder row in the table — so a brand-new
 * self-service customer (who genuinely has zero organization
 * memberships between account creation and completing their own
 * onboarding) got silently auto-granted OWNER access to Ellis and
 * Maddie's real "Founders' HQ" the next time `ensureDefaultOrganization`
 * ran — which is every server start in dev, and effectively every cold
 * start in a real serverless deployment. This file exists specifically
 * so that regression can never silently reappear; no other test file
 * exercised this function in a way that could have caught it, because
 * `resetDbForTests()`'s own "truncate and reseed from scratch" pattern
 * only ever calls it once, against a database with no organization yet
 * — the exact case where the bug was invisible.
 */
describe("ensureDefaultOrganization — real cross-tenant safety", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("does not grant a founder created AFTER the default organization already exists any membership in it", async () => {
    const db = await getDb();
    const orgId = await ensureDefaultOrganization(db); // first call — creates the org, seeds the real original founders

    const [before] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    expect(before).toBeDefined();

    // A genuinely new founder — exactly what a self-service customer
    // sign-up creates (ensureFounderAccount), with zero memberships.
    const newCustomer = await createFounder({ name: "New Customer", email: "new-customer@example.test" });

    // Simulate a real server restart (or, in production, a fresh
    // serverless cold start) calling this function again.
    const secondCallOrgId = await ensureDefaultOrganization(db);
    expect(secondCallOrgId).toBe(orgId); // the same real org, not a duplicate

    const newCustomerMembership = await db
      .select()
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organization_id, orgId),
          eq(schema.organizationMembers.founder_id, newCustomer.id),
        ),
      );
    expect(newCustomerMembership).toHaveLength(0); // the real assertion — no silent grant
  });

  it("still correctly seeds every founder that existed at the moment the organization was first created", async () => {
    const db = await getDb();
    const orgId = await ensureDefaultOrganization(db);

    const members = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organization_id, orgId));

    // The real seeded founders (Ellis + Maddie) — both genuinely owners
    // of the one real business that existed before organizations did.
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members.every((m) => m.role === "owner")).toBe(true);
  });

  it("is idempotent across repeated calls with no new founders — never duplicates existing memberships", async () => {
    const db = await getDb();
    const orgId = await ensureDefaultOrganization(db);
    const firstCallMembers = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organization_id, orgId));

    await ensureDefaultOrganization(db);
    await ensureDefaultOrganization(db);
    const afterRepeatedCalls = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organization_id, orgId));

    expect(afterRepeatedCalls).toHaveLength(firstCallMembers.length);
  });
});
