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

async function seed(instance: Db) {
  const founderCount = await countRows(instance, schema.founders);
  if (founderCount === 0) {
    await instance.insert(schema.founders).values([
      { id: randomUUID(), name: "Ellis Scott", email: null },
      { id: randomUUID(), name: "Maddie", email: null },
    ]);
  }

  const agentCount = await countRows(instance, schema.agents);
  if (agentCount === 0) {
    const scoutId = randomUUID();
    await instance.insert(schema.agents).values({
      id: scoutId,
      key: "scout",
      name: "Scout",
      role_summary:
        "Opportunity-research specialist. Turns a founder's mission into a structured research job covering demand evidence, competition, risk, and platform suitability.",
      status: "active",
    });
    await instance.insert(schema.agentCapabilities).values({
      id: randomUUID(),
      agent_id: scoutId,
      capability: "opportunity_research",
      description:
        "Researches digital-product opportunities (Etsy downloads, Amazon KDP print-on-demand) and returns a structured, evidence-labeled report.",
    });

    const planned: Array<[string, string, string]> = [
      ["inventor", "Inventor", "Product ideas and strategy."],
      ["creator", "Creator", "Product assets and production."],
      ["inspector", "Inspector", "Quality, compliance, and adversarial review."],
      ["merchant", "Merchant", "Listings, pricing, and marketplace performance."],
      [
        "tiktok_specialist",
        "TikTok Specialist",
        "Video concepts, scripts, assets, captions, scheduling, and performance analysis.",
      ],
      [
        "amazon_specialist",
        "Amazon Specialist",
        "KDP product preparation, listing management, and performance analysis.",
      ],
      [
        "etsy_specialist",
        "Etsy Specialist",
        "Downloadable-product listings and shop performance.",
      ],
      [
        "manager",
        "Manager",
        "Coordinates collaborative missions and prevents duplicated or conflicting work.",
      ],
    ];
    await instance.insert(schema.agents).values(
      planned.map(([key, name, role_summary]) => ({
        id: randomUUID(),
        key,
        name,
        role_summary,
        status: "planned" as const,
      })),
    );
  }

  const projectCount = await countRows(instance, schema.projects);
  if (projectCount === 0) {
    await instance.insert(schema.projects).values({
      id: randomUUID(),
      name: "Digital Products",
      description:
        "Researching, creating, launching, and promoting digital products — no physical packing or posting.",
      platform_focus: "etsy,amazon-kdp",
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
      activity_history, ledger_entries, costs, approvals, deliverables,
      evidence, agent_assignments, mission_stages, missions, projects,
      agent_capabilities, agents, founders,
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
