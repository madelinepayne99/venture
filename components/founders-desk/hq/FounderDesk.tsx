// A tasteful, generic personal anchor for a founder — an initial-in-circle
// avatar over a small nameplate desk. No photo required, no cosmetic
// purchases: purely a stylised presence marker driven by the real
// founders table (see lib/db/repositories.ts's listFounders).
export function FounderDesk({
  name,
  isSignedInFounder,
}: {
  name: string;
  isSignedInFounder: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-full font-display text-xl font-semibold text-white shadow-desk ${
          isSignedInFounder ? "bg-hq-teal" : "bg-hq-brass"
        }`}
      >
        {initial}
        {isSignedInFounder && (
          <span
            className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-hq-cream bg-status-success"
            title="Currently signed in"
          />
        )}
      </div>
      <div className="w-28 rounded-md bg-hq-tealDark py-2 text-center shadow-desk">
        <span className="truncate px-1 text-xs font-medium text-hq-cream">{name}</span>
      </div>
    </div>
  );
}
