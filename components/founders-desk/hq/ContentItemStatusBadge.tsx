import type { ContentItemState } from "@/lib/db/types";
import { CONTENT_ITEM_STATE_LABELS } from "@/lib/domain/contentItemStates";

const STATE_STYLES: Record<ContentItemState, string> = {
  planning: "bg-hq-brass/20 text-hq-brassDark",
  generating: "bg-hq-teal/15 text-hq-teal",
  blocked: "bg-amber-100 text-amber-800",
  awaiting_review: "bg-sky-100 text-sky-800",
  revision_requested: "bg-amber-100 text-amber-800",
  ready_to_publish: "bg-emerald-100 text-emerald-800",
  publishing: "bg-hq-teal/15 text-hq-teal",
  publish_failed: "bg-red-100 text-red-800",
  published: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-hq-parchment text-hq-slate",
};

export function ContentItemStatusBadge({ state }: { state: ContentItemState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${STATE_STYLES[state]}`}
    >
      {CONTENT_ITEM_STATE_LABELS[state]}
    </span>
  );
}
