"use client";

import type { CostEntry } from "@/lib/db/types";

// Mirrors lib/domain/contentProduction.ts's MAX_ITEM_SPEND_USD exactly —
// duplicated here (not imported) because that module is `server-only` and
// this is a client component; this is a display-only figure, never used
// to enforce anything (enforcement stays entirely server-side).
const DISPLAY_MAX_ITEM_SPEND_USD = 8.0;

export function ContentCostSummary({ costs, spentUsd }: { costs: CostEntry[]; spentUsd: number }) {
  const unpriced = costs.filter((c) => c.usd_cost === null).length;
  return (
    <p className="text-xs text-hq-slate">
      ${spentUsd.toFixed(4)} of ${DISPLAY_MAX_ITEM_SPEND_USD.toFixed(2)} budget across {costs.length} real call
      {costs.length === 1 ? "" : "s"}
      {unpriced > 0 && ` (${unpriced} call${unpriced === 1 ? "" : "s"} unpriced, not included above)`}
    </p>
  );
}
