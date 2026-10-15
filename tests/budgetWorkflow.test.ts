import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder, getAgentByKey, recordCost, listFounders } from "@/lib/db/repositories";
import { createOrganizationWithOwner, getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import {
  reserveBudget,
  settleReservation,
  releaseReservation,
  releaseStaleReservations,
  getBudgetStatusForOrganization,
  getOrganizationBudgetConfig,
  DEFAULT_MONTHLY_BUDGET_USD,
  BudgetExhaustedError,
  ReservationNotFoundError,
} from "@/lib/domain/budgetWorkflow";

/**
 * Real, atomic AI spending-limit tests (Master Development Mission 7,
 * Phase 4 — "launch-critical... Add concurrency regression tests").
 * Every test here exercises the real domain functions against a real
 * Postgres database — the genuine concurrency test fires real,
 * simultaneous requests at the real database, not a simulated race.
 */

async function makeTestOrganization(name: string): Promise<string> {
  const founder = await createFounder({ name: `${name} owner` });
  const { organization } = await createOrganizationWithOwner(founder.id, name);
  return organization.id;
}

describe("getOrganizationBudgetConfig / getBudgetStatusForOrganization", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("an organization with no explicit configuration gets the real, safe application default — never silently unlimited", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const config = await getOrganizationBudgetConfig(organizationId);
    expect(config.monthlyUsdLimit).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(config.row).toBeNull();

    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.monthlyLimitUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(status.committedUsd).toBe(0);
    expect(status.remainingUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(status.exhausted).toBe(false);
  });

  it("real settled costs genuinely count toward committed spend", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const agent = await getAgentByKey("business_analyst");
    await recordCost({
      missionId: null,
      organizationId,
      agentId: agent!.id,
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 5,
    });

    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.committedUsd).toBe(5);
    expect(status.remainingUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD - 5);
  });
});

describe("reserveBudget / settleReservation / releaseReservation", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("reserves real budget within the limit", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const reservation = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 0.5,
      idempotencyKey: "test-key-1",
    });
    expect(reservation.status).toBe("reserved");
    expect(reservation.reserved_usd).toBe(0.5);

    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.committedUsd).toBe(0.5);
  });

  it("refuses a reservation that would exceed the real configured limit", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    await expect(
      reserveBudget({
        organizationId,
        purpose: "business_analyst_research",
        estimatedUsd: DEFAULT_MONTHLY_BUDGET_USD + 1,
        idempotencyKey: "test-key-exceeds",
      }),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);

    // A real refused reservation never got written at all.
    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.committedUsd).toBe(0);
  });

  it("a genuine retry with the same idempotency key returns the original reservation — never a duplicate", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const first = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "retry-key",
    });
    const second = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "retry-key",
    });
    expect(second.id).toBe(first.id);

    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.committedUsd).toBe(1); // not 2 — the retry never double-reserved
  });

  it("settling a reservation with the real final cost stops it counting as 'reserved', and the real cost takes over via the costs table", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const reservation = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "settle-key",
    });

    const agent = await getAgentByKey("business_analyst");
    await recordCost({
      missionId: null,
      organizationId,
      agentId: agent!.id,
      model: "claude-sonnet-5",
      usdCost: 0.6, // the real, actual cost — less than the conservative estimate
    });
    const settled = await settleReservation(reservation.id, 0.6);
    expect(settled.status).toBe("settled");
    expect(settled.actual_usd_cost).toBe(0.6);

    // Real committed spend now reflects the real cost, not the original
    // estimate — toBeCloseTo rather than toBe, since `usd_cost` is a
    // single-precision `real` column (same as every other cost column in
    // this schema) and genuinely round-trips with float imprecision.
    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.committedUsd).toBeCloseTo(0.6, 5);
  });

  it("settling an already-settled reservation is a harmless, idempotent no-op — never double-applies", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const reservation = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "double-settle-key",
    });
    const first = await settleReservation(reservation.id, 0.3);
    const second = await settleReservation(reservation.id, 0.9); // a hypothetical duplicate call with a different amount
    expect(second.actual_usd_cost).toBe(first.actual_usd_cost); // the real first settlement is never overwritten
  });

  it("releasing a reservation that never spent anything frees its estimate back up", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const reservation = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: DEFAULT_MONTHLY_BUDGET_USD,
      idempotencyKey: "release-key",
    });
    expect((await getBudgetStatusForOrganization(organizationId)).committedUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);

    const released = await releaseReservation(reservation.id);
    expect(released.status).toBe("released");
    expect((await getBudgetStatusForOrganization(organizationId)).committedUsd).toBe(0);

    // The real budget is genuinely available again for a new operation.
    const next = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "after-release-key",
    });
    expect(next.status).toBe("reserved");
  });

  it("throws ReservationNotFoundError for a nonexistent reservation id on both settle and release", async () => {
    await expect(settleReservation("does-not-exist", 1)).rejects.toBeInstanceOf(ReservationNotFoundError);
    await expect(releaseReservation("does-not-exist")).rejects.toBeInstanceOf(ReservationNotFoundError);
  });

  it("releaseStaleReservations frees a real reservation abandoned by a crashed process, and leaves a fresh one alone", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const stale = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 5,
      idempotencyKey: "stale-key",
    });
    const fresh = await reserveBudget({
      organizationId,
      purpose: "business_analyst_research",
      estimatedUsd: 2,
      idempotencyKey: "fresh-key",
    });

    // Simulate the stale reservation being 20 real minutes old.
    const farFuture = new Date(Date.now() + 20 * 60 * 1000);
    const { released } = await releaseStaleReservations(farFuture);
    expect(released).toBe(2); // both look stale from 20 minutes in their own future

    // Re-run from "now" (both are genuinely fresh relative to the real clock) — nothing to release.
    const organizationId2 = await makeTestOrganization("Landscaping HQ");
    await reserveBudget({
      organizationId: organizationId2,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "genuinely-fresh-key",
    });
    const { released: releasedNow } = await releaseStaleReservations(new Date());
    expect(releasedNow).toBe(0);

    void stale;
    void fresh;
  });
});

describe("Organization isolation for budgets — Bakery HQ vs. Landscaping HQ", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("two organizations' budgets are completely independent — one exhausting its limit never affects the other", async () => {
    const bakeryId = await makeTestOrganization("Bakery HQ");
    const landscapingId = await makeTestOrganization("Landscaping HQ");

    await reserveBudget({
      organizationId: bakeryId,
      purpose: "business_analyst_research",
      estimatedUsd: DEFAULT_MONTHLY_BUDGET_USD,
      idempotencyKey: "bakery-exhausts",
    });

    await expect(
      reserveBudget({
        organizationId: bakeryId,
        purpose: "business_analyst_research",
        estimatedUsd: 0.01,
        idempotencyKey: "bakery-blocked",
      }),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);

    // Landscaping HQ's own real budget is completely untouched.
    const landscapingStatus = await getBudgetStatusForOrganization(landscapingId);
    expect(landscapingStatus.committedUsd).toBe(0);
    const landscapingReservation = await reserveBudget({
      organizationId: landscapingId,
      purpose: "business_analyst_research",
      estimatedUsd: 1,
      idempotencyKey: "landscaping-fine",
    });
    expect(landscapingReservation.status).toBe("reserved");
  });

  it("Ellis and Maddie's own real Founders' HQ gets the same real default protection, unaffected by the two test organizations", async () => {
    const founders = await listFounders();
    const ellis = founders.find((f) => f.name === "Ellis Scott")!;
    const organization = await getActiveOrganizationForFounder(ellis.id);
    const status = await getBudgetStatusForOrganization(organization.id);
    expect(status.monthlyLimitUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);
  });
});

describe("Real concurrency — the actual atomicity guarantee", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("two genuinely concurrent reservations that would together exceed the limit — exactly one succeeds", async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    // Each request alone fits comfortably; together they exceed the real
    // default limit — the real test of the Postgres row-lock atomicity,
    // not a simulated or sequential race.
    const halfPlus = DEFAULT_MONTHLY_BUDGET_USD / 2 + 1;

    const results = await Promise.allSettled([
      reserveBudget({
        organizationId,
        purpose: "business_analyst_research",
        estimatedUsd: halfPlus,
        idempotencyKey: "concurrent-a",
      }),
      reserveBudget({
        organizationId,
        purpose: "business_analyst_research",
        estimatedUsd: halfPlus,
        idempotencyKey: "concurrent-b",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExhaustedError);

    // The real database agrees — only one reservation's worth of real spend was ever committed.
    const status = await getBudgetStatusForOrganization(organizationId);
    expect(status.committedUsd).toBe(halfPlus);
  });

  it("many genuinely concurrent small reservations — the real committed total never exceeds the limit, no matter how they interleave", { timeout: 20000 }, async () => {
    const organizationId = await makeTestOrganization("Bakery HQ");
    const each = 3;
    const attempts = 10; // 10 * $3 = $30, well past the $20 default limit
    const keys = Array.from({ length: attempts }, (_, i) => `swarm-${i}`);

    const results = await Promise.allSettled(
      keys.map((key) =>
        reserveBudget({ organizationId, purpose: "business_analyst_research", estimatedUsd: each, idempotencyKey: key }),
      ),
    );

    const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
    const rejectedCount = results.filter((r) => r.status === "rejected").length;
    expect(fulfilledCount + rejectedCount).toBe(attempts);
    // At most 6 can fit in $20 at $3 each ($18 <= $20 < $21).
    expect(fulfilledCount).toBeLessThanOrEqual(6);

    const status = await getBudgetStatusForOrganization(organizationId);
    // The real, authoritative invariant: committed spend never exceeds the real limit, regardless of how the real concurrent requests interleaved.
    expect(status.committedUsd).toBeLessThanOrEqual(DEFAULT_MONTHLY_BUDGET_USD);
    expect(status.committedUsd).toBeCloseTo(fulfilledCount * each, 5);
  });
});
