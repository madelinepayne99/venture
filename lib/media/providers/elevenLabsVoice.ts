import "server-only";
import type { VoiceProvider, VoiceRequest, VoiceMediaResult, VoiceWordTiming } from "../types";
import { calculateMediaUsdCost } from "../pricing";

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsTimestampedResponse {
  audio_base64: string;
  alignment: ElevenLabsAlignment | null;
}

/** Groups ElevenLabs' character-level alignment into word-level timings — the real, structured input captions are built from (no separate ASR call needed). */
function buildWordTimings(alignment: ElevenLabsAlignment | null): VoiceWordTiming[] {
  if (!alignment) return [];
  const words: VoiceWordTiming[] = [];
  let currentWord = "";
  let wordStart: number | null = null;
  let wordEnd = 0;

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i] ?? "";
    const start = alignment.character_start_times_seconds[i] ?? wordEnd;
    const end = alignment.character_end_times_seconds[i] ?? start;
    if (/\s/.test(ch)) {
      if (currentWord) {
        words.push({ word: currentWord, startSeconds: wordStart ?? start, endSeconds: wordEnd });
        currentWord = "";
        wordStart = null;
      }
      continue;
    }
    if (wordStart === null) wordStart = start;
    currentWord += ch;
    wordEnd = end;
  }
  if (currentWord) {
    words.push({ word: currentWord, startSeconds: wordStart ?? 0, endSeconds: wordEnd });
  }
  return words;
}

/**
 * ElevenLabs' real `/v1/text-to-speech/{voice_id}/with-timestamps`
 * endpoint — chosen specifically because it returns real word-level
 * timing alongside the audio in one call, which is what lets Content
 * Bot's captions be derived for free (see runContentProductionPipeline)
 * instead of needing a separate transcription provider.
 */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly key = "elevenlabs";
  readonly capability = "voice" as const;
  private cachedVoiceId: string | undefined;

  private apiKey(): string {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new Error("ELEVENLABS_API_KEY is not set — see .env.example.");
    }
    return key;
  }

  private modelId(): string {
    return process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
  }

  /**
   * Resolves a real voice id on the configured account — never hardcoded,
   * since a specific voice id from one account may not exist on another.
   * `ELEVENLABS_VOICE_ID` overrides this when the founders want a
   * specific voice; otherwise the account's first available voice is used
   * and cached for the life of the process.
   */
  private async resolveVoiceId(): Promise<string> {
    const configured = process.env.ELEVENLABS_VOICE_ID;
    if (configured) return configured;
    if (this.cachedVoiceId) return this.cachedVoiceId;

    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": this.apiKey() },
    });
    if (!res.ok) {
      throw new Error(`Could not list ElevenLabs voices (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { voices: Array<{ voice_id: string }> };
    const first = data.voices?.[0];
    if (!first) {
      throw new Error("This ElevenLabs account has no voices available to use.");
    }
    this.cachedVoiceId = first.voice_id;
    return first.voice_id;
  }

  estimateUsd(req: VoiceRequest): number {
    return calculateMediaUsdCost("elevenlabs", this.modelId(), req.text.length);
  }

  async generate(req: VoiceRequest): Promise<VoiceMediaResult> {
    const voiceId = await this.resolveVoiceId();
    const stability = req.pace === "slow" ? 0.65 : req.pace === "brisk" ? 0.35 : 0.5;

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: req.text,
        model_id: this.modelId(),
        voice_settings: { stability, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs voice generation failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as ElevenLabsTimestampedResponse;
    const audioBytes = Buffer.from(data.audio_base64, "base64");
    const alignment = buildWordTimings(data.alignment);
    const durationSeconds = alignment.length > 0 ? alignment[alignment.length - 1]!.endSeconds : null;

    return {
      open: async () => {
        const uint8 = new Uint8Array(audioBytes);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(uint8);
            controller.close();
          },
        });
      },
      contentType: "audio/mpeg",
      byteSize: audioBytes.byteLength,
      durationSeconds,
      width: null,
      height: null,
      providerAssetId: null,
      usage: {
        provider: "elevenlabs",
        model: this.modelId(),
        unit: "characters",
        quantity: req.text.length,
        usdCost: calculateMediaUsdCost("elevenlabs", this.modelId(), req.text.length),
      },
      alignment,
    };
  }

  async lookup(): Promise<VoiceMediaResult | null> {
    // Same reasoning as FalImageProvider — a stateless synchronous call
    // with no persisted job to look up. See contentWorkflow.ts's
    // runContentProductionPipeline for the real crash-recovery mechanism.
    return null;
  }
}
