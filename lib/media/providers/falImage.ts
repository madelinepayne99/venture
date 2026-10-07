import "server-only";
import type { ImageProvider, ImageRequest, MediaResult } from "../types";
import { MediaProviderError } from "../types";
import { calculateMediaUsdCost } from "../pricing";

const FAL_MODEL = "fal-ai/flux/schnell";
// Real, documented image-to-image model on the same fal.ai account —
// accepts a reference `image_url` alongside a new per-call `prompt`,
// explicitly marketed for preserving a consistent character/subject
// across different scenes (see this codebase's own reference-image
// continuity design). Confirmed via fal.ai's own model/API docs, not
// guessed: real request fields are `prompt`, `image_url` (required),
// `aspect_ratio` (a string enum including "9:16", not a width/height
// object like flux/schnell), `seed`, `num_images`. Real documented price:
// $0.04/image (see pricing.ts) — ~13x flux/schnell's per-image cost,
// which is exactly why this is only used when a reference image genuinely
// needs to be conditioned against, never as a blanket replacement.
const FAL_KONTEXT_MODEL = "fal-ai/flux-pro/kontext";

function aspectToSize(aspect: ImageRequest["aspectRatio"]): { width: number; height: number } {
  switch (aspect) {
    case "9:16":
      return { width: 768, height: 1344 };
    case "16:9":
      return { width: 1344, height: 768 };
    case "1:1":
      return { width: 1024, height: 1024 };
  }
}

interface FalImageResponse {
  images: Array<{ url: string; width: number; height: number; content_type: string }>;
}

/**
 * fal.ai's synchronous image endpoints (fal.run/{model-id}) — real HTTP
 * calls to a real, documented aggregator API, not a stub. Chosen per
 * CLAUDE.md's Content Bot milestone: one account covers both C1's image
 * generation and C1.5's future video generation, and swapping which model
 * fal.ai hosts is a one-line change here, not a new integration.
 *
 * Two real models are wired up here, selected per-request by whether a
 * reference image is present (ImageRequest.referenceImageUrl) — never by
 * a separate provider/env setting, since both live behind the same
 * FAL_KEY account and the choice is a per-call decision the pipeline
 * itself makes (plain generation for the reference image's own creation;
 * reference-conditioned generation for every beat/thumbnail after it).
 */
export class FalImageProvider implements ImageProvider {
  readonly key = "fal-ai";
  readonly capability = "image" as const;

  private apiKey(): string {
    const key = process.env.FAL_KEY;
    if (!key) {
      throw new Error("FAL_KEY is not set — see .env.example.");
    }
    return key;
  }

  private modelFor(req: ImageRequest): string {
    return req.referenceImageUrl ? FAL_KONTEXT_MODEL : FAL_MODEL;
  }

  estimateUsd(req: ImageRequest): number {
    return calculateMediaUsdCost("fal-ai", this.modelFor(req), 1);
  }

  async generate(req: ImageRequest): Promise<MediaResult> {
    const model = this.modelFor(req);
    const body = req.referenceImageUrl
      ? {
          prompt: req.prompt,
          image_url: req.referenceImageUrl,
          aspect_ratio: req.aspectRatio,
          num_images: 1,
        }
      : {
          prompt: req.prompt,
          image_size: aspectToSize(req.aspectRatio),
          num_images: 1,
          ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        };

    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const rawBody = await res.text();
      throw new MediaProviderError("fal-ai", res.status, rawBody, `fal.ai image generation failed (${res.status}): ${rawBody}`);
    }
    const data = (await res.json()) as FalImageResponse;
    const image = data.images?.[0];
    if (!image) {
      throw new Error("fal.ai returned no image in its response.");
    }

    return {
      open: async () => {
        const imgRes = await fetch(image.url);
        if (!imgRes.ok || !imgRes.body) {
          throw new MediaProviderError("fal-ai", imgRes.status, "", `Could not download the generated image from fal.ai: ${imgRes.status}`);
        }
        return imgRes.body as unknown as ReadableStream<Uint8Array>;
      },
      contentType: image.content_type || "image/jpeg",
      // Measured from real written bytes once the pipeline actually writes
      // to storage — fal.ai's response doesn't itself report a byte size.
      byteSize: null,
      durationSeconds: null,
      width: image.width,
      height: image.height,
      providerAssetId: null,
      usage: {
        provider: "fal-ai",
        model,
        unit: "images",
        quantity: 1,
        usdCost: calculateMediaUsdCost("fal-ai", model, 1),
      },
    };
  }

  async lookup(): Promise<MediaResult | null> {
    // fal.ai's synchronous image endpoint is stateless — there is no
    // persisted job to look up by idempotency key the way an async queue
    // job would have. Real crash recovery for this provider is handled
    // one layer up: the pipeline checks content_assets (keyed by the same
    // idempotency key used as the storage key) before ever calling
    // generate() — see contentWorkflow.ts's runContentProductionPipeline.
    return null;
  }
}
