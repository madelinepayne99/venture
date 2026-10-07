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
2. **Agents registered**: `executive_assistant` (`status: "active"`),
   `chief_of_staff`, `finance_agent`, `business_analyst`, `operations_agent`
   (`status: "planned"`) — added to `CANONICAL_AGENTS` in `lib/db/client.ts`,
   using the exact same idempotent `seedAgents()` mechanism Scout and
   Content Bot were seeded through. Only Executive Assistant is "active",
   and only because it has exactly one real, tested capability below —
   the other four are recorded and visible in the roster, same as
   Inventor/Inspector/Merchant/etc. have been since Milestone 1, and do
   **not** run.
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

## What is explicitly NOT done yet

- Chief of Staff, Finance Agent, Business Analyst, Operations Agent: **no
  code**. Registered as `planned`, nothing simulates them running, per
  CLAUDE.md's own standing rule.
- No 3D-office expansion (no new rooms, no new character rigs) — the
  `office-reference.html`/`office-extension.json` design reference has not
  been acted on. Explicitly ordered after real agent function per the
  founder's own brief.
- No Chief-of-Staff delegation/hand-off mechanism.
- No email/calendar integration (Executive Assistant is internal-only,
  as the brief itself required for a first slice).
- Acceptance Tests A, C, D, E, F (everything except B) are not built.

## Exact restart point for a future session

Next real increment should be **one more full vertical slice**, not all
four remaining agents at once — same reasoning as why this slice stopped
at one. Suggested order, cheapest/least-coupled first:
1. **Finance Agent** — reuses `costs`/`ledger_entries` directly (already
   real, already exist), likely the smallest next slice: "record an
   expense, show actual-vs-budget" needs little beyond `agent_tasks` with
   `task_type: "expense"` or a small sibling table if ledger shape doesn't
   fit cleanly — check before assuming either way.
2. **Operations Agent** — checklists, same `agent_tasks` shape with
   `task_type: "checklist"` and a `payload` of items; closest in shape to
   what Executive Assistant already proved out.
3. **Business Analyst** — real web-backed research, closer in spirit to
   Scout; worth checking whether it can reuse Scout's own
   `web_search`/evidence-guardrail machinery rather than duplicating it.
4. **Chief of Staff** — deliberately last; delegation only makes sense
   once there's more than one real agent to delegate *to*.

Restart command: `npm test && npx tsc --noEmit` to reconfirm this
baseline still holds, then continue from step 1 above.
