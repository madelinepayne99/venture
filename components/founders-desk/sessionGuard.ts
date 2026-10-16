let redirectingToLogin = false;

/**
 * Real session-loss handling (Mission 10) — a background refresh call can
 * genuinely receive a 401 if the founder's session was revoked while this
 * tab was open (most notably: they just deleted their own account, which
 * really does delete the underlying auth_user/session row — see
 * accountWorkflow.ts). Before this existed, every one of the unguarded
 * refresh* functions in `FoundersDeskApp.tsx` went straight from
 * `await res.json()` to `setX(data.x)`, so a 401's `{error: ...}` body set
 * state to `undefined` and crashed the next render
 * (`missions.filter is not a function`) — reproduced live via a real
 * Playwright run of account deletion. `redirectingToLogin` guards against
 * several concurrent polling ticks all firing a redirect at once.
 *
 * Deliberately its own tiny, dependency-free module (same split as
 * `lib/auth/allowList.ts`/`lib/auth/routeGate.ts`) — `FoundersDeskApp.tsx`
 * transitively imports `next-auth` via `signOutAction`, which cannot be
 * imported under plain Vitest; this function needs to stay testable
 * without that.
 */
export function handleUnauthorizedResponse(res: Response): boolean {
  if (res.status !== 401) return false;
  if (!redirectingToLogin) {
    redirectingToLogin = true;
    window.location.href = "/login";
  }
  return true;
}
