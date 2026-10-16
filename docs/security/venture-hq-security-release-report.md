# Venture HQ — Mission 11 Security Release Report

**Operation Lockdown.** Prepared 2026-10-16. Baseline before this mission:
66 test files / 799 tests, confirmed passing and tagged
`mission11-baseline-799tests`. Current: **68 test files / 809 tests**,
typecheck clean, production build clean.

This report is honest about scope: it covers what was actually inspected
and tested in this session, not a claim of exhaustive, permanent, or
externally certified security. See "What this report does not claim" at
the end.

## What was covered

- **52 of 52** real `app/api/**/route.ts` files — every one read in full
  and traced to its underlying domain-layer authorization logic.
- **6** real background workflows in `lib/jobs/` (`scoutResearchJob`,
  `contentProductionJob`, `stuckMissionWatchdog`,
  `followupDispatchWatchdog`, `contentWatchdog`, `revisionDispatchWatchdog`).
- Every resource type named in the mission brief: organizations,
  organization membership, employee recruitment, agent tasks, Scout
  missions, Content Bot production/assets, Business Analyst reports,
  Chief of Staff delegation, Executive Assistant tasks, finance records,
  operations checklists, Founders' Desk deliverables/approvals, support
  requests, data export, account deletion, subscriptions/billing, Stripe
  webhooks, Inngest handlers, and file/media-serving routes.
- The full database-access layer (`lib/db/repositories.ts`) — every
  bare-id getter cross-referenced against every route for a
  domain-layer bypass.
- A real, live cross-tenant attack session against the running
  application (two fictional organizations, ~12 attack vectors) and a
  real Playwright session testing sign-out/session-switch stale-state
  behavior.

## Vulnerabilities found and fixed this session

| # | Severity | Finding | Route/Function | Fix | Regression tests |
|---|---|---|---|---|---|
| 1 | **CRITICAL** | Cross-tenant read of any organization's deliverable + review history, zero ownership check | `GET /api/founders-desk/deliverables/[id]` | New centralized `getOwnedAgentDeliverable` | 4 (`crossTenantDeliverableSecurity.test.ts`) |
| 2 | **HIGH** | Idempotency-replay returned another organization's content item before ownership was checked | `produceAgainFromMission` / `POST /api/missions/[id]/produce-again` | Ownership check moved before the replay lookup | 2 of 6 (`crossTenantContentSecurity.test.ts`) |
| 3 | **MEDIUM/HIGH** | Client-supplied `projectId` written onto a new mission with no ownership check (cross-tenant FK injection + weak existence oracle) | `createAndSubmitMission` / `POST /api/missions` | `projectId` now verified to belong to the caller's organization | 2 of 6 (`crossTenantContentSecurity.test.ts`) |

All three fixes were verified by **temporarily reverting each one and
confirming its regression test genuinely fails against the unfixed
code**, then restoring the fix and confirming the test passes — not
written against already-fixed code with no proof it would have caught
the real bug.

Full severity classification used (per the mission brief):
**CRITICAL** = cross-customer data exposure, unauthorized financial
action, or authentication bypass (Finding 1 qualifies — deliverable
content and review history). **HIGH** = incorrect permissions or unsafe
account changes (Finding 2 — a real cross-tenant object disclosure
through a logic-ordering bug). **MEDIUM/HIGH** = Finding 3, classified
at the boundary: confirmed real unauthorized cross-tenant write and a
weak information-disclosure oracle, but no confirmed path to a direct
*sensitive-data read* leak was found through the normal UI (missions are
still correctly filtered by the viewer's own org-scoped project list
everywhere checked).

## VERIFIED SECURE WITHIN TESTED SCOPE

- Every other route's organization/founder ownership check (49 of 52
  routes), traced individually — see
  `docs/security/route-authorization-audit.md`'s full table.
- Role-based access control: `requireOrganizationRole(["owner", "admin"])`
  correctly gates employee recruitment/removal, Stripe
  checkout/portal, and deliverable/mission review — confirmed both by
  static trace and a live attack (a plain "member" role refused 403 on
  all three; an ordinary read still succeeded 200).
- Database layer: no repository function is called directly from a route
  bypassing domain-layer ownership checks, except the one now-fixed
  case (Finding 1). Zero SQL-injection surface (every query uses
  Drizzle's parameterized tagged templates — no string-concatenated
  query found anywhere in the codebase).
- Path traversal: `lib/storage/localDisk.ts`'s existing
  root-prefix guard, confirmed still in place; real asset storage keys
  are always server-generated, never client input.
- XSS: zero `dangerouslySetInnerHTML`, zero `eval`/`new Function` usage
  anywhere in the codebase (React's default escaping is the only
  rendering path for any user-supplied text, including support-ticket
  subject/message).
- CSRF: no custom cookie config anywhere — Auth.js v5's `SameSite=Lax`
  default applies to every session cookie; no state-changing route
  accepts a plain CSRF-able GET.
- Background jobs: none trust a founder/organization claim from an
  external event payload — every one re-resolves the authoritative
  owner from the real database row at execution time (traced in full
  for all 6 real jobs).
- Billing/Stripe: webhook signature verification over the raw request
  body (never parsed first), idempotent event processing
  (`recordBillingWebhookEventIfNew` checked before any entitlement
  change), organization id resolved only from Stripe's own
  server-signed metadata (`client_reference_id`/`subscription.metadata`)
  — never from anything the browser could influence at checkout-start
  time. Checkout/portal both role-gated.
- AI cost/quota: `reserveBudget`'s atomic, row-locked
  (`SELECT ... FOR UPDATE`) reservation is the only path to real AI
  spend across Scout, Business Analyst (including Chief-of-Staff-
  delegated research — traced to confirm no bypass), and Content Bot;
  confirmed via `grep` that all three real spend-producing call sites
  go through it.
- Session/auth boundary: the allow-list (`founders.email`), the route
  gate's exact 4-path exclusion list, `requireFounderId()`'s
  session-only resolution (grepped for any `body.founderId`/
  `body.organizationId` across every route — zero matches), and
  cascade session invalidation on account deletion — all confirmed by
  direct source read and, for session invalidation, by two live
  end-to-end runs (account deletion in Mission 10's own verification,
  and a real sign-out in this mission's Playwright pass).
- Stale client-side state after sign-out or switching sessions: a real
  Playwright run (sign in as Org A → confirm their own data renders →
  real sign-out → confirm the signed-out page shows no trace of Org A's
  data and a direct API call now returns 401 → a completely separate
  browser context signs in as Org B → confirms Org B sees only their
  own data, with Org A's marker absent from both the rendered page
  *and* the raw HTML source). All 9 checks passed; the only console
  messages were the expected 401s from in-flight requests during the
  sign-out transition itself (handled gracefully, not a crash — see
  Mission 10's `sessionGuard.ts`, confirmed to hold for real sign-out
  too, not just account deletion).

## FIXED (this session)

The 3 vulnerabilities in the table above. See
`docs/security/route-authorization-audit.md` for full root-cause detail
on each.

## REQUIRES FURTHER TESTING

- **Live, credentialed billing verification.** Every Stripe code path
  (checkout, portal, webhook signature verification, idempotency) is
  reviewed and unit-tested against a real signature-verification
  function, but no real Stripe test-mode account exists in this sandbox
  (confirmed: `STRIPE_SECRET_KEY` unset) — a real completed checkout has
  never been exercised end-to-end. This is a standing, named gap from
  Mission 8 onward, not new to this audit.
- **Real concurrent-load testing of the budget reservation lock** beyond
  the existing test suite's genuinely-concurrent test cases — the
  `SELECT ... FOR UPDATE` design is sound and already proven against
  real Postgres serialization in existing tests, but this audit did not
  add new load/stress testing beyond what already existed.
- **A real GitHub OAuth sign-in round-trip** — still not exercised in
  this sandbox (no OAuth app exists here); every live test in this
  report used a directly-provisioned real session row, the same
  technique this project has used since Mission 2 for this exact
  reason. The allow-list and session-shape code are reviewed and unit
  tested independently of the OAuth round-trip itself.
- **Rate limiting beyond the support-request endpoint.** Only
  `POST /api/support` has an explicit rate limit (5/hour/founder,
  Mission 10). No other route has one. Given every route requires a
  real, allow-listed founder session (no public/anonymous write surface
  exists anywhere in this app), the practical abuse risk is low, but a
  compromised or malicious founder account could still hammer any
  route — not tested or hardened against in this session.
- **A second, independent security reviewer's read of the same surface.**
  This audit was performed by one reviewer (this session) using one
  methodology (static trace + live attack). It found 3 real bugs that a
  prior review missed — the same could be true here.

## BLOCKED BEFORE LAUNCH

Unchanged from Mission 9/10's own reports — none of this session's
findings add a new blocker, but these remain real, named gaps:

- A real Stripe test-mode account (checkout cannot complete without
  it — see "Requires further testing" above).
- A real GitHub OAuth App for a real deployment.
- Final, founder-approved subscription prices and a refund policy.
- Qualified legal/data-protection review of the drafts in `docs/legal/`.

## Database migrations

**None.** This mission fixed authorization logic and added tests; no
schema change was needed or made.

## Real customer isolation checks performed

- Two real, isolated fictional organizations ("Bakery HQ" /
  "Landscaping HQ") provisioned directly in the real dev database, with
  real missions, costs, ledger entries, a deliverable, and a support
  request for Bakery.
- 12 direct HTTP attack attempts from Landscaping's real session against
  Bakery's real resources (missions, deliverables, cancel, approve-
  production, project-id injection, ledger, founders, support, budget,
  employees, missions-list, data export) — all correctly refused or
  empty.
- A plain "member"-role founder added to Landscaping, attacked against
  3 owner/admin-gated actions (recruit, checkout, portal) — all 403;
  confirmed an ordinary read still succeeded 200 for the same founder.
- A real Playwright sign-out/session-switch run (9 checks, detailed
  above).
- All fictional data (founders, organizations, memberships,
  subscriptions, projects, missions, costs, ledger entries,
  deliverables, support requests, auth rows) created for every one of
  these tests was fully removed from the real database afterward.
  Ellis's and Maddie's real founder rows and "Founders' HQ" organization
  were confirmed untouched, by direct query, before this mission started
  and again after it finished.

## Authentication findings

No defects found. See "VERIFIED SECURE WITHIN TESTED SCOPE" above for
what was specifically checked (allow-list, route gate, session
resolution, cookie defaults, cascade invalidation).

## Billing findings

No defects found in the reviewed code paths. See "REQUIRES FURTHER
TESTING" for the standing live-verification gap.

## Spending-control findings

No defects found. `reserveBudget`'s atomic reservation is the sole real
path to AI spend across all three spend-producing agents; no bypass
found via Chief-of-Staff delegation or any other traced path.

## Data export/deletion findings

No defects found this session. `exportFounderData` and
`deleteFounderAccount` (built in Mission 10) were both re-attacked live
in this mission (export: confirmed scoped to the caller's own real
memberships only, and a direct grep of a real export for secret-looking
strings came back clean; deletion: session-invalidation re-confirmed via
Playwright). The sole-owner-with-other-members refusal and the real
Stripe-subscription-cancellation-on-deletion logic were reviewed again
and found unchanged/correct — not re-exercised live this session beyond
what Mission 10 already proved, since no new code touched that path.

## Browser verification

Real Playwright run (this session): sign-out/session-switch stale-state
behavior, 9/9 checks passed, zero page crashes, expected (non-error)
401 console noise only during the sign-out transition itself. This
mission did not re-run the full desktop+mobile user-journey sweep
Mission 9/10 already performed (onboarding, billing Settings, Finance,
support, account export/deletion, employee recruitment, task assignment,
Founders' Desk review) — that existing coverage was reviewed for
continued relevance (nothing in those flows changed this session) but
not re-executed, since this session's live-testing time was spent on the
higher-value cross-tenant attack session instead. **Recommended
follow-up**, not blocking: re-run that full desktop+mobile sweep once
more before a real launch, specifically because this session's fixes
touched `missionWorkflow.ts`/`contentWorkflow.ts`, which those flows
exercise.

## Test totals

- Before this mission: 66 files / 799 tests.
- After this mission: **68 files / 809 tests** (+2 files, +10 tests —
  6 in `crossTenantContentSecurity.test.ts`, 4 in
  `crossTenantDeliverableSecurity.test.ts`).
- TypeScript: clean (`npx tsc --noEmit`, zero errors).
- Production build: clean (`npm run build`, zero errors/warnings beyond
  Next.js's own standard output).

## Git commits (this mission)

```
bd7f79f Mission 11 (Operation Lockdown): fix 3 real cross-tenant vulnerabilities
b401411 Mission 11: complete route-authorization audit + deliverable security tests
```

Tagged checkpoint before any change: `mission11-baseline-799tests`
(commit `d49bf0c`).

## Remaining external requirements (unchanged from prior missions)

1. A real Stripe test-mode account, real test-mode product/price
   creation, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`.
2. A real GitHub OAuth App for a real deployment.
3. Final, founder-approved subscription prices and a refund policy.
4. Qualified legal/data-protection review of `docs/legal/`'s drafts.
5. (New, optional) A real email provider if founders want support-ticket
   confirmation emails to actually send.

## What this report does not claim

This is a thorough, systematic, evidence-based audit of this
application's real code and real running behavior — not a penetration
test by an independent third party, not a formal security certification,
and not a guarantee that no vulnerability of any kind remains anywhere
in the codebase. It found and fixed 3 real, previously-undiscovered
vulnerabilities using a consistent methodology (route inventory → domain
function trace → database-layer cross-check → live attack), which is
meaningfully more rigorous than the individual-bug-discovery pattern the
mission brief itself named as insufficient — but "found more than before"
is not the same claim as "found everything." The regression-test matrix
in `docs/security/route-authorization-audit.md` exists specifically so
this doesn't have to be re-derived from scratch next time, and its own
"Maintaining this matrix" section is the actual process for keeping it
honest as the application grows.
