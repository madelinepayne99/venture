"use client";

import { useId } from "react";

const TONE_COLORS: Record<
  "signed-in" | "peer" | "scout",
  { body: string; bodyShade: string; chair: string; rim: string }
> = {
  "signed-in": { body: "#0E5C57", bodyShade: "#0A3F3C", chair: "#0E5C57", rim: "#C89B3C" },
  peer: { body: "#8A6A2E", bodyShade: "#6B5222", chair: "#9C7A2E", rim: "#C89B3C" },
  scout: { body: "#3E4C47", bodyShade: "#2A3531", chair: "#3E4C47", rim: "#7FBBAE" },
};

/**
 * One stylised character sitting at a proper desk — a founder or Scout.
 * The same desk/chair/monitor/lamp/character composition is reused for
 * both; only the tone, hair silhouette (founders) or visor/antenna
 * (Scout), and desk prop differ, so a future cosmetic skin can restyle
 * outfits, hairstyles, or desk decor here without touching anywhere
 * Worker is used or how its real-state wiring works.
 *
 * Idle motion is a barely-there "breathing" scale on the character plus a
 * gently flickering desk-lamp glow — present whether or not it's working,
 * since it's meant to read as "someone is here", not as an activity
 * signal. `isWorking` (driven exclusively by a real mission's
 * state === "researching", see Room.tsx) is the only thing that adds the
 * monitor's bright glow and a small hand-typing wiggle. All animation is
 * wrapped in `motion-safe:` so it's fully absent under
 * prefers-reduced-motion — the working state itself (bright screen,
 * present status dot) still reads without any animation.
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
  const uid = useId();
  const deskGradId = `${uid}-desk`;
  const screenGradId = `${uid}-screen`;
  const { body, bodyShade, chair, rim } = TONE_COLORS[tone];
  const isInteractive = Boolean(onClick) && focusable;

  const scene = (
    <svg viewBox="0 0 170 165" className="h-[150px] w-[156px]" aria-hidden="true">
      <defs>
        <linearGradient id={deskGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8A6A2E" />
          <stop offset="100%" stopColor="#5A431E" />
        </linearGradient>
        <linearGradient id={screenGradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={isWorking ? "#2FA57F" : "#3A4A44"} />
          <stop offset="100%" stopColor={isWorking ? "#12523F" : "#20302A"} />
        </linearGradient>
      </defs>

      {/* contact shadow */}
      <ellipse cx="78" cy="152" rx="58" ry="8" fill="#000000" opacity="0.32" />

      {/* chair */}
      <path d="M46 20 Q46 8 58 8 L98 8 Q110 8 110 20 L110 100 L46 100 Z" fill={chair} opacity="0.22" />
      <rect x="38" y="86" width="8" height="26" rx="3" fill={chair} opacity="0.3" />
      <rect x="110" y="86" width="8" height="26" rx="3" fill={chair} opacity="0.3" />

      <g className="origin-bottom motion-safe:animate-hq-breathe">
        {/* torso shadow layer for a touch of volume */}
        <path d="M44 132 Q78 104 112 132 L112 118 Q78 96 44 118 Z" fill={bodyShade} />
        {/* torso / blazer */}
        <path d="M44 132 L44 122 Q78 100 112 122 L112 132 Q112 140 104 143 L52 143 Q44 140 44 132 Z" fill={body} />
        {/* collar / shirt notch */}
        <path d="M70 110 L78 122 L86 110 L82 108 L78 116 L74 108 Z" fill="#EFE6CF" opacity="0.85" />
        {/* rim light along one shoulder */}
        <path d="M104 118 Q112 122 112 132" fill="none" stroke={rim} strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />

        {kind === "founder" ? (
          <>
            <ellipse cx="78" cy="80" rx="18" ry="20" fill={body} />
            <ellipse cx="78" cy="80" rx="18" ry="20" fill={bodyShade} opacity="0.25" />
            {tone === "signed-in" ? (
              <path
                d="M58 76 Q60 54 78 54 Q98 54 98 76 Q98 62 86 60 Q76 58 68 64 Q60 68 58 76 Z"
                fill="#1A1E1C"
              />
            ) : (
              <path
                d="M56 78 Q54 50 78 50 Q102 50 100 78 Q100 68 92 72 Q90 60 78 60 Q66 60 64 72 Q58 68 56 78 Z"
                fill="#3A2A18"
              />
            )}
            <ellipse cx="71" cy="72" rx="5" ry="4" fill="#FFFFFF" opacity="0.14" />
            {tone === "signed-in" && (
              <circle cx="93" cy="92" r="5" fill="#1E7A4C" stroke="#141917" strokeWidth="2" />
            )}
          </>
        ) : (
          <>
            {/* Scout — a compact worker-bot head with a single visor band and a small antenna */}
            <rect x="58" y="52" width="40" height="34" rx="10" fill={body} />
            <rect x="58" y="52" width="40" height="34" rx="10" fill="none" stroke={rim} strokeOpacity="0.5" strokeWidth="1.2" />
            <rect x="63" y="65" width="30" height="8" rx="4" fill={isWorking ? "#8FE3C8" : "#5C6B65"} className={isWorking ? "motion-safe:animate-hq-glow" : ""} />
            <line x1="78" y1="52" x2="78" y2="42" stroke={body} strokeWidth="3" strokeLinecap="round" />
            <circle
              cx="78"
              cy="40"
              r="4"
              fill={isWorking ? "#8FE3C8" : rim}
              className={isWorking ? "motion-safe:animate-hq-glow" : ""}
            />
            {/* panel lines for a mechanical feel */}
            <line x1="66" y1="80" x2="90" y2="80" stroke={bodyShade} strokeWidth="1.4" opacity="0.6" />
          </>
        )}

        {/* hands / arms */}
        <rect
          x="52"
          y="128"
          width="12"
          height="7"
          rx="3"
          fill={bodyShade}
          className={isWorking ? "motion-safe:animate-hq-bob" : ""}
        />
        <rect
          x="92"
          y="128"
          width="12"
          height="7"
          rx="3"
          fill={bodyShade}
          className={isWorking ? "motion-safe:animate-hq-bob" : ""}
          style={{ animationDelay: "0.15s" }}
        />
      </g>

      {/* desk */}
      <rect x="20" y="138" width="136" height="8" rx="2" fill="#3A2C15" />
      <rect x="24" y="146" width="128" height="16" rx="2" fill={`url(#${deskGradId})`} />
      <line x1="50" y1="146" x2="50" y2="162" stroke="#3A2C15" strokeOpacity="0.5" />
      <line x1="120" y1="146" x2="120" y2="162" stroke="#3A2C15" strokeOpacity="0.5" />

      {/* desk lamp */}
      <g>
        <ellipse
          cx="34"
          cy="128"
          rx="24"
          ry="11"
          fill="#E8B15A"
          opacity="0.22"
          className="motion-safe:animate-hq-flicker"
        />
        <path d="M30 138 L30 116 Q30 108 40 106" fill="none" stroke="#2A2015" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 106 L54 100 L52 112 Z" fill="#C89B3C" />
        <circle cx="46" cy="106" r="2.4" fill="#FCEBC2" className="motion-safe:animate-hq-flicker" />
      </g>

      {/* monitor */}
      <rect x="60" y="96" width="46" height="36" rx="4" fill="#111917" />
      <rect x="64" y="100" width="38" height="28" rx="2" fill={`url(#${screenGradId})`} />
      <line x1="67" y1="103" x2="86" y2="103" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="2" />
      <rect x="78" y="132" width="10" height="7" fill="#111917" />
      <rect x="70" y="139" width="26" height="4" rx="2" fill="#111917" />

      {isWorking && (
        <g>
          <circle cx="112" cy="90" r="5.5" fill="#1E7A4C" opacity="0.5" className="motion-safe:animate-ping" />
          <circle cx="112" cy="90" r="3.8" fill="#1E7A4C" />
        </g>
      )}

      {/* desk prop */}
      {kind === "founder" ? (
        <g transform="translate(128, 138)">
          <rect x="0" y="0" width="18" height="4" fill="#EFE6CF" opacity="0.9" />
          <rect x="1" y="-3" width="16" height="4" fill="#F3EEDD" opacity="0.75" />
          <rect x="2" y="-6" width="14" height="4" fill="#EFE6CF" opacity="0.6" />
        </g>
      ) : (
        <g transform="translate(126, 128)">
          <rect x="0" y="10" width="10" height="16" rx="1" fill="#12433D" />
          <rect x="11" y="10" width="10" height="16" rx="1" fill="#0E5C57" />
          <circle cx="24" cy="8" r="6" fill="none" stroke="#C89B3C" strokeWidth="2" />
          <line x1="28.2" y1="12.2" x2="33" y2="17" stroke="#C89B3C" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );

  const nameplate = (
    <div className="mt-1 w-28 rounded-md bg-night-panel px-1 py-1 text-center shadow-desk">
      <p className="truncate px-1 text-[11px] font-medium text-night-text">{label}</p>
      {kind === "scout" && (
        <p className="text-[9px] text-night-textDim">{isWorking ? "Researching…" : "Idle"}</p>
      )}
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} — ${isWorking ? "researching, open the mission" : "idle"}`}
        className="group flex flex-col items-center rounded-xl p-1 transition hover:bg-white/5"
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
