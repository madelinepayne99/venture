import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { startBillingPortalSession } from "@/lib/domain/billingWorkflow";

// Real Stripe Billing Portal — the actual customer billing-management
// interface (cancel, update payment method, invoice history), hosted
// entirely by Stripe. Founder-gated, owner/admin-gated inside
// startBillingPortalSession.
export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const origin = request.nextUrl.origin;
    const { portalUrl } = await startBillingPortalSession(founderId, `${origin}/`);
    return NextResponse.json({ portalUrl });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
