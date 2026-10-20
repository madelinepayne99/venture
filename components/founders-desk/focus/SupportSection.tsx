"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FocusCard, FocusSectionHeading, FocusErrorState, FocusLoadingState, FocusEmptyState } from "./FocusPrimitives";

interface SupportRequestRow {
  id: string;
  subject: string;
  message: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
}

const STATUS_LABEL: Record<SupportRequestRow["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

const STATUS_CLASS: Record<SupportRequestRow["status"], string> = {
  open: "bg-focus-gold/20 text-focus-goldText",
  in_progress: "bg-blue-100 text-blue-700",
  resolved: "bg-status-success/15 text-status-success",
};

/**
 * Real Help & Support (Mission 10) — a genuine server-persisted ticket
 * (GET/POST /api/support), never a form that only looks like it submits.
 * Deliberately never claims an email confirmation was sent unless the
 * backend itself confirms real email delivery is configured
 * (`emailDeliveryConfigured`, from `supportWorkflow.ts`'s
 * `isEmailDeliveryConfigured` — currently always false, since no email
 * provider exists anywhere in this codebase yet).
 */
export function SupportSection() {
  const [requests, setRequests] = useState<SupportRequestRow[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [supportContactEmail, setSupportContactEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/support");
      if (!res.ok) throw new Error();
      const body = await res.json();
      setRequests(body.requests ?? []);
      setEmailConfigured(Boolean(body.emailDeliveryConfigured));
      setSupportContactEmail(body.supportContactEmail ?? null);
    } catch {
      setError("Could not load your support requests right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setJustSubmitted(false);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body.error ?? "Could not submit your request.");
        return;
      }
      setSubject("");
      setMessage("");
      setJustSubmitted(true);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <FocusCard>
        <FocusSectionHeading
          title="Help & Support"
          description="Send us a real support request — it's saved on our server and you can track its status here."
        />
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="support-subject" className="text-xs font-medium uppercase tracking-wide text-focus-slate">
              Subject
            </label>
            <input
              id="support-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              required
              className="mt-1 w-full rounded-md border border-focus-border bg-white px-3 py-2 text-sm text-focus-ink focus:outline-none focus:ring-2 focus:ring-focus-emerald"
              placeholder="e.g. Question about my plan"
            />
          </div>
          <div>
            <label htmlFor="support-message" className="text-xs font-medium uppercase tracking-wide text-focus-slate">
              Message
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              required
              rows={4}
              className="mt-1 w-full rounded-md border border-focus-border bg-white px-3 py-2 text-sm text-focus-ink focus:outline-none focus:ring-2 focus:ring-focus-emerald"
              placeholder="Tell us what's going on..."
            />
          </div>
          {submitError && <p className="text-xs text-status-danger">{submitError}</p>}
          {justSubmitted && (
            <p className="text-xs text-status-success">
              Your request was received and saved.{" "}
              {emailConfigured
                ? "A confirmation email has been sent."
                : "Email confirmation isn't configured yet, so you won't receive one — check back here for status updates."}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-focus-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-focus-emeraldLight disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </form>
        <div className="mt-4 border-t border-focus-border pt-4 text-xs text-focus-slate">
          {supportContactEmail ? (
            <p>You can also reach us directly at {supportContactEmail}.</p>
          ) : (
            <p>A direct support email address hasn&apos;t been configured yet — please use the form above.</p>
          )}
        </div>
      </FocusCard>

      <FocusCard>
        <FocusSectionHeading title="Your requests" description="Real, server-tracked status for every request you've submitted." />
        <div className="mt-4">
          {loading ? (
            <FocusLoadingState label="Loading your requests…" />
          ) : error ? (
            <FocusErrorState message={error} onRetry={load} />
          ) : requests.length === 0 ? (
            <FocusEmptyState title="No requests yet" body="Anything you submit above will show up here with its real status." />
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-lg border border-focus-border bg-focus-ivory px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-focus-ink">{r.subject}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-focus-slate">{r.message}</p>
                  <p className="mt-1 text-[11px] text-focus-slate/70">{new Date(r.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FocusCard>
    </div>
  );
}
