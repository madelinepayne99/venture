"use client";

export type FocusSection = "overview" | "employees" | "tasks" | "foundersDesk" | "finance" | "reports" | "settings";

const SECTIONS: { key: FocusSection; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "employees", label: "Employees" },
  { key: "tasks", label: "Tasks" },
  { key: "foundersDesk", label: "Founders' Desk" },
  { key: "finance", label: "Finance" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
];

/**
 * Focus View's real navigation (Mission 8 redesign) — replaces the old
 * flat three-column dump with seven clear sections. Purely a client-side
 * presentation preference (same pattern as FoundersDeskApp.tsx's own
 * view-mode/workspace localStorage choices) — it changes what's rendered,
 * never what data is fetched or what a founder is allowed to do.
 *
 * A horizontal tab strip rather than a sidebar: it degrades to a
 * horizontally-scrollable strip at phone width with no layout collapse
 * needed, and every tab stays one tap away instead of behind a hamburger.
 */
export function FocusNav({
  active,
  onChange,
  pendingReviewCount,
}: {
  active: FocusSection;
  onChange: (section: FocusSection) => void;
  /** Real, already-fetched Founders' Desk pending-review count — shown as a badge, never estimated. */
  pendingReviewCount: number;
}) {
  return (
    <nav
      aria-label="Focus View sections"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-focus-border bg-focus-ivory px-4 pb-px sm:mx-0 sm:px-0"
    >
      {SECTIONS.map((section) => {
        const isActive = section.key === active;
        return (
          <button
            key={section.key}
            type="button"
            onClick={() => onChange(section.key)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-emerald ${
              isActive
                ? "text-focus-emerald"
                : "text-focus-slate hover:text-focus-ink"
            }`}
          >
            {section.label}
            {section.key === "foundersDesk" && pendingReviewCount > 0 && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-focus-gold px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {pendingReviewCount}
              </span>
            )}
            {isActive && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-focus-emerald" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
