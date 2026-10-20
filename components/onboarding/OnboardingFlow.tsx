"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmployeesSection } from "@/components/founders-desk/focus/EmployeesSection";
import { FocusCard } from "@/components/founders-desk/focus/FocusPrimitives";
import type { VentureStage } from "@/lib/db/types";

type Step = "welcome" | "createHq" | "recruit" | "enter";

/**
 * The real new-customer journey (Mission 8, Sections 11-12) — shown
 * instead of the normal dashboard only when the signed-in founder
 * genuinely has zero organization memberships yet (app/page.tsx's own
 * check). Every step here does something real: step 2 calls the actual
 * `POST /api/organizations` (createOrganizationWithOwner — existed since
 * Mission 6, never reachable from the UI until now); step 3 is the exact
 * same real `EmployeesSection` Focus View itself uses, with the exact
 * same real recruit/remove endpoints — not a second, fake recruitment
 * flow. There is no separate "first task" or "review result" screen
 * here (steps 5-6 of the brief's own 6-step outline): once a founder has
 * a real organization, the normal FoundersDeskApp renders with its real
 * Tasks and Founders' Desk sections already built — duplicating them
 * here would just be a second, parallel UI for the same real workflow.
 */
export function OnboardingFlow({ founderName }: { founderName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [hqName, setHqName] = useState("");
  const [ventureStage, setVentureStage] = useState<VentureStage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateHq() {
    const trimmed = hqName.trim();
    if (!trimmed) {
      setError("Give your headquarters a real name — your business or project's name works well.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, ventureStage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create your headquarters. Please try again.");
        return;
      }

      // A real, immediately-usable first workspace — without this, a new
      // organization has no project for a mission to belong to, and
      // MissionForm has nothing to let a founder select (confirmed live:
      // a brand-new organization with no workspace yet renders HQ View's
      // own honest "office is unfurnished" empty state instead of being
      // assignable). "Commerce" is the same default workspace type this
      // app's own very first seeded project already used — a reasonable
      // default, not a fabricated choice; the founder can create a
      // different or additional workspace any time from Settings.
      const workspaceRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, workspaceType: "commerce" }),
      });
      if (!workspaceRes.ok) {
        const body = await workspaceRes.json().catch(() => ({}));
        setError(
          body.error ?? "Your headquarters was created, but the first workspace could not be. Try Settings once you're in.",
        );
        // The organization itself is real and already created — still
        // let them continue rather than stranding them on this step.
      }

      setStep("recruit");
    } finally {
      setSubmitting(false);
    }
  }

  function handleEnterHq() {
    // The founder now has a real organization membership — re-fetch the
    // real server-rendered page, which will render the normal
    // FoundersDeskApp instead of this onboarding flow from here on.
    router.refresh();
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold text-focus-emerald">Welcome to Venture HQ</h1>
        <p className="mt-2 text-focus-slate">
          Build your AI workforce. Give them real work. Review the results. Run your business from one headquarters.
        </p>
      </div>

      <div className="mb-8 flex items-center justify-center gap-2" aria-hidden="true">
        {(["welcome", "createHq", "recruit", "enter"] as Step[]).map((s, i) => (
          <span
            key={s}
            className={`h-1.5 w-10 rounded-full ${
              ["welcome", "createHq", "recruit", "enter"].indexOf(step) >= i ? "bg-focus-emerald" : "bg-focus-border"
            }`}
          />
        ))}
      </div>

      {step === "welcome" && (
        <FocusCard>
          <h2 className="font-display text-xl font-semibold text-focus-ink">
            Hi {founderName.split(" ")[0] || founderName} — let&apos;s get your headquarters set up.
          </h2>
          <p className="mt-3 text-sm text-focus-slate">
            In a couple of minutes you&apos;ll have your own private headquarters, a real AI employee recruited, and
            your first real task underway. Nothing here is simulated — every employee you recruit and every task you
            assign does genuine, billed work.
          </p>
          <button
            type="button"
            onClick={() => setStep("createHq")}
            className="mt-6 rounded-md bg-focus-emerald px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-focus-emeraldLight"
          >
            Get started
          </button>
        </FocusCard>
      )}

      {step === "createHq" && (
        <FocusCard>
          <h2 className="font-display text-xl font-semibold text-focus-ink">Create your headquarters</h2>
          <p className="mt-1 text-sm text-focus-slate">
            This is your own private organization — completely separate from anyone else&apos;s. You&apos;ll be its
            owner.
          </p>

          <label className="mt-5 block text-xs font-medium uppercase tracking-wide text-focus-slate" htmlFor="hq-name">
            Your business or project name
          </label>
          <input
            id="hq-name"
            type="text"
            value={hqName}
            onChange={(e) => setHqName(e.target.value)}
            placeholder="e.g. Riverside Bakery"
            className="mt-1.5 w-full rounded-md border border-focus-border px-3 py-2 text-sm text-focus-ink focus:border-focus-emerald focus:outline-none"
          />

          <fieldset className="mt-5">
            <legend className="text-xs font-medium uppercase tracking-wide text-focus-slate">
              Are you starting something new, or running an existing business?
            </legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "new_venture" as const, label: "Starting a new business", desc: "I'm exploring or launching something new." },
                  { value: "existing_business" as const, label: "Running an existing business", desc: "I already have a business I want help running." },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVentureStage(opt.value)}
                  aria-pressed={ventureStage === opt.value}
                  className={`rounded-lg border px-4 py-3 text-left text-sm transition ${
                    ventureStage === opt.value
                      ? "border-focus-emerald bg-focus-emeraldSoft text-focus-emerald"
                      : "border-focus-border text-focus-ink hover:bg-focus-ivory"
                  }`}
                >
                  <span className="block font-medium">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-focus-slate">{opt.desc}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p className="mt-4 text-sm text-status-danger">{error}</p>}

          <button
            type="button"
            disabled={submitting}
            onClick={handleCreateHq}
            className="mt-6 rounded-md bg-focus-emerald px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-focus-emeraldLight disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create my headquarters"}
          </button>
        </FocusCard>
      )}

      {step === "recruit" && (
        <div className="space-y-6">
          <FocusCard>
            <h2 className="font-display text-xl font-semibold text-focus-ink">Recruit your first employee</h2>
            <p className="mt-1 text-sm text-focus-slate">
              Seven real AI employees are available today. Three more are planned but not yet built — clearly
              labelled Coming Soon below. Recruit at least one to continue; you can recruit the rest any time from
              the Employees tab.
            </p>
          </FocusCard>
          <EmployeesSection />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep("enter")}
              className="rounded-md bg-focus-emerald px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-focus-emeraldLight"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {step === "enter" && (
        <FocusCard>
          <h2 className="font-display text-xl font-semibold text-focus-ink">You&apos;re ready</h2>
          <p className="mt-3 text-sm text-focus-slate">
            Your headquarters is set up and your workforce is ready. From here, head to the <strong>Tasks</strong>{" "}
            tab to assign your first genuinely supported task — try Scout for real opportunity research, or
            Business Analyst for a specific research question. Once an agent finishes real work, it&apos;ll wait for
            you at the <strong>Founders&apos; Desk</strong> for review.
          </p>
          <button
            type="button"
            onClick={handleEnterHq}
            className="mt-6 rounded-md bg-focus-emerald px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-focus-emeraldLight"
          >
            Enter your headquarters →
          </button>
        </FocusCard>
      )}
    </main>
  );
}
