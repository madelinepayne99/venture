import type { ReactNode } from "react";

/**
 * Shared, reusable building blocks for every Focus View section (Mission
 * 8 redesign) — one real set of cards/states/typography rather than each
 * section inventing its own, so spacing, color, and empty/error/loading
 * treatment stay genuinely consistent across Overview/Employees/Tasks/
 * Founders' Desk/Finance/Reports/Settings.
 */

export function FocusCard({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-focus-border bg-focus-card shadow-sm ${padded ? "p-5 sm:p-6" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function FocusSectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="font-display text-xl font-semibold text-focus-emerald">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-focus-slate">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function FocusEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-focus-border bg-focus-ivory/60 px-5 py-8 text-center">
      <p className="font-medium text-focus-ink">{title}</p>
      <p className="mt-1 text-sm text-focus-slate">{body}</p>
    </div>
  );
}

export function FocusErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-status-danger/30 bg-red-50 px-4 py-3 text-sm text-status-danger">
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 whitespace-nowrap rounded-md border border-status-danger/40 px-2.5 py-1 text-xs font-medium hover:bg-status-danger/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function FocusLoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-1 py-6 text-sm text-focus-slate" role="status" aria-live="polite">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-focus-border border-t-focus-emerald"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

/** A real figure, large and legible — never a fabricated or placeholder number. Pass null while genuinely unknown (renders a dash, not a fake 0). */
export function FocusStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number | null;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "text-status-danger" : tone === "warning" ? "text-focus-goldText" : "text-focus-emerald";
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-focus-slate">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold ${toneClass}`}>{value ?? "—"}</p>
    </div>
  );
}
