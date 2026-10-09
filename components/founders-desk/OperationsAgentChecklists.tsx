"use client";

import { useEffect, useState } from "react";
import type { Checklist, ChecklistWithItems } from "@/lib/db/types";

/**
 * Operations Agent's one real capability (Operations Wing, Milestone 6):
 * checklists. Mirrors the acceptance test from the Operations Expansion
 * brief — "Create a launch checklist for our first YouTube channel" —
 * real, persisted, inspectable, and updatable (add items, mark items
 * done). Self-contained, same pattern as ExecutiveAssistantTasks.tsx.
 */
export function OperationsAgentChecklists() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [selected, setSelected] = useState<ChecklistWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refreshList() {
    const res = await fetch("/api/checklists");
    if (!res.ok) return;
    const data = await res.json();
    setChecklists(data.checklists ?? []);
  }

  async function openChecklist(id: string) {
    const res = await fetch(`/api/checklists/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setSelected(data.checklist);
  }

  useEffect(() => {
    refreshList().finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) return;
    const items = itemsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const res = await fetch("/api/checklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed, items }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not create that checklist.");
      return;
    }
    setTitle("");
    setItemsText("");
    await refreshList();
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const trimmed = newItemLabel.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/checklists/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelected(data.checklist);
        setNewItemLabel("");
        await refreshList();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleItem(itemId: string, isDone: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/checklists/${selected.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDone }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelected(data.checklist);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Operations Agent — Checklists</h2>
      <p className="mt-1 text-xs text-hq-slate">Repeatable internal processes — real, persisted checklists.</p>

      {loading ? (
        <p className="mt-3 text-sm text-hq-slate">Loading…</p>
      ) : selected ? (
        <div className="mt-3">
          <button onClick={() => setSelected(null)} className="text-xs font-medium text-hq-teal">
            ← Back to checklists
          </button>
          <div className="mt-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-hq-ink">{selected.title}</h3>
            {/* Founders' Desk (Commercial MVP Milestone 4) — a real
                snapshot of this checklist's genuine item states. */}
            <button
              type="button"
              disabled={reportBusy}
              onClick={async () => {
                setReportBusy(true);
                setReportMessage(null);
                try {
                  const res = await fetch(`/api/checklists/${selected.id}/submit-for-review`, { method: "POST" });
                  const body = await res.json().catch(() => ({}));
                  setReportMessage(res.ok ? "Sent to the Founders' Desk." : body.error ?? "Could not submit for review.");
                } finally {
                  setReportBusy(false);
                }
              }}
              className="shrink-0 rounded-md border border-hq-brass/30 px-2 py-1 text-[10px] font-semibold text-hq-teal disabled:opacity-50"
            >
              Submit for review
            </button>
          </div>
          {reportMessage && <p className="text-xs text-hq-slate">{reportMessage}</p>}
          <ul className="mt-2 space-y-1">
            {selected.items.length === 0 && <li className="text-sm text-hq-slate">No items yet.</li>}
            {selected.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.is_done}
                  disabled={busy}
                  onChange={(e) => handleToggleItem(item.id, e.target.checked)}
                  className="h-4 w-4 accent-hq-teal"
                />
                <span className={`text-sm ${item.is_done ? "text-hq-slate/60 line-through" : "text-hq-ink"}`}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
          <form onSubmit={handleAddItem} className="mt-3 flex gap-2">
            <input
              value={newItemLabel}
              onChange={(e) => setNewItemLabel(e.target.value)}
              placeholder="Add an item"
              className="flex-1 rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!newItemLabel.trim() || busy}
              className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Add
            </button>
          </form>
        </div>
      ) : (
        <>
          <form onSubmit={handleCreate} className="mt-3 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Launch checklist — YouTube channel"
              className="w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <textarea
              value={itemsText}
              onChange={(e) => setItemsText(e.target.value)}
              placeholder={"One item per line (optional)\ne.g. Create channel art\nWrite channel description"}
              rows={3}
              className="w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Create checklist
            </button>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </form>

          <ul className="mt-4 space-y-2">
            {checklists.length === 0 && <li className="text-sm text-hq-slate">No checklists yet.</li>}
            {checklists.map((cl) => (
              <li key={cl.id}>
                <button
                  onClick={() => openChecklist(cl.id)}
                  className="w-full rounded-lg bg-hq-parchment/50 p-3 text-left text-sm font-medium text-hq-ink hover:bg-hq-parchment/80"
                >
                  {cl.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
