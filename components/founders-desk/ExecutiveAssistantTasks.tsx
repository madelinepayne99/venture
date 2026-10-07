"use client";

import { useEffect, useState } from "react";
import type { AgentTask } from "@/lib/db/types";

/**
 * Executive Assistant's one real capability (Operations Wing, Milestone 6):
 * internal founder tasks/reminders. Deliberately self-contained — fetches
 * and mutates its own state via /api/agent-tasks rather than being threaded
 * through FoundersDeskApp's existing mission-centric state, since this data
 * has nothing to do with missions. No external account connection exists
 * or is implied here.
 */
export function ExecutiveAssistantTasks() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/agent-tasks");
    if (!res.ok) return;
    const data = await res.json();
    setTasks(data.tasks ?? []);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) return;
    const res = await fetch("/api/agent-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed, dueAt: dueAt ? new Date(dueAt).toISOString() : null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not create that task.");
      return;
    }
    setTitle("");
    setDueAt("");
    await refresh();
  }

  async function handleAction(id: string, action: "complete" | "cancel") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/agent-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const open = tasks.filter((t) => t.state === "open" || t.state === "in_progress");
  const settled = tasks.filter((t) => t.state === "completed" || t.state === "cancelled");

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Executive Assistant — Tasks</h2>
      <p className="mt-1 text-xs text-hq-slate">
        Internal reminders only — no email or calendar account is connected yet.
      </p>

      <form onSubmit={handleCreate} className="mt-3 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Review monthly subscriptions"
          className="w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="flex-1 rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Add task
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      {loading ? (
        <p className="mt-3 text-sm text-hq-slate">Loading…</p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {open.length === 0 && <li className="text-sm text-hq-slate">No open tasks.</li>}
            {open.map((task) => (
              <li key={task.id} className="rounded-lg bg-hq-parchment/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-hq-ink">{task.title}</span>
                  <div className="flex gap-1">
                    <button
                      disabled={busyId === task.id}
                      onClick={() => handleAction(task.id, "complete")}
                      className="rounded-md bg-hq-teal px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Done
                    </button>
                    <button
                      disabled={busyId === task.id}
                      onClick={() => handleAction(task.id, "cancel")}
                      className="rounded-md border border-hq-slate/30 px-2 py-1 text-xs text-hq-slate disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                {task.due_at && (
                  <p className="mt-1 text-xs text-hq-slate">Due {new Date(task.due_at).toLocaleString()}</p>
                )}
              </li>
            ))}
          </ul>

          {settled.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-hq-slate">
                Completed/cancelled ({settled.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {settled.map((task) => (
                  <li key={task.id} className="text-xs text-hq-slate/70 line-through">
                    {task.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
