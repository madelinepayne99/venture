import type { LedgerEntry } from "@/lib/db/types";

export function Ledger({ entries, totalUsd }: { entries: LedgerEntry[]; totalUsd: number }) {
  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-hq-ink">Business ledger</h2>
        <span className="text-sm font-semibold text-hq-tealDark">
          {totalUsd < 0 ? "−" : ""}${Math.abs(totalUsd).toFixed(4)}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-hq-slate">No spend recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between text-xs">
              <span className="text-hq-slate">{entry.description}</span>
              <span className={entry.amount_usd < 0 ? "text-status-danger" : "text-status-success"}>
                {entry.amount_usd < 0 ? "−" : "+"}${Math.abs(entry.amount_usd).toFixed(4)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
