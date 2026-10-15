"use client";

import { useEffect, useState } from "react";
import type { Agent } from "@/lib/db/types";
import type { EmployeeDefinition } from "@/lib/agents/employeeRegistry";
import { INTEGRATION_LABELS } from "@/lib/agents/employeeRegistry";
import { EmployeePortrait } from "../EmployeePortrait";
import { FocusCard, FocusSectionHeading, FocusErrorState, FocusLoadingState } from "./FocusPrimitives";

interface EmployeeProfile {
  definition: EmployeeDefinition;
  agent: Agent | null;
  recruited: boolean;
  integrationsReady: boolean;
}

const STATUS_LABEL: Record<EmployeeDefinition["implementationStatus"], string> = {
  available: "Available",
  requires_setup: "Requires setup",
  coming_soon: "Coming soon",
};

/**
 * A full, spacious Employees page (Mission 8 Focus View redesign, item
 * 5) — the real approved 3D-rig portraits and genuine capabilities from
 * `EMPLOYEE_REGISTRY`, fetched the same real way the compact overlay
 * directory already does (`/api/employees`, organization-scoped
 * server-side). This is a second, independent reader of that same real
 * endpoint — not a duplicate data model — so recruiting or removing an
 * employee here is exactly as real as doing it from the overlay bar.
 */
export function EmployeesSection() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/employees");
      if (!res.ok) throw new Error("Could not load the employee directory.");
      const data = await res.json();
      setEmployees(data.employees ?? []);
      setError(null);
    } catch {
      setError("Could not load the employee directory right now.");
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleRecruit(key: string) {
    setBusyKey(key);
    try {
      const res = await fetch(`/api/employees/${key}/recruit`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not recruit this employee.");
        return;
      }
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemove(key: string) {
    setBusyKey(key);
    try {
      const res = await fetch(`/api/employees/${key}/remove`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not remove this employee.");
        return;
      }
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  const recruitedCount = employees.filter((e) => e.recruited).length;

  return (
    <div className="space-y-6">
      <FocusCard>
        <FocusSectionHeading
          title="Your workforce"
          description={`${recruitedCount} of 7 real employees recruited. Three more are planned but not yet built — shown for visibility only, never as something you can assign work to.`}
        />
      </FocusCard>

      {error && <FocusErrorState message={error} onRetry={refresh} />}

      {loading ? (
        <FocusCard>
          <FocusLoadingState label="Loading the employee directory…" />
        </FocusCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map(({ definition, recruited, integrationsReady }) => {
            const busy = busyKey === definition.key;
            const canRecruit = definition.recruitable;
            return (
              <FocusCard key={definition.key} className="flex flex-col">
                <div className="flex items-start gap-4">
                  <EmployeePortrait
                    definition={definition}
                    size="lg"
                    frameClassName="border-focus-gold/40 bg-focus-ivory"
                  />
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold text-focus-ink">{definition.displayName}</p>
                    <p className="text-sm text-focus-slate">{definition.jobTitle}</p>
                    <p className="text-xs uppercase tracking-wide text-focus-gold">{definition.department}</p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-focus-ink">{definition.description}</p>

                <ul className="mt-3 space-y-1.5">
                  {definition.capabilities.map((cap) => (
                    <li key={cap} className="flex gap-2 text-xs text-focus-slate">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-focus-emerald" aria-hidden="true" />
                      {cap}
                    </li>
                  ))}
                </ul>

                {definition.requiredIntegrations.length > 0 && (
                  <p className="mt-3 text-xs text-focus-slate">
                    Needs: {definition.requiredIntegrations.map((k) => INTEGRATION_LABELS[k] ?? k).join(", ")}
                    {!integrationsReady && recruited && (
                      <span className="ml-1 font-medium text-focus-gold">— not yet connected</span>
                    )}
                  </p>
                )}

                <div className="mt-auto pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        recruited
                          ? "bg-focus-emeraldSoft text-focus-emerald"
                          : definition.implementationStatus === "coming_soon"
                            ? "bg-focus-ivoryDark text-focus-slate"
                            : "bg-focus-goldSoft text-focus-gold"
                      }`}
                    >
                      {recruited ? "Recruited" : STATUS_LABEL[definition.implementationStatus]}
                    </span>

                    {canRecruit && !recruited && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRecruit(definition.key)}
                        className="rounded-md bg-focus-emerald px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-focus-emeraldLight disabled:opacity-50"
                      >
                        {busy ? "Recruiting…" : "Recruit"}
                      </button>
                    )}
                    {canRecruit && recruited && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemove(definition.key)}
                        className="rounded-md border border-focus-border px-3 py-1.5 text-xs font-medium text-focus-slate transition hover:bg-focus-ivory disabled:opacity-50"
                      >
                        {busy ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                </div>
              </FocusCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
