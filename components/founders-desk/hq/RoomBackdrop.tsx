"use client";

import { useId } from "react";
import type { WorkspaceType } from "@/lib/db/types";

/**
 * Purely decorative room shell — walls, windows with a soft city skyline,
 * a floor with a hint of depth, and a couple of plants. Colors are the
 * only thing that vary by workspace type; the structure (windows, floor,
 * side-wall shading) is shared, so a future cosmetic skin only needs to
 * swap the palette below (or extend this map) rather than rebuild the
 * room from scratch.
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
  }
> = {
  commerce: {
    wall: "#F3E9D2",
    wallShade: "#E7D8B2",
    floorLight: "#D9C08F",
    floorDark: "#B98F4E",
    skyTop: "#FBF6EC",
    skyBottom: "#E4C98A",
    accent: "#0E5C57",
  },
  service_business: {
    wall: "#E8F1EE",
    wallShade: "#D3E5DF",
    floorLight: "#CFE3DD",
    floorDark: "#9FC4BA",
    skyTop: "#FBF6EC",
    skyBottom: "#BFE0D6",
    accent: "#9C7A2E",
  },
};

export function RoomBackdrop({ variant }: { variant: WorkspaceType }) {
  // Unique per mounted instance — the HQ carousel renders more than one
  // room at once (for the slide transition), so gradient/clip ids must
  // never collide between them.
  const uid = useId();
  const palette = ROOM_PALETTES[variant];
  const skyId = `${uid}-sky`;
  const floorId = `${uid}-floor`;
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
        {winClipIds.map((id) => (
          <clipPath id={id} key={id}>
            <rect x="0" y="0" width="150" height="160" rx="4" />
          </clipPath>
        ))}
      </defs>

      {/* Ceiling shadow — the underside of the floor above, the "front
          wall removed" cutaway edge a dollhouse view relies on. */}
      <rect x="0" y="0" width="1000" height="34" fill="#20262B" opacity="0.14" />

      {/* Back wall */}
      <rect x="0" y="30" width="1000" height="310" fill={palette.wall} />

      {/* Side walls — thin shaded strips suggesting the room turning
          away from the camera, without a full 3D perspective. */}
      <polygon points="0,30 40,30 40,340 0,340" fill={palette.wallShade} opacity="0.8" />
      <polygon points="960,30 1000,30 1000,340 960,340" fill={palette.wallShade} opacity="0.8" />

      {/* Windows onto a generic, abstract skyline — never a literal or
          copyrighted skyline, just simple building silhouettes. */}
      {[90, 425, 760].map((x, i) => (
        <g key={x} transform={`translate(${x}, 60)`}>
          <rect x="-8" y="-8" width="166" height="176" rx="6" fill={palette.floorDark} opacity="0.5" />
          <g clipPath={`url(#${winClipIds[i]})`}>
            <rect width="150" height="160" fill={`url(#${skyId})`} />
            <rect x="10" y="90" width="24" height="70" fill={palette.wallShade} opacity="0.7" />
            <rect x="42" y="60" width="20" height="100" fill={palette.wallShade} opacity="0.55" />
            <rect x="70" y="105" width="26" height="55" fill={palette.wallShade} opacity="0.65" />
            <rect x="104" y="75" width="18" height="85" fill={palette.wallShade} opacity="0.5" />
          </g>
          <rect x="-2" y="76" width="154" height="4" fill={palette.wall} />
          <rect x="71" y="-8" width="4" height="176" fill={palette.wall} />
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
          stroke={palette.floorDark}
          strokeOpacity="0.35"
          strokeWidth="2"
        />
      ))}

      {/* Wall flourish — the one purely decorative touch that makes
          Commerce read as a strategy room and Local Services read as an
          operations room beyond just color, filling the blank wall
          between windows instead of leaving it bare. */}
      {[300, 700].map((x) => (
        <g key={x} transform={`translate(${x}, 150)`}>
          <rect x="-38" y="-28" width="76" height="56" rx="4" fill={palette.wallShade} opacity="0.6" />
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
      <g transform="translate(500, 296)">
        <rect x="-95" y="6" width="190" height="34" rx="4" fill={palette.floorDark} opacity="0.55" />
        <rect x="-95" y="6" width="190" height="8" rx="4" fill={palette.wallShade} opacity="0.85" />
        <line x1="-32" y1="10" x2="-32" y2="40" stroke={palette.wall} strokeWidth="2" opacity="0.5" />
        <line x1="32" y1="10" x2="32" y2="40" stroke={palette.wall} strokeWidth="2" opacity="0.5" />
        <rect x="-75" y="-14" width="16" height="20" rx="2" fill={palette.accent} opacity="0.45" />
        <rect x="60" y="-20" width="12" height="26" rx="2" fill={palette.accent} opacity="0.35" />
      </g>

      {/* Rug */}
      <ellipse cx="500" cy="440" rx="320" ry="42" fill={palette.accent} opacity="0.1" />

      {/* Plants */}
      {[55, 935].map((cx) => (
        <g key={cx} transform={`translate(${cx}, 300)`}>
          <rect x="-14" y="55" width="28" height="26" rx="3" fill="#9C7A2E" />
          <ellipse cx="0" cy="40" rx="26" ry="30" fill={palette.accent} opacity="0.55" />
          <ellipse cx="-16" cy="55" rx="16" ry="20" fill={palette.accent} opacity="0.45" />
          <ellipse cx="16" cy="55" rx="16" ry="20" fill={palette.accent} opacity="0.45" />
        </g>
      ))}
    </svg>
  );
}
