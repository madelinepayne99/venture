import { describe, expect, it } from "vitest";
import { decideRouteGate } from "@/lib/auth/routeGate";

// middleware.ts's actual access-control decision, extracted into a plain
// function so it's testable without a full Next.js build (middleware.ts
// itself imports auth.ts, which imports next-auth, which can't load under
// plain Vitest — see CLAUDE.md's Authentication section).

describe("route gate", () => {
  it("sends an already-authenticated founder from /login to / instead of showing the sign-in form again", () => {
    expect(decideRouteGate("/login", true)).toEqual({ action: "redirect", to: "/" });
  });

  it("still shows /login to a signed-out visitor", () => {
    expect(decideRouteGate("/login", false)).toEqual({ action: "allow" });
  });

  it("redirects a signed-out visitor away from a protected page to /login", () => {
    expect(decideRouteGate("/", false)).toEqual({ action: "redirect", to: "/login" });
  });

  it("allows a signed-in founder through to a protected page", () => {
    expect(decideRouteGate("/", true)).toEqual({ action: "allow" });
  });

  it("returns 401 instead of a redirect for a signed-out API request", () => {
    expect(decideRouteGate("/api/missions", false)).toEqual({ action: "unauthorized" });
  });

  it("allows a signed-in founder's API request through", () => {
    expect(decideRouteGate("/api/missions", true)).toEqual({ action: "allow" });
  });

  it("never gates Auth.js's own routes, signed in or not", () => {
    expect(decideRouteGate("/api/auth/callback/github", false)).toEqual({ action: "allow" });
    expect(decideRouteGate("/api/auth/callback/github", true)).toEqual({ action: "allow" });
  });

  it("never gates the Inngest webhook — it authenticates itself via INNGEST_SIGNING_KEY", () => {
    expect(decideRouteGate("/api/inngest", false)).toEqual({ action: "allow" });
    expect(decideRouteGate("/api/inngest", true)).toEqual({ action: "allow" });
  });
});
