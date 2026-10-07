import { z } from "zod";
import { CAMERA_MOVEMENTS, MOVEMENT_INTENSITIES, TRANSITION_STYLES } from "@/lib/media/types";

// Content Bot's structured production plan — the same "array-length caps
// are a structural compactness guarantee, not just prompt guidance"
// discipline as Scout's ScoutReportSchema (see lib/agents/scout/schema.ts).
//
// C1 deliberately produces only the "assembled stills + voiceover" format
// — a `production_path` field distinguishing that from real generated
// motion is C1.5's own addition (see CLAUDE.md's Content Bot milestone),
// not built here.
//
// Creative Quality upgrade (see CLAUDE.md's Content Bot Creative Quality
// milestone): every field below beyond narration/visual_direction/timing
// was added so Content Bot has somewhere structured to put a creative
// decision instead of it being emergent prose inside visual_direction —
// the real, observed cause of a genuinely unpublishable first video
// (a slideshow-like lack of visual variety, garbled on-screen text baked
// into generated images, and no cross-shot character consistency).

export const BEAT_ROLES = [
  "hook",
  "context",
  "rising_action",
  "reveal",
  "escalation",
  "turn",
  "payoff",
  "disclosure",
] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

export const SHOT_TYPES = ["wide", "medium", "close_up", "extreme_close_up"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const ON_SCREEN_TEXT_ROLES = ["emphasis", "label"] as const;

export const OnScreenTextSchema = z.object({
  text: z.string().max(60),
  role: z.enum(ON_SCREEN_TEXT_ROLES),
});
export type BeatOnScreenText = z.infer<typeof OnScreenTextSchema>;

// Real live failure this exists for (Production 4, a genuine reference-
// conditioning run): every shot whose narrative intentionally called for
// the recurring subject to be faint/camouflaged or entirely absent still
// rendered it as solidly and prominently as the reference image — because
// nothing told the generation step this beat was DIFFERENT from an
// ordinary "show the subject clearly" shot. This field is how Content Bot
// declares that intent per beat, structurally, instead of it being
// implicit prose inside visual_direction that generation/QC have to infer.
// Deliberately generic — no creature-specific wording anywhere in this
// codebase reads or sets this; it must work for any recurring subject in
// any future content (a mascot leaving frame, a product being obscured by
// packaging, etc.).
//   - "full": the subject should be clearly visible — ordinary
//     reference-conditioned generation, unchanged from before this field
//     existed. The default, so existing behavior is unchanged.
//   - "faint": the SAME canonical subject is intentionally camouflaged,
//     obscured, or barely visible in this specific shot — identity
//     conditioning is still used (it must still look like the same
//     subject if you can make it out at all), but the generation
//     instruction explicitly prioritizes reduced visibility over the
//     reference's normally-clear presentation.
//   - "absent": the canonical subject intentionally does not appear in
//     this shot at all — no reference image and no identity description
//     are sent for it, so nothing nudges generation toward inserting the
//     subject into what should be a pure environmental/secondary-subject
//     shot.
export const SUBJECT_PROMINENCE_VALUES = ["full", "faint", "absent"] as const;
export type SubjectProminence = (typeof SUBJECT_PROMINENCE_VALUES)[number];

// Motion-first production (see CLAUDE.md's Content Bot motion-first
// milestone): the minimum information required to turn a beat's still
// "start frame" into a real generated Kling v3 Pro video clip, rather than
// a static pan/zoom over that still. Deliberately not a choreography
// system — three short text fields plus a duration, matching the exact
// shape a real Kling image-to-video request needs (a start frame, already
// covered by visual_direction/subject_prominence's existing still-
// generation path, plus a motion description).
//
// ACTION is the field that matters: it must describe what PHYSICALLY
// HAPPENS during the clip, over time — not a static composition (that's
// what visual_direction is for, describing the still start frame). A
// prompt like "Beautiful creature standing in a forest" produces no real
// motion for a video model to animate; "The creature notices a glowing
// object, turns toward it, takes two cautious steps forward and lowers
// its head to inspect it" gives it something to actually generate.
export const ScriptBeatMotionSchema = z.object({
  starting_state: z
    .string()
    .max(300)
    .describe("What the frame looks like at the very start of this clip, before any motion happens."),
  action: z
    .string()
    .max(500)
    .describe(
      "What PHYSICALLY HAPPENS during this clip — action over time, not a static composition. BAD: " +
        "'Beautiful creature standing in a forest.' GOOD: 'The creature notices a glowing object, turns toward " +
        "it, takes two cautious steps forward and lowers its head to inspect it.' This is the field a real video-" +
        "generation model actually animates — do not restate the starting composition here.",
    ),
  ending_state: z.string().max(300).describe("What the frame looks like at the end of this clip, after the action completes."),
  // Kling v3 Pro's own real, documented supported range (verified against
  // fal.ai's live API reference, whole seconds only) — a structural cap
  // matching the real provider constraint, not just prompt guidance, same
  // discipline as camera_movement/transition_in below matching Shotstack's
  // real effect vocabulary.
  clip_duration_seconds: z
    .number()
    .int()
    .min(3)
    .max(15)
    .describe("How many seconds of real generated motion video this beat's clip should be (whole number, 3-15)."),
});
export type ScriptBeatMotion = z.infer<typeof ScriptBeatMotionSchema>;

export const ScriptBeatSchema = ScriptBeatMotionSchema.extend({
  index: z.number().int().min(0),
  // What narrative job this beat does — feeds the escalation/payoff shape
  // the Creative Strategy stage lays out, and gives the founder-visible
  // plan a real structure to inspect rather than an undifferentiated list.
  beat_role: z.enum(BEAT_ROLES),
  narration: z.string().max(800),
  visual_direction: z
    .string()
    .max(600)
    .describe(
      "What the STILL START FRAME for this clip should show — VISUAL CONTENT ONLY. Never describe on-screen " +
        "text, captions, disclaimers, or words appearing in the shot here — use on_screen_text for that instead. " +
        "An image-generation model asked to render text produces garbled, illegible results. This still is then " +
        "used as the real video clip's start image — describe a composition, not the motion (see `action`).",
    ),
  // Defaults to "full" — a plan predating this field (an older persisted
  // version, or a fixture that never set it) reads as "full" wherever
  // this is consumed, so ordinary character-continuity behavior for every
  // existing plan is unchanged.
  subject_prominence: z.enum(SUBJECT_PROMINENCE_VALUES).default("full"),
  shot_type: z.enum(SHOT_TYPES),
  // Constrained to CAMERA_MOVEMENTS/MOVEMENT_INTENSITIES/TRANSITION_STYLES
  // (lib/media/types.ts) — every value maps 1:1 onto a real, verified
  // Shotstack effect/transition (see shotstackEdit.ts's mapping tables).
  // Content Bot can only ever choose from this closed vocabulary, so it
  // can never request a capability the assembly provider doesn't have.
  camera_movement: z.enum(CAMERA_MOVEMENTS),
  movement_intensity: z.enum(MOVEMENT_INTENSITIES),
  transition_in: z.enum(TRANSITION_STYLES),
  // Structured, optional on-screen text for THIS beat (e.g. a short
  // callout or emphasis word) — rendered by the assembly provider as a
  // real text element, never as part of the image prompt. Null when this
  // beat has no on-screen text of its own; disclosure is separate (see
  // ContentPlanSchema.disclosure below) since it applies to the whole
  // piece, not one beat.
  on_screen_text: OnScreenTextSchema.nullable(),
  // Why THIS beat should hold attention — forces Content Bot to reason
  // about retention per-beat rather than only in the aggregate strategy;
  // shown to founders alongside the plan, not just used internally.
  retention_purpose: z.string().max(250),
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

// A general continuity structure (CLAUDE.md's Content Bot Creative Quality
// milestone, "visual continuity — approved with architectural change"):
// deliberately NOT just `character_reference: string`. C1 only ever uses
// `canonical_description` (mechanically concatenated into every relevant
// image-generation prompt by the pipeline — see contentWorkflow.ts's
// runAssetGenerationStage). `reference_asset_id` is reserved, unused space
// for a future hero-reference-image mechanism (generating or selecting one
// canonical image and conditioning subsequent shots against it) — adding it
// now means that future capability is a new provider/pipeline behavior,
// not another ContentPlan schema redesign.
export const VisualIdentitySchema = z.object({
  canonical_description: z
    .string()
    .max(600)
    .describe("A single, reusable, verbatim description of the recurring subject — concatenated into every relevant image prompt."),
  immutable_traits: z
    .array(z.string().max(120))
    .max(8)
    .default([])
    .describe("Specific traits that must never change between shots (e.g. exact coloring, a distinctive marking)."),
  continuity_notes: z.string().max(400).default(""),
  // Real image-to-image conditioning now exists (see
  // runReferenceGenerationStage in contentWorkflow.ts and
  // ImageRequest.referenceImageUrl) — but it does NOT populate this
  // field. Content Bot writes this plan before the reference image is
  // ever generated, so it cannot know a real asset id yet; the pipeline
  // tracks which content_assets row is the reference for a version via
  // its deterministic storage key (storageKeysFor(...).reference), not
  // via this field. Still genuinely unused/reserved — for a possible
  // future multi-reference-image design, not this one.
  reference_asset_id: z.string().nullable().default(null),
});
export type VisualIdentity = z.infer<typeof VisualIdentitySchema>;

export const DISCLOSURE_PLACEMENTS = ["persistent_badge", "end_card", "opening_and_end"] as const;

// Always required — every piece of AI-generated fictional content carries
// one (see CLAUDE.md's safety rules). Rendered structurally by the
// assembly provider (a real title/text clip — see shotstackEdit.ts),
// never left to emerge from an image-generation prompt. Truthful and
// required, but proportionate: `placement` controls how prominently it
// appears, not whether it appears.
export const DisclosureSchema = z.object({
  text: z.string().max(200),
  placement: z.enum(DISCLOSURE_PLACEMENTS),
});
export type Disclosure = z.infer<typeof DisclosureSchema>;

export const ContentPlanSchema = z.object({
  title: z.string().max(100),
  description: z.string().max(4000),
  tags: z.array(z.string().max(40)).max(15).default([]),
  duration_seconds: z.number().int().min(10).max(180),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
  hook: z.string().max(400).describe("The spoken/narrated hook line."),
  // Distinct from `hook` — what appears ON SCREEN in the opening ~1-2
  // seconds, which a real observed failure showed cannot be left implicit
  // (a strong spoken hook paired with a near-empty, low-detail opening
  // frame still reads as a weak hook overall).
  hook_visual: z.string().max(300),
  script: z.array(ScriptBeatSchema).min(1).max(30),
  claims: z.array(ClaimSchema).max(20).default([]),
  thumbnail_brief: z.object({
    prompt: z.string().max(600),
    text_overlay: z.string().max(60).nullable(),
  }),
  voice_direction: z.object({
    pace: z.enum(["slow", "natural", "brisk"]),
  }),
  // Null when the piece has no single recurring subject that needs to look
  // the same across shots (e.g. a pure text/data explainer).
  visual_identity: VisualIdentitySchema.nullable(),
  disclosure: DisclosureSchema,
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

// --- Creative Strategy (Creative Quality milestone) ------------------------
//
// A bounded reasoning pass BEFORE detailed planning — genuine per-piece
// strategy derived from Scout's evidence, the founder brief, and the
// audience/platform/content type, not a hardcoded rule table (see
// CLAUDE.md's Content Bot Creative Quality milestone's opening principle).
// Kept intentionally compact: this is strategy, not another full script —
// every field is a short paragraph, never a list of beats.

export const CreativeStrategySchema = z.object({
  hook_mechanic: z.string().max(300).describe("The specific psychological/narrative device the hook uses, stated plainly (the 'why it fits' reasoning belongs in retention_strategy, not here)."),
  visual_hook: z.string().max(300).describe("What should be on screen in the first 1-2 seconds, concretely."),
  pacing: z.object({
    target_cut_count: z.number().int().min(1).max(30).describe("Roughly how many distinct visual beats/cuts this piece should have."),
    rationale: z.string().max(300),
  }),
  escalation_shape: z.string().max(400).describe("The rising/turn/payoff shape of the piece, beat-role-level, not scripted."),
  visual_treatment: z.string().max(400).describe("The visual style/consistency approach, including how the subject stays recognizable across shots."),
  caption_treatment: z.string().max(300),
  disclosure_treatment: z.string().max(300).describe("How disclosure should be presented proportionately without dominating the piece."),
  retention_strategy: z.string().max(400).describe("Concretely how this piece is expected to hold attention, tied to real evidence where relevant."),
  // Ties the strategy's reasoning back to real, checkable Scout evidence —
  // never fabricated performance claims; an empty array is legitimate when
  // the strategy isn't grounded in a specific evidence point.
  evidence_ids_referenced: z.array(z.string()).max(10).default([]),
});
export type CreativeStrategy = z.infer<typeof CreativeStrategySchema>;

// --- Visual QC (Creative Quality milestone) --------------------------------
//
// Mandatory, bounded, multimodal check of the actually-generated stills
// before assembly (see CLAUDE.md's Content Bot Creative Quality milestone,
// "Visual QC"). Deliberately NOT a subjective 1-10 quality score anywhere
// in this schema — only objective, checkable pass/flag categories with a
// real reason, per the founder's explicit instruction that this must not
// judge artistic taste.
//
// `findings` holds ONLY assets with a real, actionable problem — a real
// live failure proved why: the original schema required "exactly one
// finding per image shown" (i.e. a full pass/fail entry for every asset,
// including the ones that were fine), which made the array's length
// structurally equal to the asset count. A 13-beat plan (well within
// ContentPlanSchema's own 30-beat cap) plus a thumbnail is 14 real assets
// — already past this schema's own `.max(12)`, guaranteed to fail
// regardless of whether anything was actually wrong. This is the same
// prompt/schema misalignment class as Creative Strategy's character-limit
// failure, just an array instead of a string: a hard cap that didn't
// scale with a real, variable input size the prompt itself demanded one
// entry per item of. The fix is structural, not a bigger number: an asset
// with nothing wrong needs no entry at all, so a normal run (most assets
// fine) naturally stays well under 12; the prompt (visualQC.ts) also now
// explicitly requires prioritizing the most material problems and
// consolidating repeated ones instead of enumerating every affected asset
// separately, for the rare case genuine problems still exceed the cap.
export const VISUAL_QC_ISSUE_TYPES = [
  "subject_mismatch",
  "continuity_break",
  "composition_failure",
  "garbled_or_unintended_text",
  "watermark_or_logo",
  "unsafe_or_off_brief",
] as const;
export type VisualQCIssueType = (typeof VISUAL_QC_ISSUE_TYPES)[number];

export const VisualQCFindingSchema = z.object({
  // A stable identifier the caller assigns per asset (e.g. "thumbnail" or
  // "beat_3") — matched back up in code, never re-derived from prose.
  asset_ref: z.string().max(80),
  // At least one real category is required — an entry only exists because
  // something is actually wrong; there is no "pass" verdict to encode here
  // any more (see this section's own doc comment above).
  issue_types: z.array(z.enum(VISUAL_QC_ISSUE_TYPES)).min(1).max(6),
  reasons: z.array(z.string().max(300)).max(5).default([]),
});
export type VisualQCFinding = z.infer<typeof VisualQCFindingSchema>;

export const VisualQCReportSchema = z.object({
  overall_verdict: z.enum(["pass", "flag"]),
  // Empty exactly when every asset checked out fine; a non-empty array is
  // always the FULL set of assets that need attention (never mixed with
  // "pass" entries — see this section's own doc comment above).
  findings: z.array(VisualQCFindingSchema).max(12),
});
export type VisualQCReport = z.infer<typeof VisualQCReportSchema>;
