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
  // Real account deletion (Mission 10). Null for every real, active
  // founder. Set (alongside name -> "Deleted Founder" and email -> null)
  // by deleteFounderAccount — never a hard DELETE of this row, so every
  // real mission/cost/deliverable that references this founder_id keeps
  // working and keeps its real history, consistent with this schema's
  // own insert-only/never-fabricate philosophy. email is nulled (not
  // just left as-is) specifically so the same real GitHub account can
  // genuinely sign up again later as a brand-new account, per
  // ensureFounderAccount's own "find by email" lookup.
  deleted_at: timestamp("deleted_at", { mode: "string" }),
});

// --- Multi-tenancy (Master Development Mission 6) -------------------------
//
// An `organization` is one customer's private Venture HQ — the real tenant
// boundary. `founders` stays exactly what it already was (a real, GitHub-
// authenticated person allowed to sign in — see CLAUDE.md's Authentication
// section); it is deliberately NOT renamed or repurposed to mean "business",
// since a future person may belong to more than one organization (an
// accountant helping two separate real clients, for instance). The two are
// linked by `organization_members`, a real many-to-many: supporting multiple
// members per organization AND multiple organizations per founder from day
// one, even though this milestone's own supported customer experience keeps
// a signed-in founder on one active organization at a time (a client-side
// preference, not a schema limitation — see `lib/domain/organizationWorkflow.ts`).
//
// `owner_founder_id` is denormalized from `organization_members` (where a
// membership's own `role` would already say "owner") specifically so
// "who owns this organization" is a single indexed lookup, not a query over
// every member row — the same reasoning `missions.founder_id` already uses
// instead of forcing every read through a join.
// Plain text, not a Postgres enum — same reasoning as every other status/
// type column in this codebase (see schema.ts's own data-model doc
// comment): the app layer is the source of truth for what values are
// legal, and a DB enum would need its own migration every time the
// vocabulary changes.
export const ventureStageValues = ["new_venture", "existing_business"] as const;

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner_founder_id: text("owner_founder_id")
    .notNull()
    .references(() => founders.id),
  // A real, customer-provided answer from onboarding (Mission 8, Section
  // 11/12's "choose whether they are starting a business or running an
  // existing business") — nullable because it's only ever set going
  // forward: Ellis and Maddie's existing "Founders' HQ" (and any
  // organization created before this column existed) legitimately has no
  // answer to a question it was never asked, and backfilling a guess
  // would be exactly the kind of fabricated data this codebase refuses
  // to invent.
  venture_stage: text("venture_stage"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  // Real account deletion (Mission 10) — set only when a sole owner with
  // no other real members closes their account (deleteFounderAccount).
  // Never a hard DELETE: every real mission/cost/deliverable this
  // organization ever produced keeps its real history for audit/
  // financial retention, consistent with this schema's own insert-only
  // philosophy. A closed organization is excluded from
  // getActiveOrganizationForFounder and every other real access path —
  // closed, not just hidden.
  closed_at: timestamp("closed_at", { mode: "string" }),
});

export const organizationMemberRoleValues = ["owner", "admin", "member"] as const;

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: text("id").primaryKey(),
    organization_id: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    founder_id: text("founder_id")
      .notNull()
      .references(() => founders.id),
    role: text("role").notNull().default("member"),
    created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    oneMembershipPerFounderPerOrg: uniqueIndex("organization_members_org_founder_unique").on(
      table.organization_id,
      table.founder_id,
    ),
  }),
);

// Per-organization workforce (Section 7) — replaces the global
// `agents.status` as the real "is this agent recruited" signal.
// Deliberately a separate table, not a new column on `agents`: `agents`
// stays the one shared, global CATALOG of what agent types exist at all
// (seeded once, read by every organization alike — see `lib/db/client.ts`'s
// `seedAgents()`, unchanged) — exactly the same "don't force-fit a column
// that was never shaped for this" call already made for
// `agent_deliverables` vs. the mission-scoped `deliverables`/`approvals`.
// `agents.status` itself is intentionally left alone by this migration —
// see the accompanying backfill in `lib/db/client.ts` for why repurposing
// it would have silently broken existing world-rendering/seed-upgrade code
// that already reads it for a different real purpose (whether an agent
// type is implemented at all, not whether any particular customer has it).
export const organizationAgentStatusValues = ["active", "planned"] as const;

export const organizationAgents = pgTable(
  "organization_agents",
  {
    id: text("id").primaryKey(),
    organization_id: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    agent_key: text("agent_key")
      .notNull()
      .references(() => agents.key),
    status: text("status").notNull().default("planned"),
    created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    oneRowPerAgentPerOrg: uniqueIndex("organization_agents_org_agent_unique").on(
      table.organization_id,
      table.agent_key,
    ),
  }),
);

// --- AI spending limits (Master Development Mission 7, Phase 4) ---------
//
// Real, server-side, atomic protection against unbounded provider spend —
// "launch-critical" per the founders' own brief. Two tables:
// `organization_budgets` is one row per organization's real, configured
// limits (a missing row means "use the safe application default", never
// "unlimited" — see lib/domain/budgetWorkflow.ts); `budget_reservations`
// is the real, atomic ledger a paid operation must successfully insert
// into BEFORE it's allowed to spend anything, and must settle (or
// release) afterward — the actual mechanism, not just a display number.

export const organizationBudgets = pgTable("organization_budgets", {
  id: text("id").primaryKey(),
  organization_id: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id),
  // Null means "use the application's own safe default" (see
  // DEFAULT_MONTHLY_BUDGET_USD in budgetWorkflow.ts) — never silently
  // "no limit." A founder/admin can configure a real, explicit ceiling
  // here once settings UI exists (Phase 9/16); nothing writes this yet
  // beyond tests, which is itself the honest, current state.
  monthly_usd_limit: real("monthly_usd_limit"),
  max_concurrent_paid_tasks: integer("max_concurrent_paid_tasks"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const budgetReservationStatusValues = ["reserved", "settled", "released"] as const;

export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: text("id").primaryKey(),
    organization_id: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Caller-supplied, real idempotency key — the actual mechanism
    // preventing a retried request from reserving (and later double-
    // charging) twice. A real DB-level unique constraint, not just an
    // application-level check, so two genuinely concurrent requests with
    // the same key can never both succeed.
    idempotency_key: text("idempotency_key").notNull().unique(),
    // What real capability this reservation is for — "scout_research" |
    // "business_analyst_research" | "content_production" | ... — plain
    // text, same "the app layer is the source of truth for the
    // vocabulary" philosophy every other status/category column in this
    // schema already follows.
    purpose: text("purpose").notNull(),
    // The real, safe worst-case amount reserved BEFORE the operation
    // runs — never the actual cost yet (that's unknown until the
    // provider call finishes). This is what's actually checked against
    // the organization's remaining budget at reservation time.
    reserved_usd: real("reserved_usd").notNull(),
    status: text("status").notNull().default("reserved"),
    // Set only once the real operation finishes and its genuine cost is
    // known (settleReservation) — null while still "reserved". Can
    // legitimately be less than, equal to, or (rarely, if an estimate
    // was wrong) more than reserved_usd; the reservation's own job was
    // only ever to prevent overspending AT THE TIME it was made.
    actual_usd_cost: real("actual_usd_cost"),
    created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
    settled_at: timestamp("settled_at", { mode: "string" }),
  },
);

// --- Subscription plans & billing (Mission 8, Sections 14-15) -----------
//
// Real organization-level entitlements, enforced server-side through the
// SAME atomic budget-reservation mechanism above — this section adds
// *what the ceiling is* (resolved from a real subscription plan instead
// of always DEFAULT_MONTHLY_BUDGET_USD), never a second, parallel
// enforcement path. Stripe billing is real, current-API code
// (lib/billing/stripe.ts) that runs in test mode only; with no
// STRIPE_SECRET_KEY configured (true in this sandbox — see CLAUDE.md's
// own "Local verification vs a real deployment" discipline, applied here
// identically to every other provider), billing routes refuse clearly
// rather than silently no-opping or granting access.

export const subscriptionPlans = pgTable("subscription_plans", {
  // Plain, stable slugs — "free" | "starter" | "business" | "growth" |
  // "founder" (Ellis/Maddie's own real plan, never purchasable via
  // Stripe — see organizationSubscriptions' own doc comment). Plain
  // text, not an enum, same reasoning as every other vocabulary column
  // in this schema.
  id: text("id").primaryKey(),
  display_name: text("display_name").notNull(),
  // Provisional, founder-approved-pending prices — see
  // docs/venture-hq-commercial-mvp-progress.md's own pricing analysis
  // for how these were derived from real measured costs plus researched
  // comparable tools, not invented. monthly_price_gbp is null for a plan
  // with no real price (free, founder).
  monthly_price_gbp: real("monthly_price_gbp"),
  // The real monthly AI research/text budget this plan grants —
  // resolved by budgetWorkflow.ts's getOrganizationBudgetConfig as the
  // real default when an organization has no explicit
  // organization_budgets override, replacing the flat
  // DEFAULT_MONTHLY_BUDGET_USD constant for every plan but "free" (which
  // is real monthly_ai_budget_usd: 0 — the actual mechanism behind "a
  // free organization can't consume paid AI usage", not just a UI
  // restriction).
  monthly_ai_budget_usd: real("monthly_ai_budget_usd").notNull(),
  // Content Bot video productions are disproportionately expensive
  // (up to MAX_ITEM_SPEND_USD each — $8) relative to a research task
  // (tens of cents) — a real, SEPARATE monthly counter from the dollar
  // budget above, per the founders' own explicit "separately controlled
  // allowances" instruction. Enforced by contentWorkflow.ts before a new
  // content item is ever created, independent of (and in addition to)
  // the existing per-item dollar cap.
  monthly_video_allowance: integer("monthly_video_allowance").notNull().default(0),
  // Whether this plan may recruit/use the three real agents with actual
  // paid AI execution (Scout, Content Bot, Business Analyst) — the real
  // "employee access" enforcement the founders asked for, checked
  // server-side in employeeWorkflow.ts's recruitEmployee, never just
  // hidden in the UI. The three manual/free agents (Executive Assistant,
  // Finance, Operations) and Chief of Staff's own delegation UI remain
  // available on every plan, including free.
  includes_paid_agents: boolean("includes_paid_agents").notNull().default(false),
  // Real Stripe Price ID once a real Stripe product/price is created for
  // this plan (test mode) — null until then, and permanently null for
  // "free"/"founder", which are never purchased through Stripe.
  stripe_price_id: text("stripe_price_id"),
  // Gates whether a plan is shown on the real customer-facing pricing
  // page at all — every plan here starts false (provisional prices,
  // explicitly not yet founder-approved for publication) until a
  // founder deliberately flips it.
  is_published: boolean("is_published").notNull().default(false),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const subscriptionStatusValues = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
] as const;

export const organizationSubscriptions = pgTable("organization_subscriptions", {
  id: text("id").primaryKey(),
  organization_id: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id),
  plan_id: text("plan_id")
    .notNull()
    .references(() => subscriptionPlans.id),
  status: text("status").notNull().default("active"),
  // Real Stripe references once a real checkout completes (test mode) —
  // both null for "free"/"founder" organizations, which never go
  // through Stripe at all.
  stripe_customer_id: text("stripe_customer_id"),
  stripe_subscription_id: text("stripe_subscription_id"),
  current_period_end: timestamp("current_period_end", { mode: "string" }),
  cancel_at_period_end: boolean("cancel_at_period_end").notNull().default(false),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

// Real idempotency for Stripe webhook processing — Stripe's own delivery
// guarantee is "at least once", so the same real event can genuinely
// arrive twice (a retry after a slow response, a dashboard resend). The
// event's own real Stripe id is the primary key: a second delivery's
// insert attempt collides on it (ON CONFLICT DO NOTHING in the handler),
// so its entitlement-changing side effects run at most once — the same
// real discipline budget_reservations' idempotency_key already follows.
export const billingWebhookEvents = pgTable("billing_webhook_events", {
  id: text("id").primaryKey(), // the real Stripe event id, e.g. "evt_..."
  type: text("type").notNull(),
  processed_at: timestamp("processed_at", { mode: "string" }).notNull().defaultNow(),
});

// --- Customer support (Mission 10) ---------------------------------------
//
// A real, server-side-persisted support ticket — the actual mechanism
// behind "Create an accessible Help & Support section... a genuine
// server-side persistence mechanism" (not a contact form that silently
// does nothing, and not a claim of real email delivery this app can't
// back up — no email provider is configured in this environment; see
// lib/domain/supportWorkflow.ts's own doc comment).
export const supportRequestStatusValues = ["open", "in_progress", "resolved"] as const;

export const supportRequests = pgTable("support_requests", {
  id: text("id").primaryKey(),
  organization_id: text("organization_id").references(() => organizations.id),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
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

// Chief of Staff (Operations Wing). A goal is the immutable grouping
// container for a founder's stated objective — its real delegated work
// lives entirely in `agent_tasks` rows (see `goal_id` below), not
// duplicated here. Defined before `agentTasks` specifically so that
// table's new `goal_id` column can reference it.
export const chiefOfStaffGoals = pgTable("chief_of_staff_goals", {
  id: text("id").primaryKey(),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  // Nullable for this migration only — see the multi-tenancy backfill in
  // lib/db/client.ts's ensureDefaultOrganization(). Every row, including
  // every pre-existing one, is backfilled to a real organization at
  // startup; a future migration tightens this to NOT NULL once that's
  // verified. Never read as "global" when null — see
  // lib/domain/organizationWorkflow.ts's own doc comment.
  organization_id: text("organization_id").references(() => organizations.id),
  title: text("title").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

// Operations Wing (Milestone 6): a general-purpose task record for the
// non-mission agents (Executive Assistant, Chief of Staff, Finance,
// Business Analyst, Operations). Deliberately NOT the `missions` table —
// missions carries Scout/Content-Bot-specific concepts (workspace type,
// research_pass_count, content-item hand-off) that don't apply to "remind
// me Friday" or "add this expense". Keeping these separate means nothing
// about missions, Scout, or Content Bot changes to support this. A task
// belongs to exactly one agent and one founder; `payload`/`result` are
// jsonb specifically because each task_type's shape genuinely differs
// (a reminder's payload isn't a checklist's) — this mirrors how
// content_items already uses jsonb for the same real reason (brief,
// audience_context, plan).
export const agentTaskStateValues = ["open", "in_progress", "completed", "cancelled"] as const;

export const agentTasks = pgTable("agent_tasks", {
  id: text("id").primaryKey(),
  agent_key: text("agent_key")
    .notNull()
    .references(() => agents.key),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  // Nullable for this migration — see chief_of_staff_goals's own comment
  // above; the same backfill covers this table.
  organization_id: text("organization_id").references(() => organizations.id),
  task_type: text("task_type").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  state: text("state").notNull().default("open"),
  due_at: timestamp("due_at", { mode: "string" }),
  payload: jsonb("payload"),
  result: jsonb("result"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  // Chief of Staff (Milestone 6, Slice 5): set only on a task Chief of
  // Staff itself delegated as part of breaking down a founder's goal —
  // null for every ordinary task created directly by/for its own agent
  // (an Executive Assistant reminder, a Finance Agent record, etc.).
  // Nullable and additive, exactly like content_items_id on mission_stages
  // (Milestone 5) — existing rows are unaffected.
  goal_id: text("goal_id").references(() => chiefOfStaffGoals.id),
});

// Finance Agent (Operations Wing). Deliberately its OWN tables, not a
// reuse of `ledger_entries`/`costs` — those are hard-coded to USD
// (`amount_usd`, built for real provider-spend tracking) and the
// founder's own real example here is in GBP. Silently treating £12 as
// $12 would be exactly the kind of fabrication CLAUDE.md's safety rules
// forbid, so `expenses`/`budgets` carry their currency explicitly instead
// of assuming one. Provider costs stay exactly where they are — this is
// additive, not a migration of existing data.
export const expenses = pgTable("expenses", {
  id: text("id").primaryKey(),
  // The most urgent real gap this migration closes: expenses previously
  // had NO ownership column at all — a genuinely global, shared table
  // regardless of which business logged what. Nullable here only for the
  // same safe-backfill reason as every other table in this migration.
  organization_id: text("organization_id").references(() => organizations.id),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull(),
  incurred_at: timestamp("incurred_at", { mode: "string" }).notNull().defaultNow(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

// One budget ceiling per category+period. No founder_id — like
// ledger_entries, this is a shared business ledger, not per-founder data
// (consistent with how listLedgerEntries/ledgerTotalUsd already work
// globally, not scoped to a founder).
export const budgetPeriodValues = ["monthly", "one_off"] as const;

export const budgets = pgTable("budgets", {
  id: text("id").primaryKey(),
  // Same real gap as expenses above — previously no ownership at all.
  organization_id: text("organization_id").references(() => organizations.id),
  category: text("category").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull(),
  period: text("period").notNull().default("monthly"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

// Operations Agent (Operations Wing). A checklist is structurally distinct
// from a single agent_tasks row — it's an ORDERED list of independently
// completable items, not one task with one state — so forcing it into
// agent_tasks' payload jsonb would mean hand-rolling item-level mutation
// logic on top of a column that was never shaped for it. Two small, real
// tables instead, the same "don't force-fit, give it its own honest shape"
// call already made for expenses/budgets vs. ledger_entries/costs.
export const checklists = pgTable("checklists", {
  id: text("id").primaryKey(),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  organization_id: text("organization_id").references(() => organizations.id),
  title: text("title").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const checklistItems = pgTable("checklist_items", {
  id: text("id").primaryKey(),
  checklist_id: text("checklist_id")
    .notNull()
    .references(() => checklists.id),
  label: text("label").notNull(),
  position: integer("position").notNull(),
  is_done: boolean("is_done").notNull().default(false),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

// Business Analyst (Operations Wing). One row per real research request —
// deliberately NOT missions (this is a standalone founder question, e.g.
// "how saturated is the Etsy planner niche?", not a Scout-style mission
// with a workspace/approval/production lifecycle) and NOT agent_tasks
// (the result is a structured report, not a completable to-do). `report`
// is null when `state` is "failed" — a failed run is still persisted
// (with its real token usage) rather than silently discarded, the same
// "never drop real cost" discipline Scout's own failure path follows.
export const businessAnalystReportStateValues = ["completed", "failed"] as const;

export const businessAnalystReports = pgTable("business_analyst_reports", {
  id: text("id").primaryKey(),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  organization_id: text("organization_id").references(() => organizations.id),
  query: text("query").notNull(),
  state: text("state").notNull(),
  report: jsonb("report"),
  error: text("error"),
  model: text("model").notNull(),
  input_tokens: integer("input_tokens"),
  output_tokens: integer("output_tokens"),
  usd_cost: real("usd_cost"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

// --- Universal Founders' Desk (Milestone 4 of the Commercial MVP
// mission) --- a real, reviewable deliverable for the five Operations
// Wing agents, which have no `mission_id` to attach to the EXISTING
// `deliverables`/`approvals` tables (both `NOT NULL` on `mission_id` —
// deliberately left untouched; Scout/Content Bot's own review flows are
// protected and unmodified). This is the adapter the brief itself asks
// for: a SEPARATE, compatible table, not a forced reuse of a column that
// was never shaped for a non-mission deliverable. Scout's own missions
// are reviewed through the EXISTING `approvals` table (real mission_id,
// a new decision vocabulary — see that table's own comment); Content
// Bot's content items are reviewed through their EXISTING, fully
// protected `/api/content-items/[id]/decision` flow, unchanged. This
// table exists only for the five agents that had no reviewable-
// deliverable concept at all before this milestone.
export const agentDeliverableStateValues = ["awaiting_review", "approved", "rejected", "revision_requested"] as const;

export const agentDeliverables = pgTable("agent_deliverables", {
  id: text("id").primaryKey(),
  agent_key: text("agent_key")
    .notNull()
    .references(() => agents.key),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  organization_id: text("organization_id").references(() => organizations.id),
  // Which real entity this deliverable summarizes — "agent_task" |
  // "chief_of_staff_goal" | "checklist" | "finance_report" |
  // "business_analyst_report". Never a free-text label: always traces
  // back to a real row.
  source_type: text("source_type").notNull(),
  source_id: text("source_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  // The real, structured content a founder reviews — built entirely
  // from genuine recorded values by the submitting workflow (see
  // lib/domain/foundersDeskWorkflow.ts) — never invented here.
  content: jsonb("content").notNull(),
  state: text("state").notNull().default("awaiting_review"),
  version: integer("version").notNull().default(1),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

// Insert-only audit log of real founder decisions — the same "never
// overwrite a decision, only ever add to the record" philosophy the
// existing `approvals` table already uses.
export const agentDeliverableReviews = pgTable("agent_deliverable_reviews", {
  id: text("id").primaryKey(),
  deliverable_id: text("deliverable_id")
    .notNull()
    .references(() => agentDeliverables.id),
  founder_id: text("founder_id")
    .notNull()
    .references(() => founders.id),
  organization_id: text("organization_id").references(() => organizations.id),
  decision: text("decision").notNull(), // "approved" | "rejected" | "revision_requested"
  note: text("note"),
  decided_at: timestamp("decided_at", { mode: "string" }).notNull().defaultNow(),
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
  // Another real gap this migration closes: a workspace previously had
  // NO ownership at all — any founder/organization could see and create
  // missions under any workspace. Nullable only for the same safe-
  // backfill reason as every table in this migration.
  organization_id: text("organization_id").references(() => organizations.id),
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
  organization_id: text("organization_id").references(() => organizations.id),
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

// Milestone: one Scout mission -> many independent Content Item
// productions. Originally this table had a real, DB-level
// `content_items_one_active_per_mission` partial unique index (one
// non-terminal content item per mission at a time). That was dropped —
// see the migration that removed it — once the founders decided a single
// completed Scout research mission should be able to host multiple
// independent productions (Production 1, Production 2, ...), each with
// its own version lineage starting at V1, never a cloned mission and
// never re-run/copied Scout research. `mission_id` here is deliberately
// unconstrained now: `evidence`/`deliverables` stay mission-scoped and
// immutable exactly as before (read again, never copied), and every
// child table that matters (content_versions, content_assets, costs,
// approvals, mission_stages) was ALREADY scoped by content_item_id/
// content_version_id, not mission_id — so removing this one index is the
// complete cardinality change; nothing else here needed to move. See
// produceAgainFromMission in contentWorkflow.ts for the founder action
// that creates production 2+, and its own doc comment for how a genuine
// double-submit is still prevented without reintroducing a mission-level
// uniqueness limit.
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
    // A structured classification of WHY a "failed" item failed — set
    // alongside failure_reason at the exact point the pipeline settles a
    // real failure (see contentFailureClassification.ts). Plain text, not
    // a DB enum, matching every other status column's philosophy: the app
    // layer (RECOVERABLE_FAILURE_CATEGORIES) is the single source of truth
    // for which categories are eligible for Retry Production — never
    // inferred from failure_reason's free text, in the UI or anywhere
    // else. Null for every failure that isn't "failed" (a "blocked" safety
    // refusal has no category — it's not eligible for a technical retry
    // by construction, since it never reaches this classification point).
    failure_category: text("failure_category"),
    // What the version/attempt/spend caps in lib/domain/contentProduction.ts
    // are actually enforced against — not display counters, the same role
    // missions.research_pass_count plays for Scout's pass cap.
    version_count: integer("version_count").notNull().default(0),
    generation_attempt_count: integer("generation_attempt_count").notNull().default(0),
    next_analytics_pull_at: timestamp("next_analytics_pull_at", { mode: "string" }),
    created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  },
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
    // The Creative Quality milestone's two new quality-provenance artifacts
    // — persisted as real jsonb, exactly like plan/safety_verdict, so
    // founders can inspect why Content Bot made its creative and QC
    // decisions rather than only seeing the finished result. Null until
    // each stage actually runs; a technical retry (retryProductionAfterTechnicalFailure)
    // carries creative_strategy forward onto the new version (it's a
    // creative-layer artifact, unaffected by a provider failure) but never
    // qc_report (QC must re-run against the new version's freshly
    // generated assets).
    creative_strategy: jsonb("creative_strategy"),
    qc_report: jsonb("qc_report"),
    // How many real image-provider regenerations the Visual QC stage has
    // triggered for THIS version — the structural enforcement of "a QC
    // regeneration must never silently bypass the content-item spend cap"
    // and "nine bad images cannot create an uncontrolled retry fan-out"
    // (see MAX_QC_REGENERATIONS_PER_VERSION in contentProduction.ts).
    qc_regeneration_count: integer("qc_regeneration_count").notNull().default(0),
    // The reference-image continuity check's own verdict — deliberately
    // separate from qc_report above, since it's produced by an earlier,
    // distinct pipeline stage (reference_generation, which runs BEFORE
    // asset_generation's beat/thumbnail batch — see runReferenceGenerationStage
    // in contentWorkflow.ts) and gates a different, earlier decision: not
    // "is the finished batch OK to assemble" but "is it safe to spend on
    // the batch at all." Shape: { report: VisualQCReport;
    // reference_checksum_sha256: string }. The checksum is what makes a
    // copied-forward verdict (Retry Production) self-verifying — a verdict
    // is only ever trusted if it names the checksum of the reference asset
    // actually present on THIS version, never assumed valid just because
    // the field is non-null (see runReferenceGenerationStage's own resume
    // logic).
    reference_qc_verdict: jsonb("reference_qc_verdict"),
    // Mirrors qc_regeneration_count's exact pattern, scoped to the one
    // reference image instead of a batch of beat images — capped at
    // MAX_REFERENCE_REGENERATIONS (1) in contentProduction.ts.
    reference_regeneration_count: integer("reference_regeneration_count").notNull().default(0),
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
  // The one canonical creature/subject reference image a version's beat
  // images and thumbnail are conditioned against (fal.ai image-to-image
  // continuity — see runReferenceGenerationStage in contentWorkflow.ts).
  // Exactly one per version, never counted as a "still" in the plan's own
  // per-beat image set.
  "reference_image",
  // A real, genuinely generated motion video clip for one beat (see
  // CLAUDE.md's Content Bot motion-first milestone) — the primary visual
  // path's actual output per beat, replacing a static pan/zoom over the
  // beat's own "image" still (which is kept, used as this clip's Kling
  // start frame). Plain text column, no migration needed to add this
  // value — see this file's own note on state/status columns.
  "video_clip",
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
  // Master Development Mission 7 — the real attribution gap: previously
  // the ONLY way to attribute a cost to an organization was through a
  // mission, but Business Analyst's own standalone research (never
  // mission-scoped — see businessAnalystWorkflow.ts) recorded real spend
  // with mission_id null and no organization attribution at all. Direct
  // and nullable (not a guess dressed as a default — see the real,
  // verified backfill in lib/db/client.ts's ensureDefaultOrganization):
  // every NEW cost row sets this explicitly from its own real, resolved
  // organization, regardless of whether it also has a mission_id.
  organization_id: text("organization_id").references(() => organizations.id),
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
  // Mission 10 — the real second half of the same gap Mission 7 closed on
  // `costs`: this table had NO organization attribution at all (only a
  // nullable `mission_id`), and was being served completely unscoped to
  // every authenticated founder via GET /api/ledger and app/page.tsx —
  // a confirmed live cross-tenant leak of every organization's real
  // financial ledger. Direct and nullable for the same reason `costs.
  // organization_id` is nullable (a safe backfill for pre-existing rows,
  // not a guess dressed as a default) — every NEW row sets this
  // explicitly from `recordCost`'s already-resolved organization id.
  organization_id: text("organization_id").references(() => organizations.id),
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
