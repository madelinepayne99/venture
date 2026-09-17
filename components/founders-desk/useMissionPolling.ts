"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `onTick` on a fixed interval for as long as `active` stays true —
 * created once when `active` becomes true, torn down only when it becomes
 * false. `onTick` is read through a ref so a fresh closure every render
 * never affects the interval's lifecycle.
 *
 * This exists because of a real production bug: the original polling
 * effect in FoundersDeskApp.tsx depended directly on the mission list (and
 * the selected mission's detail) that its own tick's fetch call mutates.
 * Every tick therefore tore the interval down and rebuilt it — which
 * *usually* looked fine, but the rebuild could race and silently never
 * happen, permanently ending polling while a mission was still genuinely
 * `researching`. The frontend then never learned the mission had moved,
 * so Scout's HQ animation never left "Ready". Keying the effect on a
 * value `onTick` doesn't itself mutate closes that race by construction.
 */
export function useMissionPolling(active: boolean, onTick: () => void, intervalMs: number): void {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => onTickRef.current(), intervalMs);
    return () => clearInterval(interval);
  }, [active, intervalMs]);
}
