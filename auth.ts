import "server-only";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getRawDb } from "@/lib/db/client";
import { isAllowedFounderEmail, resolveFounderIdentity, ensureFounderAccount } from "@/lib/auth/allowList";
import * as schema from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    founderId: string | null;
    founderName: string | null;
  }
}

// The real security boundary is the server-side check below (lib/auth/
// allowList.ts), not the existence of a login page — a GitHub account
// that authenticates successfully but isn't recognized is still refused
// here, before a session is ever created.
//
// Ellis and Maddie initially sign in through one shared GitHub account —
// only one founders row has its email set, so whoever uses that account
// is recognized as that one founder. To add Maddie's own separate
// account later, no code changes are needed: just set her founders row's
// email to whatever email her own GitHub account resolves to.
//
// Mission 8, Sections 11-12: real self-service customer accounts.
// ALLOW_NEW_CUSTOMER_SIGNUP (default: unset/off) gates this — with it
// off, behavior is byte-for-byte what it always was (only an existing
// founders.email row may sign in). Set it to exactly "true" to let any
// real, GitHub-verified email that isn't already a founder get a real
// new founders row auto-provisioned on first sign-in (never an
// organization — that's a separate, customer-driven step; see
// app/api/organizations/route.ts). This is a deliberate, reversible
// switch (same pattern as missionWorkflow.ts's REQUIRE_FOUNDER_APPROVAL)
// so a real deployment never opens registration by accident — a founder
// must explicitly set this env var.
const ALLOW_NEW_CUSTOMER_SIGNUP = process.env.ALLOW_NEW_CUSTOMER_SIGNUP === "true";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getRawDb(), {
    usersTable: schema.authUsers,
    accountsTable: schema.authAccounts,
    sessionsTable: schema.authSessions,
    verificationTokensTable: schema.authVerificationTokens,
  }),
  providers: [GitHub],
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user }) {
      if (await isAllowedFounderEmail(user.email)) return true;
      if (!ALLOW_NEW_CUSTOMER_SIGNUP) return false;
      if (!user.email) return false; // Can't identify who they are without a real verified email.
      await ensureFounderAccount(user.email, user.name ?? user.email);
      return true;
    },
    async session({ session, user }) {
      const identity = await resolveFounderIdentity(user.email);
      session.founderId = identity?.founderId ?? null;
      session.founderName = identity?.founderName ?? null;
      return session;
    },
  },
});
