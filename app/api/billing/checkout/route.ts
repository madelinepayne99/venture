import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { startCheckout } from "@/lib/domain/billingWorkflow";

// Real Stripe Checkout (test mode only — see lib/billing/stripe.ts's own
// doc comment). Founder-gated, and further gated to owner/admin inside
// startCheckout itself — a plain member can't change billing. The plan
// id is validated server-side against the real subscription_plans table
// inside startCheckout; nothing here trusts a client-supplied price.
export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json().catch(() => ({}));
    const { planId } = body ?? {};
    if (!planId || typeof planId !== "string") {
      return NextResponse.json({ error: "A real planId is required." }, { status: 400 });
    }

    const origin = request.nextUrl.origin;
    const { checkoutUrl } = await startCheckout(founderId, planId, {
      successUrl: `${origin}/?billing=success`,
      cancelUrl: `${origin}/?billing=cancelled`,
    });

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
