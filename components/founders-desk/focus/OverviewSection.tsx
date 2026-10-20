"use client";

import { useEffect, useState } from "react";
import type { Agent, Mission } from "@/lib/db/types";
import { missionDockBucket } from "@/lib/domain/missionStates";
import { FocusCard, FocusSectionHeading, FocusStat, FocusEmptyState, FocusLoadingState } from "./FocusPrimitives";
import type { FocusSection } from "./FocusNav";

interface BudgetStatus {
  monthlyLimitUsd: number;
  committedUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

/** Buckets that mean "an agent is genuinely working on this right now" — reuses the same real grouping the HQ office mission board already uses, never a separate invented definition. */
const ACTIVE_WORK_BUCKETS = new Set(["researching", "awaiting_evidence", "producing"]);

/**
 * The real business overview (Mission 8 Focus View redesign, item 1):
 * active work, recruited employees, pending approvals, and actual AI
 * usage — every figure derived from already-real data (missions/agents
 * props already fetched by FoundersDeskApp.tsx, plus one new read-only
 * endpoint for budget status) or a status fetched directly. Nothing here
 * is estimated or invented — an unknown figure renders as "—", never a
 * guess.
 */
export function OverviewSection({
  missions,
  agents,
  pendingReviewCount,
  onNavigate,
}: {
  missions: Mission[];
  agents: Agent[];
  pendingReviewCount: number;
  onNavigate: (section: FocusSection) => void;
}) {
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [loadingBudget, setLoadingBudget] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/budget");
        if (!res.ok) throw new Error("Could not load AI usage.");
        const data = await res.json();
        if (!cancelled) setBudget(data);
      } catch {
        if (!cancelled) setBudgetError("Could not load AI usage right now.");
      } finally {
        if (!cancelled) setLoadingBudget(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeWork = missions.filter((m) => ACTIVE_WORK_BUCKETS.has(missionDockBucket(m.state))).length;
  const recruited = agents.filter((a) => a.status === "active").length;
  const recentMissions = [...missions]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <FocusCard>
        <FocusSectionHeading
          title="Your business, at a glance"
          description="Real, current figures — nothing here is simulated or estimated."
        />
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <button type="button" onClick={() => onNavigate("tasks")} className="text-left">
            <FocusStat label="Active work" value={activeWork} />
          </button>
          <button type="button" onClick={() => onNavigate("employees")} className="text-left">
            <FocusStat label="Recruited employees" value={recruited} />
          </button>
          <button type="button" onClick={() => onNavigate("foundersDesk")} className="text-left">
            <FocusStat
              label="Pending approvals"
              value={pendingReviewCount}
              tone={pendingReviewCount > 0 ? "warning" : "default"}
            />
          </button>
          <button type="button" onClick={() => onNavigate("finance")} className="text-left">
            {loadingBudget ? (
              <FocusStat label="AI spend this month" value="…" />
            ) : budget ? (
              <FocusStat
                label="AI spend this month"
                value={`$${budget.committedUsd.toFixed(2)} / $${budget.monthlyLimitUsd.toFixed(2)}`}
                tone={budget.exhausted ? "danger" : budget.remainingUsd < budget.monthlyLimitUsd * 0.2 ? "warning" : "default"}
              />
            ) : (
              <FocusStat label="AI spend this month" value={null} />
            )}
          </button>
        </div>
        {budgetError && <p className="mt-3 text-xs text-status-danger">{budgetError}</p>}
        {budget?.exhausted && (
          <p className="mt-3 rounded-lg bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
            This organization&apos;s monthly AI budget is fully committed — new research or production work will be
            refused until next month, or until the limit is raised.
          </p>
        )}
      </FocusCard>

      <FocusCard>
        <FocusSectionHeading
          title="Recently updated work"
          description="The five most recently updated missions across every workspace."
          action={
            <button
              type="button"
              onClick={() => onNavigate("tasks")}
              className="text-sm font-medium text-focus-emerald hover:underline"
            >
              View all tasks →
            </button>
          }
        />
        <div className="mt-4">
          {missions.length === 0 ? (
            <FocusEmptyState
              title="No missions yet"
              body="Assign Scout a brief from the Tasks tab to get your first real research mission running."
            />
          ) : (
            <ul className="divide-y divide-focus-border">
              {recentMissions.map((mission) => (
                <li key={mission.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-focus-ink">{mission.title}</p>
                    <p className="truncate text-xs text-focus-slate">{mission.brief}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-focus-border bg-focus-ivory px-2.5 py-1 text-xs font-medium text-focus-slate">
                    {missionDockBucket(mission.state).replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FocusCard>
    </div>
  );
}
