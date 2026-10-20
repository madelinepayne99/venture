"use client";

import { useEffect, useState } from "react";
import type { LedgerEntry } from "@/lib/db/types";
import { FinanceAgentPanel } from "../FinanceAgentPanel";
import { Ledger } from "../Ledger";
import { FocusCard, FocusSectionHeading, FocusErrorState, FocusLoadingState, FocusStat } from "./FocusPrimitives";

interface BudgetStatus {
  monthlyLimitUsd: number;
  committedUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

/**
 * Real AI spending status (Mission 8 Focus View redesign, item 7's
 * "spending-limit states" — the customer-facing surface
 * `getBudgetStatusForOrganization` never had before this milestone, see
 * `/api/budget`). Loading, error, and exhausted states are each their
 * own explicit, honest treatment — never a silently-missing number.
 */
function AiBudgetCard() {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/budget");
      if (!res.ok) throw new Error();
      setStatus(await res.json());
    } catch {
      setError("Could not load your AI spending status right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <FocusCard>
      <FocusSectionHeading
        title="AI spending this month"
        description="Every real agent call — Scout, Content Bot, Business Analyst — is reserved against this limit before it runs, and settled with the real cost afterward."
      />
      <div className="mt-4">
        {loading ? (
          <FocusLoadingState label="Loading spending status…" />
        ) : error ? (
          <FocusErrorState message={error} onRetry={load} />
        ) : status ? (
          <div className="space-y-4">
            {/* Mission 9 QA fix: a real visual bug found live at phone
                width — a fixed 3-column grid let "Monthly limit"'s label
                wrap to two lines while its neighbors stayed on one,
                leaving the grid's own row height mismatched and the two
                large dollar figures visually colliding. Stacks to one
                column below sm, matching OverviewSection's own stat-grid
                pattern. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FocusStat label="Committed" value={`$${status.committedUsd.toFixed(2)}`} />
              <FocusStat label="Monthly limit" value={`$${status.monthlyLimitUsd.toFixed(2)}`} />
              <FocusStat
                label="Remaining"
                value={`$${status.remainingUsd.toFixed(2)}`}
                tone={status.exhausted ? "danger" : status.remainingUsd < status.monthlyLimitUsd * 0.2 ? "warning" : "default"}
              />
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-focus-ivoryDark">
              <div
                className={`h-full rounded-full ${status.exhausted ? "bg-status-danger" : "bg-focus-emerald"}`}
                style={{
                  width: `${Math.min(100, (status.committedUsd / Math.max(status.monthlyLimitUsd, 0.01)) * 100)}%`,
                }}
              />
            </div>
            {status.exhausted ? (
              <p className="rounded-lg bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                This month&apos;s AI budget is fully committed. New Scout research, Content Bot production, or
                Business Analyst requests will be refused until it resets next month.
              </p>
            ) : status.remainingUsd < status.monthlyLimitUsd * 0.2 ? (
              <p className="rounded-lg bg-focus-goldSoft px-3 py-2 text-sm text-focus-goldText">
                Less than 20% of this month&apos;s AI budget remains.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </FocusCard>
  );
}

export function FinanceSection({ ledgerEntries, ledgerTotal }: { ledgerEntries: LedgerEntry[]; ledgerTotal: number }) {
  return (
    <div className="space-y-6">
      <AiBudgetCard />
      <FocusCard>
        <FinanceAgentPanel />
      </FocusCard>
      <FocusCard>
        <Ledger entries={ledgerEntries} totalUsd={ledgerTotal} />
      </FocusCard>
    </div>
  );
}
