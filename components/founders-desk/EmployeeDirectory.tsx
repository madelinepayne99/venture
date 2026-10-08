"use client";

import { useEffect, useState } from "react";
import type { Agent } from "@/lib/db/types";
import type { EmployeeDefinition } from "@/lib/agents/employeeRegistry";

interface EmployeeProfile {
  definition: EmployeeDefinition;
  agent: Agent | null;
  recruited: boolean;
}

const STATUS_LABEL: Record<EmployeeDefinition["implementationStatus"], string> = {
  available: "Available",
  requires_setup: "Requires setup",
  coming_soon: "Coming soon",
};

/**
 * The Employee Directory (Commercial MVP milestone) — a collapsible
 * horizontal portrait strip, deliberately an HTML overlay rendered
 * alongside (not inside) Office/Focus View, so it works identically in
 * both without touching the 3D engine, Room.tsx, or Astra's in-progress
 * office redesign at all. "Portraits" are accent-colored initials, not
 * fabricated imagery — this codebase has no exported 2D character art
 * (Scout/Content Bot exist only as real procedural 3D meshes); using a
 * placeholder photo here would be the fabrication CLAUDE.md's own rules
 * forbid, not an honest stand-in.
 */
export function EmployeeDirectory() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const res = await fetch("/api/employees");
    if (!res.ok) return;
    const data = await res.json();
    setEmployees(data.employees ?? []);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const selected = employees.find((e) => e.definition.key === selectedKey) ?? null;

  async function handleRecruit(key: string) {
    setError(null);
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
    setError(null);
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

  if (loading) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20">
      <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6 lg:px-8">
        <div className="rounded-t-2xl border border-b-0 border-hq-brass/30 bg-white/95 shadow-desk backdrop-blur">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wide text-hq-slate"
            aria-expanded={expanded}
          >
            <span>Employee Directory — {employees.filter((e) => e.recruited).length} recruited</span>
            <span>{expanded ? "Hide ▾" : "Show ▴"}</span>
          </button>
          {expanded && (
            <div className="flex gap-2 overflow-x-auto border-t border-hq-brass/15 px-4 py-3">
              {employees.map(({ definition, recruited }) => (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => setSelectedKey(definition.key)}
                  className="flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1 text-center hover:bg-hq-parchment/60"
                >
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold text-white shadow-desk"
                    style={{
                      backgroundColor: definition.accentColor,
                      opacity: definition.implementationStatus === "coming_soon" ? 0.45 : 1,
                    }}
                    aria-hidden="true"
                  >
                    {definition.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="max-w-[72px] truncate text-[11px] font-medium text-hq-ink">{definition.displayName}</span>
                  {definition.implementationStatus === "coming_soon" ? (
                    <span className="rounded bg-hq-slate/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-hq-slate/70">
                      Coming soon
                    </span>
                  ) : (
                    <span className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${recruited ? "bg-emerald-100 text-emerald-700" : "bg-hq-slate/10 text-hq-slate/70"}`}>
                      {recruited ? "Recruited" : "Not recruited"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <>
          <div
            className="fixed inset-0 z-30 bg-hq-ink/20"
            onClick={() => setSelectedKey(null)}
            aria-hidden="true"
          />
          <div
            className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg rounded-t-2xl border border-hq-brass/30 bg-hq-cream p-5 shadow-2xl sm:bottom-6 sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.definition.displayName} profile`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-full text-base font-semibold text-white"
                  style={{ backgroundColor: selected.definition.accentColor }}
                  aria-hidden="true"
                >
                  {selected.definition.displayName.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold text-hq-tealDark">{selected.definition.displayName}</h2>
                  <p className="text-xs text-hq-slate">
                    {selected.definition.jobTitle} · {selected.definition.department}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                aria-label="Close profile"
                className="rounded-md px-2 py-1 text-hq-slate hover:bg-hq-parchment"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-sm text-hq-ink">{selected.definition.description}</p>

            {selected.definition.capabilities.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-hq-slate">What they can do</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-hq-ink">
                  {selected.definition.capabilities.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {selected.definition.requiredIntegrations.length > 0 && (
              <p className="mt-3 text-xs text-hq-slate">
                <span className="font-semibold uppercase tracking-wide">Setup required:</span>{" "}
                {selected.definition.requiredIntegrations.join(", ")}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-hq-slate">
                {STATUS_LABEL[selected.definition.implementationStatus]}
              </span>
              {selected.definition.implementationStatus === "coming_soon" ? (
                <button type="button" disabled className="rounded-md bg-hq-slate/20 px-3 py-1.5 text-xs font-semibold text-hq-slate/60">
                  Not yet available
                </button>
              ) : selected.recruited ? (
                <button
                  type="button"
                  disabled={busyKey === selected.definition.key}
                  onClick={() => handleRemove(selected.definition.key)}
                  className="rounded-md border border-hq-slate/30 px-3 py-1.5 text-xs font-medium text-hq-slate disabled:opacity-50"
                >
                  Remove from Office
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyKey === selected.definition.key}
                  onClick={() => handleRecruit(selected.definition.key)}
                  className="rounded-md bg-hq-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Recruit
                </button>
              )}
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
