"use client";

import { useEffect, useState } from "react";
import type { ChiefOfStaffGoal, ChiefOfStaffGoalWithSubtasks } from "@/lib/db/types";

// Must stay in sync with DELEGATABLE_AGENT_KEYS in
// lib/domain/chiefOfStaffWorkflow.ts (a server-only module, so its
// constant can't be imported directly into this client component).
// Scout/Content Bot are deliberately not here — see that file's own
// doc comment for why.
const DELEGATABLE_AGENTS: Array<{ key: string; label: string }> = [
  { key: "executive_assistant", label: "Executive Assistant" },
  { key: "finance_agent", label: "Finance Agent" },
  { key: "operations_agent", label: "Operations Agent" },
  { key: "business_analyst", label: "Business Analyst" },
];

interface DraftSubtask {
  agentKey: string;
  title: string;
}

/**
 * Chief of Staff's one real capability (Operations Wing, Milestone 6):
 * breaking a founder goal into subtasks delegated to the other active
 * agents. Each subtask is a real agent_tasks row (see
 * chiefOfStaffWorkflow.ts) — completing/cancelling one reuses the
 * existing /api/agent-tasks/[id] route directly, no new mutation here.
 */
export function ChiefOfStaffPanel() {
  const [goals, setGoals] = useState<ChiefOfStaffGoal[]>([]);
  const [selected, setSelected] = useState<ChiefOfStaffGoalWithSubtasks | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>([{ agentKey: DELEGATABLE_AGENTS[0]!.key, title: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  async function refreshList() {
    const res = await fetch("/api/chief-of-staff/goals");
    if (!res.ok) return;
    const data = await res.json();
    setGoals(data.goals ?? []);
  }

  async function openGoal(id: string) {
    const res = await fetch(`/api/chief-of-staff/goals/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setSelected(data.goal);
  }

  useEffect(() => {
    refreshList().finally(() => setLoading(false));
  }, []);

  function updateSubtask(index: number, field: keyof DraftSubtask, value: string) {
    setSubtasks((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    const realSubtasks = subtasks
      .map((s) => ({ agentKey: s.agentKey, title: s.title.trim() }))
      .filter((s) => s.title);
    if (!trimmedTitle || realSubtasks.length === 0) return;

    const res = await fetch("/api/chief-of-staff/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmedTitle, subtasks: realSubtasks }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not create that goal.");
      return;
    }
    setTitle("");
    setSubtasks([{ agentKey: DELEGATABLE_AGENTS[0]!.key, title: "" }]);
    await refreshList();
  }

  async function handleSubtaskAction(taskId: string, action: "complete" | "cancel") {
    if (!selected) return;
    setBusyTaskId(taskId);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await openGoal(selected.id);
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Chief of Staff — Delegation</h2>
      <p className="mt-1 text-xs text-hq-slate">
        Breaks a goal into real subtasks delegated to the other agents. Never delegates to Scout or Content
        Bot.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-hq-slate">Loading…</p>
      ) : selected ? (
        <div className="mt-3">
          <button onClick={() => setSelected(null)} className="text-xs font-medium text-hq-teal">
            ← Back to goals
          </button>
          <h3 className="mt-2 text-sm font-semibold text-hq-ink">{selected.title}</h3>
          <ul className="mt-2 space-y-2">
            {selected.subtasks.map((task) => {
              const agentLabel = DELEGATABLE_AGENTS.find((a) => a.key === task.agent_key)?.label ?? task.agent_key;
              const settled = task.state === "completed" || task.state === "cancelled";
              return (
                <li key={task.id} className="rounded-lg bg-hq-parchment/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={`text-sm font-medium ${settled ? "text-hq-slate/60 line-through" : "text-hq-ink"}`}>
                        {task.title}
                      </p>
                      <p className="text-xs text-hq-slate">Delegated to {agentLabel} — {task.state}</p>
                    </div>
                    {!settled && (
                      <div className="flex gap-1">
                        <button
                          disabled={busyTaskId === task.id}
                          onClick={() => handleSubtaskAction(task.id, "complete")}
                          className="rounded-md bg-hq-teal px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Done
                        </button>
                        <button
                          disabled={busyTaskId === task.id}
                          onClick={() => handleSubtaskAction(task.id, "cancel")}
                          className="rounded-md border border-hq-slate/30 px-2 py-1 text-xs text-hq-slate disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <>
          <form onSubmit={handleCreate} className="mt-3 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Goal, e.g. Launch our first YouTube channel"
              className="w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <div className="space-y-2">
              {subtasks.map((subtask, index) => (
                <div key={index} className="flex gap-2">
                  <select
                    value={subtask.agentKey}
                    onChange={(e) => updateSubtask(index, "agentKey", e.target.value)}
                    className="rounded-md border border-hq-brass/30 px-2 py-2 text-xs"
                  >
                    {DELEGATABLE_AGENTS.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={subtask.title}
                    onChange={(e) => updateSubtask(index, "title", e.target.value)}
                    placeholder="Subtask title"
                    className="flex-1 rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSubtasks((prev) => [...prev, { agentKey: DELEGATABLE_AGENTS[0]!.key, title: "" }])}
                className="text-xs font-medium text-hq-teal"
              >
                + Add another subtask
              </button>
            </div>
            <button
              type="submit"
              disabled={!title.trim() || !subtasks.some((s) => s.title.trim())}
              className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Delegate
            </button>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </form>

          <ul className="mt-4 space-y-2">
            {goals.length === 0 && <li className="text-sm text-hq-slate">No goals yet.</li>}
            {goals.map((goal) => (
              <li key={goal.id}>
                <button
                  onClick={() => openGoal(goal.id)}
                  className="w-full rounded-lg bg-hq-parchment/50 p-3 text-left text-sm font-medium text-hq-ink hover:bg-hq-parchment/80"
                >
                  {goal.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
