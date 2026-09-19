import "server-only";
import type { ImageProvider, VoiceProvider, VideoProvider, CaptionProvider, EditProvider, MediaDeps } from "./types";
import { NoProviderConfiguredError } from "./types";
import { FalImageProvider } from "./providers/falImage";
import { ElevenLabsVoiceProvider } from "./providers/elevenLabsVoice";
import { ShotstackEditProvider } from "./providers/shotstackEdit";

// Env-key-selected, singleton-per-process, exactly like
// lib/agents/anthropicClient.ts's getAnthropicClient(). The pipeline
// always takes an injectable `deps: MediaDeps` (see contentWorkflow.ts)
// so tests never touch this registry or make a real network call — these
// getters are only ever invoked from real request-handling code.
//
// No stub or placeholder provider is registered for any capability. A
// missing MEDIA_*_PROVIDER env var is a real, honest, visible failure
// (NoProviderConfiguredError) — never a silently-faked asset.

let imageProvider: ImageProvider | undefined;
let voiceProvider: VoiceProvider | undefined;
let editProvider: EditProvider | undefined;

export function getImageProvider(): ImageProvider {
  if (imageProvider) return imageProvider;
  if (process.env.MEDIA_IMAGE_PROVIDER === "fal-ai") {
    imageProvider = new FalImageProvider();
    return imageProvider;
  }
  throw new NoProviderConfiguredError("image");
}

export function getVoiceProvider(): VoiceProvider {
  if (voiceProvider) return voiceProvider;
  if (process.env.MEDIA_VOICE_PROVIDER === "elevenlabs") {
    voiceProvider = new ElevenLabsVoiceProvider();
    return voiceProvider;
  }
  throw new NoProviderConfiguredError("voice");
}

export function getEditProvider(): EditProvider {
  if (editProvider) return editProvider;
  if (process.env.MEDIA_EDIT_PROVIDER === "shotstack") {
    editProvider = new ShotstackEditProvider();
    return editProvider;
  }
  throw new NoProviderConfiguredError("edit");
}

/**
 * Real generated motion is C1.5's own milestone (see CLAUDE.md's Content
 * Bot milestone) — deliberately no VideoProvider implementation exists
 * yet. This always throws in C1; ContentPlanSchema's production_path
 * field only ever resolves to "assembled_stills" until C1.5 fills this in.
 */
export function getVideoProvider(): VideoProvider {
  throw new NoProviderConfiguredError("video");
}

/**
 * No separate captions provider in C1 — real captions are derived
 * directly from ElevenLabs' own word-level alignment data (see
 * ElevenLabsVoiceProvider and runContentProductionPipeline), which needs
 * no transcription call at all. This interface stays available for a
 * future fallback (e.g. a Whisper-based provider, if a later voice
 * provider lacks alignment output) without any other change.
 */
export function getCaptionProvider(): CaptionProvider {
  throw new NoProviderConfiguredError("captions");
}

export type { MediaDeps };
