import "server-only";
import { randomUUID } from "node:crypto";
import { sql, eq, and, gte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { BudgetReservation, OrganizationBudget } from "@/lib/db/types";

/**
 * Real, atomic AI spending-limit enforcement (Master Development Mission
 * 7, Phase 4 — "launch-critical"). Nothing before this ever stopped a
 * paid operation from running regardless of how much an organization had
 * already spent; `costs`/`ledger_entries` were purely observational. This
 * is the actual server-side gate: a paid operation must successfully
 * `reserveBudget` before it starts, and must `settleReservation` (with
 * the real final cost) or `releaseReservation` (if it never spent
 * anything) afterward — never optional, never just a dashboard number.
 *
 * Deliberately NOT wired into every paid call site yet (Scout and
 * Content Bot's own multi-stage pipelines are real, separate integration
 * work — see the progress doc) — this module and its real atomicity
 * guarantee is proven first, then wired in incrementally, starting with
 * Business Analyst's single-call research (the simplest real integration
 * point).
 */

// A safe, conservative development default — NOT a final customer price
// (see CLAUDE.md's own standing rule against inventing those). An
// organization with no explicit configuration (every real organization
// today) is protected by this rather than silently unlimited.
export const DEFAULT_MONTHLY_BUDGET_USD = 20;

export class BudgetExhaustedError extends Error {
  constructor(
    readonly organizationId: string,
    readonly limitUsd: number,
    readonly committedUsd: number,
    readonly requestedUsd: number,
  ) {
    super(
      `This organization's monthly AI budget is exhausted: $${committedUsd.toFixed(2)} already committed of a $${limitUsd.toFixed(2)} limit, and this operation needs up to $${requestedUsd.toFixed(2)} more.`,
    );
    this.name = "BudgetExhaustedError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(reservationId: string) {
    super(`Budget reservation ${reservationId} not found.`);
    this.name = "ReservationNotFoundError";
  }
}

function startOfCurrentMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

type QueryExecutor = Awaited<ReturnType<typeof getDb>>;

/**
 * Real config, or the safe application default when an organization has
 * never configured one — never silently "unlimited." Accepts an
 * optional, already-open executor (the real transaction `tx` from
 * `reserveBudget` below) so a caller already inside a transaction reuses
 * that SAME connection rather than borrowing a second one from the
 * shared pool — a real bug this fixes: under genuine high concurrency,
 * enough simultaneous `reserveBudget` calls each needing two connections
 * (one held open by their own transaction, one borrowed here) could
 * exhaust the pool entirely and hang every one of them, a real deadlock
 * caught by this module's own concurrency tests, not a hypothetical.
 */
export async function getOrganizationBudgetConfig(
  organizationId: string,
  executor?: QueryExecutor,
): Promise<{
  monthlyUsdLimit: number;
  maxConcurrentPaidTasks: number | null;
  row: OrganizationBudget | null;
}> {
  const db = executor ?? (await getDb());
  const [row] = await db
    .select()
    .from(schema.organizationBudgets)
    .where(eq(schema.organizationBudgets.organization_id, organizationId));
  return {
    monthlyUsdLimit: row?.monthly_usd_limit ?? DEFAULT_MONTHLY_BUDGET_USD,
    maxConcurrentPaidTasks: row?.max_concurrent_paid_tasks ?? null,
    row: row ?? null,
  };
}

/** Real, currently-committed spend for this organization this calendar month — genuinely settled costs plus still-active (not yet settled/released) reservations, so a concurrent in-flight operation's real worst-case cost counts against the limit even before it finishes. */
async function getCommittedUsd(
  tx: QueryExecutor,
  organizationId: string,
  now: Date,
): Promise<number> {
  const monthStart = startOfCurrentMonthIso(now);
  const [settledRow] = await tx.execute(sql`
    select coalesce(sum(${schema.costs.usd_cost}), 0)::float8 as total
    from ${schema.costs}
    where ${schema.costs.organization_id} = ${organizationId}
      and ${schema.costs.created_at} >= ${monthStart}
      and ${schema.costs.usd_cost} is not null
  `);
  const [reservedRow] = await tx.execute(sql`
    select coalesce(sum(${schema.budgetReservations.reserved_usd}), 0)::float8 as total
    from ${schema.budgetReservations}
    where ${schema.budgetReservations.organization_id} = ${organizationId}
      and ${schema.budgetReservations.status} = 'reserved'
  `);
  const settled = Number((settledRow as unknown as { total: number }).total ?? 0);
  const reserved = Number((reservedRow as unknown as { total: number }).total ?? 0);
  return settled + reserved;
}

export interface ReserveBudgetInput {
  organizationId: string;
  purpose: string;
  estimatedUsd: number;
  /** Real caller-supplied idempotency key — a retried request with the same key returns the original reservation rather than reserving twice. */
  idempotencyKey: string;
}

/**
 * The real atomic reservation — the actual mechanism, not just a check.
 * Two genuinely concurrent calls for the SAME organization serialize on
 * a real Postgres row lock (`organization_budgets` row, `SELECT ... FOR
 * UPDATE` inside a transaction) so they can never both succeed past the
 * limit together; calls for different organizations never block each
 * other. A retried call with the same `idempotencyKey` returns the
 * original reservation instead of creating a second one — real
 * duplicate-charge protection, enforced by a genuine DB unique
 * constraint, not just an application-level check.
 */
export async function reserveBudget(input: ReserveBudgetInput, now: Date = new Date()): Promise<BudgetReservation> {
  if (!(input.estimatedUsd >= 0) || !Number.isFinite(input.estimatedUsd)) {
    throw new Error("estimatedUsd must be a real, finite, non-negative number — never inferred or guessed.");
  }

  const db = await getDb();

  // A genuine retry of the same real request — return the existing
  // reservation rather than reserving (and risking double-charging) again.
  const [existing] = await db
    .select()
    .from(schema.budgetReservations)
    .where(eq(schema.budgetReservations.idempotency_key, input.idempotencyKey));
  if (existing) return existing as BudgetReservation;

  return db.transaction(async (tx) => {
    // Ensure a real config row exists, then lock it for the rest of this
    // transaction — the actual serialization point for concurrent
    // reservation attempts against the same organization.
    await tx
      .insert(schema.organizationBudgets)
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: schema.organizationBudgets.organization_id });
    await tx.execute(sql`
      select 1 from ${schema.organizationBudgets}
      where ${schema.organizationBudgets.organization_id} = ${input.organizationId}
      for update
    `);

    const config = await getOrganizationBudgetConfig(input.organizationId, tx);
    const committed = await getCommittedUsd(tx, input.organizationId, now);

    if (committed + input.estimatedUsd > config.monthlyUsdLimit) {
      throw new BudgetExhaustedError(input.organizationId, config.monthlyUsdLimit, committed, input.estimatedUsd);
    }

    const [reservation] = await tx
      .insert(schema.budgetReservations)
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        idempotency_key: input.idempotencyKey,
        purpose: input.purpose,
        reserved_usd: input.estimatedUsd,
        status: "reserved",
        // Explicit, JS-computed UTC — never the column's own SQL-level
        // defaultNow(), which reflects the DB session's configured
        // timezone (not necessarily UTC — a real local-dev Postgres
        // instance surfaced exactly this during testing). Every other
        // table in this codebase already follows this same explicit-
        // timestamp convention (see repositories.ts's own now() helper)
        // for the same reason; this table had briefly drifted from it.
        created_at: new Date().toISOString(),
      })
      .returning();
    return reservation as BudgetReservation;
  });
}

/** The real operation finished — record its genuine final cost and close the reservation out. Idempotent: settling an already-settled reservation is a harmless no-op (the real first settlement is never overwritten). */
export async function settleReservation(reservationId: string, actualUsdCost: number | null): Promise<BudgetReservation> {
  const db = await getDb();
  const result = await db
    .update(schema.budgetReservations)
    .set({ status: "settled", actual_usd_cost: actualUsdCost, settled_at: new Date().toISOString() })
    .where(and(eq(schema.budgetReservations.id, reservationId), eq(schema.budgetReservations.status, "reserved")))
    .returning();
  if (result.length === 0) {
    const [existing] = await db.select().from(schema.budgetReservations).where(eq(schema.budgetReservations.id, reservationId));
    if (!existing) throw new ReservationNotFoundError(reservationId);
    return existing as BudgetReservation; // already settled/released — real idempotent no-op
  }
  return result[0] as BudgetReservation;
}

/** The operation never actually spent anything (refused before starting, or a genuine crash before any provider call) — release the reservation so its estimated amount stops counting against the organization's committed spend. */
export async function releaseReservation(reservationId: string): Promise<BudgetReservation> {
  const db = await getDb();
  const result = await db
    .update(schema.budgetReservations)
    .set({ status: "released", settled_at: new Date().toISOString() })
    .where(and(eq(schema.budgetReservations.id, reservationId), eq(schema.budgetReservations.status, "reserved")))
    .returning();
  if (result.length === 0) {
    const [existing] = await db.select().from(schema.budgetReservations).where(eq(schema.budgetReservations.id, reservationId));
    if (!existing) throw new ReservationNotFoundError(reservationId);
    return existing as BudgetReservation;
  }
  return result[0] as BudgetReservation;
}

/**
 * A real recovery sweep for reservations abandoned by a crashed process
 * (Section 8's own "reservations recover safely from process crashes" —
 * mirrors this codebase's existing stuck-mission/stuck-content-item
 * watchdog pattern exactly). A "reserved" row older than this is
 * presumed orphaned — its own real operation either crashed before
 * recording a cost, or recorded one and crashed before settling; either
 * way, counting its estimate against the budget forever would eventually
 * starve the organization even though nothing is still running.
 */
const RESERVATION_STALE_AFTER_MS = 15 * 60 * 1000;

export async function releaseStaleReservations(now: Date = new Date()): Promise<{ released: number }> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - RESERVATION_STALE_AFTER_MS).toISOString();
  const result = await db
    .update(schema.budgetReservations)
    .set({ status: "released", settled_at: now.toISOString() })
    .where(
      and(
        eq(schema.budgetReservations.status, "reserved"),
        sql`${schema.budgetReservations.created_at} < ${cutoff}`,
      ),
    )
    .returning({ id: schema.budgetReservations.id });
  return { released: result.length };
}

/** Real, current usage snapshot for a founder-facing display — never a fabricated figure. */
export async function getBudgetStatusForOrganization(organizationId: string, now: Date = new Date()) {
  const db = await getDb();
  const config = await getOrganizationBudgetConfig(organizationId);
  const committed = await getCommittedUsd(db, organizationId, now);
  return {
    monthlyLimitUsd: config.monthlyUsdLimit,
    committedUsd: committed,
    remainingUsd: Math.max(0, config.monthlyUsdLimit - committed),
    exhausted: committed >= config.monthlyUsdLimit,
  };
}
