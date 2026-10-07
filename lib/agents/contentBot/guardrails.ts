import type { ContentPlan } from "./schema";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import type { AudienceContext } from "@/lib/media/types";
import type { ContentAsset } from "@/lib/db/types";

/**
 * Deterministic, code-level checks — layer 2 of the three-layer safety
 * architecture (prompt, code, model judge — see safetyReview.ts for layer
 * 3). This is what actually blocks; the prompt already asks for the same
 * things, but model output isn't fully controllable (same "defense in
 * depth, don't remove either layer" reasoning as Scout's own
 * guardrails.ts).
 */
export class ContentGuardrailError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentGuardrailError";
  }
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
}

const IMITATION_PATTERNS: RegExp[] = [
  /\bin the style of\b/i,
  /\brecreat(e|ing|ion)\b/i,
  /\bparody of\b/i,
  /\bremake of\b/i,
  /\bbased on the (movie|show|character|song|video)\b/i,
];

/**
 * Hard reject on any plan text that reproduces a named work Scout flagged
 * as do-not-imitate, or that uses language signaling deliberate imitation
 * of a specific existing work — recursively walks every string in the
 * plan (same generic-walk pattern as Scout's findGuaranteeLanguage), not
 * a maintained list of field names.
 */
export function assertNoNamedIP(plan: ContentPlan, brief: ProductionBrief): void {
  const strings: string[] = [];
  collectStrings(plan, strings);
  // Two mutually exclusive sources for this list — see contentHandoff.ts's
  // ProductionBrief doc comment. A founder-commissioned brief has its own
  // (possibly empty) do_not_imitate list rather than Scout's, since Scout
  // never supplied a recommendation to read one from.
  const rawDoNotImitate =
    brief.source === "founder_commissioned"
      ? (brief.founder_commission?.do_not_imitate ?? [])
      : (brief.scout.production_recommendation?.do_not_imitate ?? []);
  const doNotImitate = rawDoNotImitate.filter((name) => name.trim());

  for (const text of strings) {
    for (const named of doNotImitate) {
      if (text.toLowerCase().includes(named.toLowerCase())) {
        throw new ContentGuardrailError(
          "named_ip",
          `Content plan references a named work Scout flagged as do-not-imitate: "${named}".`,
        );
      }
    }
    for (const pattern of IMITATION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        throw new ContentGuardrailError(
          "imitation_language",
          `Content plan used imitation language ("${match[0]}") — Content Bot must produce an original execution, never a reproduction.`,
        );
      }
    }
  }
}

const KIDS_BANNED_PATTERNS: RegExp[] = [
  /\bperil\b/i,
  /\bscary\b/i,
  /\bfrighten/i,
  /\binjur(y|ed|ies)\b/i,
  /\bromance\b/i,
  /\bromantic\b/i,
  /\bbuy now\b/i,
  /\blimited time\b/i,
  /\bsubscribe\b/i,
  /\bfollow us\b/i,
  /\bcomment below\b/i,
  /\blike and subscribe\b/i,
];

const TEEN_BANNED_PATTERNS: RegExp[] = [/\bgraphic\b/i, /\bexplicit\b/i];

/**
 * Per-audience banned-topic check. For a "kids" audience this is paired
 * with `assertKidsPositiveMarkers` below — banned language alone isn't
 * enough; a kids piece must also carry its own explicit markers (see that
 * function for why).
 */
export function assertAudienceAppropriate(plan: ContentPlan, ctx: AudienceContext): void {
  const patterns = ctx.audience === "kids" ? KIDS_BANNED_PATTERNS : ctx.audience === "teen" ? TEEN_BANNED_PATTERNS : [];
  if (patterns.length === 0) return;

  const strings: string[] = [];
  collectStrings(plan, strings);
  for (const text of strings) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        throw new ContentGuardrailError(
          "audience_inappropriate",
          `Content plan contains language not appropriate for a "${ctx.audience}" audience: "${match[0]}".`,
        );
      }
    }
  }
}

/**
 * Every claim in the plan must cite a real, founder-selected, VERIFIED
 * fact from the frozen production brief — never an invented citation, and
 * never a claim citing evidence that was in the mission's research but
 * the founder didn't select for this brief.
 */
export function assertClaimsAreEvidenced(plan: ContentPlan, brief: ProductionBrief): void {
  const verifiedIds = new Set(brief.evidence.filter((e) => e.is_verified_fact).map((e) => e.id));
  for (const claim of plan.claims) {
    if (!verifiedIds.has(claim.evidence_id)) {
      throw new ContentGuardrailError(
        "unevidenced_claim",
        `Claim "${claim.text}" cites evidence_id "${claim.evidence_id}", which is not a verified fact in this mission's frozen production brief.`,
      );
    }
  }
}

// Rough, order-of-magnitude spoken-word rates per pace setting — not exact
// (real speech rate varies by speaker, sentence structure, and pauses),
// deliberately calibrated to catch a GROSS mismatch (e.g. narration that
// would take twice as long to speak as the plan claims), not to validate
// precise timing. A real live failure motivated this: a plan targeting 30
// seconds carried narration that only fits in ~55-65 seconds at a natural
// pace, and nothing checked that before the pipeline spent real money on
// voiceover + 14 stills.
//
// All three tiers are set to the SAME value, deliberately — not an
// oversight. A second real production (Production 3: "brisk", 115 words,
// 32s target) exposed why the original differentiated table (slow 2.0 /
// natural 2.5 / brisk 3.0) was never actually grounded in anything: the
// real ElevenLabs integration only ever mapped `pace` to the `stability`
// voice setting, which ElevenLabs' own docs confirm does not affect
// speaking rate at all — so every real narration, regardless of stated
// pace, was spoken at the same real, unrequested rate. Production 3's own
// real measured rate was 115 words / 47.2s ≈ 2.44 words/sec. Now that
// `elevenLabsVoice.ts` (see PACE_TO_SPEED there) actually sends a real
// `speed` value per pace, slow/brisk SHOULD end up faster/slower than
// natural in reality — but until a real calibration run measures that
// (see this codebase's own report — one bounded probe call, not done
// yet), there is no real data to justify any particular slow/brisk
// number, and guessing one would repeat the exact mistake this comment is
// describing. Using the one real, measured rate for all three tiers is
// deliberately conservative and honest about what is and isn't verified;
// update this table for real once a calibration run's actual results are
// in (see PACE_TO_SPEED's own comment for the exact planned test).
// --- Shared narration/duration math — the ONE authoritative source ---
//
// Exported so planning guidance (prompt.ts's buildContentPlanSystemPrompt)
// and correction guidance (prompt.ts's buildGuardrailCorrectionUserPrompt)
// compute from these exact same functions/constants rather than
// duplicating the arithmetic — a real live failure (a "YouTube kids"
// episode's auto-correction attempt making its narration SHORTER when it
// needed to be much longer) traced back to the correction prompt giving
// Content Bot no actual numbers to work from, just a free-text rejection
// reason; giving both the planner and the corrector the same real
// computed target range, from the same source the guardrail itself
// checks against, is what closes that gap without ever letting the three
// silently disagree.
export const MEASURED_WORDS_PER_SECOND = 2.44;
const WORDS_PER_SECOND_BY_PACE: Record<ContentPlan["voice_direction"]["pace"], number> = {
  slow: MEASURED_WORDS_PER_SECOND,
  natural: MEASURED_WORDS_PER_SECOND,
  brisk: MEASURED_WORDS_PER_SECOND,
};

// A relative tolerance, not a fixed number of seconds — the same absolute
// slack that's reasonable for a 15s short is far too tight for a 3-minute
// long-form video, and a fixed number would effectively hardcode one
// platform's typical duration into the guardrail. 35% catches a genuine,
// material mismatch (like the real 30s-vs-~60s case this exists for)
// while leaving real headroom for natural pacing/pause variation; the
// floor keeps very short targets (e.g. 10s) from getting an unreasonably
// tight window.
const DURATION_RELATIVE_TOLERANCE = 0.35;
const DURATION_MIN_TOLERANCE_SECONDS = 5;

export function narrationWordsPerSecond(pace: ContentPlan["voice_direction"]["pace"]): number {
  return WORDS_PER_SECOND_BY_PACE[pace];
}

export function narrationDurationToleranceSeconds(durationSeconds: number): number {
  return Math.max(durationSeconds * DURATION_RELATIVE_TOLERANCE, DURATION_MIN_TOLERANCE_SECONDS);
}

export function countNarrationWords(plan: Pick<ContentPlan, "script">): number {
  return plan.script.reduce((sum, beat) => sum + beat.narration.trim().split(/\s+/).filter(Boolean).length, 0);
}

export function estimatedNarrationSeconds(wordCount: number, pace: ContentPlan["voice_direction"]["pace"]): number {
  return wordCount / narrationWordsPerSecond(pace);
}

/**
 * The acceptable narration word-count range for a given duration/pace —
 * literally the inverse of assertNarrationFitsDuration's own tolerance
 * check (same rate, same tolerance), so planning guidance, correction
 * guidance, and the real guardrail below can never silently disagree
 * about what "fits" means.
 */
export function acceptableNarrationWordRange(
  durationSeconds: number,
  pace: ContentPlan["voice_direction"]["pace"],
): { min: number; max: number; target: number } {
  const rate = narrationWordsPerSecond(pace);
  const tolerance = narrationDurationToleranceSeconds(durationSeconds);
  const minSeconds = Math.max(durationSeconds - tolerance, 0);
  const maxSeconds = durationSeconds + tolerance;
  return {
    min: Math.ceil(minSeconds * rate),
    max: Math.floor(maxSeconds * rate),
    target: Math.round(durationSeconds * rate),
  };
}

/**
 * Checked immediately after a plan is produced — BEFORE any real
 * asset-generation spend (voiceover, stills, edit) — so a narration that
 * cannot actually be spoken within the plan's own stated `duration_seconds`
 * is caught while the only cost at risk is the planning call itself, not
 * after real ElevenLabs/fal.ai/Shotstack spend. This is a genuine gap a
 * real live production exposed: `duration_seconds` already existed as a
 * real schema field and Content Bot set it correctly (30), but nothing
 * connected it to how long the narration it also wrote would actually take
 * to speak — the two were free to disagree completely. Runs through the
 * SAME one-bounded-automatic-correction path as every other guardrail
 * rejection here (see runProductionPlanningStage) — never a new retry
 * mechanism. Unchanged in behavior by the refactor above — same numbers,
 * same message, now computed from the shared functions instead of inline
 * arithmetic.
 */
export function assertNarrationFitsDuration(plan: ContentPlan): void {
  const totalWords = countNarrationWords(plan);
  const pace = plan.voice_direction.pace;
  const wordsPerSecond = narrationWordsPerSecond(pace);
  const estimatedSeconds = estimatedNarrationSeconds(totalWords, pace);
  const tolerance = narrationDurationToleranceSeconds(plan.duration_seconds);
  const diff = Math.abs(estimatedSeconds - plan.duration_seconds);
  if (diff > tolerance) {
    throw new ContentGuardrailError(
      "narration_duration_mismatch",
      `This plan's narration (${totalWords} words, ~${wordsPerSecond} words/sec at "${pace}" pace) ` +
        `would take roughly ${estimatedSeconds.toFixed(1)}s to speak, which diverges from the plan's own ` +
        `${plan.duration_seconds}s target by more than the allowed tolerance (±${tolerance.toFixed(1)}s). ` +
        `The narration must be rewritten to actually fit the stated duration, not just labeled with it.`,
    );
  }
}

/**
 * Checked after real assets exist — this is what stops a provider
 * returning garbage (or the assembly step silently producing something
 * broken) from being presented as a finished piece. Duration tolerance is
 * generous (15s) since real generation/assembly timing is never exact.
 * This is a SEPARATE, later check from assertNarrationFitsDuration above:
 * that one catches a bad plan before any spend; this one catches the
 * (rare, once the above holds) case where the real rendered video still
 * drifted from the plan's target despite the plan itself being reasonable.
 */
const DURATION_TOLERANCE_SECONDS = 15;

export function assertAssetsMatchPlan(assets: ContentAsset[], plan: ContentPlan): void {
  const video = assets.find((a) => a.kind === "video");
  if (!video) {
    throw new ContentGuardrailError("missing_video", "No video asset was produced for this version.");
  }
  if (!video.byte_size || video.byte_size <= 0) {
    throw new ContentGuardrailError("empty_asset", "The video asset has zero real bytes.");
  }
  if (video.duration_seconds != null) {
    const diff = Math.abs(video.duration_seconds - plan.duration_seconds);
    if (diff > DURATION_TOLERANCE_SECONDS) {
      throw new ContentGuardrailError(
        "duration_mismatch",
        `The rendered video's duration (${video.duration_seconds}s) diverges from the plan's target (${plan.duration_seconds}s) by more than ${DURATION_TOLERANCE_SECONDS}s.`,
      );
    }
  }

  const thumbnail = assets.find((a) => a.kind === "thumbnail");
  if (thumbnail && (!thumbnail.width || !thumbnail.height)) {
    throw new ContentGuardrailError("invalid_thumbnail", "The thumbnail asset has no real dimensions.");
  }

  const captions = assets.find((a) => a.kind === "caption_track");
  if (captions && (!captions.byte_size || captions.byte_size <= 0)) {
    throw new ContentGuardrailError("empty_captions", "The caption track asset has zero real bytes.");
  }
}
