"use client";

import { useState } from "react";
import { FocusCard, FocusSectionHeading } from "./FocusPrimitives";

const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

/**
 * Real account management (Mission 10): a genuine data export and a real,
 * server-confirmed account deletion — never a client-side-only dialog.
 * `POST /api/account/delete` itself re-checks the exact confirmation
 * phrase server-side; this UI's own matching check is just so a founder
 * gets instant feedback while typing, not the real safety boundary.
 */
export function AccountSection() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExportError(body.error ?? "Could not export your data right now.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "venture-hq-account-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: confirmText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(body.error ?? "Could not delete your account right now.");
        return;
      }
      setDeleted(true);
      // The real auth_user row (and its sessions) is already gone
      // server-side — reload so the app re-checks auth and redirects to
      // sign-in, rather than leaving a stale authenticated UI on screen.
      setTimeout(() => window.location.reload(), 1500);
    } finally {
      setDeleting(false);
    }
  }

  if (deleted) {
    return (
      <FocusCard>
        <p className="text-sm font-medium text-focus-ink">Your account has been deleted.</p>
        <p className="mt-1 text-sm text-focus-slate">Redirecting you to sign in…</p>
      </FocusCard>
    );
  }

  return (
    <FocusCard>
      <FocusSectionHeading
        title="Your data & account"
        description="Export a copy of your real data, or permanently delete your account."
      />
      <div className="mt-4 space-y-5">
        <div>
          <p className="text-sm font-medium text-focus-ink">Export your data</p>
          <p className="mt-1 text-sm text-focus-slate">
            Download a real JSON file of your profile, your organizations, their missions, financial ledger, and
            your support requests — only data you&apos;re entitled to see.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="mt-2 rounded-md border border-focus-border px-3 py-1.5 text-sm font-medium text-focus-ink hover:bg-focus-ivory disabled:opacity-50"
          >
            {exporting ? "Preparing export…" : "Download my data"}
          </button>
          {exportError && <p className="mt-1 text-xs text-status-danger">{exportError}</p>}
        </div>

        <div className="border-t border-focus-border pt-5">
          <p className="text-sm font-medium text-status-danger">Delete your account</p>
          <p className="mt-1 text-sm text-focus-slate">
            This is permanent. If you solely own an organization with other real members, deletion is refused until
            that&apos;s resolved — an organization is never deleted just because its owner leaves.
          </p>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-2 rounded-md border border-status-danger/40 px-3 py-1.5 text-sm font-medium text-status-danger hover:bg-status-danger/10"
            >
              Delete my account…
            </button>
          ) : (
            <div className="mt-2 space-y-2 rounded-lg border border-status-danger/30 bg-red-50 p-3">
              <label htmlFor="delete-confirm" className="block text-xs font-medium text-status-danger">
                Type <span className="font-mono">{CONFIRMATION_PHRASE}</span> to confirm:
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full rounded-md border border-status-danger/40 bg-white px-3 py-2 text-sm"
              />
              {deleteError && <p className="text-xs text-status-danger">{deleteError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={confirmText !== CONFIRMATION_PHRASE || deleting}
                  className="rounded-md bg-status-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {deleting ? "Deleting…" : "Permanently delete my account"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setConfirmText("");
                    setDeleteError(null);
                  }}
                  className="rounded-md border border-focus-border px-3 py-1.5 text-sm font-medium text-focus-ink hover:bg-focus-ivory"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </FocusCard>
  );
}
