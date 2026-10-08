# Operations Wing — build progress

Tracking the five-new-agent expansion (`Venture-HQ-Operations-Expansion`
brief, founder-approved directly in chat). This is **Milestone 6** in spirit
— not yet written into `CLAUDE.md` as a numbered milestone; do that once
the wing is far enough along to describe honestly, the same way every
other milestone in this project was documented only after real, verified
work existed.

## Real baseline, captured before any change

- `npx tsc --noEmit`: clean.
- `npm test`: **45 files / 553 tests passing**, against a real local
  Postgres (`venture_test`), before this slice started.
- This repo had substantial uncommitted work already in the tree beyond
  the last commit (`fe4ee6d`) — Produce Again, Retry Production, reference-
  image continuity, creative strategy, visual QC, a real Kling video
  provider, and more. None of it was touched by this slice.

## Architectural decision made before writing any code

**The five new agents do NOT use the `missions` table.** `missions` carries
Scout/Content-Bot-specific concepts (`workspace_type`, `research_pass_count`,
content-item hand-off) that don't apply to "remind me Friday" or "log a
£12 expense." A new, separate, general-purpose `agent_tasks` table was
added instead — this is **the single biggest reason Scout and Content Bot
required zero changes** to support this milestone. See the doc comment on
`agentTasks` in `lib/db/schema.ts` for the full reasoning.

## What's actually done (verified, not claimed)

1. **Schema**: `agent_tasks` table (migration
   `drizzle/0008_wandering_wendell_rand.sql`), applied to **both** real
   Postgres instances this project uses — the dev `DATABASE_URL` in
   `.env.local` and the separate `venture_test` database `vitest.config.ts`
   points tests at (these are genuinely different databases; both needed
   the migration run against them separately — a real thing this slice
   discovered and fixed, not assumed).
2. **Agents registered**: `executive_assistant`, `chief_of_staff`,
   `finance_agent`, `business_analyst`, `operations_agent` — added to
   `CANONICAL_AGENTS` in `lib/db/client.ts`, using the exact same
   idempotent `seedAgents()` mechanism Scout and Content Bot were seeded
   through. At the time this slice landed, only Executive Assistant was
   `"active"` (the other four started `"planned"`, recorded and visible
   in the roster same as Inventor/Inspector/Merchant/etc. since
   Milestone 1, and did **not** run) — see Slices 2-4 below for each
   agent's later graduation to `"active"` once it had a real, tested
   capability. `chief_of_staff` remains `"planned"` as of this doc's last
   update.
3. **Executive Assistant's one real capability: internal founder tasks.**
   - `lib/domain/executiveAssistantWorkflow.ts` — validation
     (`AgentTaskValidationError`), atomic state transitions
     (`AgentTaskStateError`, mirroring `transitionMissionState`'s
     conditional-update pattern), ownership checks
     (`AgentTaskNotFoundError` — a task can only be read/completed/
     cancelled by the founder who owns it).
   - `app/api/agent-tasks/route.ts` (GET list, POST create) and
     `app/api/agent-tasks/[id]/route.ts` (PATCH complete/cancel) — founder-
     gated via `requireFounderId()`, same as every other route.
   - `components/founders-desk/ExecutiveAssistantTasks.tsx` — a real,
     self-contained UI panel in Focus View. Deliberately self-fetching
     (its own `useEffect`/`fetch`, not threaded through
     `FoundersDeskApp`'s mission-centric state) since this data has
     nothing to do with missions.
   - `tests/executiveAssistant.test.ts` — **11 new tests**, including the
     real acceptance scenario from the brief (Test B: create a task,
     confirm it's genuinely visible after a fresh read — the actual check
     for "survives a restart" in a stateless test-run context), ownership
     isolation, and double-completion rejection.
4. **Verified, not assumed**: `npx tsc --noEmit` clean; full suite now
   **46 files / 564 tests passing** (553 prior + 11 new, zero regressions);
   `npm run build` succeeds, both new routes appear correctly in the real
   route manifest.

## Slice 2: Finance Agent (complete, verified)

5. **Agent flipped**: `finance_agent` is now `status: "active"` in
   `CANONICAL_AGENTS`, with one real capability,
   `expense_and_budget_tracking`.
6. **Architecture**: new `expenses`/`budgets` tables (migration
   `drizzle/0009_glamorous_wonder_man.sql`, applied to both the dev and
   `venture_test` databases) — deliberately **not** a reuse of
   `ledger_entries`/`costs`. Those are hard-coded USD and built for real
   provider-spend tracking; the founders' own example used GBP, and
   silently treating £12 as $12 would be fabrication under CLAUDE.md's
   own rules. Both new tables carry `currency` explicitly.
7. **`lib/domain/financeWorkflow.ts`**: `logExpense`/`setCategoryBudget`
   validate a positive finite amount and a real 3-letter currency code
   (never defaulted or guessed); `getBudgetStatus` returns `budget: null`
   (never a fabricated budget) for an unset category, and sums
   same-currency expenses only — a different-currency expense is
   reported separately via `excludedOtherCurrencyTotals`, never silently
   mixed in or converted. `upsertBudget` updates a category's existing
   budget in place rather than duplicating it.
8. **API**: `GET`/`POST /api/finance/expenses`, `GET`/`POST
   /api/finance/budgets`, `GET /api/finance/budgets/[category]` (status)
   — all `requireFounderId()`-gated.
9. **UI**: `components/founders-desk/FinanceAgentPanel.tsx` — a
   self-contained Focus View panel (same self-fetching pattern as
   `ExecutiveAssistantTasks.tsx`) for setting a budget, logging an
   expense, and seeing actual-vs-budget with any currency mismatch called
   out explicitly. Wired into `FocusView.tsx`'s sidebar.
10. **Verified, not assumed**: `tests/financeAgent.test.ts` (10 tests)
    proves the founders' own acceptance scenario (£12 expense against a
    £30 monthly budget → £18 remaining) and currency isolation (a USD
    expense never counted toward a GBP budget) directly. Fixed a
    `resetDbForTests()` truncate-list omission (same bug class hit once
    already for `agent_tasks`) before the suite was trustworthy. Updated
    `tests/executiveAssistant.test.ts`'s now-stale "finance_agent is
    planned" assertion. Full regression: `npx tsc --noEmit` clean,
    **47 files / 574 tests passing** (564 prior + 10 new, zero
    regressions), `npm run build` succeeds with all three new
    `/api/finance/*` routes in the route manifest. Committed as its own
    clean commit, Scout/Content Bot untouched.

## Slice 3: Operations Agent (complete, verified)

11. **Agent flipped**: `operations_agent` is now `status: "active"`, with
    one real capability, `checklists`.
12. **Architecture**: new `checklists`/`checklist_items` tables (migration
    `drizzle/0010_operations_agent_checklists.sql`, applied to both the
    dev and `venture_test` databases) — deliberately **not** `agent_tasks`.
    A checklist is an ORDERED list of independently completable items,
    not one row with one state; forcing it into `agent_tasks`' `payload`
    jsonb would mean hand-rolling item-level mutation logic on a column
    never shaped for it.
13. **`lib/domain/operationsWorkflow.ts`**: `createFounderChecklist`
    validates a non-empty title and rejects any blank item (writes
    nothing on failure); every read/mutation is ownership-checked
    (`ChecklistNotFoundError`), same pattern as
    `executiveAssistantWorkflow.ts`. `addItemToChecklist`/`setItemDone`
    are the "updatable" half of the acceptance test.
14. **API**: `GET`/`POST /api/checklists`, `GET`+`POST /api/checklists/[id]`
    (detail, add item), `PATCH /api/checklists/[id]/items/[itemId]`
    (toggle done).
15. **UI**: `components/founders-desk/OperationsAgentChecklists.tsx` —
    create a checklist with optional initial items, open one to add items
    and check them off.
16. **Verified, not assumed**: `tests/operationsAgent.test.ts` (14 tests)
    — persistence, validation, ownership isolation, item ordering,
    toggling done/undone. Proactively added `checklists`/`checklist_items`
    to `resetDbForTests()`'s truncate list up front this time (the same
    omission had bitten twice before, for `agent_tasks` then
    `expenses`/`budgets`) — confirmed clean on the first run. Full
    regression: `npx tsc --noEmit` clean, **48 files / 588 tests passing**
    (574 prior + 14 new, zero regressions), `npm run build` succeeds
    (after clearing a stale `.next` cache that was throwing spurious
    "module not found" errors for the new routes — not a real code
    problem). Committed as its own clean commit, Scout/Content Bot
    untouched.

## Slice 4: Business Analyst (complete, verified)

17. **Agent flipped**: `business_analyst` is now `status: "active"`, with
    one real capability, `sourced_research`.
18. **Architecture**: a new `business_analyst_reports` table (migration
    `drizzle/0011_business_analyst_reports.sql`) — one row per real
    research request (success or failure), deliberately NOT `missions`
    (this is a standalone founder question, not a Scout-style mission
    with a workspace/approval/production lifecycle) and NOT `agent_tasks`
    (the result is a structured report, not a to-do). Real spend is
    recorded through the *existing* `costs`/`ledger_entries` tables with
    `missionId: null` — already nullable, so **zero schema changes**
    were needed there; this is the "reuse existing infra wherever
    practical" principle paying off directly.
19. **`lib/agents/businessAnalyst/`** — a new, independent agent module
    (schema/prompt/guardrails/index), structurally parallel to Scout's
    own but importing nothing from `lib/agents/scout` and touching zero
    Scout files, per CLAUDE.md's "protect Scout" instruction. Simpler by
    design: one bounded web-search pass (real `web_search` tool, Claude
    API call, injectable `client` for tests), no multi-pass follow-up, no
    client-tool submission protocol — the smallest honest version of this
    capability. Its own guardrails (`findGuaranteeLanguage`,
    `hasAtLeastOneSource`) are an independent generic string-walk, the
    same philosophy as Scout's own but not shared code, matching how
    Content Bot's guardrails are already independent of Scout's.
20. **`lib/domain/businessAnalystWorkflow.ts`**: `requestResearch` is
    synchronous (request/response), not dispatched through Inngest the
    way Scout's research is — a real, documented tradeoff for this first
    slice (a real web-search-backed call can take tens of seconds; moving
    it to a durable background job is a legitimate future improvement,
    not required for a genuine first capability). A failed research
    attempt is still persisted (`state: "failed"`, the real error
    message) and its real token spend still recorded — never silently
    dropped, mirroring Scout's own failure-cost discipline.
21. **API**: `GET`/`POST /api/business-analyst/research`,
    `GET /api/business-analyst/research/[id]`.
22. **UI**: `components/founders-desk/BusinessAnalystPanel.tsx` — submits
    a research question (an honest "Researching…" state while the real
    call is in flight), lists past reports with a completed/failed badge,
    expands to show the summary/opportunities/risks/sources or the real
    error.
23. **Verified, not assumed**: `tests/businessAnalyst.test.ts` (16 tests)
    — structured response + real usage, guardrail rejection
    (guarantee language, zero sources), an unparseable-response failure
    carrying real usage, persistence of both completed and failed
    reports, real ledger spend recorded with no mission attached,
    ownership isolation. Reused the existing, generic
    `fakeAnthropicClient`/`fakeAnthropicMessage` test fixtures from
    `tests/testUtils.ts` — no real network call, same discipline as every
    other agent test in this suite. Full regression: `npx tsc --noEmit`
    clean, **49 files / 604 tests passing** (588 prior + 16 new, zero
    regressions), `npm run build` succeeds with both new
    `/api/business-analyst/*` routes in the route manifest. Committed as
    its own clean commit, Scout/Content Bot untouched.

## What is explicitly NOT done yet

- Chief of Staff: **no code**. Registered as `planned`, nothing simulates
  it running, per CLAUDE.md's own standing rule.
- No 3D-office expansion (no new rooms, no new character rigs) — the
  `office-reference.html`/`office-extension.json` design reference has not
  been acted on. Explicitly ordered after real agent function per the
  founder's own brief; **4 of 5 Operations Wing agents now have a working
  capability** — Chief of Staff is the last one needed before this gate
  opens.
- No Chief-of-Staff delegation/hand-off mechanism.
- No email/calendar integration (Executive Assistant is internal-only,
  as the brief itself required for a first slice).
- Business Analyst's research call is synchronous, not durable/
  background — a known, documented tradeoff (see Slice 4 above), not an
  oversight.
- Acceptance Tests A, C, D, E, F (everything except B) are not built as
  named in the original brief, though their underlying capabilities now
  mostly exist in some form (checklists for D, sourced research for C).

## Exact restart point for a future session

Founder's explicit ordering (governing instruction, see chat history):
1. ~~Finance Agent~~ — **done.**
2. ~~Operations Agent~~ — **done.**
3. ~~Business Analyst~~ — **done, this slice.**
4. **Chief of Staff** — next, and last of the five. Deliberately last;
   delegation only makes sense once there's more than one real agent to
   delegate *to*. Likely shape: a founder states a goal, Chief of Staff
   breaks it into subtasks and creates real `agent_tasks` rows (reusing
   Executive Assistant's existing table/workflow rather than inventing a
   parallel one) assigned conceptually to the other agents — check
   whether `agent_tasks.agent_key` already supports attributing a task to
   a *different* agent than the one that created it before assuming new
   schema is needed.

Once Chief of Staff has at least one working capability, all five
Operations Wing agents are real — re-read CLAUDE.md's "do not expand the
3D headquarters" gate and the founder's own brief before starting any
office-scene work, since that gate will have just opened.

Restart command: `npm test && npx tsc --noEmit` to reconfirm this
baseline (604 tests) still holds, then continue from step 4 above.
