import "server-only";
import type { VideoProvider, VideoRequest, MediaResult, AsyncMediaProvider } from "../types";
import { MediaProviderError } from "../types";
import { calculateMediaUsdCost } from "../pricing";

/**
 * fal.ai's real, documented `fal-ai/kling-video/v3/pro/image-to-video`
 * model (Minimum Motion Proof-of-Concept — see CLAUDE.md's motion-first
 * investigation). This is the FIRST real implementation of the
 * `AsyncMediaProvider` shape that has existed, unused, in lib/media/types.ts
 * since C1 — real video generation genuinely can run long enough to need
 * a real submit/poll split, unlike every synchronous provider so far
 * (ShotstackEditProvider blocks with an internal poll loop instead; that
 * pattern is NOT reused here on purpose, so a future Inngest-driven caller
 * can call submit()/poll() directly with step.sleep() between polls
 * without this provider needing to change at all).
 *
 * Real request/response shape verified against fal.ai's own API reference
 * before writing this (never guessed):
 *   - `start_image_url` (required), `duration` (string enum "3".."15"),
 *     `generate_audio` (bool, real API default true), `elements`
 *     (array of { frontal_image_url, reference_image_urls? }) for native
 *     multi-clip character consistency.
 *   - Real async queue API: POST https://queue.fal.run/{model} returns
 *     { request_id, status_url, response_url, ... }; status at
 *     .../requests/{request_id}/status returns IN_QUEUE | IN_PROGRESS |
 *     COMPLETED; the real result is a separate fetch at
 *     .../requests/{request_id}, shaped { video: { url, content_type,
 *     file_name, file_size } }.
 *
 * REAL LIVE FAILURE THIS FIX EXISTS FOR: the first real proof run's
 * status check failed with a genuine HTTP 405, because the original code
 * hand-reconstructed a status URL from the model id + request_id instead
 * of using the real `status_url` fal.ai's own submit response already
 * returned. fal's queue is plausibly sharded/load-balanced — the
 * authoritative server-issued URL is not guaranteed to match a naive
 * `https://queue.fal.run/{model}/requests/{id}/status` reconstruction.
 * submit()/poll()/the jobHandle shape below were all rewritten to use
 * ONLY the real, server-returned `status_url`/`response_url` — never a
 * hand-built one, anywhere in this file.
 *
 * SECOND REAL LIVE FAILURE THIS FIX EXISTS FOR: the second proof run got
 * past polling cleanly (the fix above worked) but the submitted job itself
 * failed async validation with a real HTTP 422 — "Either frontal_image_url
 * and reference_image_urls or video_url must be provided." The original
 * code sent `elements: [{ frontal_image_url }]` with no
 * `reference_image_urls`. Verified against fal.ai's own current docs and
 * raw OpenAPI schema (never guessed): an image-based `elements` entry
 * requires BOTH `frontal_image_url` AND `reference_image_urls` (1-3
 * images, at least one required) together — `frontal_image_url` alone is
 * an invalid combination. Elements referenced in the prompt must also use
 * the literal syntax `@Element1`, `@Element2`, etc. — undocumented
 * whether the same image may validly appear as both `frontal_image_url`
 * and inside `reference_image_urls`, so this provider never assumes that;
 * see `buildRequestBody`'s own comment for the resulting behavior.
 *
 * Deliberate, explicit constraints for this proof (per the approved scope
 * — never loosen these without a real decision):
 *   - `generate_audio` is HARDCODED false here, never exposed as a
 *     request field a caller could flip — Content Bot's existing
 *     ElevenLabs narration + its word-level-alignment-derived captions
 *     are what this pipeline already depends on; Kling's own audio would
 *     silently bypass that.
 *   - `referenceImageUrl` is REQUIRED on every call (see VideoRequest's
 *     own doc comment) — this provider throws rather than ever silently
 *     falling back to a referenceless (plain text-to-video) generation;
 *     it is always sent as `start_image_url`, regardless of `elements`.
 *   - `elements` is sent ONLY when the caller also supplies
 *     `referenceImageUrls` (1-3 additional, genuinely distinct reference
 *     images) — this provider NEVER synthesizes that array itself by
 *     duplicating `referenceImageUrl`, since fal's docs don't confirm
 *     that's a valid combination. Without a real second reference image,
 *     `elements` is simply omitted — a fully valid, documented request on
 *     its own (`elements` is optional; `start_image_url` alone still
 *     provides genuine reference-image conditioning for this one clip).
 */
const KLING_MODEL = "fal-ai/kling-video/v3/pro/image-to-video";

const KLING_VALID_DURATIONS = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"] as const;
type KlingDuration = (typeof KLING_VALID_DURATIONS)[number];

interface KlingSubmitResponse {
  request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
  queue_position?: number;
}

interface KlingStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  logs?: Array<{ message: string; timestamp: string }>;
  metrics?: { inference_time?: number };
  error?: string;
  error_type?: string;
}

interface KlingResultResponse {
  video?: { url: string; content_type?: string; file_name?: string; file_size?: number };
}

// fal's own documented constraint for an image-based `elements` entry's
// `reference_image_urls`: "1-3 images supported. At least one image is
// required." (verified against the raw OpenAPI schema for this model).
const MIN_REFERENCE_IMAGES = 1;
const MAX_REFERENCE_IMAGES = 3;

// fal's documented prompt syntax for referencing an `elements` entry:
// "Reference in prompt as @Element1, @Element2, etc." This provider only
// ever sends one image-based element, so it's always @Element1.
const ELEMENT_PROMPT_TAG = "@Element1";

/**
 * Prepends the required `@Element1` tag to the proof's own motion prompt
 * when (and only when) a real `elements` entry is actually being sent —
 * without altering the prompt's creative meaning (Task 3's own
 * requirement). A no-op if the tag is already present, so this is safe to
 * call even if a caller already wrote it in themselves.
 */
function promptWithElementReference(prompt: string): string {
  if (prompt.includes(ELEMENT_PROMPT_TAG)) {
    return prompt;
  }
  return `${ELEMENT_PROMPT_TAG} ${prompt}`;
}

function validateKlingDuration(durationSeconds: number): KlingDuration {
  const asString = String(Math.round(durationSeconds));
  if (!(KLING_VALID_DURATIONS as readonly string[]).includes(asString) || durationSeconds !== Math.round(durationSeconds)) {
    throw new Error(
      `Kling v3 Pro only supports whole-second durations from 3-15s (got ${durationSeconds}s) — ` +
        `see fal.ai's own documented "duration" enum. Never silently rounded or clamped.`,
    );
  }
  return asString as KlingDuration;
}

/**
 * A jobHandle is a JSON-serialized snapshot of everything needed to check
 * on and retrieve a real submitted job, WITHOUT ever depending on
 * in-memory state or reconstructing a URL: the real request_id (for
 * identification/logging), the AUTHORITATIVE `status_url`/`response_url`
 * fal.ai's own submit response returned (used verbatim, never rebuilt —
 * see this file's own module doc comment for the real HTTP 405 this
 * fixes), the optional `cancel_url` (preserved for completeness even
 * though nothing calls it yet), and the originally-requested duration
 * (the real queue status/result endpoints never report back how many
 * seconds were actually billed, so this has to travel with the handle).
 *
 * Deliberately a plain JSON string, not a class/Map/anything in-process —
 * this is exactly what makes it safe to persist verbatim across a process
 * restart, an Inngest step boundary, or any other serverless execution
 * boundary (Task 2's real requirement). Contains no secret: the API key
 * never appears here, only in the Authorization header built fresh from
 * process.env on every call.
 */
interface KlingJobHandle {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string | null;
  durationSeconds: number;
}

function encodeJobHandle(handle: KlingJobHandle): string {
  return JSON.stringify(handle);
}

function decodeJobHandle(jobHandle: string): KlingJobHandle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jobHandle);
  } catch {
    throw new Error(`Malformed Kling jobHandle (not valid JSON): "${jobHandle}".`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).requestId !== "string" ||
    !(parsed as Record<string, unknown>).requestId ||
    typeof (parsed as Record<string, unknown>).statusUrl !== "string" ||
    !(parsed as Record<string, unknown>).statusUrl ||
    typeof (parsed as Record<string, unknown>).responseUrl !== "string" ||
    !(parsed as Record<string, unknown>).responseUrl ||
    typeof (parsed as Record<string, unknown>).durationSeconds !== "number" ||
    !Number.isFinite((parsed as Record<string, unknown>).durationSeconds as number)
  ) {
    throw new Error(`Malformed Kling jobHandle (missing required fields): "${jobHandle}".`);
  }
  const candidate = parsed as Record<string, unknown>;
  return {
    requestId: candidate.requestId as string,
    statusUrl: candidate.statusUrl as string,
    responseUrl: candidate.responseUrl as string,
    cancelUrl: typeof candidate.cancelUrl === "string" ? candidate.cancelUrl : null,
    durationSeconds: candidate.durationSeconds as number,
  };
}

export class KlingVideoProvider implements AsyncMediaProvider<VideoRequest> {
  readonly key = "fal-ai";
  readonly capability = "video" as const;

  private apiKey(): string {
    const key = process.env.FAL_KEY;
    if (!key) {
      throw new Error("FAL_KEY is not set — see .env.example.");
    }
    return key;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Key ${this.apiKey()}` };
  }

  private buildRequestBody(req: VideoRequest): Record<string, unknown> {
    if (!req.referenceImageUrl) {
      throw new Error(
        "KlingVideoProvider requires referenceImageUrl on every request — this proof never falls back to a referenceless generation.",
      );
    }
    const duration = validateKlingDuration(req.durationSeconds);

    // `elements` is only constructed — and only sent at all — when the
    // caller supplies real, genuinely distinct additional reference
    // images via `referenceImageUrls`. This provider never synthesizes
    // that array by duplicating `referenceImageUrl` itself: fal's own
    // docs require reference_image_urls to accompany frontal_image_url
    // (1-3 images, at least one) but never state that reusing the same
    // image across both fields is valid — see this file's module doc
    // comment. Without a real second image, the request simply omits
    // `elements`; `start_image_url` alone is still a complete, valid,
    // genuinely reference-conditioned request per fal's own schema.
    let elements: Array<Record<string, unknown>> | undefined;
    let prompt = req.prompt;
    if (req.referenceImageUrls) {
      const count = req.referenceImageUrls.length;
      if (count < MIN_REFERENCE_IMAGES || count > MAX_REFERENCE_IMAGES) {
        throw new Error(
          `Kling v3 Pro's elements.reference_image_urls supports ${MIN_REFERENCE_IMAGES}-${MAX_REFERENCE_IMAGES} images ` +
            `(got ${count}) — see fal.ai's own documented schema. Never silently truncated or padded.`,
        );
      }
      elements = [{ frontal_image_url: req.referenceImageUrl, reference_image_urls: req.referenceImageUrls }];
      // Required by fal's own documented prompt syntax — an element that
      // isn't referenced in the prompt text has no effect.
      prompt = promptWithElementReference(req.prompt);
    }

    const body: Record<string, unknown> = {
      prompt,
      start_image_url: req.referenceImageUrl,
      duration,
      // Hardcoded — see this file's own module doc comment. Real API
      // default is `true`; never trust the default here.
      generate_audio: false,
    };
    if (elements) {
      body.elements = elements;
    }
    return body;
  }

  /** Priced BEFORE any spend, from the real requested duration — throws on an invalid duration rather than estimating a wrong one. */
  estimateUsd(req: VideoRequest): number {
    const duration = validateKlingDuration(req.durationSeconds);
    return calculateMediaUsdCost("fal-ai", KLING_MODEL, Number(duration));
  }

  /** The real async submission — returns immediately with a jobHandle, never waits for completion. Safe to call from a durable step (e.g. a future Inngest step.run) that then exits and resumes later via poll(). */
  async submit(req: VideoRequest): Promise<{ jobHandle: string }> {
    const body = this.buildRequestBody(req);
    const res = await fetch(`https://queue.fal.run/${KLING_MODEL}`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const rawBody = await res.text();
      throw new MediaProviderError("fal-ai", res.status, rawBody, `Kling video submission failed (${res.status}): ${rawBody}`);
    }
    const data = (await res.json()) as KlingSubmitResponse;
    if (!data.request_id) {
      throw new Error("fal.ai's queue submission response did not include a request_id.");
    }
    // Real, non-negotiable requirement (Task 2): without the authoritative
    // status_url/response_url, this provider has no way to check on or
    // retrieve a real, already-paid-for job — and reconstructing them is
    // exactly the defect this fix exists to remove. Fail loudly rather
    // than silently falling back to a hand-built URL.
    if (!data.status_url || !data.response_url) {
      throw new Error(
        "fal.ai's queue submission response did not include status_url/response_url — " +
          "a real job was already submitted (request_id: " +
          data.request_id +
          ") but this provider refuses to reconstruct a polling URL itself. " +
          "See this file's module doc comment for why.",
      );
    }
    const handle: KlingJobHandle = {
      requestId: data.request_id,
      statusUrl: data.status_url,
      responseUrl: data.response_url,
      cancelUrl: data.cancel_url ?? null,
      durationSeconds: req.durationSeconds,
    };
    return { jobHandle: encodeJobHandle(handle) };
  }

  /** One real status check — never blocks, never loops. A caller (generate() below, or a future Inngest step) decides how/when to call this again. */
  async poll(jobHandle: string): Promise<{ status: "pending" | "done" | "failed"; result?: MediaResult; detail?: string }> {
    const { statusUrl, responseUrl, durationSeconds } = decodeJobHandle(jobHandle);

    // Uses the real, server-issued status_url verbatim — never a
    // reconstructed `https://queue.fal.run/{model}/requests/{id}/status`.
    // This is the exact fix for the real HTTP 405 seen during the live
    // proof run (see module doc comment).
    const statusRes = await fetch(statusUrl, {
      headers: this.authHeaders(),
    });
    if (!statusRes.ok) {
      const rawBody = await statusRes.text();
      throw new MediaProviderError("fal-ai", statusRes.status, rawBody, `Kling status check failed (${statusRes.status}): ${rawBody}`);
    }
    const status = (await statusRes.json()) as KlingStatusResponse;

    if (status.error) {
      return { status: "failed", detail: `${status.error_type ?? "error"}: ${status.error}` };
    }
    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") {
      return { status: "pending", detail: status.status };
    }

    // COMPLETED — fetch the real result separately, exactly as fal.ai's
    // real queue API requires (the status endpoint never carries the
    // output itself). Again, the real server-issued response_url, used
    // verbatim — never reconstructed.
    const resultRes = await fetch(responseUrl, {
      headers: this.authHeaders(),
    });
    if (!resultRes.ok) {
      const rawBody = await resultRes.text();
      throw new MediaProviderError("fal-ai", resultRes.status, rawBody, `Kling result fetch failed (${resultRes.status}): ${rawBody}`);
    }
    const result = (await resultRes.json()) as KlingResultResponse;
    if (!result.video?.url) {
      throw new Error("Kling reported COMPLETED but returned no video.url.");
    }
    const video = result.video;

    const mediaResult: MediaResult = {
      open: async () => {
        const videoRes = await fetch(video.url);
        if (!videoRes.ok || !videoRes.body) {
          throw new MediaProviderError("fal-ai", videoRes.status, "", `Could not download the generated clip from fal.ai: ${videoRes.status}`);
        }
        return videoRes.body as unknown as ReadableStream<Uint8Array>;
      },
      contentType: video.content_type || "video/mp4",
      // fal.ai's real response reports file_size but not the actual
      // rendered duration — never guessed here; byteSize is measured,
      // durationSeconds stays null until the real written bytes are
      // independently measured (matching this codebase's existing
      // "never invent a byte count or duration" discipline for every
      // other provider).
      byteSize: video.file_size ?? null,
      durationSeconds: null,
      width: null,
      height: null,
      providerAssetId: null,
      usage: {
        provider: "fal-ai",
        model: KLING_MODEL,
        unit: "seconds",
        quantity: durationSeconds,
        usdCost: calculateMediaUsdCost("fal-ai", KLING_MODEL, durationSeconds),
      },
    };
    return { status: "done", result: mediaResult };
  }

  /**
   * A synchronous convenience wrapper over submit()+poll() for this
   * proof's own harness — genuinely just submit() then a bounded poll
   * loop, no logic that a future Inngest-based caller couldn't replicate
   * with step.sleep() instead of setTimeout(). Never the primary
   * integration point once real production wiring happens — submit()/
   * poll() are.
   */
  async generate(req: VideoRequest): Promise<MediaResult> {
    const { jobHandle } = await this.submit(req);
    const POLL_INTERVAL_MS = 5000;
    // Generous but real and bounded — Kling clips have been observed
    // (per this proof's own investigation of comparable fal.ai video
    // models) to take minutes, not seconds; this is a real ceiling, not
    // an assumption of instant completion.
    const TIMEOUT_MS = 10 * 60 * 1000;
    const startedAt = Date.now();

    for (;;) {
      const outcome = await this.poll(jobHandle);
      if (outcome.status === "done" && outcome.result) return outcome.result;
      if (outcome.status === "failed") {
        throw new MediaProviderError("fal-ai", 0, outcome.detail ?? "", `Kling video generation failed: ${outcome.detail ?? "unknown error"}`);
      }
      if (Date.now() - startedAt > TIMEOUT_MS) {
        throw new Error(`Kling video generation timed out after ${Math.round(TIMEOUT_MS / 1000)}s (jobHandle: ${jobHandle}).`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  async lookup(): Promise<MediaResult | null> {
    // A REAL, KNOWN GAP, not an oversight: unlike every synchronous
    // provider (where "has this idempotencyKey already been paid for" is
    // answered one layer up by checking content_assets before ever
    // calling generate() again), a genuinely async job can crash between
    // submit() (real spend already committed) and a completed poll(),
    // with nothing durable yet recording fal's own request_id anywhere
    // this function could recover it from. Solving that needs a real
    // persisted submit->request_id mapping — deliberately out of scope
    // for this minimal proof (see CLAUDE.md's own migration plan, step 2)
    // — returning null here is honest about that gap, not a cut corner
    // pretending to be resumable.
    return null;
  }
}
