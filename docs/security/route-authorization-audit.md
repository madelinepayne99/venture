# Venture HQ — Route & Authorization Audit

**Mission 11: Operation Lockdown.** Generated from the actual repository
(every `app/api/**/route.ts` file, every domain workflow function it
calls, and every background job in `lib/jobs/`), not from a guessed
list. Audit performed 2026-10-15 against commit `d49bf0c` (baseline:
66 test files / 799 tests, confirmed passing before any change).

This is also the "Route → Resource → Required Role → Tenant Ownership →
Negative Test" matrix section 20 of the mission brief asked for — the
summary table below **is** that matrix. See "Maintaining this matrix"
at the end for how to extend it when a new route is added.

## Methodology

1. Every file matching `app/api/**/route.ts` was located via `find` (52
   files) and read in full.
2. For each route, the domain-layer function(s) it calls were traced and
   read in full, checking specifically: does it resolve the organization
   from the verified session (`getActiveOrganizationForFounder`), and
   does it verify the requested resource's own `organization_id` (or
   `founder_id`, for personal — not organization-shared — resources like
   Executive Assistant tasks) matches before returning or mutating
   anything?
3. Every `export async function get*`/`list*` in `lib/db/repositories.ts`
   that takes a bare resource id (no `organizationId` parameter) was
   cross-referenced against every `app/api/**` file to find any route
   that calls it **directly**, bypassing the domain layer's ownership
   checks — this is exactly the shape of the one critical bug found (see
   Finding 1).
4. Two real, isolated fictional organizations ("Bakery HQ" / "Landscaping
   HQ") were provisioned directly in the real dev database (no GitHub
   OAuth available in this sandbox — real session rows created directly,
   the same technique used throughout this project's history for live
   verification), with real missions, costs, ledger entries, a deliverable,
   and a support request for Bakery. Landscaping's real session was then
   used to attack Bakery's real resources across ~12 distinct vectors
   (direct GET/POST, cross-org mutation attempts, cross-org project
   injection, role-restricted actions attempted by a plain member). All
   fictional data was removed afterward; Ellis/Maddie's real data was
   confirmed untouched before and after.
5. Background jobs (`lib/jobs/*.ts`) were read in full, checking
   specifically whether they trust any founder/organization claim in an
   external event payload, or re-resolve ownership from the authoritative
   database row.

## Summary: every route

Legend — **Auth**: session required (all routes except the three starred
exceptions). **Org**: how the organization is resolved. **Role**: role
restriction beyond plain membership. **Ownership**: how resource ownership
is verified. **Status**: ✅ verified secure within tested scope · 🔧 fixed
this audit · — not applicable (no resource id, or intentionally global
data).

| Route | Method | Org resolution | Role gate | Ownership check | Status |
|---|---|---|---|---|---|
| `/api/auth/[...nextauth]` | * | Auth.js itself | — | — | ✅ (allow-list in `lib/auth/allowList.ts`, see Auth section) |
| `/api/inngest` | GET/POST/PUT | — (system) | — | Inngest SDK signature (`INNGEST_SIGNING_KEY`) | ✅ framework-verified |
| `/api/billing/webhook` | POST | — (system) | — | Stripe signature (`STRIPE_WEBHOOK_SECRET`) | ✅ verified live (signature tests) |
| `/api/account/delete` | POST | session-derived | self only | `deleteFounderAccount` — exact confirm phrase, refuses shared-org orphaning | ✅ |
| `/api/account/export` | GET | session-derived | self only | `exportFounderData` — own memberships only | ✅ live-attacked, clean |
| `/api/agent-tasks` | GET/POST | — (personal) | — | `founder_id` match (`executiveAssistantWorkflow.ts`) | ✅ |
| `/api/agent-tasks/[id]` | PATCH | — (personal) | — | `founder_id` match | ✅ |
| `/api/agent-tasks/[id]/submit-for-review` | POST | org-derived | — | `founder_id` + `organization_id` | ✅ |
| `/api/agents` | GET | — (global catalog) | — | n/a — agent type catalog is intentionally global, not customer data | — |
| `/api/billing/checkout` | POST | org-derived | owner/admin | `requireOrganizationRole`; plan validated server-side | ✅ |
| `/api/billing/portal` | POST | org-derived | owner/admin | `requireOrganizationRole`; requires real `stripe_customer_id` | ✅ |
| `/api/billing/status` | GET | org-derived | — | `resolveOrganizationSubscription(organization.id)` | ✅ |
| `/api/budget` | GET | org-derived | — | `getBudgetStatusForOrganization(organization.id)` | ✅ live-attacked, clean |
| `/api/business-analyst/research` | GET/POST | — (personal) | — | `founder_id` match | ✅ |
| `/api/business-analyst/research/[id]` | GET | — (personal) | — | `founder_id` match | ✅ |
| `/api/business-analyst/research/[id]/submit-for-review` | POST | org-derived | — | `founder_id` + `organization_id` | ✅ |
| `/api/checklists` | GET/POST | — (personal) | — | `founder_id` match | ✅ |
| `/api/checklists/[id]` | GET/POST | — (personal) | — | `requireOwnedChecklist` (shared helper) | ✅ |
| `/api/checklists/[id]/items/[itemId]` | PATCH | — (personal) | — | owned checklist + item found within it | ✅ |
| `/api/checklists/[id]/submit-for-review` | POST | org-derived | — | `founder_id` + `organization_id` | ✅ |
| `/api/chief-of-staff/goals` | GET/POST | — (personal) | — | `founder_id` match | ✅ |
| `/api/chief-of-staff/goals/[id]` | GET | — (personal) | — | `founder_id` match | ✅ |
| `/api/chief-of-staff/goals/[id]/submit-for-review` | POST | org-derived | — | `founder_id` + `organization_id` | ✅ |
| `/api/chief-of-staff/subtasks/[id]/run-research` | POST | — (personal) | — | `founder_id` match, agent/state checked | ✅ |
| `/api/content-items/[id]` | GET | org-derived | — | `getContentItemDetail(id, organization.id)` | ✅ |
| `/api/content-items/[id]/decision` | POST | org-derived | — | `assertContentItemInFoundersOrganization` + `assertIsLatestVersion` (sub-resource check) | ✅ |
| `/api/content-items/[id]/cancel` | POST | org-derived | — | `assertContentItemInFoundersOrganization` | ✅ |
| `/api/content-items/[id]/retry-production` | POST | org-derived | — | `assertContentItemInFoundersOrganization` | ✅ |
| `/api/content/assets/[assetId]/stream` | GET | org-derived | — | `getOwnedContentAsset` — full asset→version→item→mission→org chain | ✅ live-attacked (missing-id case), unit-proven (owned/unowned case) |
| `/api/employees` | GET | org-derived | — | `listEmployeeDirectory(organization.id)` | ✅ live-attacked, clean |
| `/api/employees/[key]/recruit` | POST | org-derived | owner/admin | `requireOrganizationRole` | ✅ live-attacked (member refused) |
| `/api/employees/[key]/remove` | POST | org-derived | owner/admin | `requireOrganizationRole` | ✅ |
| `/api/finance/budgets` | GET/POST | org-derived | — | `organization.id` scoped | ✅ |
| `/api/finance/budgets/[category]` | GET | org-derived | — | `organization.id` scoped | ✅ |
| `/api/finance/expenses` | GET/POST | org-derived | — | `organization.id` scoped | ✅ |
| `/api/finance/reports` | POST | org-derived | — | `submitFinanceReport` → `organization.id` | ✅ |
| `/api/founders-desk/deliverables/[id]` | GET | org-derived | — | **was: none at all** → now `getOwnedAgentDeliverable` | 🔧 **FIXED — CRITICAL** |
| `/api/founders-desk/deliverables/[id]/review` | POST | org-derived | owner/admin | `organization_id` match (already correct) | ✅ |
| `/api/founders-desk/inbox` | GET | org-derived | — | `listFoundersDeskInbox(organization.id)` | ✅ |
| `/api/founders-desk/scout/[missionId]/review` | POST | org-derived | owner/admin | `organization_id` match | ✅ |
| `/api/founders` | GET | org-derived | — | `listFoundersForOrganization` (fixed Mission 10) | ✅ live-attacked, clean |
| `/api/ledger` | GET | org-derived | — | `listLedgerEntriesForOrganization` (fixed Mission 10) | ✅ live-attacked, clean |
| `/api/missions` | GET/POST | org-derived | — | `listMissionsForOrganization`; **POST projectId was unchecked** | 🔧 **FIXED — projectId ownership** |
| `/api/missions/[id]` | GET | org-derived | — | `getMissionDetail(id, organization.id)` | ✅ live-attacked, clean |
| `/api/missions/[id]/approve` | POST | org-derived | — | `approveMission` → `organization_id` match | ✅ |
| `/api/missions/[id]/cancel` | POST | org-derived | — | `cancelMission` → `organization_id` match | ✅ live-attacked, clean |
| `/api/missions/[id]/approve-production` | POST | org-derived | — | `approveForProduction` → `organization_id` match | ✅ live-attacked, clean |
| `/api/missions/[id]/commission-pilot` | POST | org-derived | — | `commissionPilotAnyway` → `organization_id` match | ✅ unit-proven |
| `/api/missions/[id]/produce-again` | POST | org-derived | — | **ordering bug**: replay returned data before ownership check | 🔧 **FIXED — HIGH** |
| `/api/organizations` | GET/POST | session-derived | — | own real memberships only; `createOrganizationWithOwner` | ✅ |
| `/api/projects` | GET/POST | org-derived | — | `organization.id` scoped; `createWorkspace` | ✅ |
| `/api/support` | GET/POST | org-derived (optional) | — | `listSupportRequestsForFounder`/rate-limited create | ✅ live-attacked, clean |

## Findings

### Finding 1 — CRITICAL: unauthenticated-ownership deliverable read

**Route:** `GET /api/founders-desk/deliverables/[id]`
**Before:** `requireFounderId()` was called but its return value discarded
(`await requireFounderId();` with no assignment), then the route called
the globally unscoped `getAgentDeliverable(id)` directly from
`lib/db/repositories.ts` — a bare `SELECT ... WHERE id = $1`, no
organization or founder filter at all.
**Impact:** any authenticated founder, from any organization, could read
any other organization's deliverable content (Scout reports, Business
Analyst reports, Executive Assistant summaries, checklist reviews, Chief
of Staff goal consolidations) and its full review history, by observing
or guessing a deliverable id.
**Root cause:** the sibling mutation route
(`POST .../deliverables/[id]/review`) was correctly written against the
domain layer (`reviewAgentDeliverable`, which does check
`organization_id`); this GET route was added separately and never routed
through the same check.
**Fix:** `lib/domain/foundersDeskWorkflow.ts#getOwnedAgentDeliverable` — a
new, centralized ownership check (mirrors `contentWorkflow.ts`'s existing
`getOwnedContentAsset` pattern) that both this route and any future route
touching a deliverable by id should use. The route no longer imports
`getAgentDeliverable` from the repository layer at all.
**Proof:** `tests/crossTenantDeliverableSecurity.test.ts` (4 tests) —
direct coverage of `getOwnedAgentDeliverable` (owner can read their own,
an unrelated organization gets the same `FoundersDeskNotFoundError` for a
real-but-foreign id as for a non-existent one — no existence oracle), plus
a static source-scan proving the real route's import of
`getAgentDeliverable` from the repository layer is gone (checked at the
import-line level specifically, so a doc comment mentioning the old
function by name when explaining this very bug doesn't false-positive the
check).

### Finding 2 — HIGH: idempotency-replay ordering bug

**Function:** `produceAgainFromMission` (`lib/domain/contentWorkflow.ts`),
reached via `POST /api/missions/[id]/produce-again`.
**Before:** the idempotency-replay branch (`getContentItem(input.idempotencyKey)`
→ return it if found) ran **before** the function had verified the
caller's organization owned `missionId`. `idempotencyKey` is raw,
unvalidated client input (`typeof body.idempotencyKey === "string" ? body.idempotencyKey : ""`
in the route — no check that it's a UUID the caller actually generated).
**Impact:** a caller who supplied a real `(missionId, contentItemId)` pair
belonging to an unrelated organization — ids that can leak via logs,
referrer headers, a shared screenshot, or enumeration — received that
organization's full `ContentItem` row with zero membership check.
**Fix:** moved the organization-ownership check (fetch `mission`, fetch
`organization`, compare) to run before the replay lookup.
**Proof:** `tests/crossTenantContentSecurity.test.ts` — the exact exploit
shape, verified to **fail against the unfixed code** (confirmed live by
temporarily reverting the fix and re-running the test) before confirming
it passes with the fix restored.

### Finding 3 — MEDIUM/HIGH: cross-tenant project foreign-key injection

**Function:** `createAndSubmitMission` (`lib/domain/missionWorkflow.ts`),
reached via `POST /api/missions`.
**Before:** `projectId` is raw client input (`body.projectId`, passed
straight through when present) and was never verified to belong to the
caller's own organization before being written onto the new mission's
real, FK-constrained `project_id` column.
**Impact:** an attacker who knew (or guessed) a real project id belonging
to an unrelated organization could create a mission cross-linked to it.
Consequences found: (a) `resolveWorkspaceType` would then resolve the
mission's workspace type from a workspace the caller's own organization
doesn't own, a real cross-tenant data-integrity defect; (b) the distinct
error shape for a non-existent vs. real-but-foreign project id is a weak
existence oracle for other organizations' real project ids. Confirmed the
mission itself stays attributed to the attacker's own `organization_id`
(no direct cross-org *read* leak was found via the normal UI paths, which
filter missions by the viewer's own already-org-scoped project list) —
classified MEDIUM/HIGH as a data-integrity/unauthorized-write issue, not
a confirmed direct information-disclosure one.
**Fix:** a supplied `projectId` is now resolved and checked
(`project.organization_id !== organization.id` → refused) before the
mission is created.
**Proof:** `tests/crossTenantContentSecurity.test.ts`, verified to fail
against the unfixed code (same revert-and-confirm method as Finding 2)
and confirmed live via the Bakery/Landscaping attack session (Attack 5 in
the live-testing log above).

## Database-layer audit (`lib/db/repositories.ts`)

Every exported `get*`/`list*` function taking a bare resource id (no
`organizationId` parameter) was cross-referenced against every
`app/api/**/route.ts` file for a direct call. **Result: `getAgentDeliverable`
(Finding 1) was the only case where a route called such a function
directly, bypassing the domain layer.** Every other single-id getter
(`getFounder`, `getAgentTask`, `getChiefOfStaffGoal`, `getChecklist`,
`getMission`, `getContentItem`, `getContentVersion`, `getContentAsset`,
`getBusinessAnalystReport`) is only ever called from within a domain
workflow function, each individually verified above to check real
ownership before using the result. `getOrganizationById` is called
directly from `GET /api/organizations`, but only ever with ids drawn from
the founder's own real `listOrganizationMembershipsForFounder(founderId)`
result — never an arbitrary client-supplied id.

No unscoped `UPDATE`/`DELETE` statement in `repositories.ts` is called
directly from a route without an ownership check already having run in
the calling domain function (verified by the same route-by-route trace
above — every mutating route goes through a domain function, and every
domain function checked resolves organization/founder ownership before
its first write). SQL injection surface: zero raw string-concatenated
queries found — every `sql\`...\`` usage in the codebase uses Drizzle's
tagged-template interpolation correctly (parameterized, not string-built).
Path traversal: `lib/storage/localDisk.ts#resolvePath` already guards
against an escaping storage key (`path.resolve` + root-prefix check),
and real asset storage keys are always server-generated, never client
input.

## Background jobs (`lib/jobs/*.ts`)

| Job | Trigger | Payload trusted? | Ownership re-resolution |
|---|---|---|---|
| `scoutResearchJob` | `mission/approved`, `mission/followup_needed` | Only `missionId` (no founder/org claim in the payload at all) | `runScoutPipeline` re-reads the mission's real `organization_id` from the database every time — never trusts anything beyond the id |
| `contentProductionJob` | `content/production_requested`, `content/revision_requested` | Only `contentItemId` | `runContentProductionPipeline` resolves organization via the real mission chain |
| `stuckMissionWatchdog` / `followupDispatchWatchdog` | cron (no external payload) | n/a | Operates on real, currently-stale DB rows across all organizations — an intentional system-level maintenance job, not customer-facing data access |
| `contentWatchdog` / `revisionDispatchWatchdog` | cron | n/a | Same pattern as above |

No job accepts a founder id, organization id, or role claim from its
triggering event — every one re-resolves the authoritative owner from the
real database row at execution time. `concurrency: { limit: 1, key: ... }`
on both dispatch jobs prevents a duplicate/concurrent trigger for the
same resource from running the pipeline twice (already covered by
existing concurrency tests in `tests/jobs.test.ts`).

## Authentication & session

- Allow-list: `founders.email` is the only allow-list, checked in
  `auth.ts`'s `signIn` callback before a session is ever created
  (`lib/auth/allowList.ts`, independently unit-tested, 8 tests).
- Route gate: `lib/auth/routeGate.ts#decideRouteGate` — exactly four
  paths bypass the session requirement: `/login` (public page),
  `/api/auth/**` (Auth.js's own), `/api/inngest` (Inngest's own
  signature), `/api/billing/webhook` (Stripe's own signature). Confirmed
  via direct source read — no other path is excluded.
- `requireFounderId()` is the only way a route resolves the acting
  founder, always from the verified `auth()` session, never a request
  body/query/header. Confirmed via `grep` across every route file: zero
  matches for `body.founderId`/`body.organizationId`.
- Session cookie: no custom `sameSite`/cookie config anywhere in this
  codebase — Auth.js v5's safe `SameSite=Lax` default applies, the
  standard CSRF mitigation for this app's cookie-based session.
- Account-deletion session invalidation: deleting a founder's account
  deletes their `auth_user` row (linked by email), which cascades
  (`onDelete: "cascade"`) to remove every `auth_session`/`auth_account`
  row for them — confirmed live in Mission 10's own verification and
  re-confirmed by this audit's live attack session staying scoped to
  genuinely active sessions only.
- CSRF on state-changing routes: every mutating route requires the
  session cookie (not forgeable cross-site under `SameSite=Lax`) and a
  JSON body — no state-changing route accepts a plain, CSRF-able GET.

## Live cross-tenant attack session (Bakery HQ vs. Landscaping HQ)

Two real, isolated fictional organizations with real sessions, real
missions, real costs/ledger entries, a real deliverable, and a real
support request for Bakery. Landscaping's real session attempted:

1. `GET` Bakery's mission by id → 404, no data.
2. `GET` Bakery's deliverable by id (the just-fixed route) → 404, no data.
3. `POST` cancel Bakery's mission → 404, refused.
4. `POST` approve-production on Bakery's mission (with real evidence ids
   supplied, so the real ownership check — not just input validation —
   was what refused it) → 404, refused.
5. `POST` create a mission naming Bakery's real `projectId` → 400,
   refused (Finding 3, confirmed live).
6. `GET /api/ledger` → empty, Bakery's real `-$1.50` entry never appears.
7. `GET /api/founders` → only Landscaping's own founder.
8. `GET /api/support` → empty, Bakery's real support request never
   appears.
9. `GET /api/budget` → Landscaping's own real (unused) allowance, not
   Bakery's.
10. `GET /api/employees` → Landscaping's own directory.
11. `GET /api/missions` → empty, Bakery's real mission never appears.
12. `GET /api/account/export` → Landscaping's own data only; a grep for
    secret-looking strings (`sk_live`, `sk_test`, API keys, "secret",
    "password") across Bakery's own real export came back clean.

A plain "member"-role founder added to Landscaping's own organization was
then attacked against owner/admin-gated actions: recruiting an employee
(403), starting Stripe checkout (403), opening the billing portal (403) —
all correctly refused — while an ordinary read (`GET /api/missions`, 200)
correctly succeeded, confirming the role gate narrows exactly the
privileged actions, not all access.

All fictional data (3 founders, 2 organizations, their missions/costs/
ledger entries/deliverables/support requests/auth rows) was created
directly in the real dev database for this session and fully removed
afterward; Ellis's and Maddie's real founder rows and "Founders' HQ" were
confirmed untouched both before and after.

## Maintaining this matrix

When a new route or background job is added:

1. Add a row to the summary table above: route, HTTP method, how the
   organization is resolved (`getActiveOrganizationForFounder` almost
   always), any role gate (`requireOrganizationRole`), and exactly which
   function/check proves ownership of the specific resource the route
   touches.
2. If the route takes a resource id from its path or body, write a
   cross-tenant negative test in the style of
   `tests/crossTenantContentSecurity.test.ts` or
   `tests/organizationIsolation.test.ts` — two real, independent
   organizations, one resource owned by the first, an access attempt from
   the second, asserting the same "not found"/role-refused shape a
   genuinely missing resource would produce.
3. Before trusting a route is safe, grep for it in this document (`grep
   "/api/your-new-route" docs/security/route-authorization-audit.md`) —
   an entry here with a real ownership-check column is the actual
   acceptance bar, not "it compiles" or "the happy path works."
4. If the new resource is **personal** (owned by one founder, not shared
   across their organization — like Executive Assistant tasks or
   personal checklists), document that explicitly in the Ownership
   column — `founder_id` matching is the correct, intentionally tighter
   check there, not a gap.
5. Re-run this audit's cross-tenant attack technique (two fresh fictional
   organizations, direct HTTP requests with the other's real resource
   ids) at least once per milestone that adds new customer-facing data,
   not only when a bug is suspected.
