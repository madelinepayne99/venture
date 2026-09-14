import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Every route in this app requires a verified founder session except the
// sign-in page itself and Auth.js's own callback routes. There is no
// public area — Venture HQ is private to Ellis and Maddie.
const PUBLIC_PATHS = ["/login"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthRoute = pathname.startsWith("/api/auth");
  // Called by the Inngest dev server / Inngest Cloud, never by a founder's
  // browser — Inngest Cloud authenticates its own requests with
  // INNGEST_SIGNING_KEY, which is a separate, deliberate boundary from
  // founder sign-in.
  const isInngestRoute = pathname.startsWith("/api/inngest");
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (isAuthRoute || isInngestRoute || isPublicPage) return;

  if (!req.auth) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // auth.ts uses a database session adapter (Postgres via the `postgres`
  // driver, plus node:crypto) — neither works in the default Edge
  // runtime, so middleware has to run in the Node.js runtime instead.
  runtime: "nodejs",
};
