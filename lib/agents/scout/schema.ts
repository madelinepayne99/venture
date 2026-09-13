import { z } from "zod";

export const ScoutVerdictSchema = z.enum([
  "reject",
  "investigate_further",
  "ready_for_founders_review",
]);

export const ScoutSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  published_date: z.string().nullable().describe("Date as reported by the source, or null if unknown."),
  accessed_date: z.string().describe("Date Scout retrieved this source, ISO 8601."),
});

export const ScoutFactSchema = z.object({
  statement: z.string().describe("A single verifiable claim, grounded in a specific source."),
  source_url: z.string().nullable().describe("The source this fact is grounded in, or null only for general, uncontestable background knowledge."),
});

export const ScoutReportSchema = z.object({
  interpreted_mission: z
    .string()
    .describe("Scout's restatement of what the founder actually asked for."),
  research_questions: z.array(z.string()).min(1),
  potential_customer: z.string(),
  evidence_of_demand: z
    .string()
    .describe(
      "A hedged description of demand signals found. Must never state demand, sales, revenue, or profit as guaranteed or certain.",
    ),
  competition_observations: z.string(),
  opportunity_gaps: z.string(),
  originality_considerations: z.string(),
  platform_suitability: z.object({
    etsy_downloads: z.string(),
    amazon_kdp_print_on_demand: z.string(),
    other_notes: z.string().nullable(),
  }),
  estimated_production_difficulty: z.object({
    level: z.enum(["low", "medium", "high"]),
    rationale: z.string(),
  }),
  likely_costs: z.object({
    estimate: z.string().describe("A hedged cost estimate — never a guaranteed figure."),
    breakdown: z.array(z.string()).default([]),
  }),
  important_risks: z.array(z.string()).min(1),
  copyright_trademark_concerns: z
    .array(z.string())
    .describe("Concerns requiring further legal/compliance checks before any listing is created. Empty array only if genuinely none identified."),
  sources: z.array(ScoutSourceSchema).default([]),
  verified_facts: z.array(ScoutFactSchema).default([]),
  inferences: z
    .array(z.string())
    .default([])
    .describe("Scout's own reasoning or judgment calls, clearly separate from verified_facts."),
  unresolved_questions: z.array(z.string()).default([]),
  recommended_next_action: z.string(),
  verdict: ScoutVerdictSchema,
  verdict_rationale: z.string(),
});

export type ScoutReport = z.infer<typeof ScoutReportSchema>;
export type ScoutSource = z.infer<typeof ScoutSourceSchema>;
export type ScoutFact = z.infer<typeof ScoutFactSchema>;
