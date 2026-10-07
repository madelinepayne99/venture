import type { WorkspaceType } from "@/lib/db/types";

// The provider/tool abstraction for Content Bot's real media-generation
// calls. Every concrete provider (fal.ai, ElevenLabs, Shotstack, and
// whatever comes later) implements one of these interfaces — the
// production pipeline never imports a provider SDK directly, only these
// shapes plus the injectable registry (registry.ts), mirroring exactly how
// Scout's anthropicClient.ts is the one place ANTHROPIC_API_KEY is read.

export type MediaCapability = "image" | "voice" | "music" | "video" | "captions" | "edit";

/**
 * Chosen by the FOUNDER at the "approve for production" gate
 * (contentWorkflow.ts's approveForProduction) — never a global default,
 * never set by an agent. Threaded into every prompt builder, every
 * guardrail call, and every provider request, so a single audience/
 * platform/content-type context governs the whole pipeline for this item.
 */
export type AudienceContext = {
  platform: "youtube" | "youtube_shorts" | "tiktok";
  audience: "general" | "teen" | "kids";
  contentType: "educational" | "comedy" | "commentary" | "product" | "story";
  workspaceType: WorkspaceType;
};

export type ProviderUsage = {
  provider: string;
  model: string;
  unit: "seconds" | "images" | "characters" | "tokens" | "compute_seconds";
  quantity: number;
  /** null = real spend occurred but this provider/model is unpriced — never coerced to 0, mirrors costs.usd_cost exactly. */
  usdCost: number | null;
};

export type MediaResult = {
  /** Bytes are streamed out; the PIPELINE decides where they're stored, never the provider. */
  open: () => Promise<ReadableStream<Uint8Array>>;
  contentType: string;
  byteSize: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  providerAssetId: string | null;
  usage: ProviderUsage;
};

export type GenerationRequestBase = {
  /** Stable across process restarts — what makes lookup() able to recover an already-paid-for result after a crash. */
  idempotencyKey: string;
  audience: AudienceContext;
};

export type ImageRequest = GenerationRequestBase & {
  prompt: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  negativePrompt?: string;
  /**
   * A real, publicly-fetchable URL to a reference image this generation
   * should be conditioned against (fal.ai image-to-image continuity —
   * see contentWorkflow.ts's runReferenceGenerationStage and
   * runAssetGenerationStage). When present, FalImageProvider calls a
   * genuinely different, more expensive model built for this
   * (fal-ai/flux-pro/kontext) instead of the default text-to-image model —
   * never sent for the reference image's OWN generation, which has
   * nothing to condition against yet.
   */
  referenceImageUrl?: string;
};

export type VoiceRequest = GenerationRequestBase & {
  text: string;
  voiceKey: string;
  pace: "slow" | "natural" | "brisk";
};

export type VideoRequest = GenerationRequestBase & {
  prompt: string;
  durationSeconds: number;
  // Not forwarded to every real video provider's own request — Kling v3
  // Pro specifically infers aspect ratio from `referenceImageUrl` itself
  // (confirmed against fal.ai's own API docs: "Aspect ratio is determined
  // by the start image, not a parameter"), so KlingVideoProvider never
  // sends this field to the real API. Kept on the shared request shape
  // for validation/bookkeeping and for any future video provider that
  // DOES take it as a real parameter.
  aspectRatio: "9:16" | "16:9" | "1:1";
  /**
   * The character/subject this clip must stay visually consistent with —
   * required, not optional, for the Minimum Motion Proof-of-Concept.
   * KlingVideoProvider throws rather than silently generating a
   * referenceless clip if this is missing — see that provider's own doc
   * comment for why ("do not silently fall back to plain text-to-video").
   * Always sent as Kling's `start_image_url`, regardless of whether
   * `referenceImageUrls` (below) is also supplied.
   */
  referenceImageUrl: string;
  /**
   * Optional, genuinely distinct additional reference images (1-3) for
   * Kling's native `elements` character-consistency mechanism — verified
   * against fal.ai's own schema to require BOTH a frontal image AND this
   * list together (frontal alone is rejected; see klingVideo.ts's module
   * doc comment for the real HTTP 422 this was learned from). Deliberately
   * NEVER auto-populated from `referenceImageUrl` itself — fal's docs
   * don't confirm the same image may validly serve both roles, so a
   * caller must supply a real second image explicitly, or omit this
   * entirely (in which case KlingVideoProvider sends no `elements` at
   * all, relying solely on `referenceImageUrl`/`start_image_url` for
   * conditioning — still a fully valid, non-referenceless request).
   */
  referenceImageUrls?: string[];
};

export type CaptionRequest = GenerationRequestBase & {
  audioStorageKey: string;
  language: string;
};

// The Creative Quality upgrade's constrained motion/transition vocabulary
// (CLAUDE.md's Content Bot Creative Quality milestone) — defined ONCE here
// and reused by both Content Bot's own plan schema
// (lib/agents/contentBot/schema.ts's ScriptBeatSchema) and this EditRequest
// shape, so the two can never drift apart. Every value maps 1:1 onto a
// real, verified Shotstack Edit API enum value (see shotstackEdit.ts's
// mapping tables, sourced directly from Shotstack's own SDK source, not
// guessed) — Content Bot can only ever pick from this closed list, so it
// can never request a motion/transition the assembly provider can't
// actually execute.
export const CAMERA_MOVEMENTS = ["static", "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down"] as const;
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

export const MOVEMENT_INTENSITIES = ["slow", "normal", "fast"] as const;
export type MovementIntensity = (typeof MOVEMENT_INTENSITIES)[number];

export const TRANSITION_STYLES = [
  "cut",
  "fade",
  "wipe_left",
  "wipe_right",
  "slide_left",
  "slide_right",
  "slide_up",
  "slide_down",
  "zoom",
] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

/**
 * "badge" — a small, persistent, unobtrusive on-screen element (e.g. a
 * disclosure notice) visible for a specified window, never full-frame.
 * "end_card" — a larger, centered treatment shown only for its own window,
 * typically at the end. Both are rendered by the assembly provider as a
 * real structured text/title element — never baked into a generated image
 * (see CLAUDE.md's Content Bot Creative Quality milestone, "text/disclosure
 * separation" — this is the structural fix for a real, observed failure
 * where an image model was asked to render disclosure text and produced
 * garbled, oversized, frame-dominating pseudo-text instead).
 */
export type OnScreenTextStyle = "badge" | "end_card";

export type EditRequest = GenerationRequestBase & {
  timeline: ReadonlyArray<{
    /**
     * Exactly one of `imageStorageKey`/`videoClipStorageKey` must be set —
     * the still-image path (static, gets a real Shotstack pan/zoom effect)
     * or the real generated motion clip path (see CLAUDE.md's Content Bot
     * motion-first milestone). `videoClipStorageKey` is now the PRIMARY
     * path the production pipeline uses for every beat; `imageStorageKey`
     * is kept, unremoved, for thumbnails/reference/legacy use — never both
     * set on the same timeline entry (shotstackEdit.ts's buildTimeline
     * throws if so). Never apply a camera-movement effect to a video clip
     * — it's already real, generated motion, not a static image asking
     * for a fake one.
     */
    imageStorageKey?: string;
    videoClipStorageKey?: string;
    startSeconds: number;
    endSeconds: number;
    cameraMovement: CameraMovement;
    movementIntensity: MovementIntensity;
    transitionIn: TransitionStyle;
  }>;
  voiceoverStorageKey: string;
  captionStorageKey?: string;
  musicStorageKey?: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  /**
   * Structured on-screen text (disclosure and any per-beat emphasis text) —
   * rendered by the provider as real text/title elements, never as part of
   * an image-generation prompt. See ContentPlan's `disclosure` and each
   * ScriptBeat's `on_screen_text` (lib/agents/contentBot/schema.ts) for
   * where this is populated from.
   */
  onScreenText?: ReadonlyArray<{
    text: string;
    startSeconds: number;
    endSeconds: number;
    style: OnScreenTextStyle;
  }>;
};

/** One three-method contract for every capability. */
export interface MediaProvider<TReq extends GenerationRequestBase> {
  readonly key: string;
  readonly capability: MediaCapability;
  /** Priced BEFORE any spend. Throws UnpricedProviderError when this provider/model isn't in the price table. */
  estimateUsd(req: TReq): number;
  generate(req: TReq): Promise<MediaResult>;
  /** Crash recovery: has this exact idempotencyKey already been generated (and paid for)? */
  lookup(idempotencyKey: string): Promise<MediaResult | null>;
}

export type ImageProvider = MediaProvider<ImageRequest>;
// Voice generation returns real word-level timing alongside the audio —
// this is the one capability-specific extension to the generic contract,
// added because it's what actually lets captions be derived for free
// (see contentWorkflow.ts's runContentProductionPipeline) rather than
// needing a separate transcription provider. A real, necessary correction
// to the otherwise-uniform MediaProvider<TReq> shape, not a workaround.
export type VoiceWordTiming = { word: string; startSeconds: number; endSeconds: number };
export type VoiceMediaResult = MediaResult & { alignment: VoiceWordTiming[] };
export interface VoiceProvider {
  readonly key: string;
  readonly capability: "voice";
  estimateUsd(req: VoiceRequest): number;
  generate(req: VoiceRequest): Promise<VoiceMediaResult>;
  lookup(idempotencyKey: string): Promise<VoiceMediaResult | null>;
}
export type VideoProvider = MediaProvider<VideoRequest>;
export type CaptionProvider = MediaProvider<CaptionRequest>;
export type EditProvider = MediaProvider<EditRequest>;

/** For any provider whose generate() could exceed the platform's function duration. Not required by every provider. */
export interface AsyncMediaProvider<TReq extends GenerationRequestBase> extends MediaProvider<TReq> {
  submit(req: TReq): Promise<{ jobHandle: string }>;
  poll(jobHandle: string): Promise<{ status: "pending" | "done" | "failed"; result?: MediaResult; detail?: string }>;
}

/**
 * A real provider HTTP call that came back non-2xx — thrown by every
 * concrete provider (falImage.ts, elevenLabsVoice.ts, shotstackEdit.ts) in
 * place of a plain Error, specifically so the pipeline can classify a real
 * production failure from a genuine structured signal (the HTTP status
 * code) rather than by pattern-matching the message text (see
 * lib/domain/contentFailureClassification.ts). `status` is the real
 * response status; `rawBody` is the provider's own error response,
 * preserved verbatim for diagnostics — never parsed or trusted beyond
 * that. The Error's own `message` is unchanged from before this class
 * existed, so no existing failure_reason text changes shape.
 */
export class MediaProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly rawBody: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaProviderError";
  }
}

export class NoProviderConfiguredError extends Error {
  constructor(readonly capability: MediaCapability) {
    super(`No ${capability} provider is configured (see lib/media/registry.ts's env-key resolution).`);
    this.name = "NoProviderConfiguredError";
  }
}

export class UnpricedProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly model: string,
  ) {
    super(`No pricing configured for provider "${provider}" model "${model}" — refusing to record an unknown cost.`);
    this.name = "UnpricedProviderError";
  }
}

export type MediaDeps = Partial<{
  image: ImageProvider;
  voice: VoiceProvider;
  video: VideoProvider;
  captions: CaptionProvider;
  edit: EditProvider;
}>;
