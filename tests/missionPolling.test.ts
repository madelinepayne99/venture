// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMissionPolling } from "../components/founders-desk/useMissionPolling";

// Regression coverage for a real production bug: Scout's HQ animation
// never left "Ready" for a genuinely `researching` mission because
// FoundersDeskApp's original polling effect was keyed on `missions` (and
// the selected mission's detail) — exactly the values its own tick's
// fetch call mutates. Every tick therefore tore the interval down and
// rebuilt it; the rebuild could race and simply never happen again,
// permanently and silently ending polling while research was still
// genuinely in flight. useMissionPolling exists specifically so the
// interval's lifetime depends only on a stable `active` boolean, never on
// anything a tick itself changes.
describe("useMissionPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps ticking even when the caller passes a brand-new onTick closure on every render", () => {
    const calls: number[] = [];
    let renderCount = 0;

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        renderCount += 1;
        // A fresh closure every render — exactly what FoundersDeskApp
        // does, since onTick closes over refreshMissions/refs that are
        // recreated each render. The bug this hook fixes was triggered by
        // the *effect* re-running because of this, not by onTick itself.
        const thisRenderId = renderCount;
        useMissionPolling(active, () => calls.push(thisRenderId), 3000);
      },
      { initialProps: { active: true } },
    );

    // Simulate the real app re-rendering (as it does on every poll tick,
    // since refreshMissions()'s setState triggers one) without `active`
    // itself ever changing value.
    for (let i = 0; i < 5; i++) {
      rerender({ active: true });
    }

    for (let tick = 0; tick < 10; tick++) {
      vi.advanceTimersByTime(3000);
    }

    // A single underlying interval, created once, must have fired all 10
    // times — not zero (the actual regression: silently dead after the
    // first tick) and not fewer than expected from spurious teardown.
    expect(calls.length).toBe(10);
  });

  it("stops ticking once active becomes false, and does not resume on its own", () => {
    const onTick = vi.fn();
    const { rerender } = renderHook(({ active }: { active: boolean }) => useMissionPolling(active, onTick, 3000), {
      initialProps: { active: true },
    });

    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    vi.advanceTimersByTime(9000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("never starts ticking at all when active is false from the start", () => {
    const onTick = vi.fn();
    renderHook(() => useMissionPolling(false, onTick, 3000));

    vi.advanceTimersByTime(15000);
    expect(onTick).not.toHaveBeenCalled();
  });
});
