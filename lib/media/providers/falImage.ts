import "server-only";
import type { ImageProvider, ImageRequest, MediaResult } from "../types";
import { calculateMediaUsdCost } from "../pricing";

const FAL_MODEL = "fal-ai/flux/schnell";

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
 * fal.ai's synchronous image endpoint (fal.run/{model-id}) — a real HTTP
 * call to a real, documented aggregator API, not a stub. Chosen per
 * CLAUDE.md's Content Bot milestone: one account covers both C1's image
 * generation and C1.5's future video generation, and swapping which model
 * fal.ai hosts is a one-line change here, not a new integration.
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

  estimateUsd(): number {
    return calculateMediaUsdCost("fal-ai", FAL_MODEL, 1);
  }

  async generate(req: ImageRequest): Promise<MediaResult> {
    const { width, height } = aspectToSize(req.aspectRatio);
    const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: req.prompt,
        image_size: { width, height },
        num_images: 1,
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`fal.ai image generation failed (${res.status}): ${await res.text()}`);
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
          throw new Error(`Could not download the generated image from fal.ai: ${imgRes.status}`);
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
        model: FAL_MODEL,
        unit: "images",
        quantity: 1,
        usdCost: calculateMediaUsdCost("fal-ai", FAL_MODEL, 1),
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
