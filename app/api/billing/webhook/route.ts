import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/billing/stripe";
import { processBillingWebhookEvent } from "@/lib/domain/billingWorkflow";

// Real Stripe webhook endpoint — deliberately excluded from the founder-
// session middleware gate (see lib/auth/routeGate.ts), the same way
// /api/auth and /api/inngest already are: Stripe calls this server-to-
// server and carries no founder session at all. The real security
// boundary here is NOT "no session required" — it's the signature
// verification below, which refuses anything that isn't a genuine,
// unmodified event from the real Stripe account configured by
// STRIPE_WEBHOOK_SECRET. A forged request (any body, any claimed event
// type, without a valid signature) never reaches processBillingWebhookEvent
// at all.
//
// The raw body (request.text(), never request.json()) is read BEFORE
// any parsing — Stripe's signature is computed over the exact bytes
// sent, and parsing first would make verification fail even for a
// genuine event.
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe-Signature header." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (error) {
    // A failed signature verification is never logged with the raw body
    // (could contain real customer data) and never treated as partially
    // trusted — refused outright, the real mechanism behind "forged
    // checkout confirmations cannot unlock paid AI work."
    console.error("Stripe webhook signature verification failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    const result = await processBillingWebhookEvent(event);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error processing Stripe webhook event ${event.id} (${event.type}):`, error);
    // A real 500 here tells Stripe to retry (its own real redelivery
    // behavior) — safe, since processBillingWebhookEvent's own
    // idempotency check (recordBillingWebhookEventIfNew) is the FIRST
    // thing it does, before any entitlement-changing side effect.
    return NextResponse.json({ error: "Failed to process webhook event." }, { status: 500 });
  }
}
