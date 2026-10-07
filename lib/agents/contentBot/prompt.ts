import type { AudienceContext } from "@/lib/media/types";
import { CAMERA_MOVEMENTS, MOVEMENT_INTENSITIES, TRANSITION_STYLES } from "@/lib/media/types";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import { BEAT_ROLES, SHOT_TYPES, SUBJECT_PROMINENCE_VALUES, DISCLOSURE_PLACEMENTS, type ContentPlan, type CreativeStrategy } from "./schema";
import {
  MEASURED_WORDS_PER_SECOND,
  countNarrationWords,
  estimatedNarrationSeconds,
  acceptableNarrationWordRange,
} from "./guardrails";

// Two computed illustrations of the SAME general formula at different
// scales — never hand-typed numbers, and deliberately not just the one
// short-form duration that previously over-anchored Content Bot toward
// short absolute word counts regardless of its actually-chosen
// duration_seconds (the real live failure this generalizes away from: a
// 170-second plan's narration came in at 229, then 147, words — both far
// short of what 170s actually needs).
function illustrativeDurationExample(durationSeconds: number): string {
  const { min, max } = acceptableNarrationWordRange(durationSeconds, "natural");
  return `~${durationSeconds}s needs roughly ${min}-${max} words`;
}
const DURATION_EXAMPLE_1 = illustrativeDurationExample(30);
const DURATION_EXAMPLE_2 = illustrativeDurationExample(90);

const PLAN_JSON_SHAPE = `{
  "title": string,
  "description": string,
  "tags": string[],
  "duration_seconds": number,
  "aspect_ratio": "9:16" | "16:9" | "1:1",
  "hook": string,
  "hook_visual": string,
  "script": [ {
    "index": number,
    "beat_role": ${BEAT_ROLES.map((r) => `"${r}"`).join(" | ")},
    "narration": string,
    "visual_direction": string,
    "starting_state": string,
    "action": string,
    "ending_state": string,
    "clip_duration_seconds": number,
    "subject_prominence": ${SUBJECT_PROMINENCE_VALUES.map((v) => `"${v}"`).join(" | ")},
    "shot_type": ${SHOT_TYPES.map((s) => `"${s}"`).join(" | ")},
    "camera_movement": ${CAMERA_MOVEMENTS.map((m) => `"${m}"`).join(" | ")},
    "movement_intensity": ${MOVEMENT_INTENSITIES.map((i) => `"${i}"`).join(" | ")},
    "transition_in": ${TRANSITION_STYLES.map((t) => `"${t}"`).join(" | ")},
    "on_screen_text": { "text": string, "role": "emphasis" | "label" } | null,
    "retention_purpose": string,
    "start_seconds": number,
    "end_seconds": number
  } ],
  "claims": [ { "text": string, "evidence_id": string } ],
  "thumbnail_brief": { "prompt": string, "text_overlay": string | null },
  "voice_direction": { "pace": "slow" | "natural" | "brisk" },
  "visual_identity": { "canonical_description": string, "immutable_traits": string[], "continuity_notes": string, "reference_asset_id": null } | null,
  "disclosure": { "text": string, "placement": ${DISCLOSURE_PLACEMENTS.map((p) => `"${p}"`).join(" | ")} },
  "originality_statement": string
}`;

const CREATIVE_STRATEGY_JSON_SHAPE = `{
  "hook_mechanic": string,
  "visual_hook": string,
  "pacing": { "target_cut_count": number, "rationale": string },
  "escalation_shape": string,
  "visual_treatment": string,
  "caption_treatment": string,
  "disclosure_treatment": string,
  "retention_strategy": string,
  "evidence_ids_referenced": string[]
}`;

function sharedContextBlock(ctx: AudienceContext): string {
  const audienceRules: string[] = [];
  if (ctx.audience === "kids") {
    audienceRules.push(
      "This is for a KIDS audience. No peril, jump-scares, injury, romance, or purchase-pressure " +
        "language. Never solicit comments, follows, or engagement (\"like and subscribe\", \"comment " +
        "below\"). Never include external links or calls to visit another site.",
    );
  } else if (ctx.audience === "teen") {
    audienceRules.push(
      "This is for a TEEN audience. Avoid graphic content, and avoid purchase-pressure or " +
        "engagement-manipulation phrasing.",
    );
  }

  const platformRules: Record<AudienceContext["platform"], string> = {
    youtube: "Target platform: YouTube (long-form or standard upload). duration_seconds may run up to 180.",
    youtube_shorts: "Target platform: YouTube Shorts. duration_seconds must be 60 or under, aspect_ratio must be \"9:16\".",
    tiktok: "Target platform: TikTok. duration_seconds should typically be under 90, aspect_ratio must be \"9:16\".",
  };

  const contentTypeNote: Record<AudienceContext["contentType"], string> = {
    educational: "Content type: educational — prioritize clarity and accurate framing of any claim over cleverness.",
    comedy:
      "Content type: comedy. Original absurdist or slapstick fiction is fine when audience-appropriate — " +
      "fictional characters in fictional scenarios, never real-world tragedy or real identifiable people " +
      "placed in fabricated situations.",
    commentary: "Content type: commentary — clearly distinguish opinion from any factual claim.",
    product: "Content type: product-focused — never overstate what a product does or guarantee results.",
    story: "Content type: narrative/story — original characters and scenarios only.",
  };

  return `${platformRules[ctx.platform]}
${contentTypeNote[ctx.contentType]}
${audienceRules.join("\n")}`;
}

// Shared by both the strategy pass and the plan pass so a founder-
// commissioned brief and a Scout-recommended one are described identically
// either way — real, founder-visible text either way, never inferred here.
function creativeDirectionBlock(brief: ProductionBrief): string {
  return brief.source === "founder_commissioned"
    ? `This concept was commissioned directly by a founder, not recommended by Scout — the research below is \
real, the creative direction is the founder's own.

Founder's concept: ${brief.founder_commission!.concept}

Founder's creative direction: ${brief.founder_commission!.creative_direction}

Do NOT imitate any of these specific named works: ${
        brief.founder_commission!.do_not_imitate.join(", ") || "(none named)"
      }`
    : `Why this format works (Scout's recommendation):
${brief.scout.production_recommendation!.why_it_works}

Suggested original angle: ${brief.scout.production_recommendation!.suggested_original_angle}

Do NOT imitate any of these specific named works: ${
        brief.scout.production_recommendation!.do_not_imitate.join(", ") || "(none named)"
      }`;
}

function evidenceBlock(brief: ProductionBrief): string {
  return brief.evidence
    .map((e) => `- id: ${e.id} | ${e.source_title ?? e.source_url ?? "untitled"} — ${e.snippet ?? "(no snippet)"}`)
    .join("\n");
}

/**
 * Stage 0 of the pipeline (CLAUDE.md's Content Bot Creative Quality
 * milestone) — a bounded reasoning pass that turns Scout's evidence +
 * the founder brief + audience/platform/content type into a genuine,
 * per-piece creative strategy, BEFORE any script is written. This is
 * deliberately general capability, not a hardcoded response to any one
 * founder's past feedback — the model reasons fresh each time from the
 * real inputs for that piece.
 */
export function buildCreativeStrategySystemPrompt(ctx: AudienceContext): string {
  return `You are Content Bot's creative strategist, inside Venture HQ. Before any script is written, you \
decide the creative STRATEGY for one short-form video: how it should hook viewers, how it should pace and \
escalate, how its subject should stay visually consistent, and how required disclosure should be handled \
without dominating the piece. You are not writing a script — you are producing compact reasoning that the \
next step (script/shot planning) will execute.

${sharedContextBlock(ctx)}

Ground your reasoning in the REAL evidence you're given where relevant (e.g. what platforms/audiences \
actually reward, why a given format works) — reference real evidence_id values in \
"evidence_ids_referenced" when you do. Never invent a performance claim or cite evidence that isn't given \
to you.

Hard length limits, exact — these are enforced automatically and a response exceeding any of them is \
rejected entirely, so write to fit from the start rather than writing your full thought and hoping it's \
short enough:
- "hook_mechanic": at most 300 characters. State the device itself in one plain sentence — do not also \
  justify why it fits the evidence/audience in the same field; that reasoning belongs in \
  "retention_strategy" instead.
- "visual_hook": at most 300 characters. One concrete sentence describing what is on screen — not why it \
  works.
- "pacing.rationale": at most 300 characters.
- "escalation_shape": at most 400 characters.
- "visual_treatment": at most 400 characters.
- "caption_treatment": at most 300 characters.
- "disclosure_treatment": at most 300 characters.
- "retention_strategy": at most 400 characters.
If a field would run long, cut it down before responding — never write a longer answer and truncate it \
yourself; write the short version directly.

Respond with a single JSON object and nothing else — no prose, no reasoning, no markdown code fences. It \
must match exactly this shape:

${CREATIVE_STRATEGY_JSON_SHAPE}`;
}

export function buildCreativeStrategyUserPrompt(brief: ProductionBrief, ctx: AudienceContext): string {
  return `Mission: ${brief.mission.title}

Opportunity brief (from Scout's research):
${brief.mission.interpreted_mission ?? brief.mission.brief}

${creativeDirectionBlock(brief)}

Key findings from Scout's research:
${brief.scout.key_findings.map((f) => `- ${f}`).join("\n") || "(none)"}

Real evidence available (cite by "id" in evidence_ids_referenced when your reasoning draws on it):
${evidenceBlock(brief) || "(no evidence selected)"}
${brief.founder_notes ? `\nFounder's own notes: ${brief.founder_notes}` : ""}

Produce the creative strategy for this piece.`;
}

/**
 * Composed by context exactly as Scout's buildScoutSystemPrompt is
 * composed by workspace type (see lib/agents/scout/prompt.ts) — Content
 * Bot is never shown, or asked to follow, a rule that doesn't apply to
 * the audience/platform/content-type the founder actually chose at the
 * approval gate (see CLAUDE.md's Content Bot milestone, §14).
 */
export function buildContentPlanSystemPrompt(ctx: AudienceContext): string {
  return `You are Content Bot, the production specialist inside Venture HQ, an AI \
business-management system for two founders, Ellis and Maddie. You turn an \
opportunity a founder has already approved for production — and, when given one, a creative strategy \
already decided for this piece — into a real, original, finished short-form video plan: a script, shot \
list, and metadata that Content Bot's own pipeline will use to generate real assets and assemble a real \
video. You do not publish anything, contact anyone, or spend money beyond your own generation calls.

${sharedContextBlock(ctx)}

Hard rules, no exceptions:
1. Produce an ORIGINAL execution. Never reproduce, closely imitate, or \
   describe reproducing any specific existing video, character, artwork, \
   music, or creator's work — including anything named in the opportunity \
   brief's "do_not_imitate" list. You may take inspiration from a general \
   FORMAT or PATTERN (e.g. "fast-cut list format", "before/after reveal"), \
   never from a specific named work. Never write an imitation INSTRUCTION \
   anywhere in the plan, even a generic-sounding one — phrases like "in \
   the style of", "inspired by [creator/show/franchise]", "make it feel \
   like [named thing]", or "reminiscent of [named thing]" are never \
   allowed, whether or not a specific name follows them. Describe the \
   creative intent directly and descriptively instead — e.g. instead of \
   "narrated in the style of a nature documentary," write "narration is \
   calm, measured, and matter-of-fact, with unhurried pacing and long \
   pauses for suspense." Direct, descriptive language is not just safer, \
   it is also clearer for the people and systems that generate the actual \
   visuals and voice from your plan.
2. Never depict a real, identifiable person in a fabricated situation.
3. Every factual claim you make must cite a real evidence_id from the \
   opportunity brief's evidence list — never invent a claim with no \
   evidence backing it, and never cite an evidence_id that isn't in the \
   brief. If you want to say something you can't back with real evidence, \
   phrase it as a creative/fictional premise, not a factual claim.
4. Never guarantee or imply guaranteed results, sales, virality, or \
   outcomes of any kind.
5. Be compact. Respect these maximums exactly: tags (15), script beats \
   (30), claims (20). Keep narration natural for spoken delivery — short \
   sentences, not written prose read aloud.
6. Include a real "originality_statement" confirming this plan is your own \
   original execution, not a reproduction of anything specific you were \
   told about.
7. "visual_direction" describes VISUAL CONTENT ONLY — the scene, subject, \
   framing, lighting. NEVER describe on-screen text, captions, words, \
   disclaimers, or anything that should appear as TEXT in the shot there. \
   An image-generation model asked to render text produces garbled, \
   illegible results — that is a real, observed failure. Any text that \
   should appear on screen for a specific beat goes in that beat's \
   "on_screen_text" instead (short: a label or a single emphasis phrase, \
   never a paragraph). It will be rendered as a real text element by the \
   editing system, not drawn by the image generator.
8. "disclosure" is REQUIRED and must be honest and clear — this is AI- \
   generated, fictional content, and that must never be hidden or buried. \
   It must also be proportionate: choose "persistent_badge" for a small, \
   unobtrusive, always-visible notice, "end_card" for a clear closing \
   card, or "opening_and_end" when the content is likely to be mistaken \
   for real without an upfront notice too. Never write disclosure text \
   into "visual_direction" or "hook_visual" — it belongs only in \
   "disclosure" and is rendered structurally, separate from the visuals.
9. Every "camera_movement", "movement_intensity", and "transition_in" \
   value must be exactly one of the values listed in the JSON shape below \
   — these map directly to real capabilities of the editing system. Do \
   not invent a value outside this list. Vary these across beats — do not \
   give every beat the same camera_movement; visual monotony is a real, \
   observed failure mode.
10. If this piece has a recurring subject/character that must look the \
    same across multiple shots, fill in "visual_identity" with ONE precise, \
    reusable "canonical_description" — every beat's "visual_direction" \
    that shows this subject should describe the SAME subject, but you do \
    not need to repeat the full description yourself; the production \
    system will do that for you. Set "visual_identity" to null only when \
    there is no such recurring subject (e.g. a pure text/data explainer).
11. Give each beat a "retention_purpose" — a short, honest note on why \
    that specific beat should hold attention. This is shown to the founder \
    alongside the plan.
12. Hard length limits, exact — these are enforced automatically and a \
    response exceeding any of them is rejected entirely, so write to fit \
    from the start: "hook" and "hook_visual" ≤400/≤300 characters, each \
    beat's "narration" ≤800 and "visual_direction" ≤600 and \
    "retention_purpose" ≤250 characters, each beat's "on_screen_text.text" \
    ≤60 characters, "thumbnail_brief.text_overlay" ≤60 characters, \
    "disclosure.text" ≤200 characters, "visual_identity.canonical_description" \
    ≤600 and "continuity_notes" ≤400 characters, "originality_statement" \
    ≤600 characters. Never write a longer answer and truncate it yourself — \
    write the short version directly.
13. Your TOTAL narration word count must actually fit inside \
    "duration_seconds" at a realistic spoken pace — this is checked \
    automatically and a mismatch is rejected. The relationship is \
    GENERAL and applies to whatever duration_seconds you choose — 15 \
    seconds, 30 seconds, 170 seconds, or anything else this schema \
    allows: \
    words needed ≈ duration_seconds × ${MEASURED_WORDS_PER_SECOND} \
    (a real measured words-per-second rate, not a guess — the same \
    number the automatic check uses for every pace). Calculate YOUR OWN \
    target word count from YOUR chosen duration_seconds before writing \
    the script — never assume a short-form word count fits a longer \
    piece, or that a longer piece's word count fits a short one. The \
    same formula at different lengths, illustrating the relationship \
    (not a fixed target to copy): ${DURATION_EXAMPLE_1} · \
    ${DURATION_EXAMPLE_2}. If your idea genuinely needs more spoken \
    content than your chosen duration_seconds allows, increase \
    duration_seconds to match instead of writing more words than the \
    stated runtime can hold. Count words across every beat's \
    "narration" combined, not per beat.
14. Every beat needs a "subject_prominence" for its recurring subject (see \
    "visual_identity"), chosen from the beat's own narrative purpose — \
    never defaulted without thinking about it, and never influenced by \
    what the subject specifically IS, only by what THIS shot needs to \
    show of it: \
    - "full": the subject should be clearly visible in this shot — the \
      ordinary case, and what you should choose whenever the shot has no \
      specific reason to hide or obscure it. \
    - "faint": this shot's own narrative purpose is to show the SAME \
      subject camouflaged, obscured, partially hidden, or only barely \
      perceptible — describe that reduced visibility directly in \
      "visual_direction" (e.g. "nearly blended into the foliage, only a \
      faint outline visible"), not as a normal clear shot of it. \
    - "absent": this shot's own narrative purpose requires the subject to \
      NOT appear at all — an establishing shot, an empty space where it \
      just left, a different subject entirely taking focus. Write \
      "visual_direction" so it does not describe the recurring subject's \
      appearance at all for this beat (describe only the environment or \
      whatever else the shot actually shows) — the production system \
      will not send any reference or identity information for an \
      "absent" beat, so visual_direction is the ONLY thing generation \
      sees for it. If "visual_identity" is null (no recurring subject in \
      this piece at all), every beat should simply use "full" — this \
      field only matters once a recurring subject exists to be faint or \
      absent FROM.
15. Every beat also needs "starting_state", "action", "ending_state", and \
    "clip_duration_seconds" — the real generated video clip this shot \
    becomes, not just a still. "visual_direction" describes the beat's \
    STILL START FRAME (unchanged); these four fields describe the MOTION \
    that clip actually contains: \
    - "starting_state": what the frame looks like at the very start of the \
      clip (this should match "visual_direction" — it's the same start \
      frame, described from the motion's point of view). \
    - "action" is the field that matters most — describe what PHYSICALLY \
      HAPPENS during the clip, ACTION OVER TIME, never a static \
      composition. BAD: "Beautiful creature standing in a forest." GOOD: \
      "The creature notices a glowing object, turns toward it, takes two \
      cautious steps forward and lowers its head to inspect it." A video- \
      generation model animates this text directly — if it describes a \
      static pose instead of an action, the clip will have no real motion. \
      Do not build elaborate multi-part choreography; one clear, concrete \
      action per beat is enough. \
    - "ending_state": what the frame looks like once the action completes. \
    - "clip_duration_seconds": how many real seconds of generated motion \
      this beat needs — a whole number from 3 to 15 (the video provider's \
      real supported range). Choose it to comfortably fit the action you \
      described; do not pick a duration too short for the action to \
      actually complete, and do not pad a simple action into a needlessly \
      long clip.

Respond with a single JSON object and nothing else — no prose, no \
reasoning, no markdown code fences. It must match exactly this shape:

${PLAN_JSON_SHAPE}`;
}

export function buildContentPlanUserPrompt(
  brief: ProductionBrief,
  ctx: AudienceContext,
  previousPlan?: ContentPlan,
  revisionNote?: string,
  strategy?: CreativeStrategy,
): string {
  const evidenceList = evidenceBlock(brief);

  const strategyBlock = strategy
    ? `\nThe creative strategy already decided for this piece — EXECUTE this, do not re-decide it:
${JSON.stringify(strategy, null, 2)}
`
    : "";

  const base = `Mission: ${brief.mission.title}

Opportunity brief (from Scout's research):
${brief.mission.interpreted_mission ?? brief.mission.brief}

${creativeDirectionBlock(brief)}
${strategyBlock}
Key findings from Scout's research:
${brief.scout.key_findings.map((f) => `- ${f}`).join("\n") || "(none)"}

Real evidence you may cite (use the "id" value as claims[].evidence_id — never cite anything not listed here):
${evidenceList || "(no evidence selected)"}
${brief.founder_notes ? `\nFounder's own notes: ${brief.founder_notes}` : ""}`;

  if (!previousPlan || !revisionNote) {
    return `${base}\n\nProduce the complete structured production plan.`;
  }

  return `${base}

This is a REVISION, not a fresh plan. Your previous plan for this piece:
${JSON.stringify(previousPlan, null, 2)}

The founder reviewed the finished piece made from that plan and asked for this change:
"${revisionNote}"

You may rework the WHOLE piece if that's what's needed to make the requested change land well — \
this is not a patch instruction forcing untouched parts to stay identical. Produce a new, \
complete structured production plan (the full JSON shape, not a diff) reflecting the change.`;
}

/**
 * The ONE bounded, automatic self-correction pass (see
 * contentWorkflow.ts's runProductionPlanningStage — never more than one,
 * never after any asset generation has started, always re-checked against
 * every guardrail exactly as a fresh plan would be). Deliberately a
 * separate function from the revision prompt above, not an overload of
 * it: a founder's requested revision and our own guardrail rejecting the
 * plan are different things and must never be recorded or reasoned about
 * as if they were the same event.
 *
 * The instruction below is deliberately explicit that this is not a
 * find-and-replace exercise: Content Bot must change the actual creative
 * substance behind the flagged language, not merely reword around the
 * pattern that tripped the guardrail. Whatever it produces still goes
 * through the identical guardrail checks afterward — this prompt is not
 * itself a safety mechanism, only an honest attempt to help a genuinely
 * correctable plan pass on its one allowed retry.
 */
/**
 * The generic correction block — unchanged, word-for-word, from before
 * this function became guardrail-aware. Used for every guardrail code
 * EXCEPT "narration_duration_mismatch", which gets its own, numeric,
 * arithmetic-focused block instead (see buildNarrationDurationCorrectionBlock
 * below) — a real live failure showed this generic "change the creative
 * substance" framing gives Content Bot nothing to actually compute from,
 * which is fine for a qualitative problem (reused phrasing, an
 * originality concern) but not for a pure arithmetic one (narration
 * length vs. stated duration).
 */
function genericGuardrailCorrectionBlock(rejectedPlan: ContentPlan, guardrailReason: string): string {
  return `Your previous attempt at this plan was rejected by an automated safety check before any assets \
were generated — nothing has been produced or spent beyond this planning step. The exact reason:
"${guardrailReason}"

Your previous (rejected) plan:
${JSON.stringify(rejectedPlan, null, 2)}

This is your ONE opportunity to submit a corrected plan — produce the complete structured plan \
again (the full JSON shape, not a diff), preserving the founder's brief, Scout's real evidence, \
the original creative concept, and the originality requirements exactly as before. Do not simply \
delete or reword the flagged phrase while keeping the same underlying instruction — genuinely \
change the creative substance so the plan is honestly original and would not trip this or any \
other safety check for a real reason, not just avoid the specific words that were flagged. If \
you cannot produce a genuinely corrected plan, produce your best good-faith original attempt \
regardless — this plan will go through the same safety review as any other, and there is no \
further automatic retry after this one.`;
}

/**
 * The narration-duration-specific correction block — the real fix for a
 * live failure (a "YouTube kids" episode's auto-correction attempt
 * shrinking its narration from 229 to 147 words when its 170s target
 * needed roughly 400+). Every number here is computed from the rejected
 * plan itself via the SAME shared functions assertNarrationFitsDuration
 * checks against (guardrails.ts) — never duplicated arithmetic, so this
 * can never silently disagree with what the real guardrail will check
 * the corrected plan against next.
 */
function buildNarrationDurationCorrectionBlock(rejectedPlan: ContentPlan, guardrailReason: string): string {
  const totalWords = countNarrationWords(rejectedPlan);
  const pace = rejectedPlan.voice_direction.pace;
  const duration = rejectedPlan.duration_seconds;
  const estimatedSeconds = estimatedNarrationSeconds(totalWords, pace);
  const { min, max, target } = acceptableNarrationWordRange(duration, pace);
  const tooShort = totalWords < min;
  const tooLong = totalWords > max;
  const direction = tooShort ? "LONGER" : tooLong ? "SHORTER" : "adjusted"; // "adjusted" should not occur in practice — this block only ever runs after a real rejection
  const wordsNeeded = tooShort ? min - totalWords : tooLong ? totalWords - max : 0;

  return `Your previous attempt at this plan was rejected by an automated check before any assets were \
generated — nothing has been produced or spent beyond this planning step. This was specifically a \
NARRATION LENGTH problem, not a creative-content problem. The exact reason:
"${guardrailReason}"

The numbers, precisely:
- Target duration: ${duration}s
- Narration pace you selected: "${pace}"
- Your previous narration: ${totalWords} words (~${estimatedSeconds.toFixed(1)}s at this pace)
- Acceptable word-count range for ${duration}s at "${pace}" pace: approximately ${min}-${max} words (target ≈${target} words)
- Your narration needs to become ${direction} — approximately ${wordsNeeded} ${tooShort ? "more" : "fewer"} words${
    tooShort || tooLong ? "" : " (already within range — re-check your own count)"
  }

Your previous (rejected) plan:
${JSON.stringify(rejectedPlan, null, 2)}

This is your ONE opportunity to submit a corrected plan — produce the complete structured plan again \
(the full JSON shape, not a diff). PRESERVE the creative concept, story, characters, and structure from \
your previous attempt exactly as before — only adjust the actual LENGTH of the narration (add real spoken \
content, or trim it down, beat by beat, as needed) to land inside the word-count range above. Do not change \
the underlying creative idea unless genuinely necessary to make the timing work. Recount your own total \
narration word count before responding and confirm it falls inside the range above — this is a real, \
checkable number, not a guess.`;
}

export function buildGuardrailCorrectionUserPrompt(
  brief: ProductionBrief,
  ctx: AudienceContext,
  rejectedPlan: ContentPlan,
  guardrailReason: string,
  guardrailCode: string,
  strategy?: CreativeStrategy,
): string {
  const basePrompt = buildContentPlanUserPrompt(brief, ctx, undefined, undefined, strategy);
  const correctionBlock =
    guardrailCode === "narration_duration_mismatch"
      ? buildNarrationDurationCorrectionBlock(rejectedPlan, guardrailReason)
      : genericGuardrailCorrectionBlock(rejectedPlan, guardrailReason);

  return `${basePrompt}\n\n${correctionBlock}`;
}
