import "server-only";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getRawDb } from "@/lib/db/client";
import { isAllowedFounderEmail, resolveFounderIdentity } from "@/lib/auth/allowList";
import * as schema from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    founderId: string | null;
    founderName: string | null;
  }
}

// Venture HQ is private to exactly two people. The security boundary is
// the server-side allow-list check below (lib/auth/allowList.ts), not the
// existence of a login page — a GitHub account that authenticates
// successfully but doesn't match a founders.email row is still refused
// here, before a session is ever created.
//
// Initially, both founders sign in through one shared GitHub account —
// only one founders row has its email set, so whoever uses that account
// is recognized as that one founder. To add Maddie's own separate
// account later, no code changes are needed: just set her founders row's
// email to whatever email her own GitHub account resolves to (Auth.js's
// GitHub provider always resolves a real verified email, even if the
// account's email is private — see the profile handling in
// @auth/core/providers/github). Each founder is then recognized
// independently, the same allow-list mechanism unchanged.
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
      return isAllowedFounderEmail(user.email);
    },
    async session({ session, user }) {
      const identity = await resolveFounderIdentity(user.email);
      session.founderId = identity?.founderId ?? null;
      session.founderName = identity?.founderName ?? null;
      return session;
    },
  },
});
