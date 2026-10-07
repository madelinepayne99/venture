import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, getDb, seedAgents } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

// A real, live bug this covers: the original seeding was gated by
// `agentCount === 0` — a "run once, ever" check — so a long-lived database
// (this app's real Neon instance, seeded in Milestone 1 before Content Bot
// existed) never received the "content_bot" agent once it was added to the
// seed list in Milestone 5. A real founder commission failed with "Content
// Bot agent is not registered" as a direct, live consequence. seedAgents is
// now per-agent/idempotent — these tests prove that directly against a real
// Postgres instance, not just "a fresh empty database gets seeded" (which
// every other test's resetDbForTests already exercises implicitly).

describe("seedAgents — per-agent idempotent seeding", () => {
  beforeEach(async () => {
    await resetDbForTests(); // a full, fresh seed — every canonical agent present
  });

  it("adds a missing canonical agent to an already-populated database, without touching any existing agent", async () => {
    const db = await getDb();

    const before = await db.select().from(schema.agents);
    const scoutBefore = before.find((a) => a.key === "scout")!;
    expect(before.some((a) => a.key === "content_bot")).toBe(true);

    // Simulate exactly the real, live scenario: a database that already has
    // other agents but is missing content_bot (delete its capabilities
    // first — the real FK requires it).
    const contentBot = before.find((a) => a.key === "content_bot")!;
    await db.delete(schema.agentCapabilities).where(eq(schema.agentCapabilities.agent_id, contentBot.id));
    await db.delete(schema.agents).where(eq(schema.agents.key, "content_bot"));

    const midway = await db.select().from(schema.agents);
    expect(midway.some((a) => a.key === "content_bot")).toBe(false);
    expect(midway).toHaveLength(before.length - 1);

    await seedAgents(db);

    const after = await db.select().from(schema.agents);
    const contentBotAfter = after.find((a) => a.key === "content_bot");
    expect(contentBotAfter).toBeTruthy();
    expect(contentBotAfter?.name).toBe("Content Bot");
    expect(contentBotAfter?.status).toBe("active");
    expect(after).toHaveLength(before.length); // exactly restored, not duplicated

    // Content Bot's real capabilities came back too (a new agent id, so new
    // capability rows are expected — but exactly 7, matching the canonical
    // definition, no more and no less).
    const caps = await db
      .select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agent_id, contentBotAfter!.id));
    expect(caps).toHaveLength(7);

    // Scout — an agent that was NEVER removed — is completely untouched:
    // same row, same id, same every field.
    const scoutAfter = after.find((a) => a.key === "scout");
    expect(scoutAfter).toEqual(scoutBefore);
  });

  it("never duplicates an agent or its capabilities when called again with nothing missing", async () => {
    const db = await getDb();
    const before = await db.select().from(schema.agents);
    const scoutCapsBefore = await db.select().from(schema.agentCapabilities);

    await seedAgents(db);
    await seedAgents(db); // twice, for good measure

    const after = await db.select().from(schema.agents);
    const capsAfter = await db.select().from(schema.agentCapabilities);
    expect(after).toHaveLength(before.length);
    expect(capsAfter).toHaveLength(scoutCapsBefore.length);
  });

  it("leaves an unrecognized pre-existing agent row completely alone (e.g. a stale row from an older seed definition)", async () => {
    const db = await getDb();
    await db.insert(schema.agents).values({
      id: "stale-agent-1",
      key: "some_retired_agent",
      name: "Some Retired Agent",
      role_summary: "No longer part of the canonical roster.",
      status: "planned",
    });

    await seedAgents(db);

    const stale = await db.select().from(schema.agents).where(eq(schema.agents.key, "some_retired_agent"));
    expect(stale).toHaveLength(1);
    expect(stale[0]?.name).toBe("Some Retired Agent"); // untouched, not reconciled or removed
  });

  it("getAgentByKey('content_bot') resolves correctly once seeded — the exact real failure this fixes", async () => {
    const { getAgentByKey } = await import("@/lib/db/repositories");
    const contentBot = await getAgentByKey("content_bot");
    expect(contentBot).toBeTruthy();
    expect(contentBot?.status).toBe("active");
  });
});
