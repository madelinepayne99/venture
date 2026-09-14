import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { recordCost, listCosts, listLedgerEntries, ledgerTotalUsd, listAgents } from "@/lib/db/repositories";

describe("calculateUsdCost", () => {
  it("computes cost from real per-token pricing", () => {
    const cost = calculateUsdCost("claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(2 + 10, 5);
  });

  it("refuses to invent a cost for a model with no known pricing", () => {
    expect(() => calculateUsdCost("made-up-model", { input_tokens: 100, output_tokens: 100 })).toThrow(
      /no pricing/i,
    );
  });
});

describe("cost ledger", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("writes a matching, negative ledger entry for every recorded cost", async () => {
    const agents = await listAgents();
    const scout = agents.find((a) => a.key === "scout")!;
    await recordCost({
      missionId: null,
      agentId: scout.id,
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.007,
    });

    const costs = await listCosts("");
    expect(costs).toHaveLength(0); // scoped to a mission id, and we passed none

    const entries = await listLedgerEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount_usd).toBeCloseTo(-0.007, 6);
    expect(await ledgerTotalUsd()).toBeCloseTo(-0.007, 6);
  });

  it("records token usage with a null cost without inventing a ledger charge", async () => {
    const agents = await listAgents();
    const scout = agents.find((a) => a.key === "scout")!;
    const cost = await recordCost({
      missionId: null,
      agentId: scout.id,
      model: "some-future-model-not-in-the-pricing-table",
      inputTokens: 640,
      outputTokens: 120,
      usdCost: null,
    });

    expect(cost.usd_cost).toBeNull();
    expect(cost.input_tokens).toBe(640);
    expect(cost.output_tokens).toBe(120);

    // No ledger entry at all for an unpriced cost — not even a fabricated $0.
    expect(await listLedgerEntries()).toHaveLength(0);
    expect(await ledgerTotalUsd()).toBe(0);
  });
});
