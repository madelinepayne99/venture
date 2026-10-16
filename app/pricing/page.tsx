import { auth } from "@/auth";
import { listAllPlansForFounder, resolveOrganizationSubscription } from "@/lib/domain/subscriptionWorkflow";
import { getActiveOrganizationForFounder, OrganizationNotFoundError } from "@/lib/domain/organizationWorkflow";
import { PricingTable } from "@/components/pricing/PricingTable";

export const dynamic = "force-dynamic";

/**
 * The real customer-facing pricing page (Mission 8, Sections 14-15,
 * priority 6). Every figure shown is read live from the real
 * subscription_plans table — never hardcoded here, so this page can
 * never drift from what budgetWorkflow.ts/subscriptionWorkflow.ts
 * actually enforce. Every plan in the real seed data has
 * is_published: false (provisional, founder-approval-pending prices,
 * see docs/venture-hq-commercial-mvp-progress.md's own pricing
 * analysis) — this page is reachable only by a signed-in founder (this
 * app has no public/unauthenticated area at all yet; see middleware.ts),
 * and says so plainly rather than pretending to be a live, public
 * marketing page.
 */
export default async function PricingPage() {
  const session = await auth();
  const plans = await listAllPlansForFounder();

  // Mission 12 — so the page can disable "Subscribe" and point to
  // "Manage billing" instead for an organization already on a real,
  // active paid plan (see billingWorkflow.ts's AlreadySubscribedError —
  // this is the UI-side half; the real protection is server-side there,
  // never just this). null for a signed-out visitor or a founder with no
  // organization yet (onboarding) — both already handled below.
  let currentPlanId: string | null = null;
  if (session?.founderId) {
    try {
      const organization = await getActiveOrganizationForFounder(session.founderId);
      const { subscription, isEntitled } = await resolveOrganizationSubscription(organization.id);
      if (isEntitled && subscription.stripe_subscription_id) {
        currentPlanId = subscription.plan_id;
      }
    } catch (error) {
      if (!(error instanceof OrganizationNotFoundError)) throw error;
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-12 sm:px-6">
      <div className="mb-3 rounded-lg border border-focus-gold/40 bg-focus-goldSoft px-4 py-3 text-sm text-focus-goldText">
        <strong>Development preview.</strong> These prices and quotas are provisional and have not been publicly
        announced or approved for real billing. Visible only to signed-in founders — this page is not linked from
        anywhere public.
      </div>

      <div className="mb-10 text-center">
        <h1 className="font-display text-4xl font-semibold text-focus-emerald">Venture HQ Pricing</h1>
        <p className="mx-auto mt-3 max-w-2xl text-focus-slate">
          Every plan&apos;s real AI budget and video allowance below is enforced server-side, the same way for every
          organization — nothing here is a promise of unlimited AI execution.
        </p>
      </div>

      <PricingTable plans={plans} signedInFounderName={session?.founderName ?? null} currentPlanId={currentPlanId} />

      <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-focus-border bg-focus-card p-6 text-sm text-focus-slate">
        <h2 className="font-display text-base font-semibold text-focus-ink">How these numbers were set</h2>
        <p className="mt-2">
          Each plan&apos;s AI budget and video allowance come from this app&apos;s own real, measured per-task costs
          (Scout, Content Bot, and Business Analyst&apos;s actual recorded spend) plus researched pricing from
          comparable AI business tools — not a guess. Full methodology and sources are recorded in the development
          progress file. A Content Bot video production is capped at its own real, separate per-item safety limit
          regardless of plan.
        </p>
      </div>
    </main>
  );
}
