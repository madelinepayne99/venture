import "server-only";
import {
  recordExpense,
  listExpenses,
  upsertBudget,
  getBudgetByCategory,
  sumExpensesByCategoryAndCurrency,
} from "@/lib/db/repositories";
import type { Expense, Budget, BudgetPeriod } from "@/lib/db/types";

export class FinanceValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "FinanceValidationError";
  }
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface RecordExpenseInput {
  category?: string;
  description?: string;
  amount?: number;
  currency?: string;
  incurredAt?: string;
}

function validateExpenseInput(input: RecordExpenseInput): string[] {
  const errors: string[] = [];
  if (!input.category?.trim()) errors.push("An expense needs a category.");
  if (!input.description?.trim()) errors.push("An expense needs a description.");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
    errors.push("Amount must be a positive number.");
  }
  if (!input.currency || !CURRENCY_PATTERN.test(input.currency)) {
    errors.push('Currency must be a real 3-letter code (e.g. "GBP", "USD") — never guessed or defaulted.');
  }
  if (input.incurredAt) {
    const parsed = new Date(input.incurredAt);
    if (Number.isNaN(parsed.getTime())) errors.push("incurredAt must be a valid date.");
  }
  return errors;
}

/** Finance Agent's real capability: a genuine expense, explicit currency, never guessed. */
export async function logExpense(input: RecordExpenseInput): Promise<Expense> {
  const errors = validateExpenseInput(input);
  if (errors.length) throw new FinanceValidationError(errors);

  return recordExpense({
    category: input.category!.trim(),
    description: input.description!.trim(),
    amount: input.amount!,
    currency: input.currency!.toUpperCase(),
    incurredAt: input.incurredAt,
  });
}

export interface SetBudgetInput {
  category?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
}

function validateBudgetInput(input: SetBudgetInput): string[] {
  const errors: string[] = [];
  if (!input.category?.trim()) errors.push("A budget needs a category.");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
    errors.push("Budget amount must be a positive number.");
  }
  if (!input.currency || !CURRENCY_PATTERN.test(input.currency)) {
    errors.push('Currency must be a real 3-letter code (e.g. "GBP", "USD").');
  }
  if (input.period && input.period !== "monthly" && input.period !== "one_off") {
    errors.push('period must be "monthly" or "one_off".');
  }
  return errors;
}

export async function setCategoryBudget(input: SetBudgetInput): Promise<Budget> {
  const errors = validateBudgetInput(input);
  if (errors.length) throw new FinanceValidationError(errors);

  return upsertBudget({
    category: input.category!.trim(),
    amount: input.amount!,
    currency: input.currency!.toUpperCase(),
    period: input.period ?? "monthly",
  });
}

export interface BudgetStatus {
  category: string;
  budget: Budget | null;
  spentInBudgetCurrency: number;
  remaining: number | null;
  /**
   * Real, honest flag per CLAUDE.md's "never fabricate/guess" rule: if any
   * expenses in this category used a DIFFERENT currency than the budget,
   * they are excluded from `spentInBudgetCurrency` (no silent conversion)
   * and reported here instead, so nothing is quietly mixed or lost.
   */
  excludedOtherCurrencyTotals: Array<{ currency: string; total: number }>;
}

/** The actual "£30 budget, £12 spent, £18 remaining" calculation — currency-honest. */
export async function getBudgetStatus(category: string, period: BudgetPeriod = "monthly"): Promise<BudgetStatus> {
  const budget = (await getBudgetByCategory(category, period)) ?? null;
  const sums = await sumExpensesByCategoryAndCurrency(category);

  if (!budget) {
    return {
      category,
      budget: null,
      spentInBudgetCurrency: 0,
      remaining: null,
      excludedOtherCurrencyTotals: sums,
    };
  }

  const matching = sums.find((s) => s.currency === budget.currency);
  const spent = matching?.total ?? 0;
  const excluded = sums.filter((s) => s.currency !== budget.currency);

  return {
    category,
    budget,
    spentInBudgetCurrency: spent,
    remaining: budget.amount - spent,
    excludedOtherCurrencyTotals: excluded,
  };
}

export async function listAllExpenses(category?: string): Promise<Expense[]> {
  return listExpenses(category ? { category } : undefined);
}
