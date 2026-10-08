"use client";

import { useEffect } from "react";
import { ExecutiveAssistantTasks } from "../ExecutiveAssistantTasks";
import { FinanceAgentPanel } from "../FinanceAgentPanel";
import { OperationsAgentChecklists } from "../OperationsAgentChecklists";
import { BusinessAnalystPanel } from "../BusinessAnalystPanel";
import { ChiefOfStaffPanel } from "../ChiefOfStaffPanel";

/**
 * The HQ view's agent detail slide-over for the five Operations Wing
 * agents (Milestone 7) — same visual chrome as MissionSlideOver/
 * ContentReviewSlideOver, but its body is literally the SAME self-
 * contained panel component Focus View already renders for that agent
 * (ExecutiveAssistantTasks, FinanceAgentPanel, etc.), not a second
 * display built from the same data. This is what makes "Office View and
 * Focus View stay synchronised" structurally guaranteed rather than
 * something that could drift: there is only ever one component per
 * agent, mounted in two different places, each doing its own real
 * fetch/mutate against the same real API routes.
 */
const AGENT_PANELS: Record<string, { label: string; Panel: () => JSX.Element }> = {
  chief_of_staff: { label: "Chief of Staff", Panel: ChiefOfStaffPanel },
  executive_assistant: { label: "Executive Assistant", Panel: ExecutiveAssistantTasks },
  finance_agent: { label: "Finance Agent", Panel: FinanceAgentPanel },
  business_analyst: { label: "Business Analyst", Panel: BusinessAnalystPanel },
  operations_agent: { label: "Operations Agent", Panel: OperationsAgentChecklists },
};

export function AgentDetailSlideOver({
  agentKey,
  onClose,
}: {
  agentKey: string | null;
  onClose: () => void;
}) {
  const open = agentKey !== null;
  const entry = agentKey ? AGENT_PANELS[agentKey] : undefined;

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-hq-ink/20 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-md transform bg-hq-cream shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Agent detail"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-hq-brass/20 p-4">
          <h2 className="font-display text-lg font-semibold text-hq-tealDark">{entry?.label ?? "Agent"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agent panel"
            className="rounded-md px-2 py-1 text-hq-slate hover:bg-hq-parchment"
          >
            ✕
          </button>
        </div>

        <div className="h-[calc(100%-57px)] overflow-y-auto p-4">
          {entry ? (
            <entry.Panel />
          ) : (
            <p className="text-sm text-hq-slate">Nothing to show yet.</p>
          )}
        </div>
      </div>
    </>
  );
}
