import { z } from "zod";

/**
 * Business Analyst's report shape — deliberately simpler than Scout's
 * (lib/agents/scout/schema.ts), which is NOT touched or reused here: this
 * is a standalone research capability (a founder's direct question, not a
 * mission), not a second implementation of Scout's workspace-aware
 * mission report. Array caps mirror Scout's own "generous but real"
 * compactness philosophy (CLAUDE.md) — a structural guarantee, not just
 * prompt guidance.
 */
export const BusinessAnalystSourceSchema = z.object({
  url: z.string().min(1).max(2000),
  title: z.string().min(1).max(300),
  published_date: z.string().nullable().optional(),
});

export const BusinessAnalystReportSchema = z.object({
  query: z.string().min(1).max(1000),
  summary: z.string().min(1).max(2000),
  opportunities: z.array(z.string().min(1).max(500)).max(10),
  risks: z.array(z.string().min(1).max(500)).max(10),
  sources: z.array(BusinessAnalystSourceSchema).max(10),
});

export type BusinessAnalystReport = z.infer<typeof BusinessAnalystReportSchema>;
export type BusinessAnalystSource = z.infer<typeof BusinessAnalystSourceSchema>;
