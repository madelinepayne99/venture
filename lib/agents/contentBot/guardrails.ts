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
  const doNotImitate = brief.scout.production_recommendation.do_not_imitate.filter((name) => name.trim());

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

/**
 * Checked after real assets exist — this is what stops a provider
 * returning garbage (or the assembly step silently producing something
 * broken) from being presented as a finished piece. Duration tolerance is
 * generous (15s) since real generation/assembly timing is never exact.
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
