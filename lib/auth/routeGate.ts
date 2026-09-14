import "server-only";

// Pure routing decision for middleware.ts, deliberately free of any
// next-auth/next/server import (same reason as allowList.ts: next-auth
// pulls in next/server, which only resolves inside a real Next.js
// runtime, not under plain Vitest) — so this, the actual access-control
// decision, is unit-testable directly instead of only exercisable through
// a full Next.js build.

export type RouteGateDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

// Kept in sync with middleware.ts's PUBLIC_PATHS — the sign-in page is
// the only route reachable without a session.
const PUBLIC_PATHS = ["/login"];

/**
 * Decides what middleware.ts should do with a request, given only its
 * pathname and whether it carries a verified founder session. Venture HQ
 * has no public area: every route requires a session except `/login`
 * (the sign-in page), `/api/auth/**` (Auth.js's own routes), and
 * `/api/inngest` (authenticated separately, by Inngest itself, via
 * INNGEST_SIGNING_KEY).
 *
 * An authenticated founder who lands on `/login` (e.g. after completing
 * GitHub sign-in, or by navigating back to it) is sent to `/` rather than
 * shown the sign-in form again.
 */
export function decideRouteGate(pathname: string, isAuthenticated: boolean): RouteGateDecision {
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isInngestRoute = pathname.startsWith("/api/inngest");
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (isAuthRoute || isInngestRoute) {
    return { action: "allow" };
  }

  if (isPublicPage) {
    return isAuthenticated ? { action: "redirect", to: "/" } : { action: "allow" };
  }

  if (!isAuthenticated) {
    return pathname.startsWith("/api/")
      ? { action: "unauthorized" }
      : { action: "redirect", to: "/login" };
  }

  return { action: "allow" };
}
