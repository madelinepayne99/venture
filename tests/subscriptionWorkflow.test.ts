import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder, updateOrganizationSubscription, listSubscriptionPlans } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import {
  assertPlanAllowsAgent,
  assertPlanAllowsNewVideoProduction,
  resolveOrganizationSubscription,
  listPublishedPlans,
  listAllPlansForFounder,
  PlanDoesNotIncludePaidAgentsError,
  SubscriptionNotEntitledError,
  VideoAllowanceExceededError,
} from "@/lib/domain/subscriptionWorkflow";
import { upgradeTestOrgToPaidPlan } from "./testUtils";

/**
 * Real, server-side subscription entitlement enforcement (Mission 8,
 * Sections 14-15) — proven directly against a real Postgres database,
 * independent of any UI. Every assertion here is the exact mechanism a
 * direct, bypassing API call would hit — never just a hidden button.
 */

async function makeTestOrganization(name: string): Promise<string> {
  const founder = await createFounder({ name: `${name} owner` });
  const { organization } = await createOrganizationWithOwner(founder.id, name);
  return organization.id;
}

describe("assertPlanAllowsAgent — real employee-access entitlement", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("refuses a real paid agent for a fresh free-plan organization", async () => {
    const organizationId = await makeTestOrganization("Free Org");
    await expect(assertPlanAllowsAgent(organizationId, "scout")).rejects.toBeInstanceOf(
      PlanDoesNotIncludePaidAgentsError,
    );
    await expect(assertPlanAllowsAgent(organizationId, "content_bot")).rejects.toBeInstanceOf(
      PlanDoesNotIncludePaidAgentsError,
    );
    await expect(assertPlanAllowsAgent(organizationId, "business_analyst")).rejects.toBeInstanceOf(
      PlanDoesNotIncludePaidAgentsError,
    );
  });

  it("never refuses the real manual/free agents, even on the free plan", async () => {
    const organizationId = await makeTestOrganization("Free Org");
    await expect(assertPlanAllowsAgent(organizationId, "executive_assistant")).resolves.toBeUndefined();
    await expect(assertPlanAllowsAgent(organizationId, "finance_agent")).resolves.toBeUndefined();
    await expect(assertPlanAllowsAgent(organizationId, "operations_agent")).resolves.toBeUndefined();
    await expect(assertPlanAllowsAgent(organizationId, "chief_of_staff")).resolves.toBeUndefined();
  });

  it("allows a real paid agent for an organization on a real paid plan", async () => {
    const organizationId = await makeTestOrganization("Paid Org");
    await upgradeTestOrgToPaidPlan(organizationId);
    await expect(assertPlanAllowsAgent(organizationId, "scout")).resolves.toBeUndefined();
  });

  it("refuses a real paid agent for a CANCELLED subscription, even though the plan itself includes paid agents", async () => {
    const organizationId = await makeTestOrganization("Cancelled Org");
    await updateOrganizationSubscription(organizationId, { planId: "business", status: "canceled" });
    await expect(assertPlanAllowsAgent(organizationId, "scout")).rejects.toBeInstanceOf(SubscriptionNotEntitledError);
  });

  it("refuses for a PAST_DUE subscription", async () => {
    const organizationId = await makeTestOrganization("Past Due Org");
    await updateOrganizationSubscription(organizationId, { planId: "growth", status: "past_due" });
    await expect(assertPlanAllowsAgent(organizationId, "content_bot")).rejects.toBeInstanceOf(
      SubscriptionNotEntitledError,
    );
  });

  it("allows for a TRIALING subscription on a plan that includes paid agents", async () => {
    const organizationId = await makeTestOrganization("Trial Org");
    await updateOrganizationSubscription(organizationId, { planId: "starter", status: "trialing" });
    await expect(assertPlanAllowsAgent(organizationId, "business_analyst")).resolves.toBeUndefined();
  });
});

describe("assertPlanAllowsNewVideoProduction — real, separate monthly allowance", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("refuses for the free plan (0 allowance)", async () => {
    const organizationId = await makeTestOrganization("Free Org");
    await expect(assertPlanAllowsNewVideoProduction(organizationId)).rejects.toBeInstanceOf(
      VideoAllowanceExceededError,
    );
  });

  it("refuses for the starter plan (0 video allowance — research/text only)", async () => {
    const organizationId = await makeTestOrganization("Starter Org");
    await updateOrganizationSubscription(organizationId, { planId: "starter", status: "active" });
    await expect(assertPlanAllowsNewVideoProduction(organizationId)).rejects.toBeInstanceOf(
      VideoAllowanceExceededError,
    );
  });

  it("allows within the real monthly allowance, refuses once genuinely exhausted", async () => {
    const organizationId = await makeTestOrganization("Business Org");
    await upgradeTestOrgToPaidPlan(organizationId); // "business" — real 2/month allowance
    const plans = await listSubscriptionPlans();
    const business = plans.find((p) => p.id === "business")!;
    expect(business.monthly_video_allowance).toBe(2);

    // Real content items counted via countContentItemsStartedThisMonth —
    // simulate real usage by inserting real content_items rows through
    // the real repository the gate itself reads (not a mock).
    const { createMission, createContentItem } = await import("@/lib/db/repositories");
    const mission = await createMission({
      founderId: (await createFounder({ name: "x" })).id,
      organizationId,
      projectId: null,
      title: "m1",
      brief: "b1",
    });
    await expect(assertPlanAllowsNewVideoProduction(organizationId)).resolves.toBeUndefined(); // 0 used, allowance 2

    await createContentItem({
      missionId: mission.id,
      agentId: (await import("@/lib/db/repositories").then((m) => m.getAgentByKey("content_bot")))!.id,
      sourceDeliverableId: null,
      brief: {} as never,
      audienceContext: {} as never,
    });
    await expect(assertPlanAllowsNewVideoProduction(organizationId)).resolves.toBeUndefined(); // 1 used, still under 2

    await createContentItem({
      missionId: mission.id,
      agentId: (await import("@/lib/db/repositories").then((m) => m.getAgentByKey("content_bot")))!.id,
      sourceDeliverableId: null,
      brief: {} as never,
      audienceContext: {} as never,
    });
    // 2 used — the real allowance is now genuinely exhausted.
    await expect(assertPlanAllowsNewVideoProduction(organizationId)).rejects.toBeInstanceOf(
      VideoAllowanceExceededError,
    );
  });
});

describe("resolveOrganizationSubscription / plan listing", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("resolves a real organization's plan and entitlement status together", async () => {
    const organizationId = await makeTestOrganization("Some Org");
    const resolved = await resolveOrganizationSubscription(organizationId);
    expect(resolved.plan.id).toBe("free");
    expect(resolved.isEntitled).toBe(true); // "active" status, just $0/no-paid-agents by plan design
  });

  it("listPublishedPlans returns nothing until a founder explicitly publishes a plan — provisional prices stay unpublished", async () => {
    const published = await listPublishedPlans();
    expect(published).toHaveLength(0);
  });

  it("listAllPlansForFounder returns every real customer plan except the internal founder plan", async () => {
    const all = await listAllPlansForFounder();
    const ids = all.map((p) => p.id).sort();
    expect(ids).toEqual(["business", "free", "growth", "starter"]);
  });
});

describe("Two independent organizations — billing/entitlement isolation", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("upgrading one organization's plan never affects another's real entitlement", async () => {
    const bakeryId = await makeTestOrganization("Bakery HQ");
    const landscapingId = await makeTestOrganization("Landscaping HQ");

    await upgradeTestOrgToPaidPlan(bakeryId, "growth");

    await expect(assertPlanAllowsAgent(bakeryId, "scout")).resolves.toBeUndefined();
    await expect(assertPlanAllowsAgent(landscapingId, "scout")).rejects.toBeInstanceOf(
      PlanDoesNotIncludePaidAgentsError,
    );

    const bakeryResolved = await resolveOrganizationSubscription(bakeryId);
    const landscapingResolved = await resolveOrganizationSubscription(landscapingId);
    expect(bakeryResolved.plan.id).toBe("growth");
    expect(landscapingResolved.plan.id).toBe("free");
  });

  it("cancelling one organization's subscription never affects another's", async () => {
    const bakeryId = await makeTestOrganization("Bakery HQ");
    const landscapingId = await makeTestOrganization("Landscaping HQ");
    await upgradeTestOrgToPaidPlan(bakeryId);
    await upgradeTestOrgToPaidPlan(landscapingId);

    await updateOrganizationSubscription(bakeryId, { status: "canceled" });

    await expect(assertPlanAllowsAgent(bakeryId, "scout")).rejects.toBeInstanceOf(SubscriptionNotEntitledError);
    await expect(assertPlanAllowsAgent(landscapingId, "scout")).resolves.toBeUndefined(); // completely unaffected
  });
});
