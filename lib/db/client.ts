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
    const contentBotId = randomUUID();
    await instance.insert(schema.agents).values([
      {
        id: scoutId,
        key: "scout",
        name: "Scout",
        role_summary:
          "Opportunity-research specialist. Turns a founder's mission into a structured research job covering demand evidence, competition, risk, and platform suitability.",
        status: "active",
      },
      {
        id: contentBotId,
        key: "content_bot",
        name: "Content Bot",
        role_summary:
          "Production specialist. Turns a founder-approved opportunity into a finished, watchable piece of short-form content — planning, generation, assembly, and safety review — for founder review before anything is published.",
        status: "active",
      },
    ]);
    await instance.insert(schema.agentCapabilities).values([
      {
        id: randomUUID(),
        agent_id: scoutId,
        capability: "opportunity_research",
        description:
          "Researches digital-product opportunities (Etsy downloads, Amazon KDP print-on-demand) and returns a structured, evidence-labeled report.",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "production_planning",
        description: "Turns an approved opportunity brief into a structured content plan (script, shot list, metadata).",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "script_writing",
        description: "Writes narration and visual direction for each beat of a produced piece.",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "voiceover",
        description: "Generates real spoken narration audio via a configured voice provider.",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "visual_generation",
        description: "Generates real still images (and, in a later milestone, generated video) via a configured provider.",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "assembly",
        description: "Composes generated assets into a finished, watchable video via a hosted assembly provider.",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "captions_and_metadata",
        description: "Derives real captions from voice-alignment data and writes title/description/tags.",
      },
      {
        id: randomUUID(),
        agent_id: contentBotId,
        capability: "platform_publishing",
        description: "Publishes an approved, founder-gated piece to a connected platform (not yet built — see CLAUDE.md's Content Bot milestone).",
      },
    ]);

    // "creator" is deliberately not seeded — Content Bot fills that role
    // (see CLAUDE.md's Content Bot milestone for why the roster doesn't
    // carry two overlapping "makes things" agents).
    const planned: Array<[string, string, string]> = [
      ["inventor", "Inventor", "Product ideas and strategy."],
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
      projects, agent_capabilities, agents, founders,
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
