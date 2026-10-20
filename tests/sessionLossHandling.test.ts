// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";

/**
 * Regression coverage for a real, live-reproduced production bug found
 * via Playwright during Mission 10: `FoundersDeskApp.tsx`'s `refreshMissions`
 * / `refreshLedger` / `refreshProjects` went straight from `await res.json()`
 * to `setX(data.x)` with no check that the request actually succeeded. A
 * founder's session can genuinely become invalid mid-session — most
 * notably from the new real account-deletion flow deleting their own
 * `auth_user` row out from under an in-flight polling tick, but equally a
 * session expiring or being revoked in another tab — and `GET /api/missions`
 * then returns a 401 with an `{error: ...}` body, so `data.missions` is
 * `undefined`. `setMissions(undefined)` corrupted state and the very next
 * render crashed the whole app on `missions.filter is not a function`
 * (reproduced live: a real Playwright run of the account-deletion flow
 * hit this exact crash, with the stack trace pointing at
 * `FoundersDeskApp.tsx`'s `visibleMissions = missions.filter(...)` line).
 *
 * `handleUnauthorizedResponse` is the fix: every refresh function now
 * checks it first and bails out (redirecting to /login) instead of ever
 * touching state with a failed response's body. It lives in its own tiny
 * `sessionGuard.ts` module — not inline in `FoundersDeskApp.tsx` — because
 * that component transitively imports `next-auth` via `signOutAction` and
 * can't be imported under plain Vitest (the same split already used for
 * `lib/auth/allowList.ts`/`lib/auth/routeGate.ts`).
 */

async function freshModule() {
  vi.resetModules();
  return import("@/components/founders-desk/sessionGuard");
}

describe("handleUnauthorizedResponse", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // jsdom's window.location.href is read-only via simple assignment in
    // some environments — replace it with a writable stub so the real
    // assignment the fix performs can be observed without actually
    // navigating.
    // @ts-expect-error — deliberately replacing a read-only global for the test
    delete window.location;
    // @ts-expect-error — same as above
    window.location = { href: "http://localhost:3000/" };
  });

  afterAll(() => {
    // @ts-expect-error — restore the real location after this file's tests
    window.location = originalLocation;
  });

  it("returns false and never redirects for a successful (200) response", async () => {
    const { handleUnauthorizedResponse } = await freshModule();
    const res = new Response(JSON.stringify({ missions: [] }), { status: 200 });
    expect(handleUnauthorizedResponse(res)).toBe(false);
    expect(window.location.href).toBe("http://localhost:3000/");
  });

  it("returns false and never redirects for an unrelated error (500)", async () => {
    const { handleUnauthorizedResponse } = await freshModule();
    const res = new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    expect(handleUnauthorizedResponse(res)).toBe(false);
    expect(window.location.href).toBe("http://localhost:3000/");
  });

  it("returns true and redirects to /login on a real 401 — the exact bug's trigger condition", async () => {
    const { handleUnauthorizedResponse } = await freshModule();
    const res = new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });
    expect(handleUnauthorizedResponse(res)).toBe(true);
    expect(window.location.href).toBe("/login");
  });

  it("only redirects once even when several polling ticks all receive a 401 concurrently", async () => {
    const { handleUnauthorizedResponse } = await freshModule();
    const res1 = new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });
    const res2 = new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });
    const res3 = new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });

    expect(handleUnauthorizedResponse(res1)).toBe(true);
    window.location.href = "should-not-be-overwritten-again";
    expect(handleUnauthorizedResponse(res2)).toBe(true);
    expect(handleUnauthorizedResponse(res3)).toBe(true);

    // The guard fires the real navigation exactly once — later calls
    // still correctly report "this was a 401" (true) without re-issuing
    // the redirect, so a second/third concurrent tick never stomps on
    // or re-triggers the in-flight navigation.
    expect(window.location.href).toBe("should-not-be-overwritten-again");
  });
});
