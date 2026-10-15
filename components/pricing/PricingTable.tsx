"use client";

import { useState } from "react";
import type { SubscriptionPlan } from "@/lib/db/types";

const PLAN_TAGLINES: Record<string, string> = {
  free: "Explore the office, no paid AI execution.",
  starter: "For a solo founder getting started.",
  business: "For a small business running real work weekly.",
  growth: "For a busier team producing content regularly.",
};

function describeAgentAccess(plan: SubscriptionPlan): string {
  return plan.includes_paid_agents
    ? "All 7 real employees, including Scout, Content Bot & Business Analyst"
    : "Executive Assistant, Finance & Operations only (manual tools, no paid AI)";
}

export function PricingTable({
  plans,
  signedInFounderName,
}: {
  plans: SubscriptionPlan[];
  signedInFounderName: string | null;
}) {
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    setBusyPlanId(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not start checkout.");
        return;
      }
      window.location.href = body.checkoutUrl;
    } finally {
      setBusyPlanId(null);
    }
  }

  return (
    <div>
      {!signedInFounderName && (
        <p className="mb-4 text-center text-sm text-focus-slate">Sign in to subscribe to a plan.</p>
      )}
      {error && (
        <div className="mx-auto mb-6 max-w-2xl rounded-lg border border-status-danger/30 bg-red-50 px-4 py-3 text-center text-sm text-status-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`flex flex-col rounded-2xl border p-6 ${
              plan.id === "business" ? "border-focus-emerald shadow-md" : "border-focus-border"
            } bg-focus-card`}
          >
            {plan.id === "business" && (
              <span className="mb-2 self-start rounded-full bg-focus-emerald px-2.5 py-0.5 text-xs font-semibold text-white">
                Most popular
              </span>
            )}
            <h3 className="font-display text-xl font-semibold text-focus-ink">{plan.display_name}</h3>
            <p className="mt-1 text-sm text-focus-slate">{PLAN_TAGLINES[plan.id] ?? ""}</p>

            <div className="mt-4">
              <span className="font-display text-3xl font-semibold text-focus-emerald">
                {plan.monthly_price_gbp === 0 ? "Free" : `£${plan.monthly_price_gbp}`}
              </span>
              {plan.monthly_price_gbp !== null && plan.monthly_price_gbp > 0 && (
                <span className="text-sm text-focus-slate">/month</span>
              )}
            </div>

            <ul className="mt-5 flex-1 space-y-2.5 text-sm text-focus-ink">
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-focus-emerald" aria-hidden="true" />
                <span>
                  <strong>${plan.monthly_ai_budget_usd.toFixed(0)}</strong> real AI research &amp; text budget / month
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-focus-emerald" aria-hidden="true" />
                <span>
                  <strong>{plan.monthly_video_allowance}</strong> Content Bot video production
                  {plan.monthly_video_allowance === 1 ? "" : "s"} / month
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-focus-emerald" aria-hidden="true" />
                <span>{describeAgentAccess(plan)}</span>
              </li>
            </ul>

            {plan.id === "free" ? (
              <div className="mt-6 rounded-md border border-focus-border py-2 text-center text-sm font-medium text-focus-slate">
                No paid AI execution
              </div>
            ) : (
              <button
                type="button"
                disabled={!signedInFounderName || busyPlanId === plan.id}
                onClick={() => handleSubscribe(plan.id)}
                className="mt-6 rounded-md bg-focus-emerald py-2 text-sm font-semibold text-white transition hover:bg-focus-emeraldLight disabled:opacity-50"
              >
                {busyPlanId === plan.id ? "Starting checkout…" : "Subscribe"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
