import "server-only";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | undefined;
let db: Db | undefined;

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at a real Postgres database.",
    );
  }
  return url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countRows(instance: Db, table: any): Promise<number> {
  const rows = await instance.select({ count: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.count ?? 0;
}

// The one canonical definition of every agent this app knows about —
// seedAgents below is the only inserter, and it's per-agent/idempotent
// (see its own doc comment), so this list is genuinely safe to add a new
// agent to at any time, on any database, already populated or not: an
// agent whose `key` already exists is never touched, only a missing one
// is inserted. Real bug this fixes: agent seeding used to run only when
// the whole agents table was completely empty (`agentCount === 0`), so a
// long-lived database (this app's real Neon instance, seeded back in
// Milestone 1 before Content Bot existed) never received `content_bot`
// once it was added to this list in Milestone 5 — `agentCount` was never
// 0 again after that first seed. A real founder commission on that
// database failed with "Content Bot agent is not registered" as a direct
// result (see CLAUDE.md's Content Bot milestone, C1 follow-up fixes).
//
// "creator" is deliberately not in this list — Content Bot fills that
// role (see CLAUDE.md's Content Bot milestone for why the roster doesn't
// carry two overlapping "makes things" agents). A "creator" row already
// present on an older database (seeded before that decision) is left
// alone — this list only ever adds a missing canonical agent, never
// removes or reconciles an existing one.
const CANONICAL_AGENTS: Array<{
  key: string;
  name: string;
  role_summary: string;
  status: "active" | "planned";
  capabilities?: Array<{ capability: string; description: string }>;
}> = [
  {
    key: "scout",
    name: "Scout",
    role_summary:
      "Opportunity-research specialist. Turns a founder's mission into a structured research job covering demand evidence, competition, risk, and platform suitability.",
    status: "active",
    capabilities: [
      {
        capability: "opportunity_research",
        description:
          "Researches digital-product opportunities (Etsy downloads, Amazon KDP print-on-demand) and returns a structured, evidence-labeled report.",
      },
    ],
  },
  {
    key: "content_bot",
    name: "Content Bot",
    role_summary:
      "Production specialist. Turns a founder-approved opportunity into a finished, watchable piece of short-form content — planning, generation, assembly, and safety review — for founder review before anything is published.",
    status: "active",
    capabilities: [
      {
        capability: "production_planning",
        description: "Turns an approved opportunity brief into a structured content plan (script, shot list, metadata).",
      },
      {
        capability: "script_writing",
        description: "Writes narration and visual direction for each beat of a produced piece.",
      },
      {
        capability: "voiceover",
        description: "Generates real spoken narration audio via a configured voice provider.",
      },
      {
        capability: "visual_generation",
        description: "Generates real still images (and, in a later milestone, generated video) via a configured provider.",
      },
      {
        capability: "assembly",
        description: "Composes generated assets into a finished, watchable video via a hosted assembly provider.",
      },
      {
        capability: "captions_and_metadata",
        description: "Derives real captions from voice-alignment data and writes title/description/tags.",
      },
      {
        capability: "platform_publishing",
        description: "Publishes an approved, founder-gated piece to a connected platform (not yet built — see CLAUDE.md's Content Bot milestone).",
      },
    ],
  },
  { key: "inventor", name: "Inventor", role_summary: "Product ideas and strategy.", status: "planned" },
  { key: "inspector", name: "Inspector", role_summary: "Quality, compliance, and adversarial review.", status: "planned" },
  { key: "merchant", name: "Merchant", role_summary: "Listings, pricing, and marketplace performance.", status: "planned" },
  {
    key: "tiktok_specialist",
    name: "TikTok Specialist",
    role_summary: "Video concepts, scripts, assets, captions, scheduling, and performance analysis.",
    status: "planned",
  },
  {
    key: "amazon_specialist",
    name: "Amazon Specialist",
    role_summary: "KDP product preparation, listing management, and performance analysis.",
    status: "planned",
  },
  {
    key: "etsy_specialist",
    name: "Etsy Specialist",
    role_summary: "Downloadable-product listings and shop performance.",
    status: "planned",
  },
  {
    key: "manager",
    name: "Manager",
    role_summary: "Coordinates collaborative missions and prevents duplicated or conflicting work.",
    status: "planned",
  },
];

/**
 * Per-agent, idempotent: inserts exactly the canonical agents (and, for a
 * newly-inserted agent only, its canonical capabilities) that don't
 * already exist by `key` — never touches, resets, or duplicates a
 * `agents` row that's already there, whatever its `status` or other
 * columns hold today. Safe to call on every startup against any
 * database, empty or long-lived: this is what makes adding a future
 * agent to CANONICAL_AGENTS safe on an already-populated database too.
 */
// Exported (not just used internally by seed()) specifically so this is
// directly testable against a real Postgres instance without going through
// resetDbForTests()'s full truncate-and-reseed — the exact scenario this
// exists for (a database that already has SOME agents, missing one) can't
// be constructed any other way.
export async function seedAgents(instance: Db): Promise<void> {
  const existing = await instance.select({ key: schema.agents.key }).from(schema.agents);
  const existingKeys = new Set(existing.map((row) => row.key));

  for (const agent of CANONICAL_AGENTS) {
    if (existingKeys.has(agent.key)) continue;

    const id = randomUUID();
    await instance.insert(schema.agents).values({
      id,
      key: agent.key,
      name: agent.name,
      role_summary: agent.role_summary,
      status: agent.status,
    });
    if (agent.capabilities?.length) {
      await instance.insert(schema.agentCapabilities).values(
        agent.capabilities.map((cap) => ({
          id: randomUUID(),
          agent_id: id,
          capability: cap.capability,
          description: cap.description,
        })),
      );
    }
  }
}

async function seed(instance: Db) {
  const founderCount = await countRows(instance, schema.founders);
  if (founderCount === 0) {
    await instance.insert(schema.founders).values([
      { id: randomUUID(), name: "Ellis Scott", email: null },
      { id: randomUUID(), name: "Maddie", email: null },
    ]);
  }

  await seedAgents(instance);

  const projectCount = await countRows(instance, schema.projects);
  if (projectCount === 0) {
    await instance.insert(schema.projects).values({
      id: randomUUID(),
      name: "Digital Products",
      description:
        "Researching, creating, launching, and promoting digital products — no physical packing or posting.",
      platform_focus: "etsy,amazon-kdp",
      // Explicit, not just relying on the column default — this is the
      // original workspace and must never be silently repurposed to a
      // different workspace_type (it already has completed Commerce
      // missions attached).
      workspace_type: "commerce",
    });
  }
}

/**
 * The connected Drizzle instance, synchronously — no seeding guarantee.
 * Exists for the one caller that needs a plain `PgDatabase` object at
 * config-construction time rather than a Promise: the Auth.js Drizzle
 * adapter (lib/auth.ts). Everything else should call getDb() instead,
 * which guarantees seed data exists before returning.
 */
export function getRawDb(): Db {
  if (db) return db;
  const url = resolveDatabaseUrl();
  client = postgres(url, { max: 5 });
  db = drizzle(client, { schema });
  return db;
}

let seeded: Promise<void> | undefined;

export async function getDb(): Promise<Db> {
  const instance = getRawDb();
  if (!seeded) seeded = seed(instance);
  await seeded;
  return instance;
}

/** Test-only: drop every row (not the schema) and re-seed for the next test. */
export async function resetDbForTests(): Promise<void> {
  const instance = await getDb();
  await instance.execute(sql`
    TRUNCATE TABLE
      activity_history, ledger_entries, costs, approvals,
      content_assets, content_versions, content_items,
      deliverables, evidence, agent_assignments, mission_stages, missions,
      agent_tasks, projects, agent_capabilities, agents, founders,
      auth_session, auth_account, auth_verification_token, auth_user
    RESTART IDENTITY CASCADE
  `);
  await seed(instance);
}

/** Test-only: close the pooled connection so the process can exit cleanly. */
export async function closeDbForTests(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    db = undefined;
    seeded = undefined;
  }
}
