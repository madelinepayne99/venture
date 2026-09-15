import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

// Venture HQ data model, mirroring the domain 1:1 with the previous
// SQLite schema.sql. Every table backs something genuinely displayed in
// the interface — do not add a column to fabricate activity; add it only
// when there's a real thing to record.
//
// JS property names on the business tables are deliberately snake_case,
// matching the DB column names exactly (per CLAUDE.md's convention) — so
// query results already have the same shape every repository/route/
// component in this codebase already expects, with no mapping layer.
//
// State/status/vocabulary columns (missions.state, mission_stages.status,
// etc.) are deliberately plain `text`, not Postgres enums — the app layer
// (lib/domain/missionStates.ts) is the single source of truth for what
// values are legal, and a DB-level enum would require a schema migration
// every time that vocabulary changes. Keep it that way.

export const founders = pgTable("founders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const agentStatusValues = ["active", "planned"] as const;

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  role_summary: text("role_summary").notNull(),
  status: text("status").notNull().default("planned"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const agentCapabilities = pgTable("agent_capabilities", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id),
  capability: text("capability").notNull(),
  description: text("description").notNull(),
});

// A project IS a workspace — "commerce" (the original Etsy/KDP digital-
// product focus) or "service_business" (client-facing local businesses
// like hairdressers or garages). Missions don't carry their own workspace
// type; it's derived from missions.project_id -> projects.workspace_type
// (a mission with no project defaults to "commerce" — see
// missionWorkflow.ts's resolveWorkspaceType). New values require a
// migration to widen the app-layer vocabulary in lib/db/types.ts and
// lib/agents/scout/schema.ts's discriminated union — same reasoning as
// missions.state being plain text: the app layer is the source of truth,
// not a DB enum.
export const workspaceTypeValues = ["commerce", "service_business"] as const;

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  platform_focus: text("platform_focus"),
  workspace_type: text("workspace_type").notNull().default("commerce"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const missions = pgTable("missions", {
  id: text("id").primaryKey(),
  project_id: text("project_id").references(() => projects.id),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  interpreted_mission: text("interpreted_mission"),
  state: text("state").notNull().default("draft"),
  final_status: text("final_status"),
  failure_reason: text("failure_reason"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const missionStages = pgTable("mission_stages", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id")
    .notNull()
    .references(() => missions.id),
  stage_name: text("stage_name").notNull(),
  status: text("status").notNull().default("pending"),
  started_at: timestamp("started_at", { mode: "string" }),
  completed_at: timestamp("completed_at", { mode: "string" }),
  detail: text("detail"),
});

export const agentAssignments = pgTable("agent_assignments", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id")
    .notNull()
    .references(() => missions.id),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id),
  role: text("role").notNull(),
  assigned_at: timestamp("assigned_at", { mode: "string" }).notNull().defaultNow(),
});

export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id")
    .notNull()
    .references(() => missions.id),
  source_url: text("source_url"),
  source_title: text("source_title"),
  source_date: text("source_date"),
  snippet: text("snippet"),
  retrieved_at: timestamp("retrieved_at", { mode: "string" }).notNull().defaultNow(),
  is_verified_fact: boolean("is_verified_fact").notNull().default(false),
});

export const deliverables = pgTable("deliverables", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id")
    .notNull()
    .references(() => missions.id),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id),
  kind: text("kind").notNull(),
  content: jsonb("content").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id")
    .notNull()
    .references(() => missions.id),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  decision: text("decision").notNull(),
  note: text("note"),
  decided_at: timestamp("decided_at", { mode: "string" }).notNull().defaultNow(),
});

export const costs = pgTable("costs", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id").references(() => missions.id),
  agent_id: text("agent_id").references(() => agents.id),
  model: text("model").notNull(),
  input_tokens: integer("input_tokens").notNull(),
  output_tokens: integer("output_tokens").notNull(),
  // Null means real tokens were spent but pricing for this model is
  // unknown — never coerced to 0, never fabricated.
  usd_cost: real("usd_cost"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id").references(() => missions.id),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount_usd: real("amount_usd").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const activityHistory = pgTable("activity_history", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id").references(() => missions.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

// --- Auth.js (GitHub OAuth) session tables ---------------------------------
//
// These are Auth.js's own bookkeeping tables (session management only),
// deliberately separate from `founders` (the business-identity table) and
// deliberately NOT snake_case — their JS property names must match
// exactly what @auth/drizzle-adapter's own generic adapter code expects
// (see node_modules/@auth/drizzle-adapter/src/lib/pg.ts), since that
// third-party code accesses these fields by name directly. The WebAuthn
// `authenticator` table is intentionally omitted — Venture HQ only ever
// uses GitHub OAuth, never passkeys, so that adapter code path is never
// invoked. These tables aren't provider-specific either way — swapping
// the OAuth provider (as happened once already, Google → GitHub) never
// requires a schema change here.

export const authUsers = pgTable("auth_user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const authAccounts = pgTable(
  "auth_account",
  {
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compositePk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const authSessions = pgTable("auth_session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const authVerificationTokens = pgTable(
  "auth_verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compositePk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);
