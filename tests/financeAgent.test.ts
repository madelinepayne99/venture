import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { getAgentByKey } from "@/lib/db/repositories";
import {
  logExpense,
  setCategoryBudget,
  getBudgetStatus,
  listAllExpenses,
  FinanceValidationError,
} from "@/lib/domain/financeWorkflow";

describe("Finance Agent is registered correctly", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("seeds finance_agent as active", async () => {
    const agent = await getAgentByKey("finance_agent");
    expect(agent?.status).toBe("active");
  });
});

describe("logExpense", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("records a real expense with explicit currency", async () => {
    const expense = await logExpense({
      category: "software",
      description: "Monthly subscription",
      amount: 12,
      currency: "GBP",
    });

    expect(expense.amount).toBe(12);
    expect(expense.currency).toBe("GBP");
    expect(expense.category).toBe("software");
  });

  it("is genuinely visible after a fresh read", async () => {
    await logExpense({ category: "software", description: "Real persistence check", amount: 5, currency: "GBP" });
    const expenses = await listAllExpenses("software");
    expect(expenses.some((e) => e.description === "Real persistence check")).toBe(true);
  });

  it("rejects a missing/invalid currency rather than defaulting to one", async () => {
    await expect(
      logExpense({ category: "software", description: "x", amount: 5, currency: "" }),
    ).rejects.toBeInstanceOf(FinanceValidationError);
    await expect(
      logExpense({ category: "software", description: "x", amount: 5, currency: "pounds" }),
    ).rejects.toBeInstanceOf(FinanceValidationError);
  });

  it("rejects a zero or negative amount and writes nothing", async () => {
    const before = await listAllExpenses("software");
    await expect(
      logExpense({ category: "software", description: "x", amount: 0, currency: "GBP" }),
    ).rejects.toBeInstanceOf(FinanceValidationError);
    await expect(
      logExpense({ category: "software", description: "x", amount: -5, currency: "GBP" }),
    ).rejects.toBeInstanceOf(FinanceValidationError);
    const after = await listAllExpenses("software");
    expect(after).toHaveLength(before.length);
  });
});

describe("setCategoryBudget / getBudgetStatus — the exact founder acceptance scenario", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("£12 expense + £30 monthly budget = £18 remaining, after a fresh read", async () => {
    await setCategoryBudget({ category: "software", amount: 30, currency: "GBP", period: "monthly" });
    await logExpense({ category: "software", description: "Subscription", amount: 12, currency: "GBP" });

    const status = await getBudgetStatus("software");

    expect(status.budget?.amount).toBe(30);
    expect(status.budget?.currency).toBe("GBP");
    expect(status.spentInBudgetCurrency).toBe(12);
    expect(status.remaining).toBe(18);
    expect(status.excludedOtherCurrencyTotals).toHaveLength(0);
  });

  it("sums multiple expenses in the same category correctly", async () => {
    await setCategoryBudget({ category: "software", amount: 30, currency: "GBP" });
    await logExpense({ category: "software", description: "A", amount: 12, currency: "GBP" });
    await logExpense({ category: "software", description: "B", amount: 5, currency: "GBP" });

    const status = await getBudgetStatus("software");
    expect(status.spentInBudgetCurrency).toBe(17);
    expect(status.remaining).toBe(13);
  });

  it("never silently mixes a different-currency expense into the budget total", async () => {
    await setCategoryBudget({ category: "software", amount: 30, currency: "GBP" });
    await logExpense({ category: "software", description: "GBP one", amount: 12, currency: "GBP" });
    await logExpense({ category: "software", description: "USD one", amount: 9, currency: "USD" });

    const status = await getBudgetStatus("software");
    // Only the matching-currency expense counts toward spend/remaining.
    expect(status.spentInBudgetCurrency).toBe(12);
    expect(status.remaining).toBe(18);
    // The other-currency spend is reported, not dropped silently.
    expect(status.excludedOtherCurrencyTotals).toEqual([{ currency: "USD", total: 9 }]);
  });

  it("reports no budget rather than fabricating one for an unset category", async () => {
    const status = await getBudgetStatus("marketing");
    expect(status.budget).toBeNull();
    expect(status.remaining).toBeNull();
  });

  it("updates an existing budget in place rather than creating a duplicate", async () => {
    await setCategoryBudget({ category: "software", amount: 30, currency: "GBP" });
    await setCategoryBudget({ category: "software", amount: 50, currency: "GBP" });

    const status = await getBudgetStatus("software");
    expect(status.budget?.amount).toBe(50);
  });
});
