import { z } from "zod";

// Content Bot's structured production plan — the same "array-length caps
// are a structural compactness guarantee, not just prompt guidance"
// discipline as Scout's ScoutReportSchema (see lib/agents/scout/schema.ts).
//
// C1 deliberately produces only the "assembled stills + voiceover" format
// — a `production_path` field distinguishing that from real generated
// motion is C1.5's own addition (see CLAUDE.md's Content Bot milestone),
// not built here.
export const ScriptBeatSchema = z.object({
  index: z.number().int().min(0),
  narration: z.string().max(800),
  visual_direction: z.string().max(600).describe("What the still image for this beat should show."),
  start_seconds: z.number().min(0),
  end_seconds: z.number().min(0),
});

export const ClaimSchema = z.object({
  text: z.string().max(400),
  // Must resolve to a real evidence row (is_verified_fact: true) in the
  // frozen ProductionBrief — enforced in code (guardrails.ts's
  // assertClaimsAreEvidenced), not left as prompt guidance alone.
  evidence_id: z.string(),
});

export const ContentPlanSchema = z.object({
  title: z.string().max(100),
  description: z.string().max(4000),
  tags: z.array(z.string().max(40)).max(15).default([]),
  duration_seconds: z.number().int().min(10).max(180),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
  hook: z.string().max(400),
  script: z.array(ScriptBeatSchema).min(1).max(30),
  claims: z.array(ClaimSchema).max(20).default([]),
  thumbnail_brief: z.object({
    prompt: z.string().max(600),
    text_overlay: z.string().max(60).nullable(),
  }),
  voice_direction: z.object({
    pace: z.enum(["slow", "natural", "brisk"]),
  }),
  originality_statement: z
    .string()
    .max(600)
    .describe("A statement confirming this is an original execution, not a reproduction of any specific existing work."),
});

export type ScriptBeat = z.infer<typeof ScriptBeatSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ContentPlan = z.infer<typeof ContentPlanSchema>;

export const SafetyVerdictSchema = z.object({
  verdict: z.enum(["pass", "block"]),
  reasons: z.array(z.string().max(400)).max(10).default([]),
  concerns: z.array(z.string().max(400)).max(10).default([]),
});

export type SafetyVerdict = z.infer<typeof SafetyVerdictSchema>;
