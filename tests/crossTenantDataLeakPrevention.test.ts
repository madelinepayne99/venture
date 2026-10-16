import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetDbForTests } from "@/lib/db/client";
import {
  createFounder,
  listFoundersForOrganization,
  listLedgerEntriesForOrganization,
  ledgerTotalUsdForOrganization,
  recordCost,
} from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";

/**
 * Mission 10 — regression coverage for a real, live-confirmed cross-tenant
 * leak found while designing account deletion: `GET /api/founders`,
 * `GET /api/ledger`, and `app/page.tsx`'s own server-rendered data all used
 * to call globally unscoped repository functions (`listFounders`,
 * `listLedgerEntries`, `ledgerTotalUsd`) with no organization filtering at
 * all. A completely unrelated fictional customer, verified live via a real
 * session token against the real dev database, received Ellis's and
 * Maddie's real names/email and (for the ledger) would have received every
 * organization's real financial ledger. Both are fixed by scoping to the
 * calling founder's real organization membership — this file proves the
 * fix functionally (two real, independent organizations, each only ever
 * seeing its own real data) and statically (the three real call sites can
 * never again regress to the unscoped functions), mirroring the existing
 * `fabricationPrevention.test.ts` source-scanning pattern.
 */

interface TestOrg {
  founderId: string;
  organizationId: string;
}

async function makeTestOrganization(ownerName: string, orgName: string): Promise<TestOrg> {
  const founder = await createFounder({ name: ownerName });
  const { organization } = await createOrganizationWithOwner(founder.id, orgName);
  return { founderId: founder.id, organizationId: organization.id };
}

describe("cross-tenant data leak prevention — founders and ledger", () => {
  let orgA: TestOrg;
  let orgB: TestOrg;

  beforeEach(async () => {
    await resetDbForTests();
    orgA = await makeTestOrganization("Founder A", "Org A (isolated test)");
    orgB = await makeTestOrganization("Founder B", "Org B (isolated test)");
  });

  it("listFoundersForOrganization never returns another organization's founder", async () => {
    const orgAFounders = await listFoundersForOrganization(orgA.organizationId);
    const orgBFounders = await listFoundersForOrganization(orgB.organizationId);

    expect(orgAFounders.map((f) => f.id)).toEqual([orgA.founderId]);
    expect(orgBFounders.map((f) => f.id)).toEqual([orgB.founderId]);
    expect(orgAFounders.map((f) => f.id)).not.toContain(orgB.founderId);
    expect(orgBFounders.map((f) => f.id)).not.toContain(orgA.founderId);
  });

  it("listLedgerEntriesForOrganization and ledgerTotalUsdForOrganization never leak another organization's real spend", async () => {
    await recordCost({
      missionId: null,
      organizationId: orgA.organizationId,
      agentId: null,
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 50,
      usdCost: 0.5,
    });
    await recordCost({
      missionId: null,
      organizationId: orgB.organizationId,
      agentId: null,
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 50,
      usdCost: 9.0,
    });

    const orgAEntries = await listLedgerEntriesForOrganization(orgA.organizationId);
    const orgBEntries = await listLedgerEntriesForOrganization(orgB.organizationId);

    expect(orgAEntries).toHaveLength(1);
    expect(orgBEntries).toHaveLength(1);
    expect(orgAEntries[0]!.amount_usd).toBeCloseTo(-0.5, 6);
    expect(orgBEntries[0]!.amount_usd).toBeCloseTo(-9.0, 6);

    const orgATotal = await ledgerTotalUsdForOrganization(orgA.organizationId);
    const orgBTotal = await ledgerTotalUsdForOrganization(orgB.organizationId);
    expect(orgATotal).toBeCloseTo(-0.5, 6);
    expect(orgBTotal).toBeCloseTo(-9.0, 6);
    // The specific regression: Org A's total must never include Org B's
    // much larger spend (and vice versa) — a global sum would fail this.
    expect(orgATotal).not.toBeCloseTo(orgATotal + orgBTotal, 6);
  });

  it("every real founders/ledger-facing route and server page uses the organization-scoped repository functions, never the globally unscoped ones", () => {
    const sourcesToCheck = [
      "app/api/founders/route.ts",
      "app/api/ledger/route.ts",
      "app/page.tsx",
    ];

    for (const relativePath of sourcesToCheck) {
      const fullPath = path.join(process.cwd(), relativePath);
      const content = fs.readFileSync(fullPath, "utf-8");

      // Must use the real, organization-scoped functions.
      expect(content).toMatch(/listFoundersForOrganization|listLedgerEntriesForOrganization|ledgerTotalUsdForOrganization/);

      // Must never call the globally unscoped functions as bare calls
      // (listFounders(), listLedgerEntries(), ledgerTotalUsd()) — a plain
      // word-boundary + "(" check so a future unscoped re-introduction in
      // one of these three real call sites fails this test immediately.
      expect(content).not.toMatch(/\blistFounders\s*\(/);
      expect(content).not.toMatch(/\blistLedgerEntries\s*\(/);
      expect(content).not.toMatch(/\bledgerTotalUsd\s*\(/);
    }
  });
});
