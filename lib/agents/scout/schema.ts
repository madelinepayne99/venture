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

// A legal/privacy/advertising note for a Service Business report. Scout is
// told (see prompt.ts) to prefer a UK primary regulator's own published
// guidance (ico.org.uk, asa.org.uk, gov.uk, legislation.gov.uk) over
// secondary summaries — this field makes "prefer primary sources, and mark
// any secondary source" a structural requirement, not just a hope the model
// mentions it in prose. A note with no source at all (source_url: null)
// must still be marked "secondary" — there is no "unsourced but implicitly
// primary" option.
export const RegulatoryNoteSchema = z.object({
  note: z.string().describe("A specific legal, privacy, or advertising-standards consideration relevant to this business."),
  source_url: z.string().nullable().describe("URL of the source this note is grounded in, or null if none was found."),
  source_quality: z
    .enum(["primary_regulator", "secondary"])
    .describe(
      "primary_regulator: the source is the regulator's own published guidance (e.g. ico.org.uk, asa.org.uk, gov.uk, legislation.gov.uk). secondary: any other source (law firm blog, news article, general SEO content, etc.) — must never be presented as equivalent to primary guidance.",
    ),
});

// Fields every workspace type needs, regardless of business shape. Kept
// deliberately narrow — anything specific to how a Commerce vs. a Service
// Business opportunity is evaluated lives in the per-workspace schema
// below, not here.
//
// Array-length caps below are a structural compactness guarantee, not just
// prompt guidance — see prompt.ts's matching compactness rule. They exist so
// an unbounded enumeration (a model deciding to list 40 "sources" or 30
// "risks") can't by itself blow up the length of a report — that's part of
// what was leaving genuinely-focused missions without enough max_tokens
// budget left to *finish* the report (see the comment on MAX_TOKENS in
// scout/index.ts for the full diagnosis). Caps are deliberately generous
// relative to the prompt's own compact targets, so a genuinely
// evidence-rich report is never blocked by this — hasMeaningfulEvidence in
// guardrails.ts only ever needs one verified fact, so none of these caps
// can starve that check.
const ScoutReportCoreSchema = z.object({
  interpreted_mission: z
    .string()
    .describe("Scout's restatement of what the founder actually asked for."),
  research_questions: z.array(z.string()).min(1).max(5),
  potential_customer: z.string().describe("Who this opportunity is actually for."),
  evidence_of_demand: z
    .string()
    .describe(
      "A hedged description of demand signals found. Must never state demand, sales, revenue, or profit as guaranteed or certain.",
    ),
  competition_observations: z.string(),
  important_risks: z.array(z.string()).min(1).max(6),
  sources: z.array(ScoutSourceSchema).max(10).default([]),
  verified_facts: z.array(ScoutFactSchema).max(8).default([]),
  inferences: z
    .array(z.string())
    .max(6)
    .default([])
    .describe("Scout's own reasoning or judgment calls, clearly separate from verified_facts."),
  unresolved_questions: z.array(z.string()).max(6).default([]),
  recommended_next_action: z.string(),
  verdict: ScoutVerdictSchema,
  verdict_rationale: z.string(),
});

// Commerce: the original Etsy-downloads / Amazon-KDP digital-product
// workspace. Field shape is unchanged from before workspaces existed —
// existing Commerce missions/reports remain readable as-is.
export const CommerceReportSchema = ScoutReportCoreSchema.extend({
  workspace_type: z.literal("commerce"),
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
    breakdown: z.array(z.string()).max(8).default([]),
  }),
  copyright_trademark_concerns: z
    .array(z.string())
    .max(6)
    .describe("Concerns requiring further legal/compliance checks before any listing is created. Empty array only if genuinely none identified."),
});

// Service Business: client-facing local businesses (hairdressers, garages,
// and similar) — no platform listing, no physical-product production
// difficulty. Focused on service delivery, client retention/acquisition,
// pricing, and (distinctively) legal/privacy/advertising compliance, where
// primary UK regulator sources are preferred over secondary summaries.
export const ServiceBusinessReportSchema = ScoutReportCoreSchema.extend({
  workspace_type: z.literal("service_business"),
  service_delivery_considerations: z
    .string()
    .describe("Staffing, capacity, scheduling, or service-delivery-model observations."),
  client_retention_or_acquisition_gaps: z.string(),
  regulatory_and_compliance_notes: z.array(RegulatoryNoteSchema).max(6).default([]),
  pricing_or_service_model_considerations: z.object({
    summary: z.string().describe("A hedged summary of pricing/service-model considerations — never a guaranteed figure."),
    considerations: z.array(z.string()).max(8).default([]),
  }),
});

export const ScoutReportSchema = z.discriminatedUnion("workspace_type", [
  CommerceReportSchema,
  ServiceBusinessReportSchema,
]);

export type ScoutReport = z.infer<typeof ScoutReportSchema>;
export type CommerceReport = z.infer<typeof CommerceReportSchema>;
export type ServiceBusinessReport = z.infer<typeof ServiceBusinessReportSchema>;
export type ScoutSource = z.infer<typeof ScoutSourceSchema>;
export type ScoutFact = z.infer<typeof ScoutFactSchema>;
export type RegulatoryNote = z.infer<typeof RegulatoryNoteSchema>;
