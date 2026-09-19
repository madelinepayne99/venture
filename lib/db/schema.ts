import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  primaryKey,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  // How many real Scout research passes this mission has actually had
  // (0 = none yet, 1 = the original pass, 2 = the one automatic targeted
  // follow-up). Capped at MAX_RESEARCH_PASSES in missionWorkflow.ts — this
  // column is what that cap is actually enforced against, not just a
  // display counter. See CLAUDE.md's evidence-loop milestone.
  research_pass_count: integer("research_pass_count").notNull().default(0),
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
  // Null for Scout's own stages. Set for a Content Bot production stage —
  // scoped to the version, since a revision re-runs all five stages under
  // a fresh content_versions row (see contentItemStates.ts).
  content_item_id: text("content_item_id").references((): AnyPgColumn => contentItems.id),
  content_version_id: text("content_version_id").references((): AnyPgColumn => contentVersions.id),
});

export const agentAssignments = pgTable(
  "agent_assignments",
  {
    id: text("id").primaryKey(),
    mission_id: text("mission_id")
      .notNull()
      .references(() => missions.id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id),
    role: text("role").notNull(),
    assigned_at: timestamp("assigned_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    // Makes the Scout/Content Bot hand-off idempotent under a retried
    // dispatch — a second attempt to assign the same agent to the same
    // mission in the same role is a no-op, never a duplicate row.
    oneRolePerAgentPerMission: uniqueIndex("agent_assignments_mission_agent_role_unique").on(
      table.mission_id,
      table.agent_id,
      table.role,
    ),
  }),
);

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

// --- Content Bot production (Milestone C1) ---------------------------------
//
// A mission's research (Scout's `deliverables` row) and its production
// (Content Bot's work) are deliberately different shapes: a mission is
// researched once, but a founder may request several genuinely reworked
// revisions of a produced piece before approving one — see
// lib/domain/contentItemStates.ts for the full state graph and CLAUDE.md's
// Content Bot milestone for why this is a child entity rather than more
// mission states or a second `deliverables` row per version.

export const contentItemStateValues = [
  "planning",
  "generating",
  "blocked",
  "awaiting_review",
  "revision_requested",
  "ready_to_publish",
  "publishing",
  "published",
  "publish_failed",
  "rejected",
  "failed",
  "cancelled",
] as const;

export const contentItems = pgTable(
  "content_items",
  {
    id: text("id").primaryKey(),
    mission_id: text("mission_id")
      .notNull()
      .references(() => missions.id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id),
    // The exact Scout report this production was greenlit from — the real
    // hand-off, never inferred from mission state (see contentHandoff.ts).
    source_deliverable_id: text("source_deliverable_id").references(() => deliverables.id),
    // A frozen snapshot (ProductionBrief) built once at the approval gate
    // from real mission/project/Scout-report/evidence rows — reproducible
    // and auditable even after later revisions change nothing about it.
    brief: jsonb("brief").notNull(),
    // The founder's own choice (platform/audience/content type) at the
    // approval gate — never a global default, never set by the agent.
    audience_context: jsonb("audience_context").notNull(),
    state: text("state").notNull().default("planning"),
    approved_version_id: text("approved_version_id"),
    published_version_id: text("published_version_id"),
    platform: text("platform"),
    platform_post_id: text("platform_post_id"),
    platform_post_url: text("platform_post_url"),
    published_at: timestamp("published_at", { mode: "string" }),
    failure_reason: text("failure_reason"),
    // What the version/attempt/spend caps in lib/domain/contentProduction.ts
    // are actually enforced against — not display counters, the same role
    // missions.research_pass_count plays for Scout's pass cap.
    version_count: integer("version_count").notNull().default(0),
    generation_attempt_count: integer("generation_attempt_count").notNull().default(0),
    next_analytics_pull_at: timestamp("next_analytics_pull_at", { mode: "string" }),
    created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    // One non-terminal content item per mission — the "one item in
    // flight at a time" rule enforced as a real constraint, not just an
    // application convention.
    oneActivePerMission: uniqueIndex("content_items_one_active_per_mission")
      .on(table.mission_id)
      .where(sql`state not in ('published','rejected','failed','cancelled')`),
  }),
);

export const contentVersionStatusValues = ["generating", "complete", "failed"] as const;

export const contentVersions = pgTable(
  "content_versions",
  {
    id: text("id").primaryKey(),
    content_item_id: text("content_item_id")
      .notNull()
      .references(() => contentItems.id),
    version_number: integer("version_number").notNull(),
    // Null for v1 — the version this one reworked, for a real (never
    // destructive) revision history.
    parent_version_id: text("parent_version_id").references((): AnyPgColumn => contentVersions.id),
    // The one home for the founder's verbatim revision note — a version
    // points at the approval that caused it rather than copying the text.
    revision_approval_id: text("revision_approval_id").references((): AnyPgColumn => approvals.id),
    status: text("status").notNull().default("generating"),
    plan: jsonb("plan"),
    safety_verdict: jsonb("safety_verdict"),
    failure_reason: text("failure_reason"),
    started_at: timestamp("started_at", { mode: "string" }).notNull().defaultNow(),
    completed_at: timestamp("completed_at", { mode: "string" }),
  },
  (table) => ({
    oneNumberPerItem: uniqueIndex("content_versions_item_number_unique").on(
      table.content_item_id,
      table.version_number,
    ),
  }),
);

export const contentAssetKindValues = [
  "video",
  "audio",
  "thumbnail",
  "caption_track",
  "image",
  "script",
] as const;

export const contentAssets = pgTable(
  "content_assets",
  {
    id: text("id").primaryKey(),
    content_version_id: text("content_version_id")
      .notNull()
      .references(() => contentVersions.id),
    kind: text("kind").notNull(),
    storage_provider: text("storage_provider").notNull(),
    storage_key: text("storage_key").notNull(),
    content_type: text("content_type").notNull(),
    // Measured from real written bytes, never a provider's claim — null
    // only while genuinely unknown mid-write.
    byte_size: integer("byte_size"),
    duration_seconds: real("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    checksum_sha256: text("checksum_sha256"),
    generator_provider: text("generator_provider"),
    generator_model: text("generator_model"),
    provider_asset_id: text("provider_asset_id"),
    created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    oneKeyPerProvider: uniqueIndex("content_assets_provider_key_unique").on(
      table.storage_provider,
      table.storage_key,
    ),
  }),
);

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id")
    .notNull()
    .references(() => missions.id),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  // "approved"|"cancelled" for missions, plus Content Bot's own vocabulary:
  // "approve_for_production"|"approve_content"|"reject_content"|
  // "request_revision"|"publish" — still plain text (see the file header),
  // the app layer's decision vocabulary just widened.
  decision: text("decision").notNull(),
  note: text("note"),
  decided_at: timestamp("decided_at", { mode: "string" }).notNull().defaultNow(),
  // Null for a mission-level approval (research dispatch, production
  // hand-off). Set for a decision made on a specific produced piece.
  content_item_id: text("content_item_id").references(() => contentItems.id),
  content_version_id: text("content_version_id").references(() => contentVersions.id),
});

export const costs = pgTable("costs", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id").references(() => missions.id),
  agent_id: text("agent_id").references(() => agents.id),
  model: text("model").notNull(),
  // Nullable — a media-generation call has no token count. Writing 0
  // would fabricate a number in the one table whose entire philosophy is
  // "never fabricate a number"; null here means "priced in a different
  // unit" (see `unit`/`quantity` below), not "unknown."
  input_tokens: integer("input_tokens"),
  output_tokens: integer("output_tokens"),
  // Null means real spend occurred but pricing for this model/provider is
  // unknown — never coerced to 0, never fabricated.
  usd_cost: real("usd_cost"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  content_item_id: text("content_item_id").references(() => contentItems.id),
  content_version_id: text("content_version_id").references(() => contentVersions.id),
  // Null for a Claude call (token-priced, see model above). Set for a
  // media-provider call: which provider, and what real unit its spend was
  // measured in (seconds/images/characters/compute_seconds).
  provider: text("provider"),
  unit: text("unit"),
  quantity: real("quantity"),
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
