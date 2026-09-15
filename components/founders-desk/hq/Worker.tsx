"use client";

const TONE_COLORS: Record<"signed-in" | "peer" | "scout", { body: string; chair: string }> = {
  "signed-in": { body: "#0E5C57", chair: "#0E5C57" },
  peer: { body: "#C89B3C", chair: "#C89B3C" },
  scout: { body: "#0E5C57", chair: "#5B6670" },
};

/**
 * One stylised character sitting at a desk — a founder or Scout. The same
 * desk/chair/monitor/character shape is reused for both; only the tone
 * and head shape differ (round head + initial for a founder, a small
 * robot head for Scout), so a future cosmetic skin can restyle desks,
 * outfits, or props here without touching anywhere Worker is used.
 *
 * Idle motion is a barely-there "breathing" scale on the character —
 * present whether or not it's working, since it's meant to read as
 * "someone is here", not as an activity signal. `isWorking` (driven
 * exclusively by a real mission's state === "researching", see Room.tsx)
 * adds the monitor glow and a small hand-typing wiggle — the only signals
 * that ever indicate real activity. All animation is wrapped in
 * `motion-safe:` so it's fully absent under prefers-reduced-motion.
 */
export function Worker({
  kind,
  label,
  tone,
  isWorking,
  onClick,
  focusable = true,
}: {
  kind: "founder" | "scout";
  label: string;
  tone: "signed-in" | "peer" | "scout";
  isWorking: boolean;
  onClick?: () => void;
  focusable?: boolean;
}) {
  const { body, chair } = TONE_COLORS[tone];
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  const isInteractive = Boolean(onClick) && focusable;

  const scene = (
    <svg viewBox="0 0 140 150" className="h-[136px] w-[128px]" aria-hidden="true">
      {/* chair */}
      <rect x="42" y="16" width="56" height="58" rx="16" fill={chair} opacity="0.28" />

      <g className="origin-bottom motion-safe:animate-hq-breathe">
        <path d="M46 92 Q70 70 94 92 L94 110 L46 110 Z" fill={body} />

        {kind === "founder" ? (
          <>
            <circle cx="70" cy="54" r="19" fill={body} />
            <text
              x="70"
              y="60"
              textAnchor="middle"
              fontSize="16"
              fontWeight="700"
              fill="#FBF6EC"
              fontFamily="Georgia, serif"
            >
              {initial}
            </text>
            {tone === "signed-in" && (
              <circle cx="84" cy="66" r="4.5" fill="#1E7A4C" stroke="#FBF6EC" strokeWidth="2" />
            )}
          </>
        ) : (
          <>
            <rect x="55" y="36" width="30" height="26" rx="8" fill="#FBF6EC" />
            <rect x="60" y="25" width="20" height="14" rx="5" fill="#FBF6EC" />
            <circle cx="63" cy="49" r="2.6" fill="#20262B" />
            <circle cx="77" cy="49" r="2.6" fill="#20262B" />
            <rect x="63" y="56" width="14" height="3" rx="1.5" fill="#20262B" opacity="0.7" />
          </>
        )}

        <rect
          x="52"
          y="104"
          width="10"
          height="6"
          rx="2"
          fill={body}
          className={isWorking ? "motion-safe:animate-hq-bob" : ""}
        />
        <rect
          x="78"
          y="104"
          width="10"
          height="6"
          rx="2"
          fill={body}
          className={isWorking ? "motion-safe:animate-hq-bob" : ""}
          style={{ animationDelay: "0.15s" }}
        />
      </g>

      {/* desk */}
      <rect x="18" y="112" width="104" height="10" rx="3" fill="#9C7A2E" />
      <rect x="24" y="122" width="92" height="16" rx="2" fill="#7A5F24" opacity="0.85" />

      {/* monitor */}
      <rect x="52" y="76" width="36" height="28" rx="3" fill="#20262B" opacity="0.75" />
      <rect
        x="55"
        y="79"
        width="30"
        height="22"
        rx="2"
        fill={isWorking ? "#1E7A4C" : "#5B6670"}
        opacity={isWorking ? 0.9 : 0.6}
        className={isWorking ? "motion-safe:animate-hq-glow" : ""}
      />

      {isWorking && (
        <g>
          <circle cx="106" cy="70" r="5" fill="#1E7A4C" opacity="0.5" className="motion-safe:animate-ping" />
          <circle cx="106" cy="70" r="3.5" fill="#1E7A4C" />
        </g>
      )}
    </svg>
  );

  const nameplate = (
    <div className="mt-1 w-28 rounded-md bg-hq-tealDark py-1 text-center shadow-desk">
      <p className="truncate px-1 text-[11px] font-medium text-hq-cream">{label}</p>
      {kind === "scout" && (
        <p className="text-[9px] text-hq-cream/70">{isWorking ? "Researching…" : "Idle"}</p>
      )}
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} — ${isWorking ? "researching, open the mission" : "idle"}`}
        className="group flex flex-col items-center rounded-xl p-1 transition hover:bg-white/40"
      >
        {scene}
        {nameplate}
      </button>
    );
  }

  const idleOrWorkingLabel = kind === "scout" ? `Scout — ${isWorking ? "researching" : "idle"}` : label;

  return (
    <div className="flex flex-col items-center" aria-label={idleOrWorkingLabel}>
      {scene}
      {nameplate}
    </div>
  );
}
