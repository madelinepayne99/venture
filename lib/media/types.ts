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
};

export type VoiceRequest = GenerationRequestBase & {
  text: string;
  voiceKey: string;
  pace: "slow" | "natural" | "brisk";
};

export type VideoRequest = GenerationRequestBase & {
  prompt: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
};

export type CaptionRequest = GenerationRequestBase & {
  audioStorageKey: string;
  language: string;
};

export type EditRequest = GenerationRequestBase & {
  timeline: ReadonlyArray<{
    imageStorageKey: string;
    startSeconds: number;
    endSeconds: number;
    motion?: "none" | "slow_zoom" | "pan";
  }>;
  voiceoverStorageKey: string;
  captionStorageKey?: string;
  musicStorageKey?: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
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
