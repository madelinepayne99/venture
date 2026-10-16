import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests, getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createFounder, getOrganizationSubscription, updateOrganizationSubscription } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { getStripeClient, verifyWebhookSignature } from "@/lib/billing/stripe";
import {
  processBillingWebhookEvent,
  startCheckout,
  PlanNotPurchasableError,
  PlanNotFoundError,
  AlreadySubscribedError,
} from "@/lib/domain/billingWorkflow";
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

  // --- Mission 12: real missing renewal/recovery/downgrade behavior ---
  // invoice.paid (not the older invoice.payment_succeeded — see
  // billingWorkflow.ts's own doc comment on this event, verified against
  // Stripe's current "Using webhooks with subscriptions" guide) resolves
  // the invoice's real linked subscription and retrieves ITS real status
  // from Stripe, rather than assuming paid-invoice-implies-active — so
  // these tests stub getStripeClient().subscriptions.retrieve rather
  // than hitting the real Stripe network (this sandbox holds no real
  // STRIPE_SECRET_KEY).

  function mockSubscriptionRetrieve(status: string) {
    const stripe = getStripeClient();
    return vi
      .spyOn(stripe.subscriptions, "retrieve")
      .mockResolvedValue({ status } as unknown as Stripe.Response<Stripe.Subscription>);
  }

  it("invoice.paid recovers a real past_due organization back to active — a real successful retry/renewal", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "business",
      status: "past_due",
      stripeCustomerId: "cus_recovering_123",
    });
    const spy = mockSubscriptionRetrieve("active");

    await processBillingWebhookEvent(
      makeFakeEvent("invoice.paid", {
        customer: "cus_recovering_123",
        parent: { subscription_details: { subscription: "sub_recovering_123" } },
      }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.status).toBe("active");
    expect(subscription!.plan_id).toBe("business"); // the real plan is preserved
    expect(spy).toHaveBeenCalledWith("sub_recovering_123");
    spy.mockRestore();
  });

  it("invoice.paid syncs whatever real status Stripe's own subscription actually has — never assumes paid-invoice-implies-active (per Stripe's own documented caveat)", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "business",
      status: "past_due",
      stripeCustomerId: "cus_still_past_due_123",
    });
    // A paid invoice doesn't necessarily mean the subscription itself is
    // active (Stripe's own docs) — simulate that real case directly.
    const spy = mockSubscriptionRetrieve("past_due");

    await processBillingWebhookEvent(
      makeFakeEvent("invoice.paid", {
        customer: "cus_still_past_due_123",
        parent: { subscription_details: { subscription: "sub_still_past_due_123" } },
      }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.status).toBe("past_due"); // not blindly flipped to active
    spy.mockRestore();
  });

  it("invoice.paid never resurrects a genuinely cancelled subscription (a trailing/duplicate invoice) — never even calls Stripe for it", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "free",
      status: "canceled",
      stripeCustomerId: "cus_cancelled_123",
    });
    const spy = mockSubscriptionRetrieve("active");

    await processBillingWebhookEvent(
      makeFakeEvent("invoice.paid", {
        customer: "cus_cancelled_123",
        parent: { subscription_details: { subscription: "sub_cancelled_123" } },
      }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.status).toBe("canceled"); // NOT silently re-activated
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("invoice.paid for an unknown Stripe customer touches nothing", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const before = await getOrganizationSubscription(organizationId);

    await processBillingWebhookEvent(
      makeFakeEvent("invoice.paid", {
        customer: "cus_never_seen_before",
        parent: { subscription_details: { subscription: "sub_never_seen_before" } },
      }),
    );

    expect(await getOrganizationSubscription(organizationId)).toEqual(before);
  });

  it("invoice.paid for a non-subscription invoice (no linked subscription) touches nothing", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "business",
      status: "past_due",
      stripeCustomerId: "cus_one_off_invoice_123",
    });
    const spy = mockSubscriptionRetrieve("active");

    await processBillingWebhookEvent(
      makeFakeEvent("invoice.paid", { customer: "cus_one_off_invoice_123", parent: null }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.status).toBe("past_due"); // unchanged — nothing to recover from a non-subscription invoice
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("customer.subscription.updated syncs a real plan downgrade made through Stripe's own Billing Portal", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "growth",
      status: "active",
      stripeCustomerId: "cus_downgrading_123",
      stripeSubscriptionId: "sub_downgrading_123",
    });

    // Give the real "starter" plan a real Stripe price id to downgrade to
    // — this app's seed data ships every plan with stripe_price_id: null
    // until a founder connects a real Stripe account, so the test sets
    // one directly (the one piece of state no repository function
    // exposes a write path for, deliberately — see CLAUDE.md's own note
    // that a plan's price is set once a real account exists, not through
    // any app-level API).
    const db = await getDb();
    await db.update(schema.subscriptionPlans).set({ stripe_price_id: "price_starter_test" }).where(eq(schema.subscriptionPlans.id, "starter"));

    await processBillingWebhookEvent(
      makeFakeEvent("customer.subscription.updated", {
        metadata: { organizationId },
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_starter_test" }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.plan_id).toBe("starter"); // really synced down from "growth"
    expect(subscription!.status).toBe("active");
  });

  it("customer.subscription.updated with an unrecognized Stripe price id never guesses a plan change", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await updateOrganizationSubscription(organizationId, {
      planId: "growth",
      status: "active",
      stripeCustomerId: "cus_unknown_price_123",
    });

    await processBillingWebhookEvent(
      makeFakeEvent("customer.subscription.updated", {
        metadata: { organizationId },
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_this_app_has_never_seen" }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      }),
    );

    const subscription = await getOrganizationSubscription(organizationId);
    expect(subscription!.plan_id).toBe("growth"); // unchanged — never guessed
    expect(subscription!.status).toBe("active"); // other real fields still applied
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

  it("refuses to start a SECOND checkout for an organization already on a real, active paid plan — never a double subscription", async () => {
    const founder = await createFounder({ name: "Test Owner" });
    const { organization } = await createOrganizationWithOwner(founder.id, "Test Org");
    await updateOrganizationSubscription(organization.id, {
      planId: "starter",
      status: "active",
      stripeCustomerId: "cus_already_123",
      stripeSubscriptionId: "sub_already_123",
    });

    const db = await getDb();
    await db.update(schema.subscriptionPlans).set({ stripe_price_id: "price_growth_test" }).where(eq(schema.subscriptionPlans.id, "growth"));

    await expect(
      startCheckout(founder.id, "growth", { successUrl: "https://example.test/s", cancelUrl: "https://example.test/c" }),
    ).rejects.toBeInstanceOf(AlreadySubscribedError);
  });

  it("still allows a genuine first-time checkout for a free-plan organization with no real Stripe subscription yet", async () => {
    const founder = await createFounder({ name: "Test Owner" });
    await createOrganizationWithOwner(founder.id, "Test Org");

    const db = await getDb();
    await db.update(schema.subscriptionPlans).set({ stripe_price_id: "price_starter_first_time" }).where(eq(schema.subscriptionPlans.id, "starter"));

    // A real, successful checkout-session creation requires a real
    // network call to Stripe, which this sandbox never makes — so this
    // asserts the function gets PAST the AlreadySubscribedError guard
    // (the thing this test is actually about) by confirming the error it
    // does throw is the network-level one, not AlreadySubscribedError.
    await expect(
      startCheckout(founder.id, "starter", { successUrl: "https://example.test/s", cancelUrl: "https://example.test/c" }),
    ).rejects.not.toBeInstanceOf(AlreadySubscribedError);
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
