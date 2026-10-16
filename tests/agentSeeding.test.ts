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
    // other agents but is missing content_bot (delete its capabilities and
    // its real per-organization recruitment row first — both real FKs
    // require it, same as agent_capabilities always did).
    const contentBot = before.find((a) => a.key === "content_bot")!;
    await db.delete(schema.agentCapabilities).where(eq(schema.agentCapabilities.agent_id, contentBot.id));
    await db.delete(schema.organizationAgents).where(eq(schema.organizationAgents.agent_key, "content_bot"));
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

  // A second, real, live bug — found via real end-to-end HTTP testing
  // against this app's actual dev database (Milestone 7), the same bug
  // CLASS as content_bot's own graduation above, but in the opposite
  // direction: an agent that already EXISTS in a long-lived database
  // (seeded while still "planned") never had its status upgraded when a
  // LATER code change made its canonical definition "active". The real
  // consequence was concrete, not cosmetic: chiefOfStaffWorkflow.ts's own
  // "must be active" delegation check correctly (but confusingly) refused
  // every real delegation to finance_agent/business_analyst/
  // operations_agent/chief_of_staff on the real dev database, even though
  // each one's actual capability had genuinely shipped.
  describe("graduating an already-seeded agent from \"planned\" to \"active\"", () => {
    it("upgrades an existing agent's status in place and backfills its real capabilities, without touching anything else", async () => {
      const db = await getDb();

      // Simulate the exact real scenario: finance_agent already exists
      // (inserted while still "planned", the real historical sequence),
      // with no capability rows yet.
      const before = await db.select().from(schema.agents).where(eq(schema.agents.key, "finance_agent"));
      const financeAgentId = before[0]!.id;
      await db.update(schema.agents).set({ status: "planned" }).where(eq(schema.agents.id, financeAgentId));
      await db.delete(schema.agentCapabilities).where(eq(schema.agentCapabilities.agent_id, financeAgentId));

      const midway = await db.select().from(schema.agents).where(eq(schema.agents.key, "finance_agent"));
      expect(midway[0]?.status).toBe("planned");

      await seedAgents(db);

      const after = await db.select().from(schema.agents).where(eq(schema.agents.key, "finance_agent"));
      expect(after).toHaveLength(1); // upgraded in place — never duplicated
      expect(after[0]?.id).toBe(financeAgentId); // same row, same id
      expect(after[0]?.status).toBe("active");

      const caps = await db
        .select()
        .from(schema.agentCapabilities)
        .where(eq(schema.agentCapabilities.agent_id, financeAgentId));
      expect(caps).toHaveLength(1);
      expect(caps[0]?.capability).toBe("expense_and_budget_tracking");
    });

    it("never calls an agent's canonical capabilities missing twice — idempotent across repeated calls", async () => {
      const db = await getDb();
      const [row] = await db.select().from(schema.agents).where(eq(schema.agents.key, "operations_agent"));
      await db.update(schema.agents).set({ status: "planned" }).where(eq(schema.agents.id, row!.id));
      await db.delete(schema.agentCapabilities).where(eq(schema.agentCapabilities.agent_id, row!.id));

      await seedAgents(db);
      await seedAgents(db); // twice — must not duplicate the backfilled capability

      const caps = await db.select().from(schema.agentCapabilities).where(eq(schema.agentCapabilities.agent_id, row!.id));
      expect(caps).toHaveLength(1);
    });

    it("never downgrades an active agent back to planned — this only ever moves one direction", async () => {
      const db = await getDb();
      const before = await db.select().from(schema.agents).where(eq(schema.agents.key, "scout"));
      expect(before[0]?.status).toBe("active");

      await seedAgents(db); // scout is already active and already canonical-active — no-op expected

      const after = await db.select().from(schema.agents).where(eq(schema.agents.key, "scout"));
      expect(after[0]?.status).toBe("active");
    });

    it("createGoalWithDelegatedSubtasks — the exact real failure this fixes — now succeeds for every real Operations Wing agent", async () => {
      // Reproduces the exact live failure found via real HTTP testing: a
      // database where these three agents were seeded "planned" before
      // their real capabilities shipped, then never upgraded.
      const db = await getDb();
      for (const key of ["finance_agent", "business_analyst", "operations_agent"]) {
        const [row] = await db.select().from(schema.agents).where(eq(schema.agents.key, key));
        await db.update(schema.agents).set({ status: "planned" }).where(eq(schema.agents.id, row!.id));
      }

      await seedAgents(db);

      const { listFounders } = await import("@/lib/db/repositories");
      const { createGoalWithDelegatedSubtasks } = await import("@/lib/domain/chiefOfStaffWorkflow");
      const founderId = (await listFounders())[0]!.id;

      const goal = await createGoalWithDelegatedSubtasks(founderId, {
        title: "Regression check",
        subtasks: [
          { agentKey: "finance_agent", title: "x" },
          { agentKey: "business_analyst", title: "y" },
          { agentKey: "operations_agent", title: "z" },
        ],
      });
      expect(goal.subtasks).toHaveLength(3);
    });
  });
});
