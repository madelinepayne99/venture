import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
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
// existence of a login page — a Google account that authenticates
// successfully but doesn't match a founders.email row is still refused
// here, before a session is ever created.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getRawDb(), {
    usersTable: schema.authUsers,
    accountsTable: schema.authAccounts,
    sessionsTable: schema.authSessions,
    verificationTokensTable: schema.authVerificationTokens,
  }),
  providers: [Google],
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
