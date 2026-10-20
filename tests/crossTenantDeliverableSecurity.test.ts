import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder, createAgentDeliverable } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { getOwnedAgentDeliverable } from "@/lib/domain/foundersDeskWorkflow";
import { FoundersDeskNotFoundError } from "@/lib/domain/foundersDeskWorkflow";

/**
 * Mission 11 (Operation Lockdown) — direct regression coverage for the
 * CRITICAL finding in docs/security/route-authorization-audit.md:
 * GET /api/founders-desk/deliverables/[id] called requireFounderId() but
 * discarded its result, then fetched from the globally unscoped
 * getAgentDeliverable(id) with zero ownership check — any authenticated
 * founder could read any organization's deliverable content and review
 * history by id. Fixed via getOwnedAgentDeliverable, the centralized
 * check this test exercises directly (mirroring
 * crossTenantContentSecurity.test.ts's coverage of the sibling
 * getOwnedContentAsset check).
 */
describe("getOwnedAgentDeliverable — cross-tenant deliverable security (Mission 11)", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  async function makeOrg(name: string) {
    const founder = await createFounder({ name });
    const { organization } = await createOrganizationWithOwner(founder.id, `${name} Org`);
    return { founderId: founder.id, organizationId: organization.id };
  }

  it("the owning organization can read its own deliverable", async () => {
    const owner = await makeOrg("DeliverableOwner");
    const deliverable = await createAgentDeliverable({
      agentKey: "finance_agent",
      founderId: owner.founderId,
      organizationId: owner.organizationId,
      sourceType: "finance_report",
      sourceId: "test-source-id",
      title: "Real finance report",
      kind: "finance_report",
      content: { confidential: "real numbers only this org should see" },
    });

    const result = await getOwnedAgentDeliverable(deliverable.id, owner.founderId);
    expect(result.id).toBe(deliverable.id);
    expect(result.organization_id).toBe(owner.organizationId);
  });

  it("an unrelated organization cannot read another organization's deliverable — the exact Finding 1 exploit shape", async () => {
    const owner = await makeOrg("DeliverableVictim");
    const attacker = await makeOrg("DeliverableAttacker");
    const deliverable = await createAgentDeliverable({
      agentKey: "finance_agent",
      founderId: owner.founderId,
      organizationId: owner.organizationId,
      sourceType: "finance_report",
      sourceId: "test-source-id",
      title: "Victim's confidential finance report",
      kind: "finance_report",
      content: { confidential: "victim-only real numbers" },
    });

    await expect(getOwnedAgentDeliverable(deliverable.id, attacker.founderId)).rejects.toThrow(FoundersDeskNotFoundError);
  });

  it("a non-existent deliverable id and a real-but-foreign one produce the same error shape (no existence oracle)", async () => {
    const attacker = await makeOrg("DeliverableAttacker2");
    const owner = await makeOrg("DeliverableVictim2");
    const deliverable = await createAgentDeliverable({
      agentKey: "finance_agent",
      founderId: owner.founderId,
      organizationId: owner.organizationId,
      sourceType: "finance_report",
      sourceId: "test-source-id",
      title: "Victim's report",
      kind: "finance_report",
      content: {},
    });

    let errorForReal: unknown;
    let errorForFake: unknown;
    try {
      await getOwnedAgentDeliverable(deliverable.id, attacker.founderId);
    } catch (e) {
      errorForReal = e;
    }
    try {
      await getOwnedAgentDeliverable("00000000-0000-0000-0000-000000000000", attacker.founderId);
    } catch (e) {
      errorForFake = e;
    }
    expect(errorForReal).toBeInstanceOf(FoundersDeskNotFoundError);
    expect(errorForFake).toBeInstanceOf(FoundersDeskNotFoundError);
  });

  it("the real route never regresses to calling the unscoped getAgentDeliverable directly", () => {
    const routePath = path.join(process.cwd(), "app", "api", "founders-desk", "deliverables", "[id]", "route.ts");
    const content = fs.readFileSync(routePath, "utf-8");
    expect(content).toMatch(/getOwnedAgentDeliverable/);
    // The actual enforcement: getAgentDeliverable must not be imported
    // from the repository layer here (a doc comment may still mention
    // the old function by name when explaining the historical bug, which
    // a plain text search would false-positive on — the import line is
    // what actually matters).
    const importLines = content.split("\n").filter((line) => line.includes("from \"@/lib/db/repositories\""));
    for (const line of importLines) {
      expect(line).not.toMatch(/\bgetAgentDeliverable\b/);
    }
    // The exact original bug: requireFounderId() called but its result
    // discarded — a bare `await requireFounderId();` with no assignment.
    expect(content).not.toMatch(/^\s*await requireFounderId\(\);\s*$/m);
  });
});
