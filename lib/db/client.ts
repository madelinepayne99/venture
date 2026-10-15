import "server-only";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, isNull, sql } from "drizzle-orm";
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
  // --- Operations Wing (Milestone 6) --------------------------------------
  // "active" here means exactly one real, tested capability exists — see
  // each agent's capabilities list below. Nothing else about that agent is
  // implemented yet, and the roster/UI must not imply otherwise. The other
  // four start "planned", identically to inventor/inspector/merchant/etc
  // above: recorded, visible, real, and not simulated running.
  {
    key: "executive_assistant",
    name: "Executive Assistant",
    role_summary:
      "Internal task lists, reminders, and day planning for the founders. Email/calendar integrations are not yet connected.",
    status: "active",
    capabilities: [
      {
        capability: "internal_tasks",
        description:
          "Creates and tracks a founder's internal tasks/reminders (title, detail, due date, state) with real persistence — no external account connections.",
      },
    ],
  },
  {
    key: "chief_of_staff",
    name: "Chief of Staff",
    role_summary: "Coordinates the AI workforce — turns a founder goal into delegated subtasks across agents.",
    status: "active",
    capabilities: [
      {
        capability: "goal_delegation",
        description:
          "Breaks a founder's goal into real subtasks delegated to specific active Operations Wing agents (never Scout/Content Bot, never a planned agent) — reuses the existing agent_tasks table, each one trackable through to completion.",
      },
    ],
  },
  {
    key: "finance_agent",
    name: "Finance Agent",
    role_summary: "Venture HQ budget, provider costs, subscriptions, and actual-vs-budget reporting.",
    status: "active",
    capabilities: [
      {
        capability: "expense_and_budget_tracking",
        description:
          "Records a real expense (amount, currency, category) and reports actual-vs-budget for that category — currency-explicit, never guesses or converts.",
      },
    ],
  },
  {
    key: "business_analyst",
    name: "Business Analyst",
    role_summary: "Opportunity and competitor research with traceable sources, separate from Scout's mission-scoped research.",
    status: "active",
    capabilities: [
      {
        capability: "sourced_research",
        description:
          "Answers a standalone founder research question (market/competitor/opportunity) via real web search, returning a structured report with opportunities, risks, and real cited sources — independent of Scout's mission pipeline.",
      },
    ],
  },
  {
    key: "operations_agent",
    name: "Operations Agent",
    role_summary: "Checklists, document templates, and repeatable internal processes.",
    status: "active",
    capabilities: [
      {
        capability: "checklists",
        description:
          "Creates a real, persisted checklist (e.g. a launch checklist) with ordered items a founder can add to and mark done — no external account connections.",
      },
    ],
  },
];

/**
 * Per-agent, idempotent: inserts exactly the canonical agents (and, for a
 * newly-inserted agent only, its canonical capabilities) that don't
 * already exist by `key`. For an agent that DOES already exist, this
 * also graduates it from "planned" to "active" the moment its canonical
 * definition says "active" — a real, live bug found via real end-to-end
 * HTTP testing against the real dev database (Milestone 7): every agent
 * flipped to "active" in a previous Operations Wing slice (finance_agent,
 * business_analyst, operations_agent, chief_of_staff) had already been
 * inserted as "planned" by an earlier call to this function, and the
 * original version below never updated an EXISTING row's status when its
 * canonical definition later changed — so a real, already-seeded database
 * (this app's actual dev Postgres instance) silently kept reporting four
 * genuinely-built, genuinely-active agents as "planned," which in turn
 * made chiefOfStaffWorkflow.ts's own real "must be active" delegation
 * check correctly, but confusingly, refuse every real delegation to any
 * of them. This mirrors the exact bug class CLAUDE.md already documents
 * for content_bot's own real-database graduation. The one direction this
 * ever moves is planned -> active — never active -> planned, which would
 * silently take away a working capability rather than grant one; that's
 * a deliberate human decision, not something idempotent seeding should
 * ever do on its own.
 */
// Exported (not just used internally by seed()) specifically so this is
// directly testable against a real Postgres instance without going through
// resetDbForTests()'s full truncate-and-reseed — the exact scenario this
// exists for (a database that already has SOME agents, missing one, or one
// that needs upgrading) can't be constructed any other way.
export async function seedAgents(instance: Db): Promise<void> {
  const existing = await instance.select({ key: schema.agents.key, id: schema.agents.id, status: schema.agents.status }).from(schema.agents);
  const existingByKey = new Map(existing.map((row) => [row.key, row]));

  for (const agent of CANONICAL_AGENTS) {
    const existingRow = existingByKey.get(agent.key);

    if (!existingRow) {
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
      continue;
    }

    if (agent.status === "active" && existingRow.status !== "active") {
      await instance.update(schema.agents).set({ status: "active" }).where(eq(schema.agents.id, existingRow.id));
      if (agent.capabilities?.length) {
        const existingCapabilities = await instance
          .select({ capability: schema.agentCapabilities.capability })
          .from(schema.agentCapabilities)
          .where(eq(schema.agentCapabilities.agent_id, existingRow.id));
        const existingCapabilityNames = new Set(existingCapabilities.map((c) => c.capability));
        const missingCapabilities = agent.capabilities.filter((cap) => !existingCapabilityNames.has(cap.capability));
        if (missingCapabilities.length) {
          await instance.insert(schema.agentCapabilities).values(
            missingCapabilities.map((cap) => ({
              id: randomUUID(),
              agent_id: existingRow.id,
              capability: cap.capability,
              description: cap.description,
            })),
          );
        }
      }
    }
  }
}

// Multi-tenancy (Master Development Mission 6). Every table that gained a
// real `organization_id` column in this migration keeps it NULLABLE at
// the schema level specifically so this function can backfill safely —
// never a destructive reset, never a guess at which organization
// ambiguous data belongs to (there IS no ambiguity here: every row that
// predates organizations existing at all genuinely belongs to the one
// real business this app has ever served). Idempotent and safe to call
// on every request that seeds the database (same contract as
// `seedAgents` above): a database that's already fully backfilled does
// zero writes beyond the one-time organization/membership creation
// check.
//
// Exported for the same reason `seedAgents` is — directly testable
// against a real Postgres instance without a full truncate-and-reseed.
export async function ensureDefaultOrganization(instance: Db): Promise<string> {
  const founders = await instance.select({ id: schema.founders.id }).from(schema.founders);
  if (founders.length === 0) {
    // Called before founders exist (shouldn't happen via seed()'s own
    // ordering) — fail loudly rather than creating an orphaned org.
    throw new Error("ensureDefaultOrganization requires at least one founder to exist first.");
  }

  const existingOrg = await instance.select({ id: schema.organizations.id }).from(schema.organizations).limit(1);
  let organizationId: string;
  if (existingOrg.length > 0) {
    organizationId = existingOrg[0]!.id;
  } else {
    organizationId = randomUUID();
    await instance.insert(schema.organizations).values({
      id: organizationId,
      // Real, honest name for what this actually is — the founders' own
      // original business, not a placeholder. A founder can rename it
      // later; nothing here invents a customer-facing brand.
      name: "Founders' HQ",
      owner_founder_id: founders[0]!.id,
    });
  }

  // Every real founder is a real member — both are founders of the one
  // real business this app served before organizations existed, so
  // both are genuinely owners of it, not just the first one seeded.
  const existingMembers = await instance
    .select({ founder_id: schema.organizationMembers.founder_id })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organization_id, organizationId));
  const memberFounderIds = new Set(existingMembers.map((m) => m.founder_id));
  for (const founder of founders) {
    if (!memberFounderIds.has(founder.id)) {
      await instance.insert(schema.organizationMembers).values({
        id: randomUUID(),
        organization_id: organizationId,
        founder_id: founder.id,
        role: "owner",
      });
    }
  }

  // Backfill every real table this migration touched — WHERE ... IS NULL
  // means a second call does zero writes, and a row some future code
  // already scoped correctly is never overwritten.
  const tablesToBackfill = [
    schema.projects,
    schema.missions,
    schema.chiefOfStaffGoals,
    schema.agentTasks,
    schema.checklists,
    schema.businessAnalystReports,
    schema.agentDeliverables,
    schema.agentDeliverableReviews,
    schema.expenses,
    schema.budgets,
    // Mission 7's own real attribution-gap fix — see schema.ts's own
    // comment on costs.organization_id. Every pre-existing cost row
    // (whether mission-scoped or Business Analyst's own standalone
    // research spend) genuinely belongs to the one real organization
    // that existed when it was recorded — verified, not guessed, same
    // reasoning as every other table in this backfill.
    schema.costs,
  ] as const;
  for (const table of tablesToBackfill) {
    await instance
      .update(table)
      .set({ organization_id: organizationId })
      .where(isNull(table.organization_id));
  }

  // Per-organization workforce (Section 7) — backfilled from the real,
  // existing global `agents.status`, so "which agents are recruited"
  // reads exactly the same immediately after this migration as it did
  // the moment before it, just expressed per-organization now.
  const activeAgents = await instance
    .select({ key: schema.agents.key })
    .from(schema.agents)
    .where(eq(schema.agents.status, "active"));
  const existingOrgAgents = await instance
    .select({ agent_key: schema.organizationAgents.agent_key })
    .from(schema.organizationAgents)
    .where(eq(schema.organizationAgents.organization_id, organizationId));
  const orgAgentKeys = new Set(existingOrgAgents.map((a) => a.agent_key));
  for (const agent of activeAgents) {
    if (!orgAgentKeys.has(agent.key)) {
      await instance.insert(schema.organizationAgents).values({
        id: randomUUID(),
        organization_id: organizationId,
        agent_key: agent.key,
        status: "active",
      });
    }
  }

  return organizationId;
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

  // Must run after both founders and projects/agents exist — it backfills
  // organization_id on whatever was just seeded above (a fresh database)
  // and on every pre-existing row (a real, already-populated database).
  await ensureDefaultOrganization(instance);
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
      agent_tasks, chief_of_staff_goals, expenses, budgets, checklist_items, checklists, business_analyst_reports,
      agent_deliverable_reviews, agent_deliverables, projects, agent_capabilities, agents,
      budget_reservations, organization_budgets,
      organization_agents, organization_members, organizations, founders,
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
