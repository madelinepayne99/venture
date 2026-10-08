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

## Slice 5: Chief of Staff (complete, verified) — all five agents now real

24. **Agent flipped**: `chief_of_staff` is now `status: "active"`, with
    one real capability, `goal_delegation` — **the fifth and final
    Operations Wing agent to graduate from "planned."**
25. **Architecture**: a new `chief_of_staff_goals` table (immutable
    grouping container — a founder's stated goal) plus one additive,
    nullable `goal_id` column on the EXISTING `agent_tasks` table
    (migration `drizzle/0012_chief_of_staff_goals.sql`). A delegated
    subtask is simply an ordinary `agent_tasks` row with `goal_id` set
    and `task_type: "delegated_subtask"` — genuine reuse, not a parallel
    task system. Completing or cancelling one goes through the
    **unmodified** `completeFounderTask`/`cancelFounderTask`
    (`executiveAssistantWorkflow.ts`) and the existing
    `/api/agent-tasks/[id]` route — those check only founder ownership,
    never `agent_key`, so they already worked for this with zero new
    mutation code (proven directly by two tests in
    `tests/chiefOfStaff.test.ts`).
26. **`lib/domain/chiefOfStaffWorkflow.ts`**: `DELEGATABLE_AGENT_KEYS` is
    a hardcoded allowlist — `executive_assistant`, `finance_agent`,
    `operations_agent`, `business_analyst` only. Scout and Content Bot
    are structurally excluded: they're mission-dispatched, and creating
    an `agent_tasks` row naming either would fabricate activity that
    doesn't actually make either agent do anything (neither reads
    `agent_tasks`) — a direct, concrete application of CLAUDE.md's "never
    fabricate activity" rule to this agent's own design, and of the
    "protect Scout and Content Bot" instruction. `createGoalWithDelegatedSubtasks`
    validates every subtask's target agent is both in that allowlist
    *and* currently `"active"` in the real `agents` table — defense in
    depth, not just the hardcoded list alone.
27. **API**: `GET`/`POST /api/chief-of-staff/goals`,
    `GET /api/chief-of-staff/goals/[id]`.
28. **UI**: `components/founders-desk/ChiefOfStaffPanel.tsx` — state a
    goal, add one or more subtasks each assigned to a real agent from a
    dropdown, then view a goal's subtasks and mark them done/cancelled
    (via the existing agent-tasks endpoint, reused as-is).
29. **Verified, not assumed**: `tests/chiefOfStaff.test.ts` (14 tests) —
    persistence, the real agent-targeting restriction (explicitly proves
    delegating to `"scout"` or `"content_bot"` is rejected, not just
    assumed safe), rejecting a planned or nonexistent agent key, ownership
    isolation, and — the key reuse proof — completing/cancelling a
    delegated subtask through the untouched Executive Assistant
    functions. Full regression: `npx tsc --noEmit` clean,
    **50 files / 618 tests passing** (604 prior + 14 new, zero
    regressions), `npm run build` succeeds with both new
    `/api/chief-of-staff/*` routes in the route manifest. Committed as
    its own clean commit, Scout/Content Bot untouched.

## What is explicitly NOT done yet

- No 3D-office expansion (no new rooms, no new character rigs) — the
  `office-reference.html`/`office-extension.json` design reference has
  not been acted on. **All 5 of 5 Operations Wing agents now have a
  working capability — this gate is open as of this slice.** Office-scene
  work may now begin when a founder asks for it; it was not started here
  since that's a separate, explicit next decision, not an automatic
  follow-on to this milestone.
- No email/calendar integration (Executive Assistant is internal-only,
  as the brief itself required for a first slice).
- Business Analyst's research call is synchronous, not durable/
  background — a known, documented tradeoff (see Slice 4), not an
  oversight.
- Chief of Staff's delegation is a founder-driven breakdown (the founder
  specifies each subtask and its target agent); it does not itself use
  an LLM call to decide the breakdown. A real, honest first capability —
  not every agent in this wing needed a model call to be genuine (Finance
  and Operations don't either); a future slice could add an LLM-assisted
  breakdown suggestion without changing the real delegation mechanism
  underneath it.
- Acceptance Tests A, C, D, E, F (everything except B) are not built as
  literally named in the original brief, though their underlying
  capabilities now mostly exist in some form (checklists for D, sourced
  research for C, delegation for part of A/E).

## Exact restart point for a future session

All five Operations Wing agents are now real and verified:
1. ~~Executive Assistant~~ — **done** (Slice 1).
2. ~~Finance Agent~~ — **done** (Slice 2).
3. ~~Operations Agent~~ — **done** (Slice 3).
4. ~~Business Analyst~~ — **done** (Slice 4).
5. ~~Chief of Staff~~ — **done, this slice** (Slice 5).

Nothing in the founders' explicit ordering remains. Before starting any
further work: re-read CLAUDE.md's "do not expand the 3D headquarters
until all five new agents have at least one working capability" gate —
it is now satisfied, but office-scene expansion is still a *separate*
decision for a founder to make explicitly, not an automatic next step
just because the gate opened. Absent a new founder instruction, good
next candidates (not started, not promised) are: durability for Business
Analyst's research (Inngest, matching Scout's own pattern), an
LLM-assisted goal breakdown for Chief of Staff, or wiring any of these
five agents into the HQ office scene once a founder actually asks for
that.

Restart command: `npm test && npx tsc --noEmit` to reconfirm this
baseline (618 tests) still holds before starting anything new.

## Milestone 7: bringing the workforce into the 3D office (complete, verified)

With all five Operations Wing agents real, the founders asked for the
next real step: all seven agents sharing one persistent 3D headquarters,
genuinely interactive, synchronized with Focus View.

### Real east-wing extension — not a second environment

`components/founders-desk/world/` already models one open-plan building
(Three.js, real pathfinding grid, real obstacles). Rather than cramming
five more desks into the existing room (already carrying the founders'
desk, Scout's research desk, Content Bot's studio, the lounge, and the
planning nook) or building a second scene, the walkable floor was
genuinely widened east (`layout.ts`'s `walkable()` x-bound: 5.15 → 12.5)
and a real "Operations Wing" extension was added in `environment.ts` —
a floor/wall continuation abutting the existing building (no doorway
needed: the original east side was never a rendered wall, only a
numeric limit, so the extension is already open to the main room) with
five small desks (`furniture.ts`'s new `departmentDesk`), each with its
own themed prop (gavel/folders for Chief of Staff, inbox/clock for
Executive Assistant, coins/ledger for Finance, magnifying glass/
documents for Business Analyst, clipboard/toolbox for Operations).
`engine.ts`'s camera **framing/zoom was deliberately left untouched** —
only the pan-clamp bounds widened — so the existing room's on-screen
size never shrinks to make room for the new wing; a founder pans right
to reach it.

### Five new character rigs, one proven shape

Reused the exact same procedural rig Scout/Content Bot already use
(`scout.ts`'s `buildAgentCharacter`), each in its own new accent color
(`materials.ts`: gold/plum/bronze/indigo/slate) — a deliberate choice,
not a shortcut: a genuinely new rig per agent would be five more
hand-tuned geometries with no way to visually verify any of them in this
sandbox. Distinct identity comes from accent color + desk + prop, the
same approach already proven for Content Bot.

### The real "which agent goes where" generalization

`layout.ts`'s `agentDestination`/`agentBusy` — previously hardcoded to
Scout (mission `researching` + real lead) and Content Bot (content item
`generating` + real lead) — gained one new generic branch for the five
Operations Wing agents, driven by a new, privacy-conscious projection of
real `agent_tasks` rows (`AgentTaskSignal`: `agent_key`, `state`,
`goal_id` only — never title/detail/payload, which can hold personal
reminder text). An agent walks to its own desk only while it genuinely
has an open/in-progress `agent_tasks` row. Chief of Staff is the one
deliberate special case: it delegates rather than receives tasks (no
row is ever created with `agent_key: "chief_of_staff"` — see
`chiefOfStaffWorkflow.ts`'s `DELEGATABLE_AGENT_KEYS`), so its own signal
is "does any goal it created still have an unresolved (`goal_id`-
bearing) subtask anywhere." Scout/Content Bot's own branches are
byte-for-byte unchanged. `AgentTaskSignal` defaults to `[]` everywhere,
so every pre-Milestone-7 caller keeps compiling and behaving identically.

### Real, global data plumbing — not founder-scoped

`lib/db/repositories.ts`'s new `listAgentTaskWorldSignals()` is
deliberately global (not founder-scoped, like `listLeadAssignments()`
already is) — the office is one shared space for both founders. It
rides on the *existing* `GET /api/missions` poll (now also returning
`agentTaskSignals`) rather than a second polling loop, and is also
SSR-fetched in `app/page.tsx` for a correct first paint. **A real gap
was found and closed**: the five agents' own Focus View panels are
deliberately self-contained (their own fetch/mutate, no knowledge of
`FoundersDeskApp`'s state — the same design that makes them trivially
reusable, unmodified, inside the new `AgentDetailSlideOver`), so a task
created in one of them would never flow through `FoundersDeskApp`'s
existing mission-centric handlers and nothing would refresh
`agentTaskSignals`. Fixed with a second, always-on (not gated on "is a
mission in flight") polling interval via the same `useMissionPolling`
hook, specifically so "if a founder creates a task in Focus View, Office
View reflects the assignment" is actually true, not just asserted.

### One real interaction, reusing existing components — never a duplicate

Clicking any of the five new desks/characters opens
`hq/AgentDetailSlideOver.tsx`, which renders the **exact same** Focus
View panel component for that agent (`ExecutiveAssistantTasks`,
`FinanceAgentPanel`, `OperationsAgentChecklists`, `BusinessAnalystPanel`,
`ChiefOfStaffPanel` — all already prop-less and self-fetching). This is
what makes "Office View and Focus View stay synchronized" structurally
guaranteed rather than something that could drift: there is only ever
one component per agent, mounted in two places, each against the same
real API routes. No second task system, no second display.

### A real, live bug found and fixed through actual HTTP testing

Per the founders' explicit instruction to test through the real running
application rather than unit tests alone: a real dev server was started
(`npm run dev`), and a real, already-valid Auth.js session already
present in the real dev database (from an earlier genuine GitHub
sign-in) was used to make real authenticated HTTP requests — the
closest thing to a real browser round-trip achievable in a sandbox with
no browser-automation tool and no way to complete GitHub's OAuth consent
screen interactively (see "What could not be tested" below).

This surfaced a real, live bug: `GET /api/agents` showed
`finance_agent`, `business_analyst`, `operations_agent`, and
`chief_of_staff` as **`"planned"`**, even though every one of their
slices in this document says `"active"`. Root cause: `seedAgents()`
(`lib/db/client.ts`) only ever inserts a *missing* canonical agent — it
never updates an *existing* row's `status` when that agent's canonical
definition later changes. Each of the four had already been inserted
as `"planned"` by an earlier call to this function (back when Milestone
6 started), and nothing ever revisited that row once the code began
saying `"active"`. The real, concrete consequence: attempting a real
delegation to `finance_agent` via `POST /api/chief-of-staff/goals`
genuinely failed with *"that agent is not active"* — reproduced live,
not assumed. This is the exact same bug class CLAUDE.md already
documents for `content_bot`'s own real-database graduation, just in the
opposite direction (an upgrade missed, not an insert missed).

Fixed in `seedAgents()`: for an agent that already exists, if its
canonical definition says `"active"` but the real row still says
anything else, the row is updated in place (never duplicated) and any
of its canonical capabilities missing from `agent_capabilities` are
backfilled. This only ever moves `planned → active` — never the
reverse, which would silently take away a working capability rather
than grant one; that stays a deliberate human decision. Verified by
restarting the real dev server (re-triggering `seed()`) and confirming,
via the same live HTTP path, that all seven real agents now show
`"active"`/`"planned"` correctly and the delegation that failed now
succeeds. `tests/agentSeeding.test.ts` gained 4 new tests reproducing
this exact scenario against a real Postgres instance (including the
exact `createGoalWithDelegatedSubtasks` regression check), not just the
live reproduction.

### Real end-to-end verification performed

Against the real dev server + real Postgres + the real, already-valid
session (not a mock, not a fabricated cookie):

- `GET /api/agents` — confirmed all 7 real agents present with correct
  status (after the fix above).
- `POST /api/chief-of-staff/goals` — a real goal delegating real
  subtasks to `finance_agent`, `operations_agent`, and
  `business_analyst` simultaneously; **persisted**, confirmed via a
  fresh `GET`.
- `GET /api/missions` — confirmed `agentTaskSignals` reflects the new
  open tasks, carrying only `agent_key`/`state`/`goal_id` (verified
  directly — no title/detail ever present).
- The real response fed through the real `agentDestination`/`agentBusy`
  functions (via `tsx`, not a mock) — confirmed Finance Agent,
  Operations Agent, Business Analyst, **and** Chief of Staff all
  correctly resolve to their own desks and show `busy: true`
  simultaneously, with Executive Assistant (untouched) correctly
  staying home.
- `PATCH /api/agent-tasks/[id]` (`action: "complete"`) on all three
  real subtasks — completed via the pre-existing, unmodified route.
  Re-fetched `GET /api/missions` — confirmed all four agents resolve
  back to `"hub"`.
- **A real, live Business Analyst research call** — `ANTHROPIC_API_KEY`
  turned out to be configured in this environment (unlike every prior
  milestone in this document). `POST /api/business-analyst/research`
  with a real question ran a genuine Claude API call with real
  `web_search`, returned real sources (Worldometer, Wikipedia,
  georank.org, World Population Review), real token usage (15,528 in /
  1,072 out), and a real cost (`$0.041776`) — confirmed **genuinely
  recorded** in the real ledger via `GET /api/ledger`
  (`mission_id: null`, exactly as designed). This is the first time any
  agent in this codebase has been exercised against the real Anthropic
  API from within this development sandbox.
- Finance Agent (`POST /api/finance/budgets` + `/expenses`) and
  Operations Agent (`POST /api/checklists`) — both real flows re-
  verified live, matching their own unit tests exactly.
- **Security boundaries re-confirmed live, not just in code review**: an
  unauthenticated `POST`/`GET` to a protected route returns a real
  `401`; a request body with a forged `founderId` is silently ignored —
  the real session's own founder id is what's actually used (confirmed
  by inspecting the created row).
- Full regression after every fix: `npx tsc --noEmit` clean,
  **51 files / 633 tests passing** (618 prior + 15 new, zero
  regressions), `npm run build` succeeds with every new route in the
  manifest.

Test artifacts genuinely created on the real dev database during this
verification (titled `[Verification] ...` for easy identification; this
app has no delete endpoint for any of these by design — insert-only,
audit-trail philosophy — so they remain as a real, honestly-labeled
record rather than being silently cleaned up): one Chief of Staff goal
with three completed subtasks, one Business Analyst research report
(Iceland population — genuinely useful to leave, since it cost real
money to produce), one Finance budget/expense pair under category
`"verification-test"`, one Operations checklist.

### What could not be tested, and exactly why

A literal rendered-browser click-through (the founders' own "launch the
application... using browser automation where available" ask) was not
possible: no browser-automation tool is available in this environment
(confirmed by searching the available toolset before concluding this,
not assumed), and completing a fresh GitHub OAuth consent screen
requires a human in an actual browser — the same standing limitation
CLAUDE.md has documented since Milestone 2. What *was* possible, and
performed: using a real, already-valid session already present in the
real dev database (the artifact of a genuine prior GitHub sign-in) to
make real authenticated HTTP requests against a really-running server —
exercising the actual Next.js route handlers, actual middleware, actual
session resolution, and actual Postgres writes, not a function call in
a test file. This is real integration testing at the HTTP layer; it is
not pixel-level visual confirmation that the 3D scene renders or
animates correctly, which still requires a founder's own eyes (or a
browser-automation tool this session does not have).

### What is explicitly NOT done yet

- No pixel-level visual QA of the new wing's geometry (desk spacing,
  prop proportions, camera framing at the new pan extent) — verified
  structurally (walkability, pathfinding, obstacle non-overlap, all via
  real tests) but not visually, for the reason above.
- The "Operations Wing" wall plaque's texture is mapped onto a square
  canvas stretched over a wide rectangular plane (same simplification
  `frame()`'s other callers already accept) — a minor cosmetic detail,
  not a functional one.
- No LLM-assisted Chief of Staff goal breakdown (still founder-specified
  subtasks, as scoped in Milestone 6).
- Business Analyst's research call remains synchronous, not durable/
  background (same documented tradeoff as Milestone 6's Slice 4).

Restart command: `npm test && npx tsc --noEmit` to reconfirm this
baseline (633 tests) still holds. The real dev server was stopped
cleanly after verification; no agent-task polling or world-sync code
needs anything further before a founder actually opens HQ View.

## Milestone 8: integrating the approved Noir Studio / Living Polish world

A founder-requested investigation (see the question-and-answer exchange
preserved in this session's own history) found that Milestone 7's 3D
work had been built without ever locating or opening the founders'
actually-approved visual design: two real, tested, ready-to-apply
patches (`Venture-HQ-Noir-Studio-Source.zip`, superseded by
`Venture-HQ-Living-Polish-Source.zip`) sitting in Downloads, built
against base commit `fe4ee6d` — the exact commit this session's own
Operations Wing work started from. Neither had ever been applied to the
real git history. This milestone is that integration: a careful,
file-by-file merge, not a blind patch application (confirmed via a
read-only `git apply --check`, which failed on exactly the six files
Milestone 7 had also rewritten — the two change sets had genuinely
diverged and needed reconciling by hand).

### What was brought forward from the approved design

- **Scout's detective identity** — fedora, split charcoal coat with
  emerald lapel lining, tan satchel with a real dimensional magnifying
  glass, and a curved screen face (glyph eyes, never anatomical) —
  ported verbatim from the approved patch (`characterWardrobe.ts`,
  `screenFace.ts`, `characterSurfaces.ts`, `scout.ts`'s rebuilt
  `buildAgentCharacter`).
- **Scout's noir-paneled office** — `detectiveOffice.ts` (ported
  verbatim): emerald panelling, a patterned study rug, a real filing
  cabinet, a stationery evidence board, desk pedestals, and a warm
  ambient light. Dressed onto the existing research desk, not a
  replacement of it.
- **Content Bot's identity and a real, dedicated Content Studio wing** —
  tailored jacket, headphones, a play-badge, same screen-face system.
  The studio itself moved from Milestone 5's smaller-footprint
  in-building nook into a real adjoining wing (`studio.ts`, ported
  verbatim) with its own walls, doorway from the lounge, and an arched
  window — the "legitimate follow-up" CLAUDE.md's own Milestone 5 note
  said the original smaller footprint had deferred, now actually built.
  Its wall plaque and three screens render the real `studioStatus`
  (`studioState.ts`, ported verbatim) — now covering all nine real
  content-item states, not just generating/planning.
- **The richer `officeLife.ts` idle system** — real leisure itineraries
  (lounge seating with genuine sit-down animation, coffee breaks,
  window-gazing, desk check-ins), live body-avoidance during ANY
  movement (`safeStep`, not just idle wandering), and bounded replanning
  around a blocked peer — replacing the simpler fixed-offset `idle.ts`
  (left in place, unused by the live engine, its own tests —
  `idleWander.test.ts` — still passing as a record of what it once
  drove).
- **A real "one continuous company world" architecture** —
  `HQView.tsx`/`Room.tsx` changed from one separately-mounted
  Room/OfficeWorld per workspace tab (which silently reset Scout/Content
  Bot's position and idle state on every tab switch) to a single,
  always-mounted Room receiving the real, unfiltered missions/lead
  assignments/content items regardless of which workspace tab is
  active — only the `MissionBoard` list filters by the active project.
  This was a genuine fix, not just adopted for its own sake: the old
  per-room-filtered design actually contradicted CLAUDE.md's own
  Milestone 4.6 principle ("the founders' desk, Scout's research desk,
  and Content Bot's workstation all exist in the ONE HQ scene regardless
  of which workspace") — now it's actually true.

### Reconciling with Milestone 7 — the real work of this integration

The approved studio wing claims exactly the physical space
(`x∈[5.37,10.6]`) Milestone 7 had placed the five Operations Wing desks
in. Resolved by **relocating** the Operations Wing further east, just
past the studio's own open side (no doorway needed, matching the
original building's own open east side) — `layout.ts`'s `MARKS`/
`OBSTACLES`/`walkable()` all updated, verified via a real reachability
script before any rendering code was written (and a real, found-via-
testing gap — a 0.23-unit dead strip between the two zones' boundaries —
caught and fixed before it shipped).

`characterWardrobe.ts`'s own `accent` parameter turned out to be
accepted but never actually used by the original patch — porting it
as-is would have rendered all five new agents in Content Bot's exact
jacket color with zero visual distinction. Caught before writing
`scout.ts`'s five new builder functions; fixed by adding an
`accentOverride` (cloth/lining color pair, one per new agent, derived
from each one's own Milestone 7 accent) that Scout and Content Bot never
pass, so their colors stay byte-for-byte the approved ones.

The five Operations Wing agents reuse Content Bot's "creator" wardrobe
silhouette (jacket, badge, tablet pocket) in their own accent color and
ink-tinted screen expression, without headphones — a deliberate,
honestly-scoped choice: a sixth/seventh/... fully bespoke costume each
was judged not worth the real risk of unverifiable geometry bugs in a
sandbox with no way to screenshot (the same trade-off CLAUDE.md already
documents for the Content Studio's own first, smaller-footprint
iteration). Each also gained its own short, genuine `officeLife.ts`
itinerary (own desk, a neighbor check-in, home) using the identical
collision-aware mechanism Scout/Content Bot's richer itineraries use —
not a scaled-down imitation of it.

`engine.ts`'s own 7-agent rig array, `agentTaskSignals` threading
through `syncWorld`, and generalized `focus()` (Milestone 7) were kept
intact and merged with the patch's collision-aware movement, richer
`CharacterLife`-driven animation, studio status tag, and `select()`
acknowledgement gesture — generalized to look up any of the 7 agents by
key directly rather than the original patch's own hardcoded two-agent
ternary.

### Verified, not assumed

- `npx tsc --noEmit`: clean throughout, checked after every major file.
- A standalone reachability/walkability script (not a guess) confirmed
  every mark — old and new — walkable and reachable before any rendering
  code referenced them; the same script caught and proved the fix for
  the zone-boundary gap mentioned above.
- Full regression: **the existing 633 tests passed unchanged** on the
  first full run after the merge — including `officeWorld.test.ts`'s
  `MARKS.studio`/`contentBotHome` walkability test, which is generic
  (checks `walkable()`/`verifyRoute()`, not hardcoded coordinates) and
  so correctly re-validated the relocated marks without needing an edit.
- **`tests/livingEngine.test.ts`** (11 new tests, ported from the
  approved patch's own `livingEngine.test.ts` and extended) — a real
  engine-level harness (mocked renderer, fake clock, no WebGL needed)
  directly exercising the live tick loop: three minutes of independent
  idle wandering with no body overlap; real work genuinely interrupting
  leisure and settling both Scout and Content Bot; snap-placement with
  several agents working at once; reduced-motion snapping; idempotent
  re-syncs not replaying a journey; clean disposal — plus five new
  Operations-Wing-specific cases: a real `agent_tasks` row moving its
  own agent and no other; completion sending it home; Chief of Staff
  genuinely reaching its desk from a real delegated subtask; all seven
  agents genuinely busy at once with zero body overlap; and extended
  independent idle wandering near a neighbor. Porting the original
  patch's own `syncWorld(...)` calls caught a real integration bug before
  it shipped: Milestone 7 had inserted `agentTasks` as a new 4th
  parameter before `snap`, so the original patch's 4-argument calls would
  have silently passed `true` as `agentTasks` (wrong type) and left
  `snap` defaulting to `false` — every call site was updated, not papered
  over. One of the new tests also caught a real premise error in itself,
  not the engine: an assertion assumed an agent's desk x-coordinate alone
  proved "not busy," missing that Chief of Staff's own idle itinerary
  legitimately visits its own desk as a leisure stop (the same pattern
  Scout's "At home desk" idle visit already uses) — fixed by asserting
  what's actually reliable (the positive, real-task-driven case) rather
  than weakening or deleting the test.
- **Real HTTP verification against the live dev server**, using the same
  genuine, already-valid Auth.js session as Milestone 7's own
  verification: the authenticated root page renders a clean `200` with
  zero real errors in the server log (the one "BAILOUT_TO_CLIENT_SIDE_
  RENDERING" marker in the raw SSR HTML is Next.js's own expected,
  pre-existing mechanism for `OfficeWorld`'s deliberate `{ssr:false}`
  dynamic import — unrelated to this milestone, invisible to an actual
  browser, confirmed harmless by checking the surrounding render
  completed with a real `200`). A fresh real delegation →
  `agentTaskSignals` reflecting it → completion cycle was re-run
  end-to-end against the live server and database after the full visual
  merge, exactly reproducing Milestone 7's own successful result.
- `npm run build` succeeds; the main route's First Load JS grew modestly
  (21.5kB → 21.9kB), consistent with the richer character/office
  geometry and nothing else.

### What could not be tested, and exactly why

Same standing limitation as every prior milestone: no browser-automation
tool is available in this environment, and a real GitHub OAuth consent
screen requires a human in an actual browser. Pixel-level visual
confirmation that the detective office, the studio wing, the screen
faces, and the relocated Operations Wing actually look right — not just
that they're structurally sound and collision-free, which IS verified
above — still needs a founder's own eyes in a real browser tab.

### What is explicitly NOT done — the larger Central HQ expansion

Per the founders' own explicit instruction, this milestone deliberately
stops here: it restores and integrates the approved visual foundation
and living-world behavior into the CURRENT building footprint (the
original suite + the approved studio wing + the relocated Operations
Wing beyond it). The separately-agreed, substantially larger "Central HQ
with Four Connected Wings" is real future work, not started, not
designed, and not to be combined with this integration — the founders
were explicit that this foundation should be stable first.

Restart command: `npm test && npx tsc --noEmit` to reconfirm this
baseline (644 tests) still holds before starting the Central HQ
expansion or anything else.
