import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { resolveOrganizationSubscription, listAllPlansForFounder } from "@/lib/domain/subscriptionWorkflow";
import { isStripeConfigured } from "@/lib/billing/stripe";

// The real, current billing status for the signed-in founder's
// organization — committed+limit/remaining AI spend lives at
// GET /api/budget (Mission 7 Phase 4); this is specifically the real
// subscription/plan state, plus every real plan a founder could choose,
// for a customer-facing billing/settings view.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const { subscription, plan, isEntitled } = await resolveOrganizationSubscription(organization.id);
    const plans = await listAllPlansForFounder();
    return NextResponse.json({
      subscription: {
        planId: subscription.plan_id,
        status: subscription.status,
        isEntitled,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end,
        hasStripeCustomer: Boolean(subscription.stripe_customer_id),
      },
      plan,
      plans,
      stripeConfigured: isStripeConfigured(),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
