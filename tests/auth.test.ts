import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders } from "@/lib/db/repositories";
import { isAllowedFounderEmail, resolveFounderIdentity } from "@/lib/auth/allowList";

// The allow-list IS the founders table (see lib/auth/allowList.ts) — these
// tests exercise the actual server-side check used in auth.ts's signIn
// callback, independent of the full NextAuth/GitHub OAuth wiring (which
// can't run under Vitest — next-auth imports "next/server", which only
// resolves inside a real Next.js runtime). The check itself is
// provider-agnostic (it matches founders.email against whatever real
// email the OAuth provider resolves) — these tests never needed to
// change when the provider was swapped from Google to GitHub.

describe("founder allow-list", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("allows an email that matches a founders.email row", async () => {
    const founders = await listFounders();
    const ellis = founders.find((f) => f.name === "Ellis Scott")!;

    // Seed data starts with no email set — simulate the real deployment
    // step of configuring it (see CLAUDE.md's "Known production blockers").
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    await db.update(schema.founders).set({ email: "ellis@example.test" }).where(eq(schema.founders.id, ellis.id));

    expect(await isAllowedFounderEmail("ellis@example.test")).toBe(true);
    const identity = await resolveFounderIdentity("ellis@example.test");
    expect(identity).toEqual({ founderId: ellis.id, founderName: "Ellis Scott" });
  });

  it("refuses an email that isn't a registered founder — the actual security boundary", async () => {
    expect(await isAllowedFounderEmail("anyone-else@example.test")).toBe(false);
    expect(await resolveFounderIdentity("anyone-else@example.test")).toBeNull();
  });

  it("refuses a null or missing email rather than treating it as a wildcard match", async () => {
    expect(await isAllowedFounderEmail(null)).toBe(false);
    expect(await isAllowedFounderEmail(undefined)).toBe(false);
    expect(await resolveFounderIdentity(null)).toBeNull();
  });

  it("refuses every founder before any email has been configured — no accidental wide-open allow-list", async () => {
    // Fresh seed data has founders with email: null — nothing should match.
    expect(await isAllowedFounderEmail("ellis@example.test")).toBe(false);
    expect(await isAllowedFounderEmail("maddie@example.test")).toBe(false);
  });
});
