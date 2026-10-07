"use client";

import { useEffect, useState } from "react";
import type { Expense, Budget } from "@/lib/db/types";

/**
 * Finance Agent's one real capability (Operations Wing, Milestone 6): log
 * a real expense and see actual-vs-budget for its category. Currency is
 * always explicit — never guessed, never silently converted. See
 * lib/domain/financeWorkflow.ts's doc comments for why this doesn't reuse
 * ledger_entries (USD-only, built for provider-spend tracking).
 */
export function FinanceAgentPanel() {
  const [category, setCategory] = useState("software");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [status, setStatus] = useState<{
    budget: Budget | null;
    spentInBudgetCurrency: number;
    remaining: number | null;
    excludedOtherCurrencyTotals: Array<{ currency: string; total: number }>;
  } | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(forCategory: string) {
    const [statusRes, expensesRes] = await Promise.all([
      fetch(`/api/finance/budgets/${encodeURIComponent(forCategory)}`),
      fetch(`/api/finance/expenses?category=${encodeURIComponent(forCategory)}`),
    ]);
    if (statusRes.ok) setStatus((await statusRes.json()).status);
    if (expensesRes.ok) setExpenses((await expensesRes.json()).expenses ?? []);
  }

  useEffect(() => {
    refresh(category).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSetBudget(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = Number(budgetAmount);
    if (!amt || amt <= 0) return;
    const res = await fetch("/api/finance/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, amount: amt, currency, period: "monthly" }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Could not set budget.");
      return;
    }
    setBudgetAmount("");
    await refresh(category);
  }

  async function handleLogExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0 || !description.trim()) return;
    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, description: description.trim(), amount: amt, currency }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Could not log that expense.");
      return;
    }
    setDescription("");
    setAmount("");
    await refresh(category);
  }

  async function handleCategoryChange(next: string) {
    setCategory(next);
    setLoading(true);
    await refresh(next);
    setLoading(false);
  }

  return (
    <div className="rounded-2xl border border-hq-brass/20 bg-white/70 p-5 shadow-desk">
      <h2 className="font-display text-lg font-semibold text-hq-ink">Finance Agent — Budget &amp; Expenses</h2>
      <p className="mt-1 text-xs text-hq-slate">
        Currency is always explicit — amounts are never guessed or converted between currencies.
      </p>

      <div className="mt-3">
        <label className="text-xs font-medium text-hq-slate">Category</label>
        <input
          value={category}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
        />
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-hq-slate">Loading…</p>
      ) : (
        <>
          <div className="mt-3 rounded-lg bg-hq-parchment/50 p-3">
            {status?.budget ? (
              <>
                <p className="text-sm font-medium text-hq-ink">
                  {status.budget.amount} {status.budget.currency} / {status.budget.period} budget
                </p>
                <p className="text-sm text-hq-slate">
                  Spent: {status.spentInBudgetCurrency} {status.budget.currency} — Remaining:{" "}
                  <span className="font-semibold text-hq-ink">
                    {status.remaining} {status.budget.currency}
                  </span>
                </p>
                {status.excludedOtherCurrencyTotals.length > 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    Not included above (different currency):{" "}
                    {status.excludedOtherCurrencyTotals.map((e) => `${e.total} ${e.currency}`).join(", ")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-hq-slate">No budget set for &quot;{category}&quot; yet.</p>
            )}
          </div>

          <form onSubmit={handleSetBudget} className="mt-3 flex gap-2">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="Monthly budget amount"
              className="flex-1 rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="rounded-md border border-hq-brass/30 px-2 py-2 text-sm"
            >
              <option>GBP</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
            <button type="submit" className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white">
              Set budget
            </button>
          </form>

          <form onSubmit={handleLogExpense} className="mt-3 space-y-2">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Expense description"
              className="w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 rounded-md border border-hq-brass/30 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={!amount || !description.trim()}
                className="rounded-md bg-hq-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Log expense
              </button>
            </div>
          </form>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <ul className="mt-4 space-y-1">
            {expenses.length === 0 && <li className="text-sm text-hq-slate">No expenses logged in this category yet.</li>}
            {expenses.map((exp) => (
              <li key={exp.id} className="flex justify-between text-sm text-hq-slate">
                <span>{exp.description}</span>
                <span className="font-medium text-hq-ink">
                  {exp.amount} {exp.currency}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
