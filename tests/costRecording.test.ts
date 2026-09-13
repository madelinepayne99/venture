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
  beforeEach(() => {
    resetDbForTests();
  });

  it("writes a matching, negative ledger entry for every recorded cost", () => {
    const scout = listAgents().find((a) => a.key === "scout")!;
    recordCost({
      missionId: null,
      agentId: scout.id,
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.007,
    });

    const costs = listCosts("");
    expect(costs).toHaveLength(0); // scoped to a mission id, and we passed none

    const entries = listLedgerEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount_usd).toBeCloseTo(-0.007, 6);
    expect(ledgerTotalUsd()).toBeCloseTo(-0.007, 6);
  });
});
