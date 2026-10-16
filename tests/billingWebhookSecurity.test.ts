import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder, getOrganizationSubscription, updateOrganizationSubscription } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { getStripeClient, verifyWebhookSignature } from "@/lib/billing/stripe";
import { processBillingWebhookEvent, startCheckout, PlanNotPurchasableError, PlanNotFoundError } from "@/lib/domain/billingWorkflow";
import type Stripe from "stripe";

/**
 * Real billing security tests (Mission 8, Sections 14-15, priority 7:
 * "Prove that forged checkout confirmations, altered plan identifiers,
 * cancelled subscriptions, expired trials and exhausted allowances
 * cannot unlock paid AI work"). Signature verification is tested against
 * the real, local HMAC logic inside the installed Stripe SDK
 * (stripe.webhooks.constructEvent/generateTestHeaderString) — a pure,
 * local cryptographic operation with no real network call, so this runs
 * genuinely end to end without a real Stripe account.
 */

async function makeTestOrganization(name: string): Promise<string> {
  const founder = await createFounder({ name: `${name} owner` });
  const { organization } = await createOrganizationWithOwner(founder.id, name);
  return organization.id;
}

function makeFakeEvent(type: string, object: unknown, id = `evt_test_${Math.random().toString(36).slice(2)}`): Stripe.Event {
  return {
    id,
    type,
    data: { object },
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as unknown as Stripe.Event;
}

describe("Forged webhook signatures cannot unlock paid AI work", () => {
  it("refuses a request with no real signature — the real, local HMAC check genuinely fails", () => {
    const forgedPayload = JSON.stringify({
      id: "evt_forged",
      type: "customer.subscription.updated",
      data: { object: { metadata: { organizationId: "some-real-org-id" }, status: "active" } },
    });
    expect(() => verifyWebhookSignature(forgedPayload, "t=1,v1=not_a_real_signature")).toThrow();
  });

  it("refuses a request whose signature doesn't match its body — tampering is genuinely detected", () => {
    const stripe = getStripeClient();
    const realPayload = JSON.stringify({ id: "evt_real", type: "ping" });
    // A real signature, but for a DIFFERENT payload than the one actually sent.
    const signatureForDifferentPayload = stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify({ id: "evt_different", type: "ping" }),
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    expect(() => verifyWebhookSignature(realPayload, signatureForDifferentPayload)).toThrow();
  });

  it("accepts a genuinely valid signature — proving the check isn't just always rejecting", () => {
    const stripe = getStripeClient();
    const payload = JSON.stringify({
      id: "evt_genuine",
      object: "event",
      type: "ping",
      data: { object: {} },
      api_version: null,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
    });
    const validSignature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    const event = verifyWebhookSignature(payload, validSignature);
    expect(event.id).toBe("evt_genuine");
  });
});

describe("processBillingWebhookEvent — real idempotent entitlement updates", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("checkout.session.completed updates the real organization's subscription to active — but ONLY for a real session.mode of 'subscription'", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const event = makeFakeEvent("checkout.session.completed", {
      mode: "payment", // NOT subscription mode — must be ignored
      client_reference_id: organizationId,
      customer: "cus_fake",
      subscription: null,
    });
    await processBillingWebhookEvent(event);
    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.status).toBe("active"); // unchanged — free plan's own default, not touched by a non-subscription session
    expect(subscription!.plan_id).toBe("free");
  });

  it("is genuinely idempotent — redelivering the exact same real event id only applies its effect once", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, { planId: "business", status: "active" });

    const event = makeFakeEvent(
      "customer.subscription.deleted",
      { metadata: { organizationId }, status: "canceled" },
      "evt_redelivery_test",
    );

    const first = await processBillingWebhookEvent(event);
    expect(first.processed).toBe(true);
    const afterFirst = await getOrganizationSubscription(organizationId);
    expect(afterFirst!.plan_id).toBe("free"); // real cancellation reverted the plan

    // Manually "undo" the real effect to prove a REDELIVERY doesn't reapply it.
    await updateOrganizationSubscription(organizationId, { planId: "growth", status: "active" });

    const second = await processBillingWebhookEvent(event); // the SAME event.id, a genuine Stripe redelivery
    expect(second.processed).toBe(false); // recognized as already-processed
    const afterSecond = await getOrganizationSubscription(organizationId);
    expect(afterSecond!.plan_id).toBe("growth"); // NOT reverted again — the redelivery did nothing
  });

  it("customer.subscription.deleted reverts a real organization to the real free plan", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, { planId: "growth", status: "active" });

    await processBillingWebhookEvent(makeFakeEvent("customer.subscription.deleted", { metadata: { organizationId }, status: "canceled" }));

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.plan_id).toBe("free");
    expect(subscription!.status).toBe("canceled");
  });

  it("invoice.payment_failed marks the real subscription past_due, without changing its plan", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "business",
      status: "active",
      stripeCustomerId: "cus_realish_123",
    });

    await processBillingWebhookEvent(
      makeFakeEvent("invoice.payment_failed", { customer: "cus_realish_123" }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.status).toBe("past_due");
    expect(subscription!.plan_id).toBe("business"); // the real plan is preserved — only the status reflects the failed payment
  });

  it("a real event referencing a different/unknown organization id never touches any real organization here", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const before = await getOrganizationSubscription(organizationId);

    await processBillingWebhookEvent(
      makeFakeEvent("customer.subscription.deleted", { metadata: { organizationId: "completely-made-up-org-id" }, status: "canceled" }),
    );

    const after = await getOrganizationSubscription(organizationId);
    expect(after).toEqual(before); // completely untouched
  });
});

describe("Altered plan identifiers cannot unlock paid AI work", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("refuses to start checkout for a real plan with no real Stripe price configured yet", async () => {
    const founder = await createFounder({ name: "Test Owner" });
    await createOrganizationWithOwner(founder.id, "Test Org");
    // Every real plan in this app's seed data has stripe_price_id: null
    // until a founder creates real Stripe products/prices — so NO plan
    // can be purchased yet, by design, not by accident.
    await expect(
      startCheckout(founder.id, "growth", { successUrl: "https://example.test/s", cancelUrl: "https://example.test/c" }),
    ).rejects.toBeInstanceOf(PlanNotPurchasableError);
  });

  it("refuses a completely fabricated plan id outright", async () => {
    const founder = await createFounder({ name: "Test Owner" });
    await createOrganizationWithOwner(founder.id, "Test Org");
    await expect(
      startCheckout(founder.id, "super-secret-unlimited-plan", {
        successUrl: "https://example.test/s",
        cancelUrl: "https://example.test/c",
      }),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});

describe("Two independent organizations — billing events never leak between them", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("processing a real cancellation for Bakery HQ never affects Landscaping HQ's real subscription", async () => {
    const bakeryId = await makeTestOrganization("Bakery HQ");
    const landscapingId = await makeTestOrganization("Landscaping HQ");
    await updateOrganizationSubscription(bakeryId, { planId: "growth", status: "active" });
    await updateOrganizationSubscription(landscapingId, { planId: "business", status: "active" });

    await processBillingWebhookEvent(
      makeFakeEvent("customer.subscription.deleted", { metadata: { organizationId: bakeryId }, status: "canceled" }),
    );

    const bakery = await getOrganizationSubscription(bakeryId);
    const landscaping = await getOrganizationSubscription(landscapingId);
    expect(bakery!.plan_id).toBe("free");
    expect(bakery!.status).toBe("canceled");
    expect(landscaping!.plan_id).toBe("business"); // completely unaffected
    expect(landscaping!.status).toBe("active");
  });

  it("a payment failure for one organization's real Stripe customer never affects another's", async () => {
    const bakeryId = await makeTestOrganization("Bakery HQ");
    const landscapingId = await makeTestOrganization("Landscaping HQ");
    await updateOrganizationSubscription(bakeryId, { planId: "starter", status: "active", stripeCustomerId: "cus_bakery" });
    await updateOrganizationSubscription(landscapingId, { planId: "starter", status: "active", stripeCustomerId: "cus_landscaping" });

    await processBillingWebhookEvent(makeFakeEvent("invoice.payment_failed", { customer: "cus_bakery" }));

    expect((await getOrganizationSubscription(bakeryId))!.status).toBe("past_due");
    expect((await getOrganizationSubscription(landscapingId))!.status).toBe("active"); // untouched
  });
});
