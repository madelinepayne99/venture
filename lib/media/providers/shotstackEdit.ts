import "server-only";
import type { EditProvider, EditRequest, MediaResult } from "../types";
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

function motionEffect(motion: EditRequest["timeline"][number]["motion"]): string | undefined {
  switch (motion) {
    case "slow_zoom":
      return "zoomIn";
    case "pan":
      return "slideLeft";
    default:
      return undefined;
  }
}

interface ShotstackTrack {
  clips: Array<Record<string, unknown>>;
}

function buildTimeline(req: EditRequest, stagedVoiceoverUrl: string, stagedCaptionUrl: string | null) {
  const imageClips: ShotstackTrack["clips"] = req.timeline.map((clip) => ({
    asset: { type: "image", src: clip.imageStorageKey },
    start: clip.startSeconds,
    length: clip.endSeconds - clip.startSeconds,
    fit: "crop",
    ...(motionEffect(clip.motion) ? { effect: motionEffect(clip.motion) } : {}),
  }));

  const audioTrack: ShotstackTrack = {
    clips: [
      {
        asset: { type: "audio", src: stagedVoiceoverUrl },
        start: 0,
        length: req.timeline.length > 0 ? req.timeline[req.timeline.length - 1]!.endSeconds : 1,
      },
    ],
  };

  const tracks: ShotstackTrack[] = [{ clips: imageClips }, audioTrack];

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
      throw new Error(`Shotstack render submission failed (${submitRes.status}): ${await submitRes.text()}`);
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
        throw new Error(`Could not poll Shotstack render status (${statusRes.status}): ${await statusRes.text()}`);
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
          throw new Error(`Could not download the rendered video from Shotstack: ${videoRes.status}`);
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
