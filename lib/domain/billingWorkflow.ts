import "server-only";
import type Stripe from "stripe";
import {
  recordBillingWebhookEventIfNew,
  getOrganizationSubscriptionByStripeCustomerId,
  updateOrganizationSubscription,
  getSubscriptionPlan,
  getOrganizationSubscription,
  getFounder,
} from "@/lib/db/repositories";
import { getActiveOrganizationForFounder, requireOrganizationRole } from "@/lib/domain/organizationWorkflow";
import {
  createCheckoutSession,
  createBillingPortalSession,
  getStripeClient,
  isStripeConfigured,
  StripeNotConfiguredError,
} from "@/lib/billing/stripe";
import type { SubscriptionStatus } from "@/lib/db/types";

/**
 * Real Stripe billing workflow (Mission 8, Sections 14-15) — the domain
 * layer between the real Stripe routes and the real
 * organization_subscriptions/subscription_plans tables. Every function
 * here is called from a real route handler (app/api/billing/*) and is
 * directly unit-testable without Stripe's own runtime, the same split
 * this codebase already uses for Inngest-triggered logic
 * (runScoutPipeline / reapStaleResearchingMissions).
 */

export class PlanNotFoundError extends Error {
  constructor(planId: string) {
    super(`Plan "${planId}" doesn't exist.`);
    this.name = "PlanNotFoundError";
  }
}

export class PlanNotPurchasableError extends Error {
  constructor(planId: string) {
    super(`Plan "${planId}" has no real Stripe price configured yet — it can't be purchased through checkout.`);
    this.name = "PlanNotPurchasableError";
  }
}

/**
 * Starts a real Stripe Checkout session for an organization to subscribe
 * to a real paid plan. Founder-gated one level up (the route calls
 * requireFounderId()); this additionally requires the real organization
 * owner/admin role — a plain member can't change the organization's
 * billing, the same real permission boundary every other consequential
 * organization action already enforces.
 */
export async function startCheckout(
  founderId: string,
  planId: string,
  urls: { successUrl: string; cancelUrl: string },
): Promise<{ checkoutUrl: string }> {
  const organization = await getActiveOrganizationForFounder(founderId);
  await requireOrganizationRole(founderId, organization.id, ["owner", "admin"]);

  const plan = await getSubscriptionPlan(planId);
  if (!plan) throw new PlanNotFoundError(planId);
  if (!plan.stripe_price_id) throw new PlanNotPurchasableError(planId);

  const subscription = await getOrganizationSubscription(organization.id);
  const founder = await getFounder(founderId);
  const founderEmail = founder?.email ?? null;

  const session = await createCheckoutSession({
    organizationId: organization.id,
    planId,
    stripePriceId: plan.stripe_price_id,
    stripeCustomerId: subscription?.stripe_customer_id ?? null,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    founderEmail,
  });

  if (!session.url) {
    throw new Error("Stripe created a checkout session but returned no real URL — cannot redirect the founder.");
  }
  return { checkoutUrl: session.url };
}

/** Real Stripe Billing Portal — self-service cancellation, payment-method update, invoice history, all inside Stripe's own hosted UI. Requires a real stripe_customer_id, which only exists after a real checkout has completed at least once. */
export async function startBillingPortalSession(founderId: string, returnUrl: string): Promise<{ portalUrl: string }> {
  const organization = await getActiveOrganizationForFounder(founderId);
  await requireOrganizationRole(founderId, organization.id, ["owner", "admin"]);

  const subscription = await getOrganizationSubscription(organization.id);
  if (!subscription?.stripe_customer_id) {
    throw new Error("This organization has no real Stripe customer yet — subscribe to a paid plan first.");
  }

  const session = await createBillingPortalSession({ stripeCustomerId: subscription.stripe_customer_id, returnUrl });
  return { portalUrl: session.url };
}

const KNOWN_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "canceled", "incomplete"];
function normalizeStripeStatus(stripeStatus: string): SubscriptionStatus {
  if ((KNOWN_STATUSES as readonly string[]).includes(stripeStatus)) return stripeStatus as SubscriptionStatus;
  // Stripe has a few other real statuses this app doesn't distinguish
  // (unpaid, incomplete_expired, paused) — all of them mean "not
  // entitled," so they map to the closest real status that also isn't
  // entitled, never silently treated as active.
  return "incomplete";
}

/**
 * Processes one real, already-signature-verified Stripe event.
 * Idempotent: recordBillingWebhookEventIfNew is checked FIRST, so a
 * genuine redelivery of the same real event (Stripe's own "at least
 * once" delivery guarantee) runs these side effects at most once.
 */
export async function processBillingWebhookEvent(event: Stripe.Event): Promise<{ processed: boolean }> {
  const isNew = await recordBillingWebhookEventIfNew(event.id, event.type);
  if (!isNew) return { processed: false }; // genuine redelivery — already handled

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;
      const organizationId = session.client_reference_id;
      if (!organizationId) break; // not one of our real sessions — nothing to do
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const stripeSubscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      // The real plan id was set as metadata on the SUBSCRIPTION at
      // creation time (createCheckoutSession's subscription_data.metadata)
      // — Stripe doesn't echo that back on the checkout Session object
      // itself, only on the real subscription resource, so it's fetched
      // here rather than assumed.
      let planId: string | undefined;
      if (stripeSubscriptionId) {
        const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
        planId = typeof subscription.metadata?.planId === "string" ? subscription.metadata.planId : undefined;
      }
      await updateOrganizationSubscription(organizationId, {
        ...(planId ? { planId } : {}),
        status: "active",
        stripeCustomerId,
        stripeSubscriptionId,
      });
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const organizationId = sub.metadata?.organizationId;
      if (!organizationId) break;
      await updateOrganizationSubscription(organizationId, {
        status: normalizeStripeStatus(sub.status),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: sub.items.data[0]?.current_period_end
          ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
          : null,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const organizationId = sub.metadata?.organizationId;
      if (!organizationId) break;
      // A genuinely ended subscription — real cancellation, not just a
      // flag. Revert to the real free plan rather than leaving the
      // organization on a paid plan_id with a dead/cancelled status,
      // which would be a confusing, inconsistent real state.
      await updateOrganizationSubscription(organizationId, {
        planId: "free",
        status: "canceled",
        cancelAtPeriodEnd: false,
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!stripeCustomerId) break;
      const subscription = await getOrganizationSubscriptionByStripeCustomerId(stripeCustomerId);
      if (!subscription) break;
      await updateOrganizationSubscription(subscription.organization_id, { status: "past_due" });
      break;
    }
    default:
      break; // a real Stripe event type this app doesn't act on — not an error
  }

  return { processed: true };
}

export { isStripeConfigured, StripeNotConfiguredError };
