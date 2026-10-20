import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getAgentByKey, ledgerTotalUsd, listActivity } from "@/lib/db/repositories";
import { runBusinessAnalystResearch, BusinessAnalystResearchError } from "@/lib/agents/businessAnalyst";
import { findGuaranteeLanguage, hasAtLeastOneSource } from "@/lib/agents/businessAnalyst/guardrails";
import type { BusinessAnalystReport } from "@/lib/agents/businessAnalyst/schema";
import {
  requestResearch,
  listFounderResearchReports,
  getFounderResearchReport,
  BusinessAnalystValidationError,
  BusinessAnalystReportNotFoundError,
} from "@/lib/domain/businessAnalystWorkflow";
import { fakeAnthropicClient, fakeAnthropicClientWithCalls, fakeAnthropicMessage } from "./testUtils";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import {
  reserveBudget,
  getBudgetStatusForOrganization,
  DEFAULT_MONTHLY_BUDGET_USD,
  BudgetExhaustedError,
} from "@/lib/domain/budgetWorkflow";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

function makeReport(overrides: Partial<BusinessAnalystReport> = {}): BusinessAnalystReport {
  return {
    query: "How saturated is the printable planner niche on Etsy?",
    summary: "Demand signals are mixed; the niche shows real search volume but heavy existing supply.",
    opportunities: ["A few sub-niches (ADHD planners) show lower competition with real search volume."],
    risks: ["Saturation is high in the general planner category."],
    sources: [{ url: "https://www.etsy.com/example", title: "Etsy seller forum thread", published_date: "2026-01-01" }],
    ...overrides,
  };
}

describe("Business Analyst is registered correctly", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("seeds business_analyst as active", async () => {
    const agent = await getAgentByKey("business_analyst");
    expect(agent?.status).toBe("active");
  });
});

describe("runBusinessAnalystResearch — structured response", () => {
  it("returns a fully structured, schema-valid report with real usage", async () => {
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const outcome = await runBusinessAnalystResearch(report.query, { client });

    expect(outcome.report.summary).toBe(report.summary);
    expect(outcome.report.sources.length).toBeGreaterThan(0);
    expect(outcome.usage.model).toBe("claude-sonnet-5");
    expect(outcome.usage.inputTokens).toBe(1000);
    expect(outcome.usage.outputTokens).toBe(500);
    expect(outcome.usage.usdCost).toBeGreaterThan(0);
  });

  it("rejects a report outright when it contains guaranteed-outcome language", async () => {
    const report = makeReport({ opportunities: ["This niche is guaranteed to sell well."] });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    await expect(runBusinessAnalystResearch(report.query, { client })).rejects.toBeInstanceOf(
      BusinessAnalystResearchError,
    );
  });

  it("rejects a report with zero sources rather than delivering it without evidence", async () => {
    const report = makeReport({ sources: [] });
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    await expect(runBusinessAnalystResearch(report.query, { client })).rejects.toBeInstanceOf(
      BusinessAnalystResearchError,
    );
  });

  it("rejects an unparseable response as a distinct, clear error carrying real usage", async () => {
    const client = fakeAnthropicClient([
      fakeAnthropicMessage({}, {
        content: [{ type: "text", text: "Sorry, I could not complete this.", citations: null }],
      }),
    ]);

    const error = await runBusinessAnalystResearch("some query", { client }).catch((e) => e);
    expect(error).toBeInstanceOf(BusinessAnalystResearchError);
    expect(error.usage.inputTokens).toBe(1000);
  });
});

describe("Business Analyst guardrails — independent of Scout's", () => {
  it("flags guarantee language anywhere in the report, not just a maintained field list", async () => {
    const report = makeReport({ risks: ["There is no risk at all here."] });
    expect(findGuaranteeLanguage(report).length).toBeGreaterThan(0);
  });

  it("passes through hedged language untouched", async () => {
    const report = makeReport({ opportunities: ["This may be a workable niche, early signs suggest some demand."] });
    expect(findGuaranteeLanguage(report)).toHaveLength(0);
  });

  it("requires at least one real source", async () => {
    expect(hasAtLeastOneSource(makeReport())).toBe(true);
    expect(hasAtLeastOneSource(makeReport({ sources: [] }))).toBe(false);
  });
});

describe("requestResearch — real persistence, success and failure", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("persists a completed report and records real cost against no mission (missionId: null)", async () => {
    const founderId = await seededFounderId();
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const before = await ledgerTotalUsd();
    const saved = await requestResearch(founderId, report.query, { client });
    const after = await ledgerTotalUsd();

    expect(saved.state).toBe("completed");
    expect(saved.founder_id).toBe(founderId);
    expect(saved.report?.summary).toBe(report.summary);
    // A negative ledger entry (real spend) was recorded with no mission attached.
    expect(after).toBeLessThan(before);
  });

  it("is genuinely visible after a fresh read — not just returned from the write", async () => {
    const founderId = await seededFounderId();
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const saved = await requestResearch(founderId, report.query, { client });
    const reread = await getFounderResearchReport(saved.id, founderId);

    expect(reread.report?.summary).toBe(report.summary);
  });

  it("records real activity for a completed run", async () => {
    const founderId = await seededFounderId();
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    await requestResearch(founderId, report.query, { client });

    const activity = await listActivity(undefined, 50);
    expect(activity.some((a) => a.actor === "business_analyst" && a.action === "research_completed")).toBe(true);
  });

  it("persists a failed report (with its real error) rather than throwing it away, when research fails", async () => {
    const founderId = await seededFounderId();
    const report = makeReport({ sources: [] }); // triggers the zero-sources guardrail rejection
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const saved = await requestResearch(founderId, "A question with no real evidence", { client });

    expect(saved.state).toBe("failed");
    expect(saved.report).toBeNull();
    expect(saved.error).toMatch(/no real sources/i);

    const activity = await listActivity(undefined, 50);
    expect(activity.some((a) => a.actor === "business_analyst" && a.action === "research_failed")).toBe(true);
  });

  it("rejects an empty query and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderResearchReports(founderId);

    await expect(requestResearch(founderId, "")).rejects.toBeInstanceOf(BusinessAnalystValidationError);
    await expect(requestResearch(founderId, "   ")).rejects.toBeInstanceOf(BusinessAnalystValidationError);

    const after = await listFounderResearchReports(founderId);
    expect(after).toHaveLength(before.length);
  });
});

describe("requestResearch — real budget enforcement (Mission 7 Phase 4)", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("settles a real reservation with the actual cost on a successful run", async () => {
    const founderId = await seededFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const before = await getBudgetStatusForOrganization(organization.id);
    const saved = await requestResearch(founderId, report.query, { client });
    const after = await getBudgetStatusForOrganization(organization.id);

    expect(saved.state).toBe("completed");
    // Committed spend grew by exactly the real recorded cost — not the
    // worst-case estimate that was reserved up front.
    expect(after.committedUsd - before.committedUsd).toBeCloseTo(saved.usd_cost ?? 0, 6);
  });

  it("settles a real reservation with the real cost even on a failed (guardrail-rejected) run", async () => {
    const founderId = await seededFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const report = makeReport({ sources: [] }); // triggers the zero-sources guardrail rejection
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);

    const before = await getBudgetStatusForOrganization(organization.id);
    const saved = await requestResearch(founderId, "A question with no real evidence", { client });
    const after = await getBudgetStatusForOrganization(organization.id);

    expect(saved.state).toBe("failed");
    // A failed-but-billed run's real cost still counts against committed
    // spend — not the worst-case reservation, and never left "reserved"
    // (uncommitted) forever.
    expect(after.committedUsd - before.committedUsd).toBeCloseTo(saved.usd_cost ?? 0, 6);
  });

  it("refuses the request before ever calling the model when the organization's budget is already exhausted", async () => {
    const founderId = await seededFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);

    // Simulate prior real spend this month that's already used up the
    // organization's entire default budget.
    await reserveBudget({
      organizationId: organization.id,
      purpose: "test_prior_spend",
      estimatedUsd: DEFAULT_MONTHLY_BUDGET_USD,
      idempotencyKey: "prior-spend-exhausts-budget",
    });

    const report = makeReport();
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(report)]);

    await expect(requestResearch(founderId, report.query, { client })).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );

    // The real model was never called — the gate refused before any spend.
    expect(calls).toHaveLength(0);

    // Nothing was persisted for this refused request either.
    const reports = await listFounderResearchReports(founderId);
    expect(reports.some((r) => r.query === report.query)).toBe(false);
  });
});

describe("listFounderResearchReports / getFounderResearchReport — ownership isolation", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("only returns the calling founder's own reports", async () => {
    const founderId = await seededFounderId();
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);
    await requestResearch(founderId, report.query, { client });

    const reports = await listFounderResearchReports(founderId);
    expect(reports.every((r) => r.founder_id === founderId)).toBe(true);
  });

  it("refuses to read a report owned by a different founder", async () => {
    const founders = await listFounders();
    const owner = founders[0]!.id;
    const report = makeReport();
    const client = fakeAnthropicClient([fakeAnthropicMessage(report)]);
    const saved = await requestResearch(owner, report.query, { client });

    const otherFounder = founders.find((f) => f.id !== owner);
    if (!otherFounder) return;

    await expect(getFounderResearchReport(saved.id, otherFounder.id)).rejects.toBeInstanceOf(
      BusinessAnalystReportNotFoundError,
    );
  });

  it("throws BusinessAnalystReportNotFoundError for a nonexistent id", async () => {
    const founderId = await seededFounderId();
    await expect(getFounderResearchReport("does-not-exist", founderId)).rejects.toBeInstanceOf(
      BusinessAnalystReportNotFoundError,
    );
  });
});
