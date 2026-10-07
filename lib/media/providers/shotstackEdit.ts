import "server-only";
import type { EditProvider, EditRequest, MediaResult, CameraMovement, MovementIntensity, TransitionStyle } from "../types";
import { MediaProviderError } from "../types";
import { calculateMediaUsdCost } from "../pricing";

const SHOTSTACK_MODEL = "default";

function aspectToSize(aspect: EditRequest["aspectRatio"]): { width: number; height: number } {
  switch (aspect) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
  }
}

// Every value on the right is a REAL, verified Shotstack Clip.effect enum
// value (confirmed directly from Shotstack's own SDK source — the effect
// speed variants are the base name plus "Slow"/"Fast", e.g. "zoomInFast" —
// never invented). "static" deliberately maps to no `effect` property at
// all, a genuine static hold, rather than a fabricated "none" capability.
const CAMERA_MOVEMENT_BASE_EFFECT: Record<Exclude<CameraMovement, "static">, string> = {
  zoom_in: "zoomIn",
  zoom_out: "zoomOut",
  pan_left: "slideLeft",
  pan_right: "slideRight",
  pan_up: "slideUp",
  pan_down: "slideDown",
};

/** Exported for tests only — verifies the constrained vocabulary maps 1:1 onto real Shotstack values, without a real network call. */
export function shotstackEffect(movement: CameraMovement, intensity: MovementIntensity): string | undefined {
  if (movement === "static") return undefined;
  const base = CAMERA_MOVEMENT_BASE_EFFECT[movement];
  if (intensity === "slow") return `${base}Slow`;
  if (intensity === "fast") return `${base}Fast`;
  return base;
}

// Every value on the right is a REAL, verified Shotstack Transition
// in/out enum value. "cut" deliberately maps to omitting the `transition`
// property entirely (a real hard cut, Shotstack's own default) rather than
// the literal string "none" — either is accepted by the API, but omitting
// keeps the payload minimal.
/** Exported for tests only. */
export const TRANSITION_TO_SHOTSTACK: Record<Exclude<TransitionStyle, "cut">, string> = {
  fade: "fade",
  wipe_left: "wipeLeft",
  wipe_right: "wipeRight",
  slide_left: "slideLeft",
  slide_right: "slideRight",
  slide_up: "slideUp",
  slide_down: "slideDown",
  zoom: "zoom",
};

interface ShotstackTrack {
  clips: Array<Record<string, unknown>>;
}

/**
 * Structured on-screen text (disclosure, per-beat emphasis) rendered as
 * real Shotstack `title` clips — never as an instruction inside an image-
 * generation prompt (see CLAUDE.md's Content Bot Creative Quality
 * milestone, "text/disclosure separation": the real failure this fixes is
 * an image model asked to render disclosure text producing garbled,
 * frame-dominating pseudo-text). Every field/value used here (type, text,
 * style presets, size presets, position presets, background) is a real,
 * verified TitleAsset field — confirmed from Shotstack's own SDK source.
 * "badge" is a small, corner-positioned, semi-transparent-backed treatment
 * meant to coexist with captions (which default to the bottom) without
 * competing for the same screen space; "end_card" is a larger, centered
 * treatment for its own dedicated window. Exported for tests only.
 */
export function buildTitleClips(onScreenText: EditRequest["onScreenText"]): ShotstackTrack["clips"] {
  if (!onScreenText || onScreenText.length === 0) return [];
  return onScreenText.map((t) => ({
    asset: {
      type: "title",
      text: t.text,
      style: t.style === "end_card" ? "minimal" : "subtitle",
      size: t.style === "end_card" ? "medium" : "x-small",
      position: t.style === "end_card" ? "center" : "topLeft",
      ...(t.style === "badge" ? { background: "#66000000" } : {}),
    },
    start: t.startSeconds,
    length: Math.max(t.endSeconds - t.startSeconds, 0.5),
  }));
}

/**
 * A video-clip timeline entry never gets a `camera_movement` effect,
 * structurally — never trusting the caller to have passed "static" for a
 * real generated clip (see CLAUDE.md's Content Bot motion-first
 * milestone: "Do not apply fake Ken Burns movement to Kling clips").
 * Exported for tests only.
 */
export function buildVisualClips(timeline: EditRequest["timeline"]): ShotstackTrack["clips"] {
  return timeline.map((clip) => {
    const isVideoClip = Boolean(clip.videoClipStorageKey);
    if (isVideoClip === Boolean(clip.imageStorageKey)) {
      throw new Error(
        "Each Shotstack timeline entry must set exactly one of imageStorageKey/videoClipStorageKey — " +
          `got imageStorageKey=${JSON.stringify(clip.imageStorageKey)}, videoClipStorageKey=${JSON.stringify(clip.videoClipStorageKey)}.`,
      );
    }
    const transitionValue = clip.transitionIn === "cut" ? undefined : TRANSITION_TO_SHOTSTACK[clip.transitionIn];
    if (isVideoClip) {
      // Real generated motion — never a fake pan/zoom effect on top of it.
      return {
        asset: { type: "video", src: clip.videoClipStorageKey, trim: 0 },
        start: clip.startSeconds,
        length: clip.endSeconds - clip.startSeconds,
        fit: "crop",
        ...(transitionValue ? { transition: { in: transitionValue } } : {}),
      };
    }
    const effect = shotstackEffect(clip.cameraMovement, clip.movementIntensity);
    return {
      asset: { type: "image", src: clip.imageStorageKey },
      start: clip.startSeconds,
      length: clip.endSeconds - clip.startSeconds,
      fit: "crop",
      ...(effect ? { effect } : {}),
      ...(transitionValue ? { transition: { in: transitionValue } } : {}),
    };
  });
}

/** Exported for tests only. */
export function buildTimeline(req: EditRequest, stagedVoiceoverUrl: string, stagedCaptionUrl: string | null) {
  const imageClips: ShotstackTrack["clips"] = buildVisualClips(req.timeline);

  const audioTrack: ShotstackTrack = {
    clips: [
      {
        asset: { type: "audio", src: stagedVoiceoverUrl },
        start: 0,
        length: req.timeline.length > 0 ? req.timeline[req.timeline.length - 1]!.endSeconds : 1,
      },
    ],
  };

  const titleClips = buildTitleClips(req.onScreenText);
  const tracks: ShotstackTrack[] = [{ clips: imageClips }, audioTrack];
  if (titleClips.length > 0) {
    tracks.unshift({ clips: titleClips });
  }

  if (stagedCaptionUrl) {
    tracks.unshift({
      clips: [
        {
          asset: { type: "caption", src: stagedCaptionUrl, font: { color: "#ffffff", size: 32 } },
          start: 0,
          length: req.timeline.length > 0 ? req.timeline[req.timeline.length - 1]!.endSeconds : 1,
        },
      ],
    });
  }

  return { tracks };
}

interface ShotstackSubmitResponse {
  success: boolean;
  response: { id: string };
}

interface ShotstackStatusResponse {
  success: boolean;
  response: {
    id: string;
    status: "queued" | "fetching" | "rendering" | "saving" | "done" | "failed";
    url: string | null;
    error: string | null;
    duration: number | null;
  };
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100; // ~5 minutes, generous for a 60-180s short-form render

/**
 * Shotstack's real render API (submit a JSON timeline, poll for status) —
 * chosen over self-hosting ffmpeg specifically to avoid Vercel's
 * serverless packaging limits (see CLAUDE.md's Content Bot milestone,
 * §0a). Runs against the sandbox host by default (SHOTSTACK_STAGE=stage)
 * since C1 was built and verified against a Shotstack Sandbox account.
 *
 * Shotstack fetches every input from a real, publicly-reachable HTTPS
 * URL — by the time an `EditRequest` reaches this provider, every
 * `*StorageKey` field is already such a URL, not an internal storage key.
 * Turning "whatever storage this app is using" into "a URL an external
 * service can fetch" is the PIPELINE's job (runContentProductionPipeline
 * in contentWorkflow.ts — via storage.signedReadUrl() where the storage
 * provider supports it, or a staged public copy where it doesn't, e.g.
 * local disk in dev), not this provider's — keeping this class simple,
 * storage-agnostic, and easy to test against plain fixture URLs.
 */
export class ShotstackEditProvider implements EditProvider {
  readonly key = "shotstack";
  readonly capability = "edit" as const;

  private apiKey(): string {
    const key = process.env.SHOTSTACK_API_KEY;
    if (!key) {
      throw new Error("SHOTSTACK_API_KEY is not set — see .env.example.");
    }
    return key;
  }

  private stage(): string {
    return process.env.SHOTSTACK_STAGE || "stage";
  }

  private baseUrl(): string {
    return `https://api.shotstack.io/${this.stage()}`;
  }

  estimateUsd(): number {
    // A rough, deliberately generous pre-flight estimate (2 minutes) — the
    // real charge, computed from the actual rendered duration, replaces
    // this once the render completes; see generate()'s real usage.quantity.
    return calculateMediaUsdCost("shotstack", SHOTSTACK_MODEL, 120);
  }

  async generate(req: EditRequest): Promise<MediaResult> {
    const { width, height } = aspectToSize(req.aspectRatio);
    const timeline = buildTimeline(req, req.voiceoverStorageKey, req.captionStorageKey ?? null);

    const submitRes = await fetch(`${this.baseUrl()}/render`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeline,
        output: { format: "mp4", size: { width, height } },
      }),
    });
    if (!submitRes.ok) {
      const rawBody = await submitRes.text();
      throw new MediaProviderError("shotstack", submitRes.status, rawBody, `Shotstack render submission failed (${submitRes.status}): ${rawBody}`);
    }
    const submitted = (await submitRes.json()) as ShotstackSubmitResponse;
    const renderId = submitted.response.id;

    let finalStatus: ShotstackStatusResponse["response"] | undefined;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const statusRes = await fetch(`${this.baseUrl()}/render/${renderId}`, {
        headers: { "x-api-key": this.apiKey() },
      });
      if (!statusRes.ok) {
        const rawBody = await statusRes.text();
        throw new MediaProviderError("shotstack", statusRes.status, rawBody, `Could not poll Shotstack render status (${statusRes.status}): ${rawBody}`);
      }
      const status = (await statusRes.json()) as ShotstackStatusResponse;
      if (status.response.status === "done") {
        finalStatus = status.response;
        break;
      }
      if (status.response.status === "failed") {
        throw new Error(`Shotstack render failed: ${status.response.error ?? "no error detail returned"}`);
      }
    }

    if (!finalStatus?.url) {
      throw new Error(`Shotstack render did not complete within the polling window (render id ${renderId}).`);
    }

    const durationSeconds = finalStatus.duration ?? undefined;
    const quantitySeconds = durationSeconds ?? 120;

    return {
      open: async () => {
        const videoRes = await fetch(finalStatus!.url!);
        if (!videoRes.ok || !videoRes.body) {
          throw new MediaProviderError("shotstack", videoRes.status, "", `Could not download the rendered video from Shotstack: ${videoRes.status}`);
        }
        return videoRes.body as unknown as ReadableStream<Uint8Array>;
      },
      contentType: "video/mp4",
      byteSize: null,
      durationSeconds: durationSeconds ?? null,
      width,
      height,
      providerAssetId: renderId,
      usage: {
        provider: "shotstack",
        model: SHOTSTACK_MODEL,
        unit: "seconds",
        quantity: quantitySeconds,
        usdCost: calculateMediaUsdCost("shotstack", SHOTSTACK_MODEL, quantitySeconds),
      },
    };
  }

  async lookup(): Promise<MediaResult | null> {
    // Shotstack's render id is only known after a successful submit — a
    // crash before that point has genuinely spent nothing to recover, and
    // a crash after it is recovered by the pipeline's own content_assets
    // check before ever calling generate() again (same pattern as the
    // other C1 providers).
    return null;
  }
}
