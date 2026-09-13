"use client";

import { useState } from "react";
import type { Agent, Founder, LedgerEntry, Mission } from "@/lib/db/types";
import { StatusBadge } from "./StatusBadge";
import { MissionForm } from "./MissionForm";
import { MissionDetail, type MissionDetailData } from "./MissionDetail";
import { AgentRoster } from "./AgentRoster";
import { Ledger } from "./Ledger";

interface Props {
  initialFounders: Founder[];
  initialAgents: Agent[];
  initialMissions: Mission[];
  initialLedgerEntries: LedgerEntry[];
  initialLedgerTotal: number;
}

export function FoundersDeskApp({
  initialFounders,
  initialAgents,
  initialMissions,
  initialLedgerEntries,
  initialLedgerTotal,
}: Props) {
  const [founders] = useState(initialFounders);
  const [agents] = useState(initialAgents);
  const [missions, setMissions] = useState(initialMissions);
  const [ledgerEntries, setLedgerEntries] = useState(initialLedgerEntries);
  const [ledgerTotal, setLedgerTotal] = useState(initialLedgerTotal);
  const [actingFounderId, setActingFounderId] = useState(founders[0]?.id ?? "");
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [missionDetail, setMissionDetail] = useState<MissionDetailData | null>(null);
  const [busyMissionId, setBusyMissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshMissions() {
    const res = await fetch("/api/missions");
    const data = await res.json();
    setMissions(data.missions);
  }

  async function refreshLedger() {
    const res = await fetch("/api/ledger");
    const data = await res.json();
    setLedgerEntries(data.entries);
    setLedgerTotal(data.totalUsd);
  }

  async function loadDetail(missionId: string) {
    setSelectedMissionId(missionId);
    const res = await fetch(`/api/missions/${missionId}`);
    if (res.ok) {
      setMissionDetail(await res.json());
    }
  }

  async function handleCreate(title: string, brief: string) {
    setError(null);
    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, brief, founderId: actingFounderId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create the mission.");
      return;
    }
    await refreshMissions();
    await loadDetail(data.mission.id);
  }

  async function handleApprove(missionId: string) {
    setError(null);
    setBusyMissionId(missionId);
    try {
      const res = await fetch(`/api/missions/${missionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ founderId: actingFounderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not approve the mission.");
        return;
      }
      await refreshMissions();
      await refreshLedger();
      if (selectedMissionId === missionId) await loadDetail(missionId);
    } finally {
      setBusyMissionId(null);
    }
  }

  async function handleCancel(missionId: string) {
    setError(null);
    setBusyMissionId(missionId);
    try {
      const res = await fetch(`/api/missions/${missionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ founderId: actingFounderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not cancel the mission.");
        return;
      }
      await refreshMissions();
      if (selectedMissionId === missionId) await loadDetail(missionId);
    } finally {
      setBusyMissionId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-hq-tealDark">Venture HQ</h1>
          <p className="mt-1 text-sm text-hq-slate">
            The founders&apos; desk — genuine missions, genuine agents, genuine results.
          </p>
        </div>
        <label className="text-sm text-hq-slate">
          Acting as{" "}
          <select
            className="ml-2 rounded-md border border-hq-brass/40 bg-white px-2 py-1 font-medium text-hq-ink"
            value={actingFounderId}
            onChange={(e) => setActingFounderId(e.target.value)}
          >
            {founders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-status-danger/30 bg-red-50 px-4 py-3 text-sm text-status-danger">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr_420px]">
        <aside className="space-y-6">
          <AgentRoster agents={agents} />
          <Ledger entries={ledgerEntries} totalUsd={ledgerTotal} />
        </aside>

        <section className="space-y-6">
          <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
            <h2 className="font-display text-lg font-semibold text-hq-ink">Create a mission</h2>
            <p className="mt-1 text-sm text-hq-slate">
              Give Scout a brief. It will come back with an honest, evidence-labeled research
              report — never a guaranteed outcome.
            </p>
            <MissionForm onSubmit={handleCreate} />
          </div>

          <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
            <h2 className="font-display text-lg font-semibold text-hq-ink">Missions</h2>
            {missions.length === 0 ? (
              <p className="mt-3 text-sm text-hq-slate">No missions yet — create the first one above.</p>
            ) : (
              <ul className="mt-3 divide-y divide-hq-brass/10">
                {missions.map((mission) => (
                  <li key={mission.id} className="py-3">
                    <button
                      onClick={() => loadDetail(mission.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left transition hover:bg-hq-parchment/60 ${
                        selectedMissionId === mission.id ? "bg-hq-parchment/80" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-hq-ink">{mission.title}</span>
                        <StatusBadge state={mission.state} />
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-hq-slate">{mission.brief}</p>
                    </button>

                    <div className="mt-2 flex gap-2 px-3">
                      {mission.state === "awaiting_founder_approval" && (
                        <button
                          disabled={busyMissionId === mission.id}
                          onClick={() => handleApprove(mission.id)}
                          className="rounded-md bg-hq-teal px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {busyMissionId === mission.id ? "Sending Scout…" : "Approve & send Scout"}
                        </button>
                      )}
                      {["draft", "awaiting_founder_approval", "queued", "researching", "ready_for_founders_review", "awaiting_evidence"].includes(
                        mission.state,
                      ) && (
                        <button
                          disabled={busyMissionId === mission.id}
                          onClick={() => handleCancel(mission.id)}
                          className="rounded-md border border-hq-slate/30 px-3 py-1 text-xs font-medium text-hq-slate disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside>
          <MissionDetail detail={missionDetail} />
        </aside>
      </div>
    </main>
  );
}
