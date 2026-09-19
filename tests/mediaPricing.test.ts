import { describe, expect, it } from "vitest";
import { calculateMediaUsdCost } from "@/lib/media/pricing";
import { UnpricedProviderError } from "@/lib/media/types";

describe("media pricing", () => {
  it("prices a real fal.ai image generation per image", () => {
    expect(calculateMediaUsdCost("fal-ai", "fal-ai/flux/schnell", 1)).toBeCloseTo(0.003, 6);
    expect(calculateMediaUsdCost("fal-ai", "fal-ai/flux/schnell", 3)).toBeCloseTo(0.009, 6);
  });

  it("prices real ElevenLabs voice generation per character", () => {
    expect(calculateMediaUsdCost("elevenlabs", "eleven_turbo_v2_5", 1000)).toBeCloseTo(0.05, 6);
    expect(calculateMediaUsdCost("elevenlabs", "eleven_multilingual_v2", 1000)).toBeCloseTo(0.1, 6);
  });

  it("prices a real Shotstack render per second", () => {
    expect(calculateMediaUsdCost("shotstack", "default", 60)).toBeCloseTo(0.07, 6);
  });

  it("throws before any spend is ever recorded for an unpriced model", () => {
    expect(() => calculateMediaUsdCost("fal-ai", "some-future-model", 1)).toThrow(UnpricedProviderError);
  });

  it("throws for an unpriced provider entirely", () => {
    expect(() => calculateMediaUsdCost("some-new-vendor", "any-model", 1)).toThrow(UnpricedProviderError);
  });

  it("never fabricates a zero-cost result for an unknown model/provider pair", () => {
    try {
      calculateMediaUsdCost("elevenlabs", "not-a-real-model", 500);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnpricedProviderError);
    }
  });
});
