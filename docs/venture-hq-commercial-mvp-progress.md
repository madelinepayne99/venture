# Venture HQ — Commercial MVP progress

Tracking the master development mission (founder brief, "Seven-Agent
Workforce, Employee Recruitment, Human Approvals, Living-World
Integration and Commercial Readiness"). This is a genuinely large,
multi-session assignment — this file is the required handover record.
**Read this file before starting any new work in this mission; do not
repeat a completed milestone.**

## Real baseline, captured before any change (this session)

- Branch: `claude/wonderful-shannon-b9zcsj`. Latest commit at session
  start: `e16713a` (already pushed to `origin` — confirmed via `git
  fetch` + `git log origin/...`, not assumed).
- `npx tsc --noEmit`: clean.
- `npm test`: **52 files / 644 tests passing**, against real Postgres.
- `npm run build`: succeeds.
- No `astra/*` branch exists on the remote yet (`git ls-remote --heads
  origin` checked directly) — confirmed before starting, not assumed.
  Per the brief's own instruction ("If Astra's source is not available,
  continue with backend, directory, approvals, testing and commercial
  preparation"), this session proceeded with backend/directory work and
  did **not** touch office geometry, `components/founders-desk/world/`,
  or `hq/Room.tsx`/`hq/HQView.tsx` at all.

## Milestone 1: Repository safety — DONE

Baseline re-verified above (not assumed from the prior session's own
report). No destructive actions taken. Working tree was clean at
session start.

## Milestone 2: Employee Directory + shared Capability Registry — DONE

### Architecture decision

**`lib/agents/employeeRegistry.ts`** is a new, static, framework-agnostic
module — the "shared Employee Capability Registry" the brief asks for.
It does **not** replace `lib/db/client.ts`'s `CANONICAL_AGENTS` or the
real `agents`/`agent_capabilities` tables — those still own the real,
live `status` (active/planned) and real capability rows. The registry
adds exactly the customer-facing metadata those were never meant to
carry: department, job title, plain-language description, setup
requirements, world-scene mapping (`worldTarget`, matching a real
`WorldTarget` string in `world/layout.ts`), accent color. Every read
merges registry metadata with a live `agents` row — never one instead
of the other (see `listEmployeeDirectory` in
`lib/domain/employeeWorkflow.ts`).

10 entries: the 7 real, working agents (`scout`, `content_bot`,
`chief_of_staff`, `executive_assistant`, `finance_agent`,
`business_analyst`, `operations_agent` — keys matching `agents.key`
exactly) plus 3 future agents (`website_developer`, `ai_receptionist`,
`sales_specialist` — **no `agents` DB row exists for any of these; never
seeded, never shown as having any capability**, consistent with
CLAUDE.md's "never fabricate activity" rule applied to the roster
itself). The brief's own capability descriptions for each real agent
were written in plain language from what's actually built (cross-checked
against CLAUDE.md's own technical descriptions, not invented).

### Real recruit/remove workflow

This app is still single-tenant (founder-only — see CLAUDE.md's
Authentication section); there is no per-business roster table to
introduce yet, and building one wasn't in scope for this milestone. So
"recruit" and "remove" are genuinely, honestly just the real
`agents.status` column (active/planned) under a customer-facing name —
**the exact same column `seedAgents()`'s upgrade path already uses**
(Milestone 7's own real bug fix). This was a deliberate scoping
decision, not an oversight: a real multi-tenant roster is Milestone 8's
job (commercial audit), not this one.

- `lib/db/repositories.ts`'s new `setAgentStatus(key, status)` — the one
  new low-level write.
- `lib/domain/employeeWorkflow.ts`: `listEmployeeDirectory()`,
  `recruitEmployee(key)` (refuses a Coming Soon key or an unknown key),
  `removeEmployee(key)` (refuses — `EmployeeHasActiveWorkError` — if the
  agent genuinely has real work in flight right now, reusing the exact
  same real signals the shared 3D office already reads: a `researching`
  mission Scout genuinely leads; a `planning`/`generating` content item
  Content Bot genuinely leads; an open/in-progress `agent_tasks` row for
  the five Operations Wing agents, with Chief of Staff's own
  goal_id-based special case — no new query, reused logic). Removing an
  employee **never touches any other table** — missions, costs,
  deliverables, agent_tasks, chief_of_staff_goals all stay exactly as
  they are, satisfying "removing an employee must not delete historical
  tasks" by construction, not extra code — proven directly in a test.
- API: `GET /api/employees`, `POST /api/employees/[key]/recruit`,
  `POST /api/employees/[key]/remove` — all `requireFounderId()`-gated.

### UI

**`components/founders-desk/EmployeeDirectory.tsx`** — a collapsible
horizontal portrait strip, deliberately rendered as an HTML overlay in
`FoundersDeskApp.tsx` (visible in both HQ View and Focus View, not
inside `Room.tsx` or the 3D canvas) — so it works identically in both
views without touching the 3D engine, `Room.tsx`/`HQView.tsx`, or
Astra's in-progress office redesign **at all**. Clicking a portrait opens
a profile panel: name, job title, department, plain-language
description, real capabilities, required integrations, implementation
status, and a real Recruit/Remove control (disabled and labeled
"Not yet available" for the 3 Coming Soon entries).

**Portraits are accent-colored initials, not photos** — an honest
limitation, not a shortcut: this codebase has no exported 2D character
art (Scout/Content Bot exist only as real procedural 3D meshes built in
Three.js — see Milestone 8's own integration). Using a placeholder stock
photo here would itself be the fabrication CLAUDE.md's rules forbid.
Real portrait images are a legitimate future improvement (e.g.
server-rendering a snapshot of each rig), not done this session.

### Verified, not assumed

`tests/employeeDirectory.test.ts` — 10 new tests: the directory lists
exactly 10 entries with correct real/null agent rows; all 7 real agents
start recruited and all 3 future ones never are; remove→recruit round
trip; removing an already-removed agent is a harmless no-op; recruiting
a Coming Soon key is refused; unknown keys refused on both actions;
**Executive Assistant cannot be removed while it has a real open task,
and can be once resolved**; **Chief of Staff and its delegate cannot be
removed while a real delegated subtask is unresolved**; **Scout cannot
be removed while a mission he genuinely leads is researching, and can be
once it settles**; removing an employee proven NOT to touch its
historical task data.

Full regression: `npx tsc --noEmit` clean, **53 files / 654 tests
passing** (644 prior + 10 new, zero regressions), `npm run build`
succeeds with all three new `/api/employees*` routes in the manifest.

### What is explicitly NOT done in Milestone 2

- No real portrait images (see above).
- No per-business roster table — "recruit/remove" is the real
  `agents.status` column, honestly scoped to this app's current
  single-tenant reality (see "Architecture decision" above).
- Chief of Staff's own delegation target list
  (`chiefOfStaffWorkflow.ts`'s `DELEGATABLE_AGENT_KEYS`) was **not**
  changed to read from the new registry's `DELEGATION_CAPABLE_KEYS` —
  they currently happen to agree (both name the same 4 keys) but are two
  separate lists. Wiring Chief of Staff to the shared registry directly
  is real future work, not done this session, to avoid touching
  Chief of Staff's already-tested, protected delegation logic without a
  dedicated verification pass.

## What is explicitly NOT done yet (Milestones 3-9)

**None of the following were started this session.** Per the brief's own
anti-fabrication rules, this is stated plainly rather than implied done:

- **Milestone 3 (Workforce integration in both views)** — partially true
  already (all 7 agents already appear correctly in both views, proven
  by Milestones 7-8's own tests), but the Directory's recruit/remove
  action has not been verified end-to-end against a live render of
  either view removing/re-adding an agent and confirming the 3D scene
  and Focus View panels both correctly reflect it live.
- **Milestone 4 (Founders' Desk universal review system)** — not
  started. This is a genuinely large, separate piece of work: a real,
  shared inbox/projection over Scout's missions, Content Bot's content
  items, AND a new reviewable-deliverable concept for the five
  Operations Wing agents (which currently have no "deliverable requiring
  founder approval" concept at all — Executive Assistant/Finance/
  Operations/Business Analyst/Chief of Staff's work is currently
  create-and-persist, not submit-for-review). Needs real design work
  before implementation, not just wiring.
- **Milestone 5 (Individual agent task testing)** — not run this
  session as a dedicated pass (though the existing real test suites for
  each agent already cover their core real workflows — see each
  agent's own test file).
- **Milestone 6 (Combined workforce testing)** — `tests/livingEngine.test.ts`
  (Milestone 8) already proves all 7 agents can be genuinely busy at
  once with no interference at the 3D-scene level; a dedicated
  backend-level "assign one real task to every agent in the same run"
  test was not written this session.
- **Milestone 7 (The Cleaner)** — not started. Real scope: a new,
  non-recruitable scripted character (explicitly NOT in the Employee
  Directory per the brief), its own rig/animations, comedy routines, and
  a celebration banner tied to a real approval event (which doesn't
  exist yet — depends on Milestone 4's review system existing first,
  at least for the "WE DID IT, BOSS!" trigger to mean anything real).
- **Milestone 8 (Commercial readiness audit)** — not started. Real
  scope: a factual audit document covering auth, multi-tenancy (this
  app has none yet — confirmed, not assumed), cost protection, data
  retention, deployment readiness, etc.
- **Milestone 9 (Full QA pass)** — implicitly covered by this session's
  own verification (tsc/tests/build all clean), but not a dedicated
  final pass across the whole mission, since most of the mission isn't
  built yet.

## Exact restart point for a future session

1. Confirm this doc's baseline still holds: `npm test && npx tsc
   --noEmit` (expect 654 tests passing).
2. Check again whether Astra's branch now exists (`git ls-remote
   --heads origin | grep -i astra`) before touching anything
   office-related.
3. Next real milestone, in the brief's own stated order: **Milestone 4,
   the Founders' Desk universal review system** — start with real
   design work (what does "a reviewable deliverable" mean for Executive
   Assistant/Finance/Operations/Business Analyst/Chief of Staff, whose
   current workflows have no review step at all?) before writing any
   code. Scout/Content Bot's existing approval mechanisms must not be
   rewritten — build a real adapter/projection over them, per the
   brief's own explicit instruction.
4. After Milestone 4 has a real reviewable-deliverable concept for every
   agent, Milestone 5 (individual testing) and Milestone 6 (combined
   testing) can exercise it honestly — they'd have nothing real to test
   before that.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (654 tests) still holds before continuing.
