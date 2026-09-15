// Scout's desk in the HQ scene. Its "working" state is driven by exactly
// one real signal — a mission whose state is genuinely "researching" — and
// nothing else. There is no invented animation for queued, approved-but-
// not-yet-started, or any other state: idle means idle.
export function ScoutDesk({
  isWorking,
  onClick,
}: {
  isWorking: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl shadow-desk ${
          isWorking ? "bg-hq-teal" : "bg-hq-slate/60"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
          <rect x="5" y="8" width="14" height="11" rx="2.5" fill="white" opacity="0.95" />
          <rect x="9" y="3" width="6" height="6" rx="2" fill="white" opacity="0.95" />
          <circle cx="9.5" cy="13" r="1.3" fill="currentColor" className="text-hq-ink" />
          <circle cx="14.5" cy="13" r="1.3" fill="currentColor" className="text-hq-ink" />
          <rect x="9" y="16" width="6" height="1.4" rx="0.7" fill="currentColor" className="text-hq-ink" opacity="0.7" />
        </svg>
        {isWorking && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-hq-cream bg-status-success" />
          </span>
        )}
      </div>
      <div className="w-28 rounded-md bg-white/85 py-2 text-center shadow-desk">
        <p className="text-xs font-semibold text-hq-ink">Scout</p>
        <p className="text-[10px] text-hq-slate">{isWorking ? "Researching…" : "Idle"}</p>
      </div>
    </>
  );

  if (!isWorking || !onClick) {
    return (
      <div className="flex flex-col items-center gap-2 opacity-90" aria-label="Scout — idle">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scout is researching — open the mission"
      className="group flex flex-col items-center gap-2 rounded-xl p-1 transition hover:bg-white/40"
    >
      {body}
    </button>
  );
}
