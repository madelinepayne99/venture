import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceRequest } from "@/lib/media/types";

// A real, live bug (see this codebase's own Production 3 investigation):
// `pace` was previously mapped only to ElevenLabs' `stability` voice
// setting, which ElevenLabs' own API reference confirms does not affect
// speaking rate at all — only voice consistency/expressiveness. Every
// narration was spoken at ElevenLabs' implicit default rate regardless of
// the stated pace. These tests prove the real fix: `pace` now also maps to
// ElevenLabs' real `speed` voice setting (the actual rate control), kept
// fully independent of `stability`.

const ORIGINAL_ENV = { ...process.env };

function baseRequest(pace: VoiceRequest["pace"]): VoiceRequest {
  return {
    idempotencyKey: "voice-key-1",
    audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
    text: "Hello there, this is a test narration.",
    voiceKey: "narrator",
    pace,
  };
}

function fakeTtsResponse() {
  return {
    audio_base64: Buffer.from([1, 2, 3]).toString("base64"),
    alignment: {
      characters: ["h", "i"],
      character_start_times_seconds: [0, 0.1],
      character_end_times_seconds: [0.1, 0.2],
    },
  };
}

describe("ElevenLabsVoiceProvider — pace controls real speaking rate, independently of stability", () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "fake-key-for-tests";
    process.env.ELEVENLABS_VOICE_ID = "fixed-voice-id"; // skips the real voices-list lookup call
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function generateAndCaptureBody(pace: VoiceRequest["pace"]): Promise<{ stability: number; speed: number; similarity_boost: number }> {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeTtsResponse(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ElevenLabsVoiceProvider } = await import("@/lib/media/providers/elevenLabsVoice");
    const provider = new ElevenLabsVoiceProvider();
    await provider.generate(baseRequest(pace));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/text-to-speech/fixed-voice-id/with-timestamps");
    const body = JSON.parse(init.body as string) as { voice_settings: { stability: number; speed: number; similarity_boost: number } };
    return body.voice_settings;
  }

  it("sends the intended speed value for \"slow\" (slower than default) and keeps stability at its own, separate value", async () => {
    const settings = await generateAndCaptureBody("slow");
    expect(settings.speed).toBe(0.85);
    expect(settings.speed).toBeLessThan(1.0); // genuinely slower than ElevenLabs' own default
    expect(settings.stability).toBe(0.65);
    expect(settings.similarity_boost).toBe(0.75);
  });

  it("sends the intended speed value for \"natural\" (ElevenLabs' own default, 1.0)", async () => {
    const settings = await generateAndCaptureBody("natural");
    expect(settings.speed).toBe(1.0);
    expect(settings.stability).toBe(0.5);
  });

  it("sends the intended speed value for \"brisk\" (faster than default) and keeps stability at its own, separate value", async () => {
    const settings = await generateAndCaptureBody("brisk");
    expect(settings.speed).toBe(1.15);
    expect(settings.speed).toBeGreaterThan(1.0); // genuinely faster than ElevenLabs' own default
    expect(settings.stability).toBe(0.35);
  });

  it("speed strictly increases from slow to natural to brisk — pace now genuinely orders real speaking rate", async () => {
    const slow = await generateAndCaptureBody("slow");
    const natural = await generateAndCaptureBody("natural");
    const brisk = await generateAndCaptureBody("brisk");
    expect(slow.speed).toBeLessThan(natural.speed);
    expect(natural.speed).toBeLessThan(brisk.speed);
  });

  it("stability is NOT used as a stand-in for speed — its three values are unchanged from before this fix and vary independently of speed", async () => {
    // Regression guard: stability must keep exactly its pre-existing
    // per-pace values (this was already correct — only speed was missing)
    // — proving the fix added a genuinely separate control rather than
    // repurposing or removing the existing one.
    const slow = await generateAndCaptureBody("slow");
    const natural = await generateAndCaptureBody("natural");
    const brisk = await generateAndCaptureBody("brisk");
    expect([slow.stability, natural.stability, brisk.stability]).toEqual([0.65, 0.5, 0.35]);
    // stability moves in the OPPOSITE direction from speed (slow pace =
    // highest stability, brisk = lowest) — real, independent dials, not
    // two labels for the same underlying number.
    expect(slow.stability).toBeGreaterThan(brisk.stability);
    expect(slow.speed).toBeLessThan(brisk.speed);
  });
});
