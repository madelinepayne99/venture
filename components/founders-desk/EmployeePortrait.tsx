import type { EmployeeDefinition } from "@/lib/agents/employeeRegistry";

/**
 * Shared portrait rendering — extracted from EmployeeDirectory.tsx
 * (Mission 8 Focus View redesign) so the new, spacious Employees section
 * and the existing compact overlay bar render identical real portraits
 * from one place rather than two copies drifting apart. Behavior-
 * preserving: EmployeeDirectory.tsx's own rendering is byte-for-byte
 * unchanged by this extraction, just re-imported.
 */

/**
 * A plain, honestly-generic silhouette for the three not-yet-built future
 * employees — "same visual family" (the rounded capsule head every real
 * agent shares) without claiming a specific, founder-approved character
 * design that doesn't exist yet. Deliberately plainer than a real
 * portrait (muted, featureless) so it never reads as finished art.
 */
export function ComingSoonSilhouette({ accentColor }: { accentColor: string }) {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
      <rect width="64" height="64" rx="32" fill="#EDE6D4" />
      <path
        d="M32 14c-8 0-13 5.6-13 13.6 0 5 2.2 8 4.6 9.8-5.4 2-9.6 5.8-10.8 10.6a1.4 1.4 0 0 0 1.36 1.75h35.68a1.4 1.4 0 0 0 1.36-1.75c-1.2-4.8-5.4-8.6-10.8-10.6 2.4-1.8 4.6-4.8 4.6-9.8C45 19.6 40 14 32 14Z"
        fill={accentColor}
        opacity={0.28}
      />
      <circle cx="26.5" cy="27" r="2.6" fill={accentColor} opacity={0.55} />
      <circle cx="37.5" cy="27" r="2.6" fill={accentColor} opacity={0.55} />
    </svg>
  );
}

export function EmployeePortrait({
  definition,
  size,
  frameClassName = "border-hq-brass/30 bg-hq-parchment",
}: {
  definition: EmployeeDefinition;
  size: "sm" | "lg";
  /** Border + background classes around the portrait circle — override to match a different surface (e.g. Focus View's ivory/emerald palette) without changing EmployeeDirectory's own look. */
  frameClassName?: string;
}) {
  const dimension = size === "sm" ? "h-14 w-14" : "h-20 w-20";
  const faded = definition.implementationStatus === "coming_soon";
  return (
    <span
      className={`relative block ${dimension} shrink-0 overflow-hidden rounded-full border shadow-desk ${frameClassName}`}
      style={{ opacity: faded ? 0.75 : 1 }}
      aria-hidden="true"
    >
      {definition.portraitUrl ? (
        // A real static image rendered from the approved 3D rig — see
        // employeeRegistry.ts's own doc comment on portraitUrl. Plain
        // <img>, not next/image: these are small, fixed-size, locally
        // hosted assets where Next's remote-optimization pipeline buys
        // nothing.
        <img src={definition.portraitUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <ComingSoonSilhouette accentColor={definition.accentColor} />
      )}
    </span>
  );
}
