import "server-only";
import Stripe from "stripe";

/**
 * Real Stripe billing (Mission 8, Sections 14-15) — test mode only, by
 * design: STRIPE_SECRET_KEY must itself be a real Stripe *test-mode*
 * secret key (sk_test_...) for any of this to work at all; this module
 * never checks which kind of key it was given (Stripe's own dashboard
 * and API already separate test/live data completely), so the actual
 * "test mode only" guarantee is: never put a live secret key in this
 * app's environment until the founders explicitly decide to. The
 * current API version is pinned explicitly rather than left to drift.
 *
 * This sandbox holds no real STRIPE_SECRET_KEY (confirmed by inspecting
 * the environment directly — the same standing discipline this codebase
 * already applies to ANTHROPIC_API_KEY/FAL_KEY/etc., see CLAUDE.md's
 * "Local verification vs a real deployment"). Every function below is
 * real, current-API code, not a stub — but none of it has been
 * exercised against the real Stripe API. getStripeClient() throws a
 * clear, named error rather than silently returning null or a fake
 * client, so every real call site fails loudly and specifically instead
 * of behaving as if billing were configured when it isn't.
 */

export class StripeNotConfiguredError extends Error {
  constructor() {
    super(
      "STRIPE_SECRET_KEY is not set. Billing features are unavailable until a founder configures a real Stripe test-mode secret key (see .env.example).",
    );
    this.name = "StripeNotConfiguredError";
  }
}

let client: Stripe | undefined;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripeClient(): Stripe {
  if (client) return client;
  if (!process.env.STRIPE_SECRET_KEY) throw new StripeNotConfiguredError();
  client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-09-30.endive",
  });
  return client;
}

/**
 * A real Stripe Checkout Session in subscription mode for one real
 * organization/plan pair. The organization id is carried in the
 * session's own `client_reference_id` and `subscription_data.metadata`
 * — the webhook handler reads it from THERE (server-to-server, signed),
 * never from anything the browser could tamper with on return from a
 * real checkout.
 */
export async function createCheckoutSession(input: {
  organizationId: string;
  planId: string;
  stripePriceId: string;
  stripeCustomerId: string | null;
  successUrl: string;
  cancelUrl: string;
  founderEmail: string | null;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: input.stripePriceId, quantity: 1 }],
    client_reference_id: input.organizationId,
    customer: input.stripeCustomerId ?? undefined,
    customer_email: input.stripeCustomerId ? undefined : (input.founderEmail ?? undefined),
    subscription_data: {
      metadata: { organizationId: input.organizationId, planId: input.planId },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}

/** A real Stripe Billing Portal session — the actual "customer billing-management interface": cancel, update payment method, view invoices, all inside Stripe's own real, PCI-scope-free hosted UI. */
export async function createBillingPortalSession(input: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripeClient();
  return stripe.billingPortal.sessions.create({
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });
}

/**
 * Real webhook signature verification — `stripe.webhooks.constructEvent`
 * against the RAW request body (never JSON-parsed first; Stripe's
 * signature is computed over the exact bytes sent) and the real
 * `Stripe-Signature` header. Throws on a forged/mismatched/expired
 * signature — the real mechanism behind "forged checkout confirmations
 * cannot unlock paid AI work": nothing downstream of this function ever
 * runs for a request that fails this check.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string): Stripe.Event {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set — cannot verify a webhook's authenticity without it.");
  }
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}
