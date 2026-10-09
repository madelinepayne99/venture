"use client";

import { useEffect, useState } from "react";

interface ReviewItem {
  id: string;
  source: "scout_mission" | "content_bot_item" | "agent_deliverable";
  agentKey: string;
  title: string;
  kind: string;
  createdAt: string;
  referenceId: string;
}

const AGENT_LABELS: Record<string, string> = {
  scout: "Scout",
  content_bot: "Content Bot",
  chief_of_staff: "Chief of Staff",
  executive_assistant: "Executive Assistant",
  finance_agent: "Finance Agent",
  business_analyst: "Business Analyst",
  operations_agent: "Operations Agent",
};

/**
 * The Universal Founders' Desk inbox (Commercial MVP Milestone 4) — one
 * real, unified list of everything genuinely awaiting founder review,
 * across all seven agents. This component does NOT reimplement Scout's
 * or Content Bot's own review UIs — clicking one of their items opens
 * the EXACT SAME, already-protected detail views Focus View already has
 * (`onSelectMission`/`onOpenContentItem`, passed in as props). Only the
 * five Operations Wing agents' `agent_deliverable` items get a new,
 * simple detail view here, since they had no reviewable-deliverable
 * concept before this milestone.
 */
export function FoundersDeskInbox({
  onSelectMission,
  onOpenContentItem,
}: {
  onSelectMission: (missionId: string) => void;
  onOpenContentItem: (contentItemId: string) => void;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDeliverable, setExpandedDeliverable] = useState<{
    id: string;
    deliverable: { title: string; kind: string; content: unknown; agent_key: string };
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/founders-desk/inbox");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items ?? []);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function openDeliverable(id: string) {
    const res = await fetch(`/api/founders-desk/deliverables/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setExpandedDeliverable({ id, deliverable: data.deliverable });
  }

  async function handleScoutReview(missionId: string, decision: "approve" | "reject" | "revise") {
    setBusyId(missionId);
    setMessage(null);
    try {
      const res = await fetch(`/api/founders-desk/scout/${missionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? body.message : body.error ?? "Could not record that decision.");
      if (res.ok) {
        setNote("");
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeliverableReview(deliverableId: string, decision: "approve" | "reject" | "revise") {
    setBusyId(deliverableId);
    setMessage(null);
    try {
      const res = await fetch(`/api/founders-desk/deliverables/${deliverableId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? body.message : body.error ?? "Could not record that decision.");
      if (res.ok) {
        setNote("");
        setExpandedDeliverable(null);
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Founders&apos; Desk — Review Inbox</h2>
      <p className="mt-1 text-xs text-hq-slate">
        Every agent&apos;s completed work waits here for a founder to approve, reject, or send back — nothing is
        accepted automatically.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-hq-slate">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-hq-slate">Nothing awaiting review right now.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg bg-hq-parchment/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-hq-ink">{item.title}</p>
                  <p className="text-xs text-hq-slate">
                    {AGENT_LABELS[item.agentKey] ?? item.agentKey} · {item.kind.replace(/_/g, " ")}
                  </p>
                </div>
                {item.source === "scout_mission" && (
                  <button
                    type="button"
                    onClick={() => onSelectMission(item.referenceId)}
                    className="shrink-0 rounded-md border border-hq-brass/30 px-2 py-1 text-xs font-semibold text-hq-teal"
                  >
                    Open report
                  </button>
                )}
                {item.source === "content_bot_item" && (
                  <button
                    type="button"
                    onClick={() => onOpenContentItem(item.referenceId)}
                    className="shrink-0 rounded-md border border-hq-brass/30 px-2 py-1 text-xs font-semibold text-hq-teal"
                  >
                    Open for review
                  </button>
                )}
                {item.source === "agent_deliverable" && (
                  <button
                    type="button"
                    onClick={() => openDeliverable(item.referenceId)}
                    className="shrink-0 rounded-md border border-hq-brass/30 px-2 py-1 text-xs font-semibold text-hq-teal"
                  >
                    Inspect
                  </button>
                )}
              </div>

              {item.source === "scout_mission" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    disabled={busyId === item.referenceId}
                    onClick={() => handleScoutReview(item.referenceId, "approve")}
                    className="rounded-md bg-hq-teal px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === item.referenceId}
                    onClick={() => handleScoutReview(item.referenceId, "reject")}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    disabled={busyId === item.referenceId}
                    onClick={() => handleScoutReview(item.referenceId, "revise")}
                    className="rounded-md border border-hq-slate/30 px-2 py-1 text-xs text-hq-slate disabled:opacity-50"
                  >
                    Send back
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {message && <p className="mt-2 text-xs text-hq-slate">{message}</p>}

      {expandedDeliverable && (
        <>
          <div className="fixed inset-0 z-30 bg-hq-ink/20" onClick={() => setExpandedDeliverable(null)} aria-hidden="true" />
          <div
            className="fixed inset-x-4 top-1/2 z-40 mx-auto max-w-lg -translate-y-1/2 rounded-2xl border border-hq-brass/30 bg-hq-cream p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-base font-semibold text-hq-tealDark">{expandedDeliverable.deliverable.title}</h3>
              <button onClick={() => setExpandedDeliverable(null)} aria-label="Close" className="text-hq-slate">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-hq-slate">
              {AGENT_LABELS[expandedDeliverable.deliverable.agent_key] ?? expandedDeliverable.deliverable.agent_key} ·{" "}
              {expandedDeliverable.deliverable.kind.replace(/_/g, " ")}
            </p>
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-white/70 p-3 text-xs text-hq-ink">
              {JSON.stringify(expandedDeliverable.deliverable.content, null, 2)}
            </pre>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (used for Reject / Send back)"
              className="mt-3 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <div className="mt-3 flex flex-wrap gap-1">
              <button
                disabled={busyId === expandedDeliverable.id}
                onClick={() => handleDeliverableReview(expandedDeliverable.id, "approve")}
                className="rounded-md bg-hq-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busyId === expandedDeliverable.id}
                onClick={() => handleDeliverableReview(expandedDeliverable.id, "reject")}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                disabled={busyId === expandedDeliverable.id}
                onClick={() => handleDeliverableReview(expandedDeliverable.id, "revise")}
                className="rounded-md border border-hq-slate/30 px-3 py-1.5 text-xs text-hq-slate disabled:opacity-50"
              >
                Send back
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
