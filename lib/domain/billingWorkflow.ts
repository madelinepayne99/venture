import "server-only";
import type Stripe from "stripe";
import {
  recordBillingWebhookEventIfNew,
  getOrganizationSubscriptionByStripeCustomerId,
  updateOrganizationSubscription,
  getSubscriptionPlan,
  getSubscriptionPlanByStripePriceId,
  getOrganizationSubscription,
  getFounder,
} from "@/lib/db/repositories";
import { getActiveOrganizationForFounder, requireOrganizationRole } from "@/lib/domain/organizationWorkflow";
import { ENTITLED_STATUSES } from "@/lib/domain/subscriptionWorkflow";
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
 * Mission 12 — a real double-subscription risk found while auditing
 * missing billing behaviors: a Stripe Checkout Session in "subscription"
 * mode always creates a NEW real subscription — it never replaces an
 * existing one, which is what the Billing Portal's own plan-change flow
 * is for. Before this guard, an organization already on a real, active
 * paid plan could start a second checkout for a different plan (the
 * pricing page's "Subscribe" button has no such restriction) and end up
 * genuinely billed for two simultaneous real subscriptions. A plan
 * change for an already-subscribed organization must go through
 * startBillingPortalSession instead.
 */
export class AlreadySubscribedError extends Error {
  constructor(
    readonly organizationId: string,
    readonly currentPlanId: string,
  ) {
    super(
      `This organization already has a real, active subscription ("${currentPlanId}"). Use "Manage billing" to change or cancel your plan — starting a new checkout here would create a second, separate real subscription.`,
    );
    this.name = "AlreadySubscribedError";
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
  // See AlreadySubscribedError's own doc comment — a real, active
  // Stripe-backed subscription already exists, so a NEW checkout session
  // would create a second, simultaneous real subscription rather than
  // changing the existing one. stripe_subscription_id is the real
  // signal: a free-plan organization (which has never checked out) has
  // none, so first-time subscription is never blocked by this.
  if (subscription?.stripe_subscription_id && ENTITLED_STATUSES.has(subscription.status)) {
    throw new AlreadySubscribedError(organization.id, subscription.plan_id);
  }

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

      // Mission 12 — real plan-change sync. A customer can upgrade or
      // downgrade entirely inside Stripe's own Billing Portal
      // (startBillingPortalSession), outside any route this app
      // controls — Stripe's own real price id on the updated
      // subscription is the only signal that happened. Before this fix,
      // the local organization_subscriptions.plan_id was never updated
      // on this event at all: a customer who downgraded through the
      // portal kept their OLD (higher-tier) plan's real AI
      // budget/video allowance indefinitely, despite now paying less —
      // a real entitlement bug, not just a display one. A price id this
      // app doesn't recognize is never guessed into a plan change; the
      // status/period fields below still apply either way.
      const stripePriceId = sub.items.data[0]?.price?.id;
      const matchedPlan = stripePriceId ? await getSubscriptionPlanByStripePriceId(stripePriceId) : undefined;

      await updateOrganizationSubscription(organizationId, {
        ...(matchedPlan ? { planId: matchedPlan.id } : {}),
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
    case "invoice.paid": {
      // Mission 12 — the real missing recovery path, using Stripe's own
      // CURRENT-documented event for it. Verified against Stripe's live
      // "Using webhooks with subscriptions" guide while auditing this
      // code (priority 2): Stripe's own subscription-tracking guidance
      // names `invoice.paid` specifically — not the older
      // `invoice.payment_succeeded`, which still exists but isn't what
      // current docs point integrators toward. Before this fix, nothing
      // in this codebase ever reacted to a successful payment at all: an
      // organization that failed a charge (status "past_due", not
      // entitled — see subscriptionWorkflow.ts's ENTITLED_STATUSES) and
      // then genuinely paid — Stripe's own automatic retry succeeding,
      // or the founder updating their card in the Billing Portal —
      // stayed locked out of paid AI work forever despite having paid.
      //
      // Stripe's own docs also warn: "A paid invoice doesn't necessarily
      // transition the subscription to active" — so this deliberately
      // does NOT assume paid-invoice-implies-active-subscription. It
      // resolves the invoice's real linked subscription (current API
      // shape: `invoice.parent.subscription_details.subscription`, not
      // the older flat `invoice.subscription` field, confirmed against
      // the installed SDK's own current type definitions) and retrieves
      // that subscription's own real, current status from Stripe —
      // mirroring exactly how checkout.session.completed already
      // resolves its subscription metadata rather than assuming.
      const invoice = event.data.object as Stripe.Invoice;
      const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!stripeCustomerId) break;
      const localSubscription = await getOrganizationSubscriptionByStripeCustomerId(stripeCustomerId);
      if (!localSubscription) break;
      // Never resurrects a deliberately cancelled subscription — a
      // trailing/duplicate invoice for a subscription the customer
      // already cancelled must not silently re-activate it.
      if (localSubscription.status === "canceled") break;

      const subscriptionRef = invoice.parent?.subscription_details?.subscription;
      const stripeSubscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
      if (!stripeSubscriptionId) break; // a non-subscription invoice — nothing to do here

      const realSubscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
      await updateOrganizationSubscription(localSubscription.organization_id, {
        status: normalizeStripeStatus(realSubscription.status),
      });
      break;
    }
    default:
      break; // a real Stripe event type this app doesn't act on — not an error
  }

  return { processed: true };
}

export { isStripeConfigured, StripeNotConfiguredError };
