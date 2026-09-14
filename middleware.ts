import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { decideRouteGate } from "@/lib/auth/routeGate";

// Every route in this app requires a verified founder session except the
// sign-in page itself and Auth.js's own callback routes. There is no
// public area — Venture HQ is private to Ellis and Maddie. The actual
// decision logic lives in lib/auth/routeGate.ts (kept free of next-auth/
// next/server so it's directly unit-testable); this is just the thin
// Next.js wrapper around it, same split used elsewhere in this codebase
// for Inngest-bound logic (see runScoutPipeline, reapStaleResearchingMissions).
export default auth((req) => {
  const decision = decideRouteGate(req.nextUrl.pathname, Boolean(req.auth));

  switch (decision.action) {
    case "redirect":
      return NextResponse.redirect(new URL(decision.to, req.nextUrl.origin));
    case "unauthorized":
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    case "allow":
      return;
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // auth.ts uses a database session adapter (Postgres via the `postgres`
  // driver, plus node:crypto) — neither works in the default Edge
  // runtime, so middleware has to run in the Node.js runtime instead.
  runtime: "nodejs",
};
