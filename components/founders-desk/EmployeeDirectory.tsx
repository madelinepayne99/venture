"use client";

import { useEffect, useRef, useState } from "react";
import type { Agent } from "@/lib/db/types";
import type { EmployeeDefinition } from "@/lib/agents/employeeRegistry";
import { INTEGRATION_LABELS } from "@/lib/agents/employeeRegistry";
import { EmployeePortrait } from "./EmployeePortrait";

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
 * The Employee Directory (Commercial MVP Milestone — visually rebuilt per
 * Master Development Mission 5, Section 3) — a collapsible horizontal
 * portrait strip, deliberately an HTML overlay rendered alongside (not
 * inside) Office/Focus View, so it works identically in both without
 * touching the 3D engine, Room.tsx, or Astra's in-progress office
 * redesign at all.
 *
 * Portraits are real static images rendered from each employee's own
 * approved 3D rig (see EmployeePortrait above) — not colour-and-initial
 * placeholders, and not a different, invented art style. The collapsed
 * bar stays a slim, permanently-visible strip (the page's own bottom
 * padding in FoundersDeskApp.tsx accounts for its height so it never
 * hides real content); expanding it adds a real dimmed backdrop — the
 * same pattern this component's own profile dialog already used — so it
 * reads unambiguously as a temporary overlay a founder can dismiss,
 * rather than silently covering whatever happened to be underneath.
 */
export function EmployeeDirectory() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [justRecruited, setJustRecruited] = useState<string | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);

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

  // Keyboard/accessibility: Escape closes whichever overlay is open
  // (profile first, then the expanded strip), and the profile dialog
  // takes real focus the moment it opens so screen-reader/keyboard users
  // land on it directly rather than having to hunt for it.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (selectedKey) setSelectedKey(null);
      else if (expanded) setExpanded(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedKey, expanded]);

  useEffect(() => {
    if (selected) profileRef.current?.focus();
  }, [selected]);

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
      // A real, successful recruitment just happened server-side — this
      // is never shown speculatively ahead of that confirmation. Purely
      // a confirmation banner; no animation plays unless the founder's
      // system allows motion (motion-safe below), and there is nothing
      // here that simulates an in-office arrival that didn't happen.
      setJustRecruited(key);
      setTimeout(() => setJustRecruited((cur) => (cur === key ? null : cur)), 3200);
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

  const recruitedCount = employees.filter((e) => e.recruited).length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20">
      {/* A real dimmed backdrop while expanded — not just when a profile
          is open — so the strip reads as a dismissable overlay rather
          than silently sitting on top of whatever page content is
          underneath (the real bug Master Development Mission 5, Section
          3 named: "must feel integrated rather than simply covering
          application content"). Clicking it collapses the strip. */}
      {expanded && (
        <div
          className="fixed inset-0 z-20 bg-hq-ink/15"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}
      <div className="relative z-20 mx-auto max-w-7xl px-4 pb-3 sm:px-6 lg:px-8">
        <div className="rounded-t-2xl border border-b-0 border-hq-brass/30 bg-white/95 shadow-desk backdrop-blur">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-hq-slate"
            aria-expanded={expanded}
            aria-controls="employee-directory-strip"
          >
            <span>
              Employee Directory <span className="text-hq-ink">— {recruitedCount} of 7 recruited</span>
            </span>
            <span aria-hidden="true">{expanded ? "Hide ▾" : "Show ▴"}</span>
          </button>
          {expanded && (
            <div
              id="employee-directory-strip"
              className="flex gap-3 overflow-x-auto border-t border-hq-brass/15 px-4 py-4"
            >
              {employees.map(({ definition, recruited }) => (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => setSelectedKey(definition.key)}
                  aria-label={`${definition.displayName}, ${definition.jobTitle}${
                    definition.implementationStatus === "coming_soon"
                      ? ", coming soon"
                      : recruited
                        ? ", recruited"
                        : ", not recruited"
                  }. Open profile.`}
                  className="flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-xl px-1.5 py-2 text-center transition hover:bg-hq-parchment/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-hq-teal"
                >
                  <span className="relative">
                    <EmployeePortrait definition={definition} size="sm" />
                    {justRecruited === definition.key && (
                      <span className="motion-safe:animate-hq-glow absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white shadow-desk">
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="w-full text-[11px] font-medium leading-tight text-hq-ink">
                    {definition.displayName}
                  </span>
                  {definition.implementationStatus === "coming_soon" ? (
                    <span className="rounded bg-hq-slate/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-hq-slate/70">
                      Coming soon
                    </span>
                  ) : (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${recruited ? "bg-emerald-100 text-emerald-700" : "bg-hq-slate/10 text-hq-slate/70"}`}
                    >
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
            className="fixed inset-0 z-30 bg-hq-ink/25"
            onClick={() => setSelectedKey(null)}
            aria-hidden="true"
          />
          <div
            ref={profileRef}
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[85vh] max-w-lg overflow-y-auto rounded-t-2xl border border-hq-brass/30 bg-hq-cream p-5 shadow-2xl outline-none sm:bottom-6 sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-profile-name"
            aria-describedby="employee-profile-description"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <EmployeePortrait definition={selected.definition} size="lg" />
                <div>
                  <h2 id="employee-profile-name" className="font-display text-lg font-semibold text-hq-tealDark">
                    {selected.definition.displayName}
                  </h2>
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

            <p id="employee-profile-description" className="mt-3 text-sm text-hq-ink">
              {selected.definition.description}
            </p>

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
                <span className="font-semibold uppercase tracking-wide">Uses:</span>{" "}
                {selected.definition.requiredIntegrations
                  .map((name) => INTEGRATION_LABELS[name] ?? "An additional service")
                  .join(", ")}
                {" — "}
                {selected.integrationsReady ? (
                  <span className="font-medium text-emerald-700">ready to work</span>
                ) : (
                  <span className="font-medium text-amber-700">integration required — contact the administrator</span>
                )}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-hq-slate">
                {selected.definition.implementationStatus === "available" && !selected.integrationsReady
                  ? "Integration required"
                  : STATUS_LABEL[selected.definition.implementationStatus]}
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
            {justRecruited === selected.definition.key && (
              <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
                {selected.definition.displayName} has joined the office.
              </p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
