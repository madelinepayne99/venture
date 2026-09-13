import type { Agent } from "@/lib/db/types";

export function AgentRoster({ agents }: { agents: Agent[] }) {
  const active = agents.filter((a) => a.status === "active");
  const planned = agents.filter((a) => a.status === "planned");

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">The workforce</h2>

      <div className="mt-3 space-y-2">
        {active.map((agent) => (
          <div key={agent.id} className="rounded-lg bg-hq-teal/10 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-hq-teal" />
              <span className="font-medium text-hq-ink">{agent.name}</span>
            </div>
            <p className="mt-1 text-xs text-hq-slate">{agent.role_summary}</p>
          </div>
        ))}
      </div>

      {planned.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-hq-slate">
            Planned — not yet built
          </p>
          <ul className="mt-2 space-y-1">
            {planned.map((agent) => (
              <li key={agent.id} className="text-xs text-hq-slate/80">
                <span className="font-medium text-hq-slate">{agent.name}</span> — {agent.role_summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
