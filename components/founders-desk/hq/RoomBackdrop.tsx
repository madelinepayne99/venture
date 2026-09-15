"use client";

import { useId } from "react";
import type { WorkspaceType } from "@/lib/db/types";

/**
 * Purely decorative "cutaway" room shell — a dark, cinematic office at
 * night: charcoal walls with a forest-green undertone, a warm brass/gold
 * light pool over the desks, windows onto an abstract lit skyline, a
 * bookshelf, a wall flourish, a low back console, and plants. Colors
 * (and the wall flourish/shelf trim) are the only things that vary by
 * workspace type; the structure is shared, so a future cosmetic skin only
 * needs to extend `ROOM_PALETTES` — a "salon", "garage", or "site office"
 * skin is a new palette entry, not a rebuilt room.
 */
const ROOM_PALETTES: Record<
  WorkspaceType,
  {
    wall: string;
    wallShade: string;
    floorLight: string;
    floorDark: string;
    skyTop: string;
    skyBottom: string;
    accent: string;
    accent2: string;
    litWindow: string;
  }
> = {
  commerce: {
    wall: "#1B2420",
    wallShade: "#121A17",
    floorLight: "#2C2116",
    floorDark: "#160F09",
    skyTop: "#0F141C",
    skyBottom: "#3B2A1C",
    accent: "#C89B3C",
    accent2: "#12433D",
    litWindow: "#E8B15A",
  },
  service_business: {
    wall: "#16211D",
    wallShade: "#0F1815",
    floorLight: "#202F2A",
    floorDark: "#111C18",
    skyTop: "#0C131C",
    skyBottom: "#28394A",
    accent: "#C89B3C",
    accent2: "#173F38",
    litWindow: "#E8C878",
  },
};

// Fixed (not random) so server and client markup always match — a small
// scatter of "lit windows" across each skyline silhouette.
const LIT_WINDOWS: Array<{ x: number; y: number; w: number; h: number; delay: number }> = [
  { x: 13, y: 98, w: 5, h: 7, delay: 0 },
  { x: 13, y: 114, w: 5, h: 7, delay: 0.6 },
  { x: 22, y: 132, w: 5, h: 6, delay: 1.2 },
  { x: 46, y: 66, w: 5, h: 7, delay: 0.3 },
  { x: 46, y: 82, w: 5, h: 7, delay: 1.6 },
  { x: 55, y: 100, w: 5, h: 6, delay: 0.9 },
  { x: 46, y: 128, w: 5, h: 7, delay: 2.1 },
  { x: 74, y: 112, w: 5, h: 6, delay: 0.4 },
  { x: 83, y: 128, w: 5, h: 6, delay: 1.4 },
  { x: 74, y: 144, w: 5, h: 6, delay: 2.4 },
  { x: 108, y: 82, w: 5, h: 6, delay: 0.7 },
  { x: 108, y: 98, w: 5, h: 6, delay: 1.9 },
  { x: 116, y: 118, w: 5, h: 6, delay: 0.2 },
];

export function RoomBackdrop({ variant }: { variant: WorkspaceType }) {
  // Unique per mounted instance — the HQ carousel renders more than one
  // room at once (for the slide transition), so gradient/clip/mask ids
  // must never collide between them.
  const uid = useId();
  const palette = ROOM_PALETTES[variant];
  const skyId = `${uid}-sky`;
  const floorId = `${uid}-floor`;
  const vignetteId = `${uid}-vignette`;
  const spotId = `${uid}-spot`;
  const winClipIds = [`${uid}-win-0`, `${uid}-win-1`, `${uid}-win-2`];

  return (
    <svg
      viewBox="0 0 1000 520"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.skyTop} />
          <stop offset="100%" stopColor={palette.skyBottom} />
        </linearGradient>
        <linearGradient id={floorId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.floorLight} />
          <stop offset="100%" stopColor={palette.floorDark} />
        </linearGradient>
        <radialGradient id={spotId} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor={palette.accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor={palette.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={vignetteId} cx="50%" cy="42%" r="75%">
          <stop offset="55%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.45" />
        </radialGradient>
        {winClipIds.map((id) => (
          <clipPath id={id} key={id}>
            <rect x="0" y="0" width="150" height="160" rx="4" />
          </clipPath>
        ))}
      </defs>

      {/* Ceiling shadow — the underside of the floor above, the "front
          wall removed" cutaway edge a dollhouse view relies on. */}
      <rect x="0" y="0" width="1000" height="34" fill="#000000" opacity="0.35" />

      {/* Back wall */}
      <rect x="0" y="30" width="1000" height="310" fill={palette.wall} />
      {/* A soft warm light pool over the desks, like a stage wash */}
      <rect x="0" y="30" width="1000" height="310" fill={`url(#${spotId})`} />

      {/* Side walls — thin shaded strips suggesting the room turning
          away from the camera, without a full 3D perspective. */}
      <polygon points="0,30 40,30 40,340 0,340" fill={palette.wallShade} opacity="0.9" />
      <polygon points="960,30 1000,30 1000,340 960,340" fill={palette.wallShade} opacity="0.9" />

      {/* Windows onto an abstract, lit-up night skyline — never a literal
          or copyrighted skyline, just simple building silhouettes with a
          scatter of warm lit windows. */}
      {[90, 425, 760].map((x, i) => (
        <g key={x} transform={`translate(${x}, 60)`}>
          <rect x="-10" y="-10" width="170" height="180" rx="6" fill={palette.accent} opacity="0.28" />
          <rect x="-6" y="-6" width="162" height="172" rx="5" fill="#0A0E0C" />
          <g clipPath={`url(#${winClipIds[i]})`}>
            <rect width="150" height="160" fill={`url(#${skyId})`} />
            <rect x="10" y="90" width="24" height="70" fill={palette.wallShade} />
            <rect x="42" y="60" width="20" height="100" fill={palette.wallShade} />
            <rect x="70" y="105" width="26" height="55" fill={palette.wallShade} />
            <rect x="104" y="75" width="18" height="85" fill={palette.wallShade} />
            {LIT_WINDOWS.map((w, wi) => (
              <rect
                key={wi}
                x={w.x}
                y={w.y}
                width={w.w}
                height={w.h}
                fill={palette.litWindow}
                className="motion-safe:animate-hq-flicker"
                style={{ animationDelay: `${w.delay}s` }}
              />
            ))}
          </g>
          <rect x="-2" y="76" width="154" height="4" fill={palette.wall} />
          <rect x="71" y="-8" width="4" height="176" fill={palette.wall} />
        </g>
      ))}

      {/* Bookshelves flanking the windows — fills the wall/floor gap with
          real furniture instead of bare charcoal. */}
      {[150, 850].map((x) => (
        <g key={x} transform={`translate(${x}, 205)`}>
          <rect x="-40" y="0" width="80" height="130" rx="3" fill={palette.wallShade} />
          <rect x="-40" y="0" width="80" height="130" rx="3" fill="none" stroke={palette.accent} strokeOpacity="0.35" />
          {[0, 40, 80].map((sy) => (
            <rect key={sy} x="-40" y={sy} width="80" height="5" fill={palette.accent} opacity="0.5" />
          ))}
          {/* book spines */}
          {[
            { y: 6, books: [6, 4, 8, 5, 7] },
            { y: 46, books: [5, 8, 4, 6, 5] },
          ].map((shelf, si) => {
            let cx = -34;
            return (
              <g key={si}>
                {shelf.books.map((w, bi) => {
                  const bx = cx;
                  cx += w + 2;
                  return (
                    <rect
                      key={bi}
                      x={bx}
                      y={shelf.y}
                      width={w}
                      height="32"
                      fill={bi % 2 === 0 ? palette.accent : palette.accent2}
                      opacity={0.7 + (bi % 3) * 0.1}
                    />
                  );
                })}
              </g>
            );
          })}
          {/* a small prop on the top shelf */}
          <circle cx="20" cy="18" r="9" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.8" />
          <line x1="20" y1="9" x2="20" y2="27" stroke={palette.accent} strokeWidth="1" opacity="0.6" />
        </g>
      ))}

      {/* Floor — a gentle trapezoid for a touch of depth, not a full
          perspective grid, since the camera stays predominantly front-on. */}
      <polygon points="0,340 1000,340 1040,520 -40,520" fill={`url(#${floorId})`} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line
          key={i}
          x1={40 + i * 155}
          y1="340"
          x2={-80 + i * 200}
          y2="520"
          stroke={palette.accent}
          strokeOpacity="0.18"
          strokeWidth="2"
        />
      ))}

      {/* Wall flourish — the one purely decorative touch that makes
          Commerce read as a strategy room and Local Services read as an
          operations room beyond just color. */}
      {[300, 700].map((x) => (
        <g key={x} transform={`translate(${x}, 150)`}>
          <rect x="-40" y="-30" width="80" height="60" rx="4" fill={palette.wallShade} stroke={palette.accent} strokeOpacity="0.5" />
          {variant === "commerce" ? (
            <>
              <rect x="-30" y="-20" width="60" height="40" rx="2" fill={palette.wall} />
              <polyline
                points="-22,10 -8,-6 4,4 20,-14"
                fill="none"
                stroke={palette.accent}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="-8" cy="-6" r="2.5" fill={palette.accent} />
              <circle cx="20" cy="-14" r="2.5" fill={palette.accent} />
            </>
          ) : (
            <>
              <circle cx="0" cy="-2" r="20" fill={palette.wall} stroke={palette.accent} strokeWidth="2.5" />
              <line x1="0" y1="-2" x2="0" y2="-12" stroke={palette.accent} strokeWidth="2" strokeLinecap="round" />
              <line x1="0" y1="-2" x2="7" y2="2" stroke={palette.accent} strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </g>
      ))}

      {/* A low back console, centered — fills the floor between the desks
          rather than leaving it a bare expanse. */}
      <g transform="translate(500, 290)">
        <rect x="-95" y="6" width="190" height="38" rx="4" fill={palette.wallShade} stroke={palette.accent} strokeOpacity="0.4" />
        <rect x="-95" y="6" width="190" height="8" rx="4" fill={palette.accent} opacity="0.35" />
        <line x1="-32" y1="10" x2="-32" y2="44" stroke={palette.accent} strokeWidth="1.5" opacity="0.3" />
        <line x1="32" y1="10" x2="32" y2="44" stroke={palette.accent} strokeWidth="1.5" opacity="0.3" />
        <rect x="-75" y="-16" width="16" height="22" rx="2" fill={palette.accent2} />
        <rect x="60" y="-22" width="12" height="28" rx="2" fill={palette.accent} opacity="0.6" />
      </g>

      {/* Rug */}
      <ellipse cx="500" cy="440" rx="320" ry="42" fill={palette.accent} opacity="0.08" />

      {/* Plants */}
      {[55, 935].map((cx) => (
        <g key={cx} transform={`translate(${cx}, 300)`}>
          <rect x="-14" y="55" width="28" height="26" rx="3" fill={palette.accent} opacity="0.55" />
          <ellipse cx="0" cy="40" rx="26" ry="30" fill={palette.accent2} />
          <ellipse cx="-16" cy="55" rx="16" ry="20" fill={palette.accent2} opacity="0.85" />
          <ellipse cx="16" cy="55" rx="16" ry="20" fill={palette.accent2} opacity="0.85" />
        </g>
      ))}

      {/* Cinematic vignette — darkens the corners so the desks (which sit
          under the light pool above) read as the visual focus. */}
      <rect x="0" y="0" width="1000" height="520" fill={`url(#${vignetteId})`} />
    </svg>
  );
}
