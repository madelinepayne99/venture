"use client";

import { useEffect, useState } from "react";
import { FocusCard, FocusSectionHeading, FocusErrorState, FocusLoadingState } from "./FocusPrimitives";

interface BillingStatus {
  subscription: {
    planId: string;
    status: string;
    isEntitled: boolean;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    hasStripeCustomer: boolean;
  };
  plan: { id: string; display_name: string; monthly_price_gbp: number | null };
  stripeConfigured: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Payment failed",
  canceled: "Cancelled",
  incomplete: "Incomplete",
};

/**
 * Real billing status (Mission 8, Sections 14-15) — anticipated by
 * Milestone D's own SettingsSection doc comment ("the natural future
 * home for plan/billing/allowance configuration") as exactly this.
 * Reads the real GET /api/billing/status; "Manage billing" opens a real
 * Stripe Billing Portal session when one exists (requires a real
 * stripe_customer_id, which only exists after a real checkout — never
 * on the free plan).
 */
export function BillingSection() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/status");
      if (!res.ok) throw new Error();
      setStatus(await res.json());
    } catch {
      setError("Could not load billing status right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleManageBilling() {
    setPortalBusy(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalError(body.error ?? "Could not open billing management.");
        return;
      }
      window.location.href = body.portalUrl;
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <FocusCard>
      <FocusSectionHeading
        title="Plan & billing"
        description="Your organization's real subscription plan — enforced server-side, the same for every organization."
      />
      <div className="mt-4">
        {loading ? (
          <FocusLoadingState label="Loading billing status…" />
        ) : error ? (
          <FocusErrorState message={error} onRetry={load} />
        ) : status ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-border bg-focus-ivory px-4 py-3">
              <div>
                <p className="font-medium text-focus-ink">{status.plan.display_name}</p>
                <p className="text-xs text-focus-slate">
                  {STATUS_LABEL[status.subscription.status] ?? status.subscription.status}
                  {status.subscription.cancelAtPeriodEnd && " · cancels at period end"}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href="/pricing"
                  className="rounded-md border border-focus-border px-3 py-1.5 text-xs font-medium text-focus-ink hover:bg-focus-ivory"
                >
                  View plans
                </a>
                {status.subscription.hasStripeCustomer && (
                  <button
                    type="button"
                    disabled={portalBusy}
                    onClick={handleManageBilling}
                    className="rounded-md bg-focus-emerald px-3 py-1.5 text-xs font-semibold text-white hover:bg-focus-emeraldLight disabled:opacity-50"
                  >
                    {portalBusy ? "Opening…" : "Manage billing"}
                  </button>
                )}
              </div>
            </div>
            {!status.stripeConfigured && (
              <p className="text-xs text-focus-slate">
                Real billing isn&apos;t configured in this environment yet — subscribing will show a clear error
                until a founder adds real Stripe test-mode credentials.
              </p>
            )}
            {portalError && <p className="text-xs text-status-danger">{portalError}</p>}
          </div>
        ) : null}
      </div>
    </FocusCard>
  );
}
