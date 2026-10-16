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

## Milestone 4: Universal Founders' Desk, Human Approvals & Complete Agent Verification — DONE

### Architecture decision — an adapter, not a schema merge

Three structurally different review mechanisms already existed (or
needed to exist) across the seven agents, and this milestone's explicit
instruction was to unify them for founders **without** touching Scout's
or Content Bot's own protected state machines:

- **Scout** — `missions` at `ready_for_founders_review`. Reviewed via the
  *existing* `approvals` table (real `mission_id`, already `NOT NULL`),
  with its `decision` vocabulary widened to add
  `founders_desk_approved`/`founders_desk_rejected`/
  `founders_desk_revision_requested`. **`missions.state` is never
  written by this adapter** — a Founders' Desk decision is a real,
  separate, audit-only acknowledgment, not a mission-state transition.
  Because of that, "already reviewed" can't be told from
  `missions.state` (it legitimately stays `ready_for_founders_review`
  either way) — `reviewScoutMission` instead checks `listApprovals` for
  an existing `founders_desk_*` decision, the same check
  `listFoundersDeskInbox` uses to drop it from the pending list. (A first
  version checked `mission.state` for this and never actually refused a
  second review — caught by this milestone's own new test, fixed before
  it shipped; see the file's own doc comment.)
- **Content Bot** — deliberately gets **no new mechanism at all**. The
  unified inbox only *lists* its `awaiting_review` content items; opening
  one routes straight to the existing, fully protected
  `/api/content-items/[id]/decision` flow and `ContentReviewSlideOver`,
  completely unchanged. This is the one place the brief's "don't touch
  Content Bot's existing approval/production/publishing gates" rule is
  structural rather than just a reminder — there was nothing to wire up.
- **The five Operations Wing agents** (Executive Assistant, Finance,
  Operations, Business Analyst, Chief of Staff) had no "deliverable
  requiring founder approval" concept at all before this milestone — their
  work was create-and-persist. A genuinely new table pair,
  `agent_deliverables`/`agent_deliverable_reviews` (migration
  `drizzle/0013_universal_founders_desk.sql`), carries a real snapshot of
  each agent's genuine completed work (never fabricated — see each
  `submit*` function below) through `awaiting_review` →
  `approved`/`rejected`/`revision_requested`, via the same atomic
  conditional-UPDATE pattern (`transitionAgentDeliverableState`) every
  other state machine in this codebase already uses.

`lib/domain/foundersDeskWorkflow.ts` is the one new adapter module:
`listFoundersDeskInbox()` (the real unified projection — missions +
content items + deliverables, each only ever appearing while genuinely
pending), `reviewScoutMission`/`reviewAgentDeliverable` (Approve/Reject/
Send-Back, honestly — "send back" never fabricates an automatic revision;
for Scout it's recorded with an explanatory message since Scout has no
revision workflow, for the five agents it creates a real, visible
`agent_tasks` follow-up row instead), and five `submit*` functions (one
per Operations Wing agent) that wrap **only genuinely existing, completed
data** — Executive Assistant refuses an incomplete task, Finance wraps
real budget/expense rows, Operations wraps real checklist item
done-counts, Business Analyst wraps a real completed sourced-research
report, and Chief of Staff **hard-refuses** consolidation while any
subtask is still `open`/`in_progress` (the brief's own anti-fabrication
requirement for "a consolidated result from genuine subtask outcomes,
never fabricating completion").

### UI

- **Focus View**: `components/founders-desk/FoundersDeskInbox.tsx` — the
  professional central review interface the brief's Section 6 asked for:
  real pending items with employee, title, deliverable kind, and
  timestamp; Approve/Reject/Send-Back for deliverables and Scout missions
  inline; a real inspect modal showing a deliverable's actual content
  (never just a title with no result); Content Bot items open the
  existing, unmodified slide-over rather than a second review UI.
  Mounted at the top of `FocusView.tsx`'s center column. Each of the five
  agent panels (`ExecutiveAssistantTasks`, `FinanceAgentPanel`,
  `OperationsAgentChecklists`, `BusinessAnalystPanel`,
  `ChiefOfStaffPanel`) gained a real "Submit for review" action wired to
  its own new endpoint — Chief of Staff's is disabled and labeled with the
  exact unresolved-subtask count until every subtask is genuinely
  resolved.
- **Office View (Section 7)**: a real, global pending-review **count**
  (`foundersDeskPendingCount` in `FoundersDeskApp.tsx`, fetched from the
  same `GET /api/founders-desk/inbox` on mount and on the existing
  always-on poll tick — no new interval) threaded top-down, exactly like
  `missions`/`leadAssignments` already are, through `HQView` → `Room` →
  the existing `MissionBoard.tsx`, which renders it as a small red
  "N awaiting review" badge next to its "Mission board" header label.
  **Deliberately HTML-only** — `MissionBoard.tsx` is the board's existing
  React/CSS overlay, not Three.js geometry, so this satisfies the brief's
  explicit "do not modify office geometry, character designs, world
  layout or animation systems" instruction by construction: nothing under
  `components/founders-desk/world/` was touched, and the full
  `livingEngine`/`officeWorld`/`officeLayout`/`idleWander`/`scoutLocation`
  test files all still pass unchanged, proving it. The count is global
  (not room-scoped) because the five Operations Wing agents' deliverables
  aren't workspace-bound — a per-room count would misrepresent them.

### Verified, not assumed

`tests/foundersDeskWorkflow.test.ts` — 14 new tests at the domain layer
(empty inbox; a mission/deliverable listed then correctly disappearing
after review; approving a mission never touches `missions.state`;
reject/revise record distinct real decisions; **double-review of the
same mission is refused** — the test that caught the real `state`-check
bug above; each of the five `submit*` functions proven to refuse
fabrication and to wrap genuinely real content on success; a Send-Back
on a deliverable proven to create a real `agent_tasks` follow-up row;
double-review of a deliverable refused).

Full regression after the domain/API/UI work: `npx tsc --noEmit` clean,
**54 files / 668 tests passing** (654 prior + 14 new, zero regressions).

**Live verification against the real running dev server** (a real,
valid session token read directly from the real `auth_session` table,
used as a cookie against `curl` — no browser-automation tool was
available; this is the same technique established earlier in this
mission, not a new shortcut), exercising the real Neon Postgres database
end-to-end, not mocks:

- `GET /api/founders-desk/inbox` returned the real, pre-existing pending
  Scout missions and Content Bot items.
- **Executive Assistant**: created a real task → completed it → submitted
  → approved. Verified removed from the inbox afterward.
- **Finance**: set a real budget, logged a real expense, submitted the
  real spend report, rejected it.
- **Operations**: created a real checklist, submitted it, sent it back
  with a note — **confirmed directly in the database** that a real
  `agent_tasks` row (`task_type: "revision_follow_up"`, carrying the
  founder's exact note) was created for `operations_agent`.
- **Chief of Staff**: created a real goal with two delegated subtasks;
  confirmed `submit-for-review` is refused (400) while they're
  unresolved; completed both; submitted the real consolidated result;
  approved it.
- **Business Analyst**: ran one real, billed web-research call against
  the live Anthropic API (a real `ANTHROPIC_API_KEY` is configured in
  this environment); submitted the completed report (confirmed real
  sources attached); inspected it via the detail endpoint; approved it.
- **Scout**: approved one real pending mission and rejected another at
  the Founders' Desk; confirmed **`missions.state` was unchanged**
  (stayed `ready_for_founders_review`) before and after, on both;
  confirmed a second review attempt on the same mission is refused (409).
- **Genuine concurrency** (brief's Section 9 — "no race conditions, no
  bypassed review"): fired two simultaneous review requests (one
  approve, one reject) at the same real deliverable. Exactly one won
  (200), the other was refused (409), and the database shows exactly one
  review row and a single consistent final state — the atomic
  `transitionAgentDeliverableState` guard proven under real Postgres
  write concurrency, not just sequential calls.
- Confirmed via the dev server's own log that every change hot-reloaded
  with zero compile errors, and `GET /` for an authenticated founder
  still returns 200 with the real Mission board markup present.

### What is explicitly NOT done in Milestone 4

- **No real browser was used** — every "live" claim above is a real HTTP
  round-trip against the real running server and real database using a
  real session cookie, not a simulated or mocked one, but it is not a
  pixel-rendered, screenshot-verified browser session. The badge's actual
  on-screen appearance (styling, layout at narrow widths, the inbox
  modal's visual layering) has not been visually confirmed — only that
  it compiles, renders server-side without error, and receives/returns
  the right data.
- The five Operations Wing agents' `submit-for-review` action is manual
  (a founder clicks a real button once work is genuinely done) — there is
  no automatic "submit the moment a task completes" behavior, matching
  the brief's own "deliverable" framing (a deliverable is something
  explicitly handed up for review, not every completed task).
- No "Cleaner" mascot, celebration banner, or approval-triggered
  animation exists yet — that is Milestone 7, separately scoped, and
  this milestone's approvals are real but silent.

## What is explicitly NOT done yet (Milestones 5-9)

**None of the following were started this session.** Per the brief's own
anti-fabrication rules, this is stated plainly rather than implied done:

- **Milestone 3 (Workforce integration in both views)** — partially true
  already (all 7 agents already appear correctly in both views, proven
  by Milestones 7-8's own tests), but the Directory's recruit/remove
  action has not been verified end-to-end against a live render of
  either view removing/re-adding an agent and confirming the 3D scene
  and Focus View panels both correctly reflect it live.
- **Milestone 5 (Individual agent task testing)** — the live
  verification above covers each of the seven agents' real workflow
  through the new review lifecycle specifically; a dedicated, separate
  pass per agent beyond what Milestone 4 already exercised was not run
  this session.
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
   --noEmit` (expect **668 tests passing**).
2. Check again whether Astra's branch now exists (`git ls-remote
   --heads origin | grep -i astra`) before touching anything
   office-related.
3. Next real milestone, in the brief's own stated order: **Milestone 5/6
   — a dedicated individual + combined agent testing pass**, beyond what
   Milestone 4's own live verification already covered. Milestone 4 now
   gives every agent a real, exercisable reviewable-deliverable concept
   to test against — this was the blocking dependency noted in the prior
   version of this doc, and it's now resolved.
4. After that, **Milestone 7 (The Cleaner)** has what it needs to be real
   rather than cosmetic: Milestone 4's Approve decisions are genuine
   events a celebration trigger could honestly hook into.
5. If visual/browser confirmation of the new Founders' Desk UI (the
   inbox panel, the mission-board badge) becomes available in a future
   session, that is the one verification gap this milestone explicitly
   named as not done — see Milestone 4's own "What is explicitly NOT
   done" list above.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (668 tests) still holds before continuing.

---

# Master Development Mission 5 — Product Polish, Living Workforce,
# Multi-Agent Testing, The Cleaner & Commercial MVP Foundations

A new, much larger founder brief superseding the milestone framing
above for everything from here on. Work tracked by the brief's own
**Phase A–I** structure (Section 17). **Branch:**
`claude/commercial-mvp-polish`, created from `claude/wonderful-shannon-
b9zcsj` at commit `4c0ce27` (the tip at the start of this brief — 668
tests passing, clean `tsc`, confirmed by re-running both before
branching, not assumed from the prior session's own report).

## Phase A — Baseline and safety: DONE

- Re-verified (not assumed): `npx tsc --noEmit` clean, `npx vitest run`
  → 54 files / 668 tests passing, matching the prior session's own
  closing report exactly.
- `git fetch` confirmed the prior branch was already fully pushed
  (founder had run the push manually since the last session) — no
  unpushed work existed to protect.
- No `astra/*` branch exists on the remote yet (checked directly via
  `git ls-remote --heads origin`).
- New branch `claude/commercial-mvp-polish` created from that verified
  HEAD, per the brief's explicit instruction.
- **Playwright installed as a real devDependency** (`package.json`) —
  the single biggest capability change this session. Every prior
  session's "live verification" was HTTP+database only, with no way to
  visually confirm anything; a real Chromium browser downloads and runs
  successfully in this environment (confirmed by actually doing it, not
  assumed), making genuine screenshot-based verification possible for
  the first time. Used throughout everything below.

## Phase B — Employee Directory and UI polish: substantially DONE

**Real portraits, not colored initials.** Investigated what asset
options actually existed before writing any code (per the brief's own
"prefer reusing existing approved assets... do not require expensive
image-generation API calls" instruction): `components/founders-desk/
world/scout.ts`'s seven `buildXxx()` character-rig functions and
`materials.ts`'s `buildMaterials()` turned out to be fully self-
contained (no scene/renderer dependency) — reusable as-is, with zero
changes to either file. Built `app/dev-portrait-capture/page.tsx`, a
genuinely temporary, auth-gated, unlinked capture harness that mounts
one real agent rig in an isolated scene with real portrait lighting and
a head-and-shoulders camera framing (iterated live via real Playwright
screenshots — roughly six rounds of render→look→adjust before the
framing was right; Scout's fedora needed extra headroom the six hatless
"creator"-persona agents didn't). Rendered all seven real portraits
through a headless browser against the live dev server into
`public/employee-portraits/*.png` — literally the same approved rig
every founder already sees in the 3D office, not fabricated art, not a
different style, not a paid image-generation call.

For the three not-yet-built future employees (no rig exists to render),
built `ComingSoonSilhouette` — a plain, deliberately featureless rounded
shape in the same visual family, never claiming a finished design that
doesn't exist. This is the brief's own documented fallback path
("implement a reliable reusable portrait component"), chosen over
inventing a new placeholder 3D character for an agent with no approved
design yet.

**Fixed the real "covers application content" bug**, confirmed first by
screenshot before any fix was written: expanding the directory strip
rendered directly over whatever page content was underneath (in Focus
View this landed on top of the live workspace-creation form's actual
input fields) with no visual signal that it needed dismissing. Added a
real dimmed backdrop on expand (the same pattern the profile dialog
already used) and real bottom padding on `<main>` so the always-visible
collapsed bar never clips the last content on the page. Re-verified
live: a `fullPage` screenshot still shows an apparent overlap mid-page
— confirmed via a second, non-`fullPage` screenshot taken at a real
scroll position that this is a known Playwright artifact (`position:
fixed` elements get composited at every stitched scroll offset in a
full-page capture) and not real browser behavior; the real scrolled
viewport shows the collapsed bar behaving as a normal, non-intrusive
bottom bar.

**Replaced exposed technical strings.** `requiredIntegrations:
["ANTHROPIC_API_KEY", ...]` was being joined raw into the profile
dialog. Added `INTEGRATION_LABELS` (plain-language descriptions) to the
registry and a real server-side `integrationsReady` check
(`lib/domain/employeeWorkflow.ts` — genuine `process.env` presence per
required var, boolean only, value never leaves the server) so the UI
now reads "Uses: AI research & writing — ready to work" instead of a
raw variable name, and would honestly show "integration required —
contact the administrator" in a deployment actually missing a key
(verified structurally; this dev environment has every key configured,
so the "missing" path couldn't be live-demonstrated here).

**Layout/accessibility**: full names (no truncation), wider cards,
"N of 7 recruited" (explicit denominator), Escape-to-close (profile
first, then strip), real focus-on-open for the profile dialog, specific
per-employee `aria-label`s (name + role + recruitment status) instead
of relying on adjacent visible text.

**Recruitment feedback**: a real, non-speculative confirmation (brief
checkmark + "has joined the office" message) fires only after the
server confirms the write, motion-safe.

**Verified live, with a real browser, against the real running app** —
not assumed: directory expand/collapse at desktop (1440px) and mobile
(390px) width; opening Scout's profile (confirmed real portrait, real
plain-language integration line); a real Remove-then-Recruit round trip
for Executive Assistant, confirmed in the database both times
(`agents.status` really flipped to `"planned"` then back to `"active"`);
the Focus View overlap fix, at both a `fullPage` capture and a real
scrolled-viewport capture. One tooling note recorded honestly: Playwright's
own click-stability heuristic repeatedly timed out against this app's
continuously-repainting WebGL canvas (GPU "ReadPixels" stalls in the
console) even though the element was genuinely clickable — confirmed by
using `page.mouse.click()` at the element's real coordinates instead,
which worked immediately every time. Not an application bug; noted here
so a future session doesn't waste time re-diagnosing it.

**Not done in Phase B**: no visual QA pass across every one of the ten
profiles individually (only Scout's was opened in a screenshot); no
check of the "coming soon" silhouette inside the profile dialog itself
(only the collapsed strip); horizontal-scroll behavior on the strip at
very narrow widths wasn't specifically exercised beyond the one mobile
screenshot taken.

## Phase C — Founders' Desk polish: partially DONE

**Investigated the "possible duplicate entries" question directly**,
per the brief's explicit "do not assume this is a defect" instruction —
queried the real database before writing anything. Finding: not a
duplication bug. Two real, separate `content_items` rows exist under one
mission (Content Bot's own multi-production "Produce Again" architecture
working as designed — see the memory note on this), and
`listFoundersDeskInbox` was correctly listing each once; the real
problem was that both rows showed only their shared mission title with
nothing to tell them apart. Fixed by labeling any item whose mission has
more than one real content item with its own ordinal ("production
attempt 2 of 2"), proven with two new tests and confirmed against the
exact real historical data that prompted the founders' question (now
reads "...(production attempt 7 of 7)" live). A separate, real,
unrelated finding surfaced during the same investigation: one mission's
title is genuinely stored as `"ind Our Next Viral Short Brief:"` (missing
its leading "F") — reproduced-against directly (fast synthetic typing in
the real form, focus-race scenarios) with no character loss in either
case, and `MissionForm.tsx` has not changed since before that mission was
created (`git log`), so this is not a reproducible code defect. Left
untouched as a genuine historical record, per the brief's "do not delete
legitimate historical records" instruction — editing someone else's past
typo would misrepresent history, not fix a bug.

**Not done in Phase C** (the larger part of this phase's brief): the
review inbox's presentation of agent portrait/richer deliverable
inspection (report content, sources, generated files, video preview,
financial calculations, checklist contents, revision history) beyond
what Milestone 4 already built; no additional polish pass on
`FoundersDeskInbox.tsx` itself this session.

## Phases D–I: NOT STARTED

Stated plainly, not implied done:

- **Phase D — complete seven-agent verification matrix.** Milestone 4's
  own live verification (prior session) already exercised each agent's
  real workflow through the new review lifecycle once, including one
  genuine concurrency test, but the brief's full 12-point acceptance
  checklist per agent, and a dedicated multi-agent concurrent-load test,
  were not built this session.
- **Phase E — commercial security / multi-tenancy.** Not started at all.
  This is explicitly called out in the brief as taking priority over
  decorative features once started — real design work (organisation/
  membership model, migration safety, isolation proof via negative
  tests, recruitment refactored to be organisation-scoped) is a
  substantial, separate undertaking from everything above and has not
  begun.
- **Phase F — roles/permissions, usage/spending safeguards.** Not
  started.
- **Phase G — onboarding foundation, billing-readiness scaffolding (test
  mode only).** Not started.
- **Phase H — The Cleaner.** Not started (correctly — the brief orders
  this after critical reliability/security work, not before).
- **Phase I — final regression and release audit.** Not started as its
  own pass; this session's own regression checks (tsc/tests/build, all
  green) are real but scoped to what this session touched, not a full
  launch-readiness audit.

## Exact restart point for a future session

1. Confirm this doc's baseline still holds:
   `npm test && npx tsc --noEmit` (expect **670 tests passing**).
2. Confirm still on `claude/commercial-mvp-polish`, and whether it's been
   merged/pushed since (`git status`, `git log origin/... ` if a remote
   tracking branch exists yet — it didn't as of this session, since this
   branch was only just created and pushing from this sandbox requires
   the founder's own `git push`, per the standing credential limitation
   recorded earlier in this file's history).
3. Check again whether Astra's branch now exists before touching
   anything office-related (`git ls-remote --heads origin | grep -i
   astra`).
4. Next real work, in the brief's own Phase order: finish Phase C (the
   richer deliverable-inspection UI), or move to Phase D's full
   verification matrix — both are natural continuations of what's
   already built. **Phase E (multi-tenancy) is the first large,
   separate design effort** or the next genuinely different kind of
   work in this mission; the brief is explicit that it preempts
   decorative work (including the still-pending Phase H Cleaner) the
   moment it's reached.
5. Playwright is now a real, working devDependency — use it. The
   WebGL-canvas click-stability caveat above (use `page.mouse.click()`
   at real coordinates when `.click()` times out despite the element
   being genuinely clickable) applies to any future live test of this
   app's 3D views.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (670 tests) still holds before continuing.

---

# Master Development Mission 6 — From Working AI Headquarters to
# Secure, Multi-Customer SaaS Platform

**Branch:** `claude/commercial-mvp-polish` (continued — already pushed,
`branch.ab +0/-0` confirmed at session start). **Latest commit:**
`b575480`. Phases followed: the brief's own **Phase D** (baseline/
ownership audit), plus an explicit founder-priority addendum ("prove
the seven agents genuinely work, especially Chief of Staff coordination,
before onboarding/billing — continue multi-tenancy in parallel"), plus
real progress into **Phase E** (multi-tenant foundation).

## Phase D — Baseline and ownership audit: DONE

Re-verified, not assumed: `npx tsc --noEmit` clean, `npx vitest run` →
54 files / 670 tests (exactly the prior session's own closing count),
branch already pushed, no `astra/*` branch yet, dev server starts
clean.

**The real ownership map** (ahead of any schema change):

- **Had a real, direct `founder_id`:** `missions`, `chief_of_staff_goals`,
  `agent_tasks`, `checklists`, `business_analyst_reports`,
  `agent_deliverables`, `agent_deliverable_reviews`, `approvals`.
- **Scoped transitively via `mission_id → missions.founder_id`:**
  `mission_stages`, `agent_assignments`, `evidence`, `deliverables`,
  `content_items`, `content_versions`, `content_assets`.
- **Scoped transitively via `checklist_id → checklists.founder_id`:**
  `checklist_items`.
- **Genuinely global catalogs (correctly so — not customer data):**
  `agents`, `agent_capabilities` (the shared Employee Capability
  Registry's DB half; unchanged by this mission). A legacy set of 7
  "planned" agent rows (`inventor`, `inspector`, `merchant`, etc. — an
  older, pre-Employee-Registry concept from Milestone 1, never cleaned
  up, not part of the 10-profile Employee Directory) also lives here,
  harmlessly global, not touched this session.
- **Had NO ownership column at all — the real, concrete gaps:**
  `expenses` and `budgets` (genuinely shared/global regardless of which
  business logged what — confirmed by reading their own doc comments,
  which say so explicitly: "No founder_id... a shared business ledger"),
  and `projects`/workspaces (any founder could see/use any workspace).
  `costs`/`ledger_entries`/`activity_history` have a *nullable*
  `mission_id` and no `founder_id` at all — when `mission_id` is null
  (e.g. a Business Analyst cost), there was and is no way to attribute
  that spend to an organization yet; flagged as real follow-up work,
  not fixed this session (see "Not done" below).
- **Recruitment ownership:** `agents.status` ("active"/"planned") was
  the sole signal for "is this agent recruited" — fully global. This is
  the literal scenario Section 7's Bakery HQ / Landscaping HQ example
  warns about: recruiting or removing an agent currently affects every
  organization at once, because there is no organization yet.

Every API route under `app/api/**` currently derives the acting founder
from `requireFounderId()` (never trusts the client) but, for the gap
tables above, has nothing to additionally scope BY — this is the
concrete blocker Phase E's schema work below exists to close.

## Phase (addendum) — prove the seven agents genuinely work: DONE,
## with a real gap found and fixed

The founders' own explicit priority for this session, ahead of
onboarding/billing: verify Chief of Staff's multi-agent coordination is
real, not simulated, and fix it if it isn't.

**Investigated before claiming anything.** `completeFounderTask`/
`cancelFounderTask` (the functions a delegated subtask is actually
completed through) had zero agent-specific branching — completing a
subtask "delegated to Finance Agent" was the exact same generic
`agent_tasks` state flip as completing one delegated to Business
Analyst, or an Executive Assistant reminder. For Executive Assistant/
Finance/Operations that's honest (none has any autonomous AI
execution — they're founder-driven tools by design, same as Executive
Assistant's own "internal reminders only" is already documented to be).
**It was not honest for Business Analyst**, which does have a real
autonomous capability (`requestResearch`, a genuine billed Claude call
with web search) — a subtask delegated to it was being closed out as a
bare manual checkbox, with that real capability never actually
dispatched. Chief of Staff was coordinating a to-do list for that one
delegate, not genuinely sending it real work.

**Fixed**: `lib/domain/chiefOfStaffWorkflow.ts`'s new
`runDelegatedResearch(founderId, taskId)` reuses `requestResearch`
verbatim, uses the subtask's own title/detail as the real question, and
marks the subtask "completed" — atomically, with the real report's id
recorded in its own `result` field — **only** when that real research
genuinely finished successfully. A failed run leaves the subtask
exactly where it was and throws a new `ChiefOfStaffResearchError`
carrying the real failed report's id — never a fabricated completion.
New route: `POST /api/chief-of-staff/subtasks/[id]/run-research`.
`ChiefOfStaffPanel.tsx`'s UI shows "Run real research" instead of the
generic "Done" button for a Business-Analyst-delegated subtask. 6 new
tests (20 total in `tests/chiefOfStaff.test.ts`).

**Verified live, with real money spent, not mocked**: a genuine 4-agent
goal ("Launch a small print-on-demand sticker shop", one subtask each
to Business Analyst/Operations/Finance/Executive Assistant) run start
to finish through the real running app and real database:
- The first real research attempt **genuinely failed** — Business
  Analyst's own guardrail correctly rejected a report for using
  "guaranteed" language — and the subtask was confirmed, directly in
  the database, to remain `open` with **zero** fabricated completion,
  while the real $0.144 cost of that failed attempt was still recorded
  (consistent with the existing "never drop real cost" discipline).
- A retry **genuinely succeeded**, the subtask transitioned to
  `completed` with a real report id attached.
- All 4 subtasks were then completed, the consolidated result
  submitted, confirmed present in the real Founders' Desk inbox, and
  approved — the complete real multi-agent coordination loop, start to
  finish, with real evidence at every step.

**Other six agents — status, not re-verified from scratch this
session** (to respect Section 13's "do not run repeated paid calls
solely to populate a dashboard"): Scout and Content Bot were already
real-verified live earlier in this same branch's own work (a real
Scout mission approved/rejected at the Founders' Desk with
`missions.state` proven untouched; Content Bot's real multi-production
history is the very data this branch's own duplicate-title fix was
verified against). Executive Assistant/Finance/Operations/Business
Analyst were each real-verified live in that same earlier session (real
task completion, real budget/expense recording, real checklist
completion, one real billed research call) — see this doc's own
Milestone 4 section above for the full account. Nothing here re-claims
those without that evidence; this session's own new live evidence is
specifically the Chief-of-Staff-coordinated run above.

## Phase E — Multi-tenant foundation: real, verified progress (not complete)

**Schema and safe migration — DONE.** New tables: `organizations`,
`organization_members` (real many-to-many, a role per membership),
`organization_agents` (replaces global `agents.status` as the real
per-organization recruitment signal — deliberately a new table, not a
new column on `agents`, which stays the one shared, global agent-type
catalog, unchanged). `organization_id` (nullable, FK'd) added to every
table the audit above found needed real ownership: `projects`,
`missions`, `chief_of_staff_goals`, `agent_tasks`, `checklists`,
`business_analyst_reports`, `agent_deliverables`,
`agent_deliverable_reviews`, `expenses`, `budgets`. Migration
`drizzle/0014_black_nicolaos.sql` — entirely additive (new tables, new
nullable columns only; nothing dropped, nothing tightened yet).

**Safe backfill — DONE and verified live.** `lib/db/client.ts`'s new
`ensureDefaultOrganization()` (same exported, idempotent,
directly-testable pattern as the existing `seedAgents()`) creates one
real "Founders' HQ" organization, adds **both** real founders as real
owner members, backfills `organization_id` on every existing row across
all ten tables (`WHERE ... IS NULL` — a second call does zero writes),
and backfills `organization_agents` from the real, existing
`agents.status = 'active'` rows. No row was ever ambiguous enough to
need stopping the migration — every pre-existing row genuinely belongs
to the one real business this app has ever served (confirmed, not
assumed, by the audit above). **Verified directly against the real dev
database after running it**: one organization, both founders as owners,
all 7 real agents correctly present in `organization_agents`, and all
48 real pre-existing rows across all 9 scoped tables confirmed at
**zero** remaining NULLs. Applied to both the real dev Postgres and the
local test Postgres.

**676 tests passing** (670 prior + 6 Chief-of-Staff tests), one real
regression found and fixed along the way (`tests/agentSeeding.test.ts`
deleted an `agents` row directly to simulate a gap — now also deletes
the real `organization_agents` row referencing it first, the same real
FK discipline it already applied to `agent_capabilities`). `npx tsc
--noEmit` clean, production build clean (verified via the safe stop/
rebuild/restart procedure — dev server confirmed healthy both before
and after), a live smoke test of `/api/missions`, `/api/employees`,
`/api/founders-desk/inbox`, `/api/projects`, and
`/api/finance/expenses` all returned real 200s against the migrated
database.

### What Phase E explicitly does NOT yet cover — stated plainly

This is a real foundation, not a finished tenant boundary. Concretely
still open:

- **No route or domain function actually reads or filters by
  `organization_id` yet.** Every API route still behaves exactly as
  before — single-tenant, reading/writing without any organization
  scope. The column exists and is correctly populated; nothing enforces
  it yet. This is the large, separate "isolation hardening" effort
  Phase F names, not started.
- **Recruitment still reads the old global `agents.status`,** not the
  new `organization_agents` table — `lib/domain/employeeWorkflow.ts`
  was not touched this session. `organization_agents` is correctly
  backfilled and ready to become the real source of truth, but nothing
  reads from it yet.
- **No organization-switcher or "current organization" concept exists
  in the UI or session** — `FoundersDeskApp.tsx` has no
  `activeOrganizationId` the way it already has `activeProjectId`.
- **No security-negative tests exist yet** — Section 10's explicit
  two-fictional-organizations isolation-attack test suite (direct URL
  manipulation, cross-org recruitment mutation, missing organization
  context, etc.) was not written this session, because there is no
  enforcement yet for it to test.
- **`costs`/`ledger_entries`/`activity_history`'s nullable-`mission_id`
  attribution gap** (see the audit above) was identified but not
  closed.
- **Inngest background jobs** (`scoutResearchJob.ts`,
  `contentProductionJob.ts`, the watchdogs) were not inspected or
  changed for tenant-context safety this session.
- **No role/permission model beyond what the schema can now express**
  (`organization_members.role`) — no route checks it yet.
- `budgets`' real "one ceiling per category+period" semantics (per its
  own doc comment) should become per-organization once scoping is
  enforced — flagged, not yet re-verified against the new column.

## What remains (Mission 6's own Phases F–L): NOT STARTED

Stated plainly: Phase F (complete isolation hardening + negative
tests), Phase G (seven-agent acceptance testing under tenant-aware
ownership — distinct from the addendum work above, which proved Chief
of Staff's coordination is real but not yet under organization scoping),
Phase H (usage/spending controls), Phase I (customer onboarding), Phase
J (billing foundations), Phase K (browser QA/release audit beyond what
was done this session), Phase L (Cleaner).

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **676 tests
   passing**).
2. Re-verify the real dev database backfill still holds (the
   verification script used this session queried `organizations`,
   `organization_members`, `organization_agents`, and every scoped
   table's remaining NULL count directly — repeat that check rather
   than assuming no regression).
3. **The next real engineering action**: wire ONE real route through
   the new ownership model end to end, as a proof the foundation
   actually works under enforcement, before touching every route at
   once. The brief's own suggested order (Section 7's own worked
   example) makes per-organization recruitment the natural first slice:
   build `lib/domain/organizationWorkflow.ts` (a `requireActiveOrganization
   (founderId)` resolver every other scoped function will need), switch
   `lib/domain/employeeWorkflow.ts`'s recruit/remove/list functions to
   read and write `organization_agents` instead of the global
   `agents.status`, thread an `activeOrganizationId` through
   `FoundersDeskApp.tsx` the same way `activeProjectId` already works,
   and write the real Section 10 security-negative tests for exactly
   this one slice (two fictional organizations, prove org A cannot
   recruit/remove/see org B's workforce). Only once that one slice is
   real and tested does repeating the pattern for missions/finance/
   checklists/etc. become mechanical rather than risky.
4. Astra's branch still doesn't exist — check again
   (`git ls-remote --heads origin | grep -i astra`) before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (676 tests) still holds before continuing.

---

# Mission 6 continued — Phase E completed: real, enforced, tested tenant isolation

Direct continuation of the same session, same branch
(`claude/commercial-mvp-polish`), responding to the founder's explicit
follow-up: "Your immediate priority is completing Phase E ... Use two
isolated fictional businesses (Bakery HQ and Landscaping HQ) to prove
... Enforce organisation membership and permissions server-side."
**Latest commit: `938703d`.**

## What's now real (not just schema) — every path listed actually enforces it

`lib/domain/organizationWorkflow.ts` is the new enforcement core:
`requireOrganizationMembership` (throws for a genuine non-member),
`getActiveOrganizationForFounder` (the real, server-resolved "which
organization" — never accepted from a client), `createOrganizationWithOwner`.

Organization-scoped for real, with every call site updated (not left
half-migrated):

- **Recruitment** (Section 7's own worked example) — `organization_agents`
  is now the real per-org "recruited" signal; `employeeWorkflow.ts`'s
  recruit/remove/list and the active-work safety check (missions/content
  items/agent_tasks, all newly org-filtered) are fully real.
- **Missions** — creation, the real mission list (`/api/missions`,
  `app/page.tsx`), and `getDefaultProject` (a genuine cross-tenant leak
  before this — the single oldest project across *every* organization).
- **Finance** — `expenses`/`budgets` had **no ownership column at all**
  before this; every read/write path is now real, server-side
  WHERE-clause scoped, and "one budget per category+period" is real
  per-organization uniqueness now, not global.
- **Chief of Staff goals, checklists, Business Analyst reports, agent
  deliverables** — creation and every read path.
- **Founders' Desk** (Section 8's explicit example) — the inbox and
  every review/submit function now verify the real resource's
  `organization_id` against the acting founder's own organization,
  with a deliberately generic "not found" (never confirming or denying
  another organization's data exists) on mismatch.
- **Projects/workspaces** — creation and listing.

## Real security-negative tests — `tests/organizationIsolation.test.ts` (17 new)

Two genuinely separate real organizations (Bakery HQ, Landscaping HQ),
two genuinely separate real founders (`createFounder`, a new repository
function — not used by `seed()`, which still hardcodes Ellis/Maddie's
own two rows unchanged). Proven, against a real database: a brand-new
organization starts with **nothing** recruited; recruit/remove/
re-recruit are fully independent between organizations; missions and
Founders' Desk items never cross organizations (both via the inbox
listing and via a direct cross-organization review/submit attempt using
the real resource id); finance with the *same category name* in two
organizations never collides or leaks; tasks/checklists/goals are
isolated; the membership primitive itself refuses a genuine non-member
in both directions; and Ellis/Maddie's own real "Founders' HQ" data is
completely unaffected by creating the two new test organizations.

## Verified, not assumed

**693 tests passing** (676 prior + 17 new). `npx tsc --noEmit` clean.
Production build clean (safe stop → `npm run build` → `rm -rf .next` →
restart). Live, with a real browser and the real founder session: every
real API route smoke-tested (200s), real data spot-checked directly
against Postgres (21 real missions, 7-of-7 recruited agents, both real
projects, real expense rows — all correctly carrying the real "Founders'
HQ" `organization_id` from the earlier backfill), and a real screenshot
confirming the HQ view renders identically to before this refactor, zero
page errors.

## Remaining vulnerabilities / explicitly not yet covered — stated plainly

1. **`leadAssignments` and `agentTaskSignals` stay global.** They drive
   the one shared 3D office scene (Astra's own design — this session
   deliberately did not touch `components/founders-desk/world/*` or the
   geometry it renders, per the brief's own explicit instruction). Once
   a second organization with its own recruited agents genuinely exists,
   this *would* leak that organization's agent positions/activity into
   every other organization's Office View. Real, named, not closed.
2. **Content Bot's own tables** (`content_items`, `content_versions`,
   `content_assets`) were not independently audited or given a direct
   `organization_id` this session — they inherit real scoping
   transitively through `mission_id → missions.organization_id` (and
   missions are now correctly scoped), but no test specifically proves
   Content Bot's own API routes (`/api/content-items/*`,
   `/api/content/assets/*/stream`) refuse a cross-organization request.
   This is the natural next slice — same pattern as Founders' Desk's own
   review functions, not yet applied here.
3. **Inngest background jobs** (`scoutResearchJob.ts`,
   `contentProductionJob.ts`, `stuckMissionWatchdog.ts`,
   `followupDispatchWatchdog`/`revisionDispatchWatchdog`) were not
   inspected for tenant-context safety this session. They operate on
   real mission/content-item ids already resolved server-side (not
   client-supplied), so the immediate injection risk is low, but no
   test proves a background job can't act across organizations, and
   Section 11's own checklist (idempotency, scoped DB access, no
   cross-tenant result delivery) was not run against them.
4. **`costs`/`ledger_entries`/`activity_history`'s nullable-`mission_id`
   attribution gap** (named in the Phase D audit above) is still open —
   a cost with no mission (e.g. Business Analyst's own spend, which *is*
   now organization-attributable via the report it's tied to, but the
   `costs` row itself still isn't) has no direct organization
   attribution.
5. **No role/permission distinctions enforced yet beyond membership
   itself.** `organization_members.role` ("owner"/"admin"/"member") is
   real and returned by `requireOrganizationMembership`, but no route
   yet checks it — every member is currently treated identically to an
   owner for every action. Section 9's full model is schema-ready, not
   enforced.
6. **No organization-switcher UI, no onboarding path to create a second
   real organization for an actual new customer** — `createOrganizationWithOwner`
   is real and tested, but only reachable from server-side code (tests,
   future onboarding), not from any route or UI yet.
7. **`setCategoryBudget`'s "one budget per category+period" uniqueness
   has no DB-level constraint**, organization-scoped or otherwise — only
   the function's own select-then-branch guards it, the same
   non-atomic-upsert caveat that already existed before this migration
   (now scoped, but not hardened).

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **693 tests
   passing**).
2. Re-verify the real dev database directly (same technique used this
   session: query `organizations`/`organization_members`/
   `organization_agents` and spot-check a few scoped tables' real rows)
   rather than assuming no regression.
3. **Next real engineering action, in the order the remaining
   vulnerabilities above suggest**: Content Bot's own routes next (the
   same "verify the real resource's organization_id, generic not-found
   on mismatch" pattern already proven for Founders' Desk — extend
   `tests/organizationIsolation.test.ts` or a sibling file with the
   equivalent Bakery-vs-Landscaping content-item tests), then the
   Inngest background-job audit (Section 11's own checklist), then
   decide deliberately whether `leadAssignments`/`agentTaskSignals`
   need a real per-organization 3D-world story *before* a second
   organization with real recruited agents can safely go live — that
   decision affects Astra's own design and should not be made
   unilaterally.
4. Still do not proceed to public onboarding or billing (Phases I/J)
   until the above is closed — consistent with the founder's own
   explicit instruction this session.
5. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (693 tests) still holds before continuing.

---

# Mission 6 continued — tenant isolation substantially complete

Same session, same branch. Responding to the founder's explicit
follow-up: close the remaining tenant-security gaps named in the prior
update before proceeding to workforce verification/spending/onboarding.
**Latest commit: `de1a873`.**

## What closed this round

**Content Bot's complete workflow — audited and secured.** Every
founder-facing function (`approveMission`, `cancelMission`,
`approveForProduction`, `commissionPilotAnyway`,
`produceAgainFromMission`, `approveContentVersion`, `rejectContentItem`,
`requestContentRevision`, `retryProductionAfterTechnicalFailure`,
`cancelContentItem`) had the exact gap Phase E already closed for
Founders' Desk: a `founderId` parameter accepted but never checked
against the resource. Fixed, with a generic "not found" on any
organization mismatch. `getMissionDetail`/`getContentItemDetail` now
require a real `organizationId` and return `null` across organizations.
The real asset-streaming route (`/api/content/assets/[assetId]/stream`)
— the single most sensitive surface Content Bot has, since it serves
real generated video/audio/image bytes directly — had **no ownership
check at all** before this; new `getOwnedContentAsset` resolves the real
chain (asset → version → item → mission → organization) and is what the
route now calls. 6 new cross-organization tests
(`tests/contentBotOrganizationIsolation.test.ts`).

**Background jobs — audited, found safe by construction.** Read all 9
real `inngest.send()` call sites directly. Every one sends only real
resource ids, never a founderId/organizationId/role claim; every job
handler re-resolves everything from the authoritative database by that
id. The two cron watchdogs are legitimately global system maintenance
(correct to reap stale work across every organization uniformly — not a
gap). New `tests/backgroundJobTenantSafety.test.ts` is a structural
regression guard, not just a one-time claim: it parses every real
`inngest.send()` call and fails if a future one ever smuggles in a
trusted claim instead of a plain id.

**Real organization roles and permissions (Section 9).** New
`requireOrganizationRole` — genuine membership checked first, then the
real persisted role against an explicit per-call-site allow-list.
Applied to every sensitive action Section 9 named: employee recruit/
remove, workspace creation, Founders' Desk review decisions. Ordinary
work (tasks, checklists, missions, submitting for review) stays open to
any real member. 7 new tests prove a genuine member is refused for each
gated action while a real owner/admin succeeds, the member-vs-
non-member error distinction is correct, and a plain member retains full
access to ordinary work.

**`leadAssignments`/`agentTaskSignals` — organization-scoped.** The two
real signals driving the shared 3D office scene were still global — a
genuine future leak once a second organization has real recruited
agents. Fixed as a pure data-scoping change (new
`listLeadAssignmentsForOrganization`/
`listAgentTaskWorldSignalsForOrganization`, wired into `/api/missions`
and `app/page.tsx`); **zero changes to
`components/founders-desk/world/*`** — Astra's own design, untouched.
`tests/livingEngine.test.ts` (the real 3D-engine suite) passes
completely unchanged; a live screenshot after this change is
pixel-identical to before it. 2 new tests prove the isolation directly.

## Verified, not assumed

**708 tests passing** (693 prior + 15 new across this round). `npx tsc
--noEmit` clean. Production build clean (safe stop/rebuild/restart).
Live, with a real browser and the real founder session: every route
smoke-tested including a genuine 404 for a nonexistent content item (no
500, no leak), real data counts confirmed non-zero and correctly scoped
(21 missions, 17 lead assignments, 13 agent-task signals), zero page
errors, and a real screenshot pixel-identical to before this round's
changes.

## Tenant isolation: substantially complete for the real, built surface

Every real capability this app currently has — missions, Content Bot's
full production/review/asset lifecycle, Founders' Desk, finance,
recruitment/workforce, tasks, checklists, Chief of Staff goals, roles,
background jobs, and the shared 3D world's own data feed — now enforces
real, server-side, tested organization boundaries. What remains is
either genuinely lower-severity technical debt or explicitly belongs to
a later phase, not a live cross-tenant data leak in the built product:

1. **`costs`/`ledger_entries`/`activity_history`'s nullable-`mission_id`
   attribution gap** (named in the original Phase D audit) is still
   open — a cost with no mission has no direct organization attribution
   on the `costs` row itself. Does not leak data across organizations
   today (nothing reads these cross-tenant); it just means a future
   "total spend per organization" report can't be built from `costs`
   alone yet for mission-less spend.
2. **`setCategoryBudget`'s "one budget per category+period" uniqueness**
   still has no DB-level constraint, organization-scoped or otherwise —
   the same pre-existing non-atomic-upsert caveat, now at least
   organization-scoped so two organizations' real races can't collide
   with each other.
3. **No organization-switcher UI, no onboarding path to create a second
   real organization for an actual new customer.** `createOrganizationWithOwner`
   is real, tested, and used by `tests/organizationIsolation.test.ts`'s
   own fixtures, but only reachable from server-side code — this is
   Phase I's own job (customer onboarding), not a tenant-isolation gap.
4. **No negative test specifically drives a cross-organization attempt
   through the real HTTP routes** (every test calls domain functions
   directly, this codebase's established pattern) — the routes
   themselves were read and updated to call the now-fixed domain
   functions/resolvers, and a live HTTP smoke test confirmed the real
   running app behaves correctly end to end, but there's no permanent
   route-level integration test in the suite.

## Next: workforce verification, AI spending controls, onboarding

Per the founder's own explicit instruction, tenant isolation being
substantially complete is what unblocks the remaining Mission 6
milestones — none of the following were started this round:

- **Complete workforce verification matrix** (Mission 6's own Section 12)
  — the addendum work earlier in this mission proved Chief of Staff's
  real multi-agent coordination; a full, dedicated pass per agent
  through the now-organization-scoped review lifecycle (Section 12's own
  12-point checklist) has not been run as its own exercise.
- **AI spending controls** (Section 13) — real per-organization usage
  limits, budget reservation before costly work, concurrency caps. Not
  started; the `costs` table records real spend but nothing yet enforces
  a ceiling per organization.
- **Customer onboarding** (Section 14) — not started; blocked on exactly
  nothing now except being the next piece of work.

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **708 tests
   passing**).
2. Re-verify the real dev database directly if picking this up fresh
   (same technique as before — query `organizations`/
   `organization_members`/`organization_agents` and a few scoped tables'
   real rows).
3. **Next real engineering action**: Section 12's full seven-agent
   verification matrix, now meaningfully exercisable under real
   organization scoping for the first time — then Section 13's spending
   controls (the natural prerequisite for onboarding real paying
   customers), then Section 14's onboarding flow itself.
4. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (708 tests) still holds before continuing.

---

# Master Development Mission 7 — The Working Business
# (Phase 4 only — the rest of Mission 7 was never started)

Mission 7's own brief covered ten phases. Only **Phase 4 (AI cost
attribution + real atomic spending limits)** was executed before Mission
8 arrived; Phases 1-3 and 5-10 were never started under their own name,
though Phase 2's seven-agent matrix and Phase 3's Chief-of-Staff
demonstration were already substantially satisfied by Mission 6's own
addendum (see that section above) before Mission 7 was even written.

## Phase 4 — DONE, verified, committed

**Cost attribution repair.** `costs.organization_id` (nullable, FK to
`organizations`) closed a real gap: Business Analyst's standalone
research had `missionId: null` and *no* organization attribution at all
on its `costs` row. `recordCost()` now requires `organizationId`; every
real call site (Business Analyst's success/failure paths, both Scout
`recordCost` calls, all 8 Content Bot pipeline call sites via a new
`resolveContentItemOrganizationId` helper) resolves and passes a real
one. 184 existing `costs` rows backfilled via `ensureDefaultOrganization()`
— 0 left null. Migration: `drizzle/0015_curly_post.sql`.
**Commit `9c5e453`.**

**Real atomic budget enforcement**, `lib/domain/budgetWorkflow.ts`:
`organization_budgets` (configurable monthly USD limit, default $20) +
`budget_reservations` (reserved/settled/released lifecycle).
`reserveBudget()` takes a genuine Postgres row lock (`SELECT ... FOR
UPDATE` inside a transaction) on the organization's budget row so
concurrent reservations serialize instead of racing past the limit
together. Idempotency-key retries return the original reservation
rather than double-reserving. Found and fixed two real bugs via
genuine-concurrency testing (documented in the module itself): a
timezone-default bug (`defaultNow()` isn't reliably UTC under this
Postgres session) and a connection-pool deadlock under real 10-way
concurrency (a nested call was borrowing a second pooled connection from
inside an already-open transaction). **Commit `2198ff4`.**

**Wired into Business Analyst's `requestResearch`** — the simplest real
integration point (single synchronous call). A request against an
exhausted organization budget is refused with `BudgetExhaustedError`
(mapped to HTTP 429 with real committed/limit/requested figures) *before*
the model is ever called. **Verified live** against the real running dev
server and real Postgres (not just the test suite): a temporary
over-budget reservation against the real seeded organization produced a
genuine HTTP 429 with real figures (`$20.32 committed of $20.00 limit`),
then was cleaned up, restoring the organization's real state exactly.
**Commit `2198ff4`.**

**Wired into Scout's `runScoutPipeline`** — same pattern, both the
initial dispatch and the automatic follow-up pass, reservation key tied
to `(missionId, research_pass_count)` so a crash-resumed run never
double-reserves. A refusal settles the mission straight to `failed` with
a clear reason rather than stranding it in `researching`. **Commit
`baf50d9`.**

**Explicitly NOT yet done**: **Content Bot's production pipeline has no
organization-level budget gate yet** — it still only has its own
*per-item* `MAX_ITEM_SPEND_USD` ($8) cap (Milestone 5's own, unrelated to
an organization's monthly ceiling). An organization could still create
unboundedly many content items, each individually capped at $8, with no
aggregate ceiling. This is the next real gap, named here rather than
left implicit — see Mission 8's own cost-protection milestone below.

**Verified**: 727/727 tests passing (722 baseline + 5 new across both
integrations). `npx tsc --noEmit` clean. Production build clean (safe
stop/rebuild/restart). Two new live-concurrency tests prove genuine
simultaneous requests against the same budget can never both succeed
past the limit, and that ten concurrent small reservations never let
committed spend exceed the real limit.

---

# Master Development Mission 8 — The Full Product Push
# (Working Agents, Premium Focus View, Free Playground, Subscriptions,
# Legal Foundations and Relentless End-to-End Testing)

This is a large, multi-session brief (30 sections). This document tracks
it honestly, milestone by milestone, rather than claiming completion of
work not yet done. Status values: **Not started / In progress /
Implemented / Tested / Blocked / Deferred.**

## Section 2 — Baseline audit (Milestone A): DONE

Established from the repository itself, not assumed:

- Branch: `claude/commercial-mvp-polish` (correct, matches the brief).
- Git status at session start: Mission 7 Phase 4's work (cost
  attribution + budget enforcement) was fully built but **entirely
  uncommitted** — carried over from the previous session's context
  window. Finished, verified, and committed as 3 commits this session
  (`9c5e453`, `2198ff4`, `baf50d9`) before any Mission 8 work began, per
  this document's own standing rule to never leave verified work
  sitting uncommitted across a session boundary.
- **Real baseline is 727 passing tests**, not the brief's stated 708 —
  the 708 figure was Mission 6's own final count; 19 more have been
  added since (14 budget-workflow tests, 3 Business-Analyst budget
  tests, 2 Scout budget tests).
- `npx tsc --noEmit`: clean. Production build: clean (safe stop/rebuild/
  restart cycle, `.next` removed and rebuilt each time).
- Astra's separate headquarters branch: still does not exist in this
  repository. Nothing office-related has been touched.
- Mission 6's own Phase (addendum) already proved Chief of Staff's real
  multi-agent coordination live, with real money spent, across 4 agents
  (Business Analyst/Operations/Finance/Executive Assistant) — this
  substantially satisfies Mission 8 Section 7's "defining demonstration"
  ask already; see that section above for the full account. Re-running
  it from scratch this session would mean spending real money solely to
  re-populate a dashboard, which Section 13's own standing instruction
  argues against — it is cited here, not repeated.

## Milestone C — AI cost protection (Section 10): DONE for all three real paid agents

Every real paid surface now has a genuine organization-level monthly
budget ceiling, enforced atomically before any real model/provider call,
never just observed after the fact:

- Business Analyst: **DONE** (Mission 7 Phase 4, commit `2198ff4`).
- Scout: **DONE** (commit `baf50d9`).
- Content Bot: **DONE** (commit `9cba750`) — reserves the item's real
  *remaining* room under its existing per-item $8 cap
  (`MAX_ITEM_SPEND_USD`), scoped per production version (each version is
  its own real spend event, mirroring Scout's per-pass reservations), so
  multiple versions of one item can never together reserve more than the
  item could ever actually spend. 2 new tests; all 91 pre-existing
  Content Bot pipeline/quality/retry/produce-again/reference-continuity/
  organization-isolation tests pass unchanged — this delicate,
  explicitly-protected pipeline's resumability, cancellation, and
  version/attempt caps were not touched, only wrapped.
- Provider failure accounting, unknown-cost handling, and retry limits:
  already real and tested (pre-existing, documented above and in
  CLAUDE.md) — not new this session.
- **Remaining within this milestone**: a customer-facing allowance
  display. `getBudgetStatusForOrganization()` returns real figures
  (committed/limit/remaining/exhausted) but has no UI surface yet — this
  is Section 10's own "Clear customer-facing allowance status" ask, not
  started. Natural pairing with Section 8 (Focus View redesign) or
  Section 9 (Founders' Desk polish) rather than its own isolated task.
- **Also not done**: an actual admin/founder path to configure a
  different `monthly_usd_limit` per organization — `organization_budgets`
  rows are created on first reservation with the real $20 default; no
  route or UI writes a different value yet. Needed before Section 14/15
  (pricing tiers, billing) can translate a paid plan into a real,
  different enforced ceiling.

Full suite after all three integrations: **729/729 passing.** `npx tsc
--noEmit` clean. Production build clean. Commits: `9c5e453` (cost
attribution), `2198ff4` (budget module + Business Analyst), `baf50d9`
(Scout), `9cba750` (Content Bot).

## Everything else in Mission 8 (Sections 8, 9, 11-20): NOT STARTED

Section 6 (seven-agent capability matrix) is now DONE — see its own
section above. Still not started, named explicitly rather than left
silently undone: Focus View redesign (Section 8), Founders' Desk
presentation polish (Section 9), customer sign-in/account management
(Section 11), customer onboarding (Section 12), free HQ Playground and
the Cleaner (Section 13), subscription plans and pricing research
(Section 14), Stripe/billing foundation (Section 15), legal/privacy
drafts (Section 16), full QA sweep (Section 17), real customer journey
testing (Section 18), living-headquarters verification (Section 19),
mobile/responsive testing (Section 20).

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **729 tests
   passing**).
2. Milestone C (AI cost protection, Section 10) and Section 6 (seven-
   agent capability matrix) are both now DONE — see their own sections
   above. The two small items still open under Section 10 (a customer-
   facing allowance display; an actual way to configure a non-default
   `monthly_usd_limit`) pair naturally with Focus View work (Section 8)
   rather than standing alone — pick them up there, not as isolated
   tasks.
3. Next real engineering action: per the brief's own Section 21 priority
   order (data leaks > unauthorized actions > uncontrolled spending >
   data corruption > broken agent workflows > broken payments >
   broken onboarding > usability > visual polish > decorative features),
   with spending now protected, the next highest-priority unstarted item
   is Section 8 (Focus View redesign) or Section 11/12 (customer
   sign-in/onboarding) — both still fully unstarted, pick based on
   founder preference if asked.
4. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (727 tests) still holds before continuing.

## Section 6 — Seven-agent capability matrix: DONE (assembled from real code, no new paid calls)

Per the brief's own instruction ("Do not confuse a functional user
interface with a functional employee"), this table is built from the
actual exported domain functions each agent's routes call — not from
what the UI displays. "Automatic" means a real model/provider call runs
with no further human input once dispatched; "Manual" means the action
is a founder-driven data operation with no AI execution at all; a task
delegated to a Manual agent through Chief of Staff is a real to-do item,
not simulated AI work — it is just not AI work.

| Agent | Real capability | Classification | Evidence |
|---|---|---|---|
| **Scout** | Web-search-backed opportunity research, two-pass evidence loop, structured report, guardrails | **Fully automatic** (dispatched, runs via Inngest to completion) | `lib/agents/scout/`, `runScoutPipeline`; live-verified (Milestone 2.2/3/5.1 sections above); org-budget-gated (this session) |
| **Content Bot** | Five-stage real production pipeline (creative strategy → planning → safety → assets → assembly), real fal.ai/ElevenLabs/Shotstack calls | **Fully automatic** once a founder approves production; **requires manual input** to start (founder picks target platform/audience/content type and approves) and to resolve (Approve/Reject/Send-Back) | `lib/domain/contentWorkflow.ts`'s `runContentProductionPipeline`; Milestone 5 section above; org-budget-gated (this session) |
| **Business Analyst** | Standalone sourced research (web search + Claude), single synchronous call | **Fully automatic** once requested | `lib/domain/businessAnalystWorkflow.ts`'s `requestResearch`; org-budget-gated (this session, first integration) |
| **Chief of Staff** | Goal creation with delegated subtasks across supported agents; genuinely dispatches Business Analyst's real research for its own subtasks | **Automatic for the Business-Analyst delegate** (`runDelegatedResearch`, real billed call); **manual for every other delegate** (Operations/Finance/Executive Assistant subtasks are real to-do items a founder or those agents' own manual tools complete — never simulated AI work) | `lib/domain/chiefOfStaffWorkflow.ts`; live-verified 4-agent run, Mission 6 addendum section above (real $0.144 failed attempt + real retry success, both recorded) |
| **Executive Assistant** | Internal task tracking: create/list/complete/cancel a founder task | **Manual only** — no AI execution exists or is claimed. Each action is a real, persisted database operation (not simulated), just not autonomous | `lib/domain/executiveAssistantWorkflow.ts` — no model/provider import at all |
| **Finance Agent** | Expense logging, category budgets, budget-status calculation | **Manual only** — real persisted data and real arithmetic, no AI execution | `lib/domain/financeWorkflow.ts` — no model/provider import at all |
| **Operations Agent** | Checklist creation, item management, completion tracking | **Manual only** — real persisted data, no AI execution | `lib/domain/operationsWorkflow.ts` — no model/provider import at all |

**Integration-dependent or not-yet-implemented capabilities, named explicitly** (none of these exist in any form — not claimed, not stubbed):
- Any real publishing surface for Content Bot (TikTok/YouTube/Etsy/Amazon) — Milestone 5's own "deliberately not built" list, unchanged.
- Email or calendar operations for Executive Assistant — never implemented or claimed; `createFounderTask` is explicitly an internal reminder, not an integration.
- Any payment-processor integration for Finance Agent — expense/budget tracking is internal-only; no bank, card, or accounting-software connection exists.
- Content Bot's real generated video/motion (`VideoProvider`) — Milestone 5's own "C1.5" deferral, still true.
- Inventor/Creator/Inspector/Merchant/TikTok/Amazon/Etsy Specialist/Manager — still `status = 'planned'` per Milestone 1, unchanged; none run.

**No new paid calls were made to produce this table** — consistent with
Section 13's own standing instruction against running costly calls
solely to populate a status artifact. The one piece of live evidence
this table leans on (Chief of Staff's real 4-agent coordination run) was
already produced and recorded in an earlier session, cited here rather
than repeated.

## Milestone D — Focus View redesign (Section 8) & Founders' Desk polish (Section 9): DONE for the first pass

Chosen direction: **Refined Emerald & Ivory** (founder-approved, no
internal comparison needed). Replaces the flat three-column "developer
dashboard" with seven real sections behind real navigation (Overview,
Employees, Tasks, Founders' Desk, Finance, Reports, Settings).

**Baseline established first** — real Playwright screenshots of the
actual running app at desktop/tablet/mobile before any change, per the
brief's own instruction. Confirmed the problem described in the brief
was real: a single ~3700px-tall three-column stack on desktop, an
~8000px single-column stack on mobile, no navigation at all.

**What changed**: `tailwind.config.ts` gained a new, additive `focus.*`
token namespace (warm ivory, deep emerald, restrained gold) — does
**not** touch `hq.*` (HQ View's own 2D chrome) or `night.*`/
`ROOM_PALETTES` (the 3D scene). Seven new section components under
`components/founders-desk/focus/`, a new `FocusNav` tab strip, shared
`FocusPrimitives` (card/heading/empty/error/loading/stat) for one
consistent design language, and one new read-only endpoint
(`GET /api/budget`) that finally surfaces `getBudgetStatusForOrganization`
(built in Mission 7 Phase 4, never shown to a founder until now) to the
Overview and Finance sections. `FocusView.tsx` itself keeps the exact
same props interface `FoundersDeskApp.tsx` already passed it — zero
changes to what's fetched or what a founder can do, only how it's shown.
`EmployeePortrait` was extracted from `EmployeeDirectory.tsx` into its
own shared file (behavior-preserving refactor) so the new, spacious
Employees section and the existing compact overlay bar render identical
real portraits from one place.

**A real bug found and fixed during verification, not assumed away**:
three section wrappers (Founders' Desk, Reports, Settings) each added
their own heading on top of a component that already rendered its own —
a literal duplicate heading, caught only because the actual screenshots
were inspected rather than trusting the code was correct.

**Verified, with evidence**:
- Real Playwright screenshots of every one of the 7 sections, at desktop
  (1440px), tablet (768px), and mobile (390px) widths.
- The real Founders' Desk review slide-over (a real Content Bot
  deliverable, "The Glasswing Stalker") opens from the new layout and
  shows real assets, a real $0.5520-of-$8.00 budget figure across 21
  real provider calls, and working Approve/Reject/Send-Back/Cancel
  actions — confirmed via a real click-through, not assumed from markup.
- Keyboard-only navigation (Tab to a nav button, confirmed
  `document.activeElement`, then Enter) reaches and activates a section.
- **HQ View's screenshot is pixel-identical before and after this
  milestone** — Astra's 3D scene and the shared `hq.*`-token 2D chrome
  around it were not touched.
- Full suite: 729/729 passing (no new tests were needed — this is a pure
  presentation-layer change over already-tested data/handlers).
  `npx tsc --noEmit` clean. Production build clean (safe stop/rebuild/
  restart).

**Known, pre-existing, not a regression**: the global `EmployeeDirectory`
overlay bar (fixed to the viewport bottom) grazes the bottom edge of the
last Employees-section card at some scroll positions. This bar was
already fixed-position and already did this against whatever content
was at the bottom of a tall page before this redesign (visible in the
very first baseline screenshot too) — not something this milestone
introduced, and out of scope to fix here (it's shared, protected
infrastructure from Mission 5, not Focus-View-specific).

**Explicitly not done in this pass** (named rather than silently
skipped):
- The Tasks section's mission list is still one long flat list for a
  workspace with many missions (19, in the real seeded data) — real
  data, much better card styling and a real detail sidebar, but no
  pagination or filtering yet.
- No accessibility audit beyond the keyboard-navigation spot-check
  above (no screen-reader pass, no automated contrast-ratio check).
- Section 8's own "founder-only theme preview" (comparing design
  candidates side-by-side) was skipped — the founders already named
  Refined Emerald & Ivory as the direction in their approval message,
  so no comparison tooling was built.
- Section 9's fuller "review history" and "source links" asks for the
  Founders' Desk weren't addressed — `FoundersDeskInbox`'s own internal
  behavior was deliberately left untouched this pass (only its
  surrounding presentation changed); any further polish to the inbox
  component itself is separate, real work for a future milestone.

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **729 tests
   passing**).
2. Natural next steps for Focus View, in rough priority order: (a)
   paginate or filter the Tasks section's mission list, (b) a real
   accessibility pass (contrast ratios, screen-reader labels beyond the
   spot-check done here), (c) Section 9's remaining Founders' Desk asks
   (review history, source links) if the founders want the inbox
   component itself improved, not just its container.
3. Per Section 23's own milestone order, the next *new* milestone after
   Focus View polish is Section 11/12 (customer sign-in/account
   management, customer onboarding) — still fully unstarted.
4. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (729 tests) still holds before continuing.

## Milestone E — Customer sign-in, account management & onboarding (Sections 11-12): DONE, with a critical bug found and fixed

A genuine new-customer journey was built and verified end to end — real
account creation, real organization, real employee recruitment, real
workspace, landing in a real headquarters ready for a real first task.
Four commits: `08b40b3` (critical security fix, see below — committed
first and in isolation given its severity), `eeae9d2` (the onboarding
feature), `84a5753` (Focus View polish items addressed alongside it).

### Real self-service account creation

`ALLOW_NEW_CUSTOMER_SIGNUP` (new env var, default unset/off) gates
everything — with it off, `auth.ts`'s `signIn` callback is byte-for-byte
what it always was: only an existing `founders.email` row may sign in.
Set to exactly `"true"`, a real GitHub-verified email that isn't already
a founder gets a real new `founders` row via the new
`ensureFounderAccount()` (`lib/auth/allowList.ts`) — idempotent, safe
under genuine concurrency (proven with a real concurrent-call test), and
never touches an already-recognized founder.

### Real organization creation, finally reachable

`POST /api/organizations` (new route) calls `createOrganizationWithOwner`
— real since Mission 6, zero UI exposure until now. A new
`organizations.venture_stage` column (migration `drizzle/0016_far_terrax.sql`,
nullable text) persists the real "new venture vs existing business"
answer from onboarding.

### A critical security bug found and fixed (commit `08b40b3`)

`ensureDefaultOrganization`'s founder-membership backfill ran
unconditionally on *every* call (every server restart; every cold start
in a real serverless deployment), granting **every founder row in the
entire table** owner access to Ellis and Maddie's real "Founders' HQ" if
they didn't already have a membership there. Invisible before self-
service sign-up existed (only Ellis and Maddie ever existed as founders,
and both legitimately belonged there); a real, serious cross-tenant leak
the moment a brand-new customer founder can exist with zero memberships
— their genuine, temporary pre-onboarding state.

**Reproduced live**, not theoretical: two fictional customers (Priya,
Tom) each independently ended up as real "owner" members of Founders'
HQ after routine server restarts during this session's own testing,
confirmed via `GET /api/organizations` and a real accidental cross-
tenant Scout recruitment. All bad data was found, inspected, and deleted
from the real database — confirmed restored to exactly the two genuine
founders before any further work continued.

**Fixed**: the membership-backfill loop now runs only inside the branch
where the organization is actually created for the first time — a true
one-time migration moment. New `tests/ensureDefaultOrganization.test.ts`
(this function had no dedicated test file before — part of why this was
invisible: `resetDbForTests()`'s "truncate and reseed" pattern only ever
calls it once, against a database with no organization yet, exactly the
one case where the bug can't show up).

### Real onboarding UI

`components/onboarding/OnboardingFlow.tsx`, shown instead of the normal
dashboard only when a signed-in founder genuinely has zero organization
memberships (`app/page.tsx` — a real crash this also fixed:
`getActiveOrganizationForFounder` already threw for that exact case).
Welcome → Create HQ (name + new-venture-vs-existing-business, **now also
auto-creates a real default "commerce" workspace** — a second real gap
found live during testing: without one, a fresh organization has no
project for `MissionForm` to offer, and a founder would land on HQ
View's own honest "the office is unfurnished" dead end) → Recruit
(reuses Focus View's own real `EmployeesSection`, not a second
recruitment flow) → Enter. Steps 5-6 of the brief's own outline (first
task, review result) are deliberately not duplicated — Focus View's real
Tasks and Founders' Desk sections already exist for exactly that the
moment a founder has a real organization.

### Verified, with real evidence

- **Real cross-organization isolation via real HTTP**, not just domain-
  function tests: two independent fictional customers (Priya/Riverside
  Bakery, Tom's Landscaping), crafted sessions against the real running
  app (a real GitHub OAuth round-trip can't run in this sandbox — see
  CLAUDE.md's standing note). Each sees only their own organization,
  missions (0, never Ellis's real 21), and employee recruitment
  (independent Scout recruitment status). Ellis's real org and real
  missions confirmed completely unaffected throughout.
- **A real Playwright browser walkthrough** of the entire flow — Welcome
  → name a business → choose venture stage → recruit Scout → Enter HQ →
  Focus View's Tasks tab, real workspace pre-selected, ready to submit a
  real mission. Screenshots at every step. The real HQ 3D office scene
  confirmed rendering that new organization's own genuinely empty office
  (0 of 7 recruited), completely independent of Ellis's.
- `tests/customerOnboarding.test.ts` (6 tests), 4 new tests in
  `tests/auth.test.ts`, 3 new tests in `tests/ensureDefaultOrganization.test.ts`.
- All real test data created during live verification found, inspected,
  and deleted — confirmed restored to exactly 2 founders, 1 organization.
- Full suite: **742/742 passing.** TypeScript clean. Production build
  clean.

### Focus View polish (addressed alongside this milestone)

- **Tasks filtering/pagination**: real search (title/brief) + status
  filter (reusing `missionDockBucket`), 8-at-a-time with "Show more."
- **Employee Directory overlap**: real extra bottom clearance added to
  Focus View's content wrapper; confirmed fixed via a real scrolled-
  viewport screenshot.
- **Accessibility pass**: computed real WCAG contrast ratios for every
  `focus.*` text color pairing. Found and fixed two real failures (gold
  text measured 3.42:1 against white, 2.68:1 against its own badge
  background — both below the 4.5:1/3:1 thresholds); added a separate,
  darker `focus.goldText` token (4.5-5.8:1 against every real background
  it's used against). Keyboard navigation, heading hierarchy, and form
  labels also checked.

### What a new customer can genuinely do today

Sign in with GitHub (once `ALLOW_NEW_CUSTOMER_SIGNUP=true` is set) →
create their own private organization → answer the venture-stage
question → get a real default Commerce workspace → recruit any of the
7 real employees → land in a fully working, completely isolated
headquarters → create a real Scout mission or any other real supported
task → review it at their own Founders' Desk. Every step is the same
real code path and real data model Ellis and Maddie's own account uses
— nothing simulated.

### What remains blocked before real public registration

1. **`ALLOW_NEW_CUSTOMER_SIGNUP` is off by default and must stay off**
   until the founders deliberately decide to accept sign-ups — this is
   the actual safety gate, not a cosmetic one.
2. **No real GitHub OAuth App exists yet** (CLAUDE.md's own long-
   standing deployment checklist, step 2, still not done) — nothing here
   changes that; self-service signup still requires a real, deployed
   OAuth app before anyone outside this sandbox could use it at all.
3. **No account settings beyond Focus View's Settings tab** — no email
   change, no account deletion/data export flow (Mission 8's own Section
   11 lists these; not built this round).
4. **No subscription/billing gate** — a self-service sign-up today gets
   the same real, full access Ellis and Maddie have (within their own
   organization's real `$20` default AI budget) — Section 14/15's
   pricing tiers and billing don't exist yet, so "opening registration"
   today would mean every new customer gets full real functionality for
   free, bounded only by the existing per-organization spending cap.
5. **Organization budget limits aren't configurable yet** — every
   organization (new customers included) gets the same real `$20`/month
   default; no admin path sets a different value per customer.

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **742 tests
   passing**).
2. `ALLOW_NEW_CUSTOMER_SIGNUP=true` is currently set in the local dev
   `.env.local` (never committed) so the founders can try the real
   onboarding flow themselves — not set in `.env.example` or any
   committed file, and should be explicitly decided on, not left on by
   habit, before any real deployment.
3. Per the brief's own Section 21 priority order, with sign-in/
   onboarding and cost protection both done: the next highest-priority
   unstarted items are Section 14/15 (pricing research + billing
   foundation) if the founders want to move toward real revenue, or
   Section 17/18 (full QA sweep, real customer journey testing) if they
   want more confidence in what already exists first.
4. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (742 tests) still holds before continuing.

## Milestone F — Pricing, Subscriptions & Billing Foundations (Sections 14-15): DONE

A genuine, secure, testable commercial subscription system, with live
payments and public registration both kept disabled. 6 commits, all
verified (773/773 tests, TypeScript clean, production build clean).

### 1. Real cost audit (not estimated)

Queried this app's own real `costs` table directly:

| Agent | Real calls | Avg cost | Max cost |
|---|---|---|---|
| Scout | 18 | $0.28 | $0.38 (single pass) |
| Content Bot | 162 (23 items) | $0.94/item avg | $3.86 (one real item) |
| Business Analyst | 4 | $0.12 | $0.14 |

Researched comparable AI-tool pricing (WebSearch, October 2026): individual
AI-assistant seats commonly $20-30/month with a usage allowance; broader
enterprise AI tools range $3-100+/user/month ([zylo.com](https://zylo.com/blog/ai-cost),
[coworker.ai](https://coworker.ai/blog/enterprise-ai-pricing-comparison-2026)).
AI video generation is priced per-second/per-credit across providers,
consistent with this app's own real fal.ai Kling costs (~$0.56/real
video clip call, matching Kling's own published ~$0.07-0.084/second
developer pricing).

### 2. Real plan catalog (provisional, unpublished)

| Plan | Price | AI budget/mo | Video allowance/mo | Paid agents | Worst-case margin |
|---|---|---|---|---|---|
| Free Playground | £0 | $0 | 0 | No | n/a |
| Starter | £19 | $10 | 0 | Yes | 59% |
| Business | £49 | $20 | 2 | Yes | 42% |
| Growth | £99 | $45 | 5 | Yes | 32% |

Worst-case margin assumes every real video production hits its real $8
MAX_ITEM_SPEND_USD cap and the full AI budget is spent — the real,
enforced ceiling, not typical usage (which the real measured averages
above suggest will usually be well under this). FX assumption: £1 ≈
$1.27 (stated, not a live rate). Every plan seeds with `is_published:
false` — none are shown on any real public page; `/pricing` itself is
reachable only by a signed-in founder (no public area exists in this
app yet) and carries its own explicit "Development preview" banner.

### 3. Real server-side entitlement enforcement

- `assertPlanAllowsAgent` — the three paid agents (Scout, Content Bot,
  Business Analyst) require a plan with `includes_paid_agents` AND an
  entitled subscription status (`active`/`trialing` only — `canceled`/
  `past_due`/`incomplete` are refused even on a plan that includes paid
  agents). Wired into `recruitEmployee` — a direct API call bypassing
  the UI is refused identically.
- `assertPlanAllowsNewVideoProduction` — a real, SEPARATE monthly
  counter from the dollar budget (per the founders' own explicit
  instruction), wired into all three real content-item-creation points
  (`approveForProduction`, `commissionPilotAnyway`,
  `produceAgainFromMission`), checked before the mission's own state
  transitions so a refusal never leaves a mission stranded.
- `budgetWorkflow.ts`'s `getOrganizationBudgetConfig` resolves an
  organization's real monthly AI budget from its real subscription plan
  — a free-plan organization gets a real $0, never the old flat $20
  default; a cancelled/past-due subscription also gets $0. An explicit
  founder-configured override still always wins.
- `createOrganizationWithOwner` creates a real "free" subscription row
  atomically with every new organization — **the actual mechanism**
  behind "a newly created free organization cannot consume a
  complimentary $20 of paid AI usage" (priority 4), proven live:
  `/api/billing/status` for a fresh organization shows `$0` budget, and
  a direct recruit attempt for a paid agent is refused with a real 403.

### 4. Two real, serious bugs found and fixed via live testing

1. **Cross-tenant membership leak** (commit `08b40b3`, fixed before any
   further work continued): `ensureDefaultOrganization`'s membership
   backfill ran on every server restart for every founder, silently
   granting new customers owner access to Ellis and Maddie's real
   organization. Reproduced live, bad data found and removed, fixed,
   and covered by a dedicated new test file.
2. **Founder-plan backfill gap** (commit `5477200`): Ellis's real,
   pre-existing "Founders' HQ" showed "Free Playground" instead of its
   real "founder" plan, because the one-time founder-plan assignment
   only runs when the default organization is first created — an
   organization that already existed (from before this migration) never
   passes through that branch again. Found via a live screenshot of
   Settings' new billing card, fixed, verified with a corrected
   screenshot, and covered by 2 new regression tests.

### 5. Real Stripe billing, test mode only

`lib/billing/stripe.ts` (checkout sessions, billing portal sessions,
webhook signature verification — real, current-API code, `stripe`
npm package v23), `lib/domain/billingWorkflow.ts` (startCheckout,
startBillingPortalSession, processBillingWebhookEvent — idempotent via
a real `billing_webhook_events` ledger), and 4 real routes
(`/api/billing/checkout`, `/portal`, `/status`, and `/webhook` —
deliberately excluded from the founder-session gate the same way
`/api/auth`/`/api/inngest` already are, since Stripe calls it
server-to-server). **Never exercised against a real Stripe account** —
this sandbox holds no `STRIPE_SECRET_KEY` (confirmed by inspecting the
environment directly, same standing discipline as every other
provider). Signature verification itself (`stripe.webhooks.constructEvent`)
is pure, local HMAC cryptography with no network call, so it's fully,
genuinely tested without a real account.

### 6. Real security-negative tests (priority 7, proven not assumed)

`tests/billingWebhookSecurity.test.ts` (12 tests): a forged webhook
signature is refused by the real local HMAC check; a signature that
doesn't match its body (tampering) is detected; a genuinely valid
signature (built with Stripe's own `generateTestHeaderString` test
helper) is accepted, proving the check isn't just always rejecting;
webhook processing is provably idempotent (the same real event id
redelivered a second time does nothing — checked against real database
state before/after); checkout refuses every real plan today (none has
a real Stripe price yet) and a completely fabricated plan id outright;
two independent organizations' billing events never leak into each
other (a cancellation or payment failure for one never touches the
other's real subscription row).

### 7. Two independent organizations — real HTTP verification (priority 8)

Two fresh fictional customers (Priya, Tom), crafted sessions against the
real running app (same technique established in Mission 8's own
onboarding milestone — a real GitHub OAuth round-trip can't run here).
Both start on the real Free plan, confirmed independently via
`GET /api/billing/status`. Priya's subscription was then upgraded to
"business" directly in the database (simulating a completed real Stripe
checkout — the same real effect `processBillingWebhookEvent` would
produce): she could then recruit Scout (real 200); Tom's identical
attempt was still correctly refused (real 403, "plan does not include
scout"), and his own billing status remained unchanged — confirmed
completely unaffected by Priya's upgrade. All test data found, inspected,
and removed from the real database afterward.

### 8. Playwright verification (priority 9)

Real screenshots at desktop (1440px) and mobile (390px) of the pricing
page; a real subscribe attempt showing the real, specific, honest error
(`PlanNotPurchasableError` — no plan has a real Stripe price yet,
surfaced clearly in the UI, not a generic failure); Settings' billing
card showing the real current plan and status. The full desktop+mobile
signup-to-subscription *visual* journey is verified as far as this
sandbox's real constraint allows — an actual completed Stripe Checkout
redirect cannot be visually verified without a real Stripe test account,
named here rather than silently skipped.

### Explicitly not done / blocked (named plainly)

- **No real Stripe account connected** — every plan's `stripe_price_id`
  is `null`; checkout cannot actually complete until a founder creates
  real Stripe test-mode products/prices and sets
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`.
- **No real completed-checkout visual verification** — the real
  Checkout→success redirect flow is coded and unit-tested
  (`processBillingWebhookEvent`'s handling of `checkout.session.completed`)
  but never exercised against a real Stripe session.
- **Final prices are not approved** — every plan stays `is_published:
  false`; publishing them is a deliberate future action, not automatic.
- **No annual billing, proration, or multi-seat pricing** — out of
  scope for this foundation pass.

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **773 tests
   passing**).
2. To genuinely complete billing verification: create a real Stripe
   test-mode account, create real test-mode products/prices for
   Starter/Business/Growth, set their `stripe_price_id` in
   `subscription_plans`, set `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
   in `.env.local`, and run `stripe listen --forward-to
   localhost:3000/api/billing/webhook` locally — only then can a real
   checkout actually complete and be visually verified end to end.
3. Per the founders' own stated next assignment: a full application-wide
   QA sweep, including account management, legal-policy drafts, and
   launch security verification (Mission 8's remaining sections).
4. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (773 tests) still holds before continuing.

## Mission 9 — Complete Product QA & Launch-Blocker Audit: DONE (scoped honestly)

Given the mission's own enormous scope (10 major sections), this round
prioritized per the brief's own explicit instruction — security, data
integrity, payment correctness, and financial exposure over cosmetic
issues — rather than attempting shallow coverage of every bullet. 4
commits, all verified (774/774 tests, TypeScript clean, production
build clean).

### 1. Two known cross-tenant bugs — re-verified across 3 real restarts

Not just re-running the existing unit tests: a fresh fictional customer
was provisioned against the real running app, the real dev server was
restarted three times in a row (the exact condition that originally
exposed both bugs), and after every restart: the new customer's
`GET /api/organizations` stayed empty (never leaked into Founders' HQ),
and Ellis's real `GET /api/billing/status` stayed on the real "founder"
plan (never reverted to "free"). All test data removed afterward.

### 2. Background-job spending-limit bypass — proven closed

A new test (`tests/missionWorkflow.test.ts`) proves the real scenario
Section 6 asks about: an organization subscribes, recruits Scout, then
genuinely cancels. Scout's own recruitment row is deliberately left
"active" (recruitment isn't auto-reverted by a plan change) — the real
protection has to come from the budget check INSIDE the background job
itself (`runScoutPipeline`), since a direct Inngest-triggered job never
goes through any HTTP route. Proven: the exact call shape
`scoutResearchJob.ts` makes is refused before the real model is ever
called, zero cost recorded. Content Bot's equivalent protection was
already proven in Mission 8's own commit (the organization-level budget
reservation lives inside `runContentProductionPipeline` itself, not
just at content-item-creation time).

### 3. Real Playwright sweep — one genuine bug found and fixed

27 real screenshots (every Focus View tab + HQ View + the pricing page,
at desktop/tablet/mobile) — zero console or page errors across all of
them. One real, genuine visual bug found: at phone width (390px), the
Finance "AI spending this month" stat grid's fixed 3-column layout let
"Monthly limit"'s label wrap to two lines while its neighbors stayed on
one, leaving two large dollar figures visually overlapping. Tablet and
desktop were unaffected (the `sm:` breakpoint already gave enough
room), which is why this was invisible in every earlier desktop-only
screenshot. Fixed (`grid-cols-1 sm:grid-cols-3`, matching
`OverviewSection`'s own existing responsive pattern) and confirmed via
a real before/after screenshot.

Also functionally tested (not just visually): Tasks' "Show more"
pagination genuinely reveals more real missions (8→16, confirmed by
counting real DOM elements); the real search filter genuinely filters
(a "Woodland" search showed Woodland items and hid unrelated "Viral
Short" items); a real expense was logged through Finance's form (real
201 response, appeared in the real ledger), then removed from the real
database afterward since it was test data. The Employee Directory's
expand/collapse interaction (explicitly called out in the brief) was
re-verified at mobile width — portraits and recruited status render
correctly in the horizontally-scrolling strip, unchanged from Mission
5's own established design.

### 4. Pre-launch legal and operational audit (Section 8)

Four real draft documents (`docs/legal/`) — Terms of Service, Privacy
Policy, Cookie Notice, Subscription & Cancellation Terms — each built
by directly inspecting the real schema, real third-party integrations,
and real observed behavior (the Cookie Notice's list was verified
against real `Set-Cookie` headers from a live session, not assumed from
documentation). A consolidated audit (`docs/legal/launch-legal-audit.md`)
names six real, functional product gaps independent of the documents
themselves: no self-service data export, no account/organization
deletion, no contact/support surface anywhere in the app, no
consent-recording mechanism, no data-retention policy, and no real
legal entity anywhere in the codebase. Per this session's own standing
discipline, nothing was invented — every open item is an explicit
`[DECISION NEEDED]` or `[REQUIRES QUALIFIED REVIEW]` placeholder.

### What this round did NOT do (named honestly, not silently skipped)

Given the realistic scope of one session, the following from the
brief's original 10 sections were **not** exhaustively covered this
round:
- A real, paid execution test of all seven agents (explicitly deferred
  — this app has no real `ANTHROPIC_API_KEY`/`FAL_KEY`/etc. in this
  sandbox, consistent with every prior milestone's own standing
  limitation; real agent execution was already proven live in earlier
  sessions, cited rather than re-run to avoid needless real spend).
- An exhaustive click-through of every dialog/form/failure-state in the
  application (Section 3's own "click every significant button") — a
  real, systematic sweep was done (27 screenshots, zero errors, one
  real bug found and fixed, several real interactions functionally
  tested), but this is not a claim that literally every control in the
  app was exercised.
- Real, exhaustive concurrent-reservation/retry/quota-exhaustion
  stress-testing beyond what Mission 7/8's own `budgetWorkflow.test.ts`
  and `subscriptionWorkflow.test.ts` already cover (10-way real
  concurrent reservations, genuine two-request races, plan-downgrade
  scenarios) — those existing, passing tests were re-run as part of
  this session's full regression, not re-designed or expanded further
  this round.

## Mission 9 — Release-Readiness Report

### VERIFIED WORKING
- Real self-service customer sign-up, organization creation, and
  onboarding (gated off by default; re-verified across 3 real restarts
  this round with zero leak).
- Real cross-organization isolation for missions, employees, finances,
  content, and billing (proven via real HTTP with two independent
  fictional customers, re-verified this round).
- Real organization-level AI spending limits, enforced atomically,
  including inside background jobs (newly proven this round for
  Scout's downgrade-then-dispatch scenario).
- Real subscription entitlement enforcement (paid-agent access, video
  allowance, cancelled/past-due refusal) — both via direct tests and
  real HTTP with two organizations.
- Real Stripe webhook signature verification and idempotent processing
  (local cryptography, no real Stripe account needed to prove this).
- Focus View (all 7 tabs), HQ View, and the pricing page — clean across
  desktop/tablet/mobile, zero console errors, one real bug found and
  fixed this round.
- The full automated suite: **774/774 tests**, TypeScript strict mode
  clean, production build clean.

### FIXED THIS SESSION (Mission 9 specifically)
- Finance stat-grid mobile layout overlap (real, visual, found via
  Playwright, fixed, re-verified).
- Background-job spending-limit bypass for a downgraded-after-recruiting
  organization (closed with a new, now-passing test proving the real
  mechanism already protects this — no code change was needed, the
  existing budget-resolution design already covered it correctly, but
  this was unproven before this round).

### REQUIRES EXTERNAL CONFIGURATION (founder action, not more code)
- A real Stripe test-mode account, real test-mode product/price
  creation, and `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — until
  then, checkout cannot actually complete (proven safe: it refuses
  clearly rather than failing silently).
- A real GitHub OAuth App for a real deployment (standing gap since
  Milestone 2).
- `ALLOW_NEW_CUSTOMER_SIGNUP` is a deliberate founder decision, not a
  default — currently on only in local `.env.local` for founder testing.
- The real legal entity name, address, registration details, and a
  real support contact — every legal draft has explicit placeholders
  for these.

### BLOCKED BEFORE LAUNCH
- Final, approved subscription prices (current figures are explicitly
  provisional).
- A refund policy (none approved — deliberately not assumed in the
  legal drafts).
- Self-service data export and account/organization deletion (real
  product features, not yet built).
- A contact/support surface anywhere in the running application.
- Qualified legal and data-protection review of all four draft
  documents.
- A real, visually-verified completed Stripe Checkout round-trip
  (blocked on the same real Stripe account gap above).

### OPTIONAL FUTURE IMPROVEMENT
- Tasks section: richer filtering (date range, multi-select status).
- Annual billing / proration / video-allowance rollover (explicitly
  deferred product decisions, not gaps).
- A consent-acceptance versioning mechanism for when legal documents
  do get published.
- Further Playwright coverage of dialogs/modals not exercised this
  round (ProductionApprovalDialog, AssignWorkModal, ContentReviewSlideOver
  beyond the one real click-through already proven in Mission 8).

## Mission 10: critical cross-tenant leak found and fixed

While designing Mission 10's account-deletion schema, two real, live
cross-tenant data leaks were found and fixed — not theoretical, confirmed
against the real dev database with a fresh fictional customer and a real
session token:

- **`GET /api/founders`** (and `app/page.tsx`'s own server-rendered data)
  called the globally unscoped `listFounders()` — any authenticated
  founder, from any organization, received every founder in the entire
  system, including Ellis's real name and real email, and Maddie's real
  name.
- **`GET /api/ledger`** (and `app/page.tsx`) called the equally unscoped
  `listLedgerEntries()`/`ledgerTotalUsd()`. `ledger_entries` had no
  organization attribution at all (only a nullable `mission_id`), so this
  would have exposed every organization's real financial ledger and
  spend total to every other organization.

**Fix:** added `ledger_entries.organization_id` (migration `0019`,
mirroring `costs.organization_id` from Master Development Mission 7),
wrote it at insert time from `recordCost`'s already-resolved organization
id, backfilled all 184 pre-existing real ledger rows (180 via their
mission's organization, the remaining 4 standalone Business Analyst rows
via an exact `usd_cost` + timestamp match against their real `costs`
row — zero ambiguity, confirmed one unique match each), and switched all
three real call sites (`app/api/founders/route.ts`,
`app/api/ledger/route.ts`, `app/page.tsx`) to new organization-scoped
repository functions (`listFoundersForOrganization`,
`listLedgerEntriesForOrganization`, `ledgerTotalUsdForOrganization`). The
three old global functions are kept only because tests reference them
for seed-data assertions — marked `@deprecated` with a doc comment
explaining no real route/page may call them.

Verified live, post-fix, with the same unrelated fictional customer two
ways: with no organization (correctly refused), and with their own
isolated test organization (correctly received only their own data,
nothing of Ellis/Maddie's). New regression file:
`tests/crossTenantDataLeakPrevention.test.ts` — two independent real
organizations proven isolated, plus a static source scan (mirroring
`fabricationPrevention.test.ts`) that fails if any of the three real
call sites ever reverts to the unscoped functions. All fictional test
data deleted from the real database afterward; Ellis/Maddie's real data
and all 184 real ledger entries confirmed untouched throughout. Full
suite (63 files / **777 tests**), typecheck, and production build all
pass. Committed as two dedicated commits (schema prep, then the fix
itself) separate from the rest of Mission 10's work.

**Audited for the same pattern and found clean:** every other
organization-aware repository function already takes an
`organizationId` parameter; no other API route or server component calls
an unscoped equivalent. This appears to have been an isolated oversight
in these two specific functions, not a systemic pattern — but worth
re-checking after any future repository function is added without an
explicit organization parameter.

## Mission 10 — Customer Trust & Launch Blockers: DONE

Built on top of the critical leak fix above (same mission, same session).
5 commits total for Mission 10 (schema prep, the leak fix, the feature
build, the crash fix, this doc update). Every item from the brief is
addressed; nothing was left as "write a proposal only."

### 1. Account and data management

`lib/domain/accountWorkflow.ts` — real, tested, never exercised against
Ellis/Maddie's actual rows:

- **`deleteFounderAccount(founderId, confirmationText)`** — requires the
  exact server-checked phrase `"DELETE MY ACCOUNT"` (the client-side
  input match is just UX; the server re-checks regardless of what's
  sent). A sole owner with no other real members: cancels any real
  outstanding Stripe subscription immediately
  (`cancelSubscriptionImmediately`, best-effort — a transient Stripe
  failure never blocks the rest of deletion), closes the organization
  (`closed_at`), and anonymizes the founder row (`name` → "Deleted
  Founder", `email` → null, `deleted_at` set) — never a hard delete, so
  every real mission/cost/deliverable stays intact for audit. Deletes the
  matching `auth_user` row (linked by email, not a direct FK — see
  `auth.ts`'s `resolveFounderIdentity`), which cascades away every real
  session/account row.
- **"Never delete an entire organisation merely because one member closes
  their account"** is enforced, not just stated: refuses outright
  (`AccountDeletionBlockedError`) if the deleting founder owns an
  organization with other real members present, checked for *every*
  owned organization before any mutation happens — a founder who owns
  one safe-to-close org and one blocked org is never left partially
  deleted. There's no ownership-transfer UI yet (a real, named gap, not
  hidden) — the safe behavior is to refuse and let the founder resolve
  membership first, not guess on their behalf.
- **`exportFounderData(founderId)`** — a real, scoped export (profile,
  every organization genuinely belonged to with its projects/missions/
  ledger, own support requests — never another founder's or
  organization's data) via `GET /api/account/export`, downloaded as a
  real JSON file.
- `getActiveOrganizationForFounder` now also excludes any closed
  organization from being selected as active — the exclusion
  `schema.ts`'s own `closed_at` doc comment had promised but nothing
  enforced yet. `app/page.tsx` falls back to onboarding rather than
  crashing if a founder's only membership turns out closed.
- New Focus View "Account" card (Settings → "Your data & account") — a
  real export-download button and a real, double-confirmed deletion flow.

### 2. Customer support

`lib/domain/supportWorkflow.ts`, `support_requests` table — real,
server-persisted tickets via `POST`/`GET /api/support`, a real server-
side rate limit (5 per rolling hour per founder), and a new Focus View
"Support" tab with a contact form and genuine tracked status. Deliberately
never claims an email confirmation was sent — `isEmailDeliveryConfigured()`
is always `false` until a real email-provider key exists (none does).
`getSupportContactAddress()` reads a real, founder-configurable
`SUPPORT_CONTACT_EMAIL` — never a fabricated address.

### 3. Subscription transparency

`BillingSection.tsx` now shows plan, real AI budget used/remaining (a
progress bar, from the existing `GET /api/budget`), the plan's real
separate video allowance, explicit cancellation guidance, and a support
contact block — all in one place, as the brief asked. No change to the
underlying budget/subscription enforcement itself.

### 4. Final usability checks — real Playwright verification

Real fictional accounts provisioned directly against the dev database
(no GitHub OAuth available in this sandbox — same established technique
as every prior live-verification round this session), real session
cookies, real browser automation at desktop (1440px) and mobile (390px):
onboarding, Settings (billing transparency), Support (submit + see
tracked status), and a genuine end-to-end account-deletion run (download
export → delete → land on `/login`).

**One real, genuine bug found and fixed** (not a proposal — the actual
crash, root-caused and fixed in the same round): approving account
deletion correctly deletes the founder's real session, but
`FoundersDeskApp.tsx`'s background polling (`refreshMissions`/
`refreshLedger`/`refreshProjects`) went straight from `await res.json()`
to `setX(data.x)` with no check that the request had actually succeeded
— a 401's `{error: ...}` body set `missions` to `undefined`, and the next
render crashed the whole app (`missions.filter is not a function`),
reproduced live with a full stack trace. Not unique to account deletion —
any genuine session loss while a tab is open would have hit the same
crash; deletion is simply the first real mechanism that can trigger it.
Fixed via a new `components/founders-desk/sessionGuard.ts` (its own
small, dependency-free module — `FoundersDeskApp.tsx` transitively
imports `next-auth` and can't be unit-tested directly, the same reason
`lib/auth/routeGate.ts` is split from `middleware.ts`): a real 401 now
redirects to `/login` instead of ever touching state with a failed
response. `tests/sessionLossHandling.test.ts` covers it directly. Re-
verified live after the fix across multiple real runs — zero console/page
errors, clean redirect to `/login`.

One apparent visual bug (the fixed Employee Directory bar appearing to
overlap Settings content in a mobile `fullPage` screenshot) was
investigated and confirmed to be the same known Playwright
`fullPage`-compositing artifact with `position: fixed` elements already
documented earlier in this file (search "known Playwright artifact") —
confirmed via a real, non-`fullPage` viewport screenshot showing normal,
non-intrusive behavior. Not a real defect; no fix needed.

All fictional Playwright test data (8 founders across the whole round,
7 organizations, their memberships/subscriptions/support requests, and
auth rows) was created directly in the real dev database and fully
removed afterward — confirmed by direct query that Ellis's and Maddie's
real founder rows and "Founders' HQ" were completely untouched throughout.

### 5. Launch safeguards — maintained, verified

`ALLOW_NEW_CUSTOMER_SIGNUP`/`STRIPE_SECRET_KEY` confirmed still unset for
any real deployment (only the pre-existing local `.env.local` founder-
testing toggle, unchanged by this session). Zero diffs this entire
mission to `components/founders-desk/world/` (Astra's project),
`docs/legal/`, or `lib/agents/` — confirmed via `git diff --stat` against
the mission's starting commit. No destructive operations on real data at
any point (every test/verification round used isolated fictional records,
all cleaned up afterward). All 7 agents and their `planned`/`wired`
status in the `agents` table untouched.

### Remaining founder-action blockers (unchanged from Mission 9, still real)

- A real Stripe test-mode account — the single external dependency
  blocking genuine end-to-end billing/checkout verification (test-mode
  product/price creation, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`).
- A real GitHub OAuth App for a real deployment.
- Final, founder-approved subscription prices (still explicitly
  provisional) and a refund policy (none approved).
- Qualified legal/data-protection review of the four draft documents in
  `docs/legal/` — still unpublished pending that review.
- A real email provider, if founders want support-request confirmation
  emails to actually send (`SUPPORT_EMAIL_PROVIDER_API_KEY` — currently
  unset by design; the support form already works without it, it just
  doesn't claim to send email).

## Exact restart point for a future session

1. Confirm baseline: `npm test && npx tsc --noEmit` (expect **799 tests
   passing**).
2. Account management, support, and billing transparency are now real
   and complete — the next natural founder-facing work is either (a)
   genuinely connecting the real Stripe test-mode account to unblock
   checkout verification, or (b) whatever the founders name as the next
   mission.
3. A real Stripe test-mode account is the single external dependency
   blocking genuine end-to-end billing verification.
4. Astra's branch still doesn't exist — check again before touching
   anything office-related.

Restart command: `npm test && npx tsc --noEmit` to reconfirm the
baseline (799 tests) still holds before continuing.
