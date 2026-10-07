import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  listContentAssets,
  openNextVersion,
  updateContentVersion,
  transitionContentItemState,
  recordContentAsset,
} from "@/lib/db/repositories";
import { MAX_ITEM_SPEND_USD } from "@/lib/domain/contentProduction";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult } from "@/lib/media/types";
import { ScriptBeatSchema } from "@/lib/agents/contentBot/schema";
import { buildVisualClips } from "@/lib/media/providers/shotstackEdit";
import { makeContentPlan, makeCreativeStrategy, setupMissionReadyForProduction, makeFakeVideoProvider } from "./testUtils";

// Offline/real-Postgres coverage for the Content Bot motion-first
// milestone: every beat's Kling v3 Pro video clip (CLAUDE.md's "Content
// Bot must produce its first real motion-first video"). Covers: the
// Content Plan motion schema contract, the real motion-prompt/duration
// helpers, Shotstack's video-vs-image clip construction (never a fake
// camera effect on a real clip), the full pipeline persisting real
// `video_clip` assets and assembling with them, the mandatory cost
// preflight refusing before any video generation call, and resumability
// (a beat whose job was already submitted is polled to completion, never
// resubmitted). No real network call anywhere — every provider here is a
// fixture, exactly like every other full-pipeline test in this suite.

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

vi.mock("@/lib/agents/contentBot", () => ({
  planContentVersion: vi.fn(),
  reviewContentSafety: vi.fn(),
  planCreativeStrategy: vi.fn(),
  reviewVisualQuality: vi.fn(),
  ContentBotError: class ContentBotError extends Error {
    usage: { model: string; inputTokens: number; outputTokens: number };
    constructor(message: string, usage: { model: string; inputTokens: number; outputTokens: number }) {
      super(message);
      this.name = "ContentBotError";
      this.usage = usage;
    }
  },
}));

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function textReadable(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function makeFakeStorage(): StorageProvider {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    key: "fake-storage",
    async put(key, body, contentType): Promise<StoredObject> {
      const bytes = await readAll(body);
      files.set(key, { bytes, contentType });
      return {
        storageProvider: "fake-storage",
        storageKey: key,
        contentType,
        byteSize: bytes.byteLength,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
    async open(key) {
      const f = files.get(key);
      if (!f) throw new Error(`fake storage: missing key ${key}`);
      return { stream: textReadable(f.bytes), contentType: f.contentType, byteSize: f.bytes.byteLength };
    },
    async head(key) {
      const f = files.get(key);
      if (!f) return null;
      return {
        storageProvider: "fake-storage",
        storageKey: key,
        contentType: f.contentType,
        byteSize: f.bytes.byteLength,
        checksumSha256: createHash("sha256").update(f.bytes).digest("hex"),
      };
    },
    async signedReadUrl(key) {
      return `https://fake-storage.test/${encodeURIComponent(key)}`;
    },
  };
}

function makeFakeImageProvider(): ImageProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    key: "fake-image",
    capability: "image",
    calls,
    estimateUsd: () => 0.003,
    async generate(req): Promise<MediaResult> {
      calls.push(req.idempotencyKey);
      return {
        open: async () => textReadable(new Uint8Array([1, 2, 3])),
        contentType: "image/jpeg",
        byteSize: null,
        durationSeconds: null,
        width: 768,
        height: 1344,
        providerAssetId: null,
        usage: { provider: "fake-image", model: "fake-image-model", unit: "images", quantity: 1, usdCost: 0.003 },
      };
    },
    async lookup() {
      return null;
    },
  };
}

function makeFakeVoiceProvider(): VoiceProvider {
  return {
    key: "fake-voice",
    capability: "voice",
    estimateUsd: () => 0.01,
    async generate(req): Promise<VoiceMediaResult> {
      return {
        open: async () => textReadable(new Uint8Array([9, 9, 9])),
        contentType: "audio/mpeg",
        byteSize: 3,
        durationSeconds: 1.3,
        width: null,
        height: null,
        providerAssetId: null,
        usage: { provider: "fake-voice", model: "fake-voice-model", unit: "characters", quantity: req.text.length, usdCost: 0.01 },
        alignment: [{ word: "Here", startSeconds: 0, endSeconds: 0.3 }],
      };
    },
    async lookup() {
      return null;
    },
  };
}

function makeFakeEditProvider(durationSeconds = 45): EditProvider & { lastReq: unknown } {
  const holder: { lastReq: unknown } = { lastReq: null };
  return {
    key: "fake-edit",
    capability: "edit",
    get lastReq() {
      return holder.lastReq;
    },
    estimateUsd: () => 0.05,
    async generate(req): Promise<MediaResult> {
      holder.lastReq = req;
      return {
        open: async () => textReadable(new Uint8Array([1, 2, 3, 4, 5])),
        contentType: "video/mp4",
        byteSize: null,
        durationSeconds,
        width: 1080,
        height: 1920,
        providerAssetId: "render-1",
        usage: { provider: "fake-edit", model: "fake-edit-model", unit: "seconds", quantity: durationSeconds, usdCost: 0.05 },
      };
    },
    async lookup() {
      return null;
    },
  };
}

const BASE_BEAT = {
  index: 0,
  beat_role: "hook" as const,
  narration: "n",
  visual_direction: "v",
  subject_prominence: "full" as const,
  shot_type: "wide" as const,
  camera_movement: "static" as const,
  movement_intensity: "normal" as const,
  transition_in: "cut" as const,
  on_screen_text: null,
  retention_purpose: "r",
  start_seconds: 0,
  end_seconds: 5,
};

describe("ScriptBeatSchema — motion contract (Phase 1)", () => {
  it("rejects a beat missing starting_state/action/ending_state/clip_duration_seconds", () => {
    expect(ScriptBeatSchema.safeParse(BASE_BEAT).success).toBe(false);
  });

  it("accepts a beat with all four motion fields present", () => {
    const result = ScriptBeatSchema.safeParse({
      ...BASE_BEAT,
      starting_state: "s",
      action: "a",
      ending_state: "e",
      clip_duration_seconds: 5,
    });
    expect(result.success).toBe(true);
  });

  it("clip_duration_seconds must be a whole number from 3-15 — Kling's own real documented range", () => {
    const withDuration = (clip_duration_seconds: number) =>
      ScriptBeatSchema.safeParse({ ...BASE_BEAT, starting_state: "s", action: "a", ending_state: "e", clip_duration_seconds });
    expect(withDuration(2).success).toBe(false);
    expect(withDuration(16).success).toBe(false);
    expect(withDuration(5.5).success).toBe(false);
    expect(withDuration(3).success).toBe(true);
    expect(withDuration(15).success).toBe(true);
  });
});

describe("beatMotionPrompt / beatClipDurationSeconds — the real Kling request construction", () => {
  it("combines starting_state/action/ending_state into the real motion prompt sent to the video provider", async () => {
    const { beatMotionPrompt } = await import("@/lib/domain/contentWorkflow");
    const prompt = beatMotionPrompt({
      action: "It turns toward the light and takes two steps forward",
      starting_state: "It stands motionless in the clearing",
      ending_state: "It now faces the light, mid-stride",
      visual_direction: "irrelevant fallback text",
    });
    expect(prompt).toBe(
      "Starting state: It stands motionless in the clearing. Action: It turns toward the light and takes two steps forward Ending state: It now faces the light, mid-stride.",
    );
  });

  it("falls back to visual_direction only when action is genuinely absent (a plan predating this milestone)", async () => {
    const { beatMotionPrompt } = await import("@/lib/domain/contentWorkflow");
    const prompt = beatMotionPrompt({
      action: "" as unknown as string,
      starting_state: "" as unknown as string,
      ending_state: "" as unknown as string,
      visual_direction: "a static scene description",
    });
    expect(prompt).toBe("a static scene description");
  });

  it("beatClipDurationSeconds uses the beat's own real value when present", async () => {
    const { beatClipDurationSeconds } = await import("@/lib/domain/contentWorkflow");
    expect(beatClipDurationSeconds({ clip_duration_seconds: 7, start_seconds: 0, end_seconds: 100 })).toBe(7);
  });

  it("beatClipDurationSeconds derives from start/end and clamps into Kling's real 3-15s range when the field is absent (pre-milestone data only)", async () => {
    const { beatClipDurationSeconds } = await import("@/lib/domain/contentWorkflow");
    expect(
      beatClipDurationSeconds({ clip_duration_seconds: undefined as unknown as number, start_seconds: 0, end_seconds: 1 }),
    ).toBe(3);
    expect(
      beatClipDurationSeconds({ clip_duration_seconds: undefined as unknown as number, start_seconds: 0, end_seconds: 30 }),
    ).toBe(15);
    expect(
      beatClipDurationSeconds({ clip_duration_seconds: undefined as unknown as number, start_seconds: 0, end_seconds: 6 }),
    ).toBe(6);
  });
});

describe("Shotstack buildVisualClips — real video clips never get a fake camera-movement effect (Phase 3)", () => {
  it("a video clip entry omits `effect` entirely, even when camera_movement/movement_intensity would normally produce one", () => {
    const clips = buildVisualClips([
      { videoClipStorageKey: "https://x/clip.mp4", startSeconds: 0, endSeconds: 5, cameraMovement: "zoom_in", movementIntensity: "fast", transitionIn: "fade" },
    ]);
    expect(clips[0]!.asset).toEqual({ type: "video", src: "https://x/clip.mp4", trim: 0 });
    expect(clips[0]!.effect).toBeUndefined();
    expect(clips[0]!.transition).toEqual({ in: "fade" });
  });

  it("an image clip entry is unaffected — still gets a real Shotstack effect, exactly as before", () => {
    const clips = buildVisualClips([
      { imageStorageKey: "https://x/still.jpg", startSeconds: 0, endSeconds: 5, cameraMovement: "zoom_in", movementIntensity: "fast", transitionIn: "cut" },
    ]);
    expect(clips[0]!.asset).toEqual({ type: "image", src: "https://x/still.jpg" });
    expect(clips[0]!.effect).toBe("zoomInFast");
  });

  it("throws rather than silently guessing when both or neither of imageStorageKey/videoClipStorageKey are set", () => {
    expect(() =>
      buildVisualClips([{ startSeconds: 0, endSeconds: 5, cameraMovement: "static", movementIntensity: "normal", transitionIn: "cut" }]),
    ).toThrow(/exactly one/);
    expect(() =>
      buildVisualClips([
        { imageStorageKey: "a", videoClipStorageKey: "b", startSeconds: 0, endSeconds: 5, cameraMovement: "static", movementIntensity: "normal", transitionIn: "cut" },
      ]),
    ).toThrow(/exactly one/);
  });
});

describe("Full pipeline — real motion video clips (Phases 2, 4, 5)", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockReset();
    vi.mocked(contentBotModule.reviewContentSafety).mockReset();
    vi.mocked(contentBotModule.planCreativeStrategy).mockReset();
    vi.mocked(contentBotModule.reviewVisualQuality).mockReset();
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }), // 2 beats, per testUtils' own fixture
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 },
    });
    vi.mocked(contentBotModule.reviewContentSafety).mockResolvedValue({
      verdict: { verdict: "pass", reasons: [], concerns: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 200, outputTokens: 100, usdCost: 0.005 },
    });
    vi.mocked(contentBotModule.planCreativeStrategy).mockResolvedValue({
      strategy: makeCreativeStrategy(),
      usage: { model: "claude-sonnet-5", inputTokens: 300, outputTokens: 150, usdCost: 0.006 },
    });
    vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
      report: { overall_verdict: "pass", findings: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 400, outputTokens: 100, usdCost: 0.008 },
    });
  });

  async function createRealContentItem() {
    const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
    const { mission, evidence } = await setupMissionReadyForProduction(founderId);
    return approveForProduction(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
    });
  }

  it("generates a real video_clip asset per beat, and assembly uses videoClipStorageKey (never imageStorageKey) for every beat", async () => {
    const item = await createRealContentItem();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const { getLatestVersion } = await import("@/lib/db/repositories");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");
    expect(video.calls).toHaveLength(2); // exactly one real submission per beat — the fixture plan has 2 beats

    const version = await getLatestVersion(item.id);
    const assets = await listContentAssets(version!.id);
    const videoClipAssets = assets.filter((a) => a.kind === "video_clip");
    expect(videoClipAssets).toHaveLength(2);
    // Real generated bytes, real cost recorded for each — never a zero-byte
    // or free placeholder asset.
    for (const asset of videoClipAssets) {
      expect(asset.byte_size).toBeGreaterThan(0);
    }

    // The exact Phase 3 assembly contract: Shotstack's real request used
    // videoClipStorageKey for every beat, never imageStorageKey (the still
    // stays real and persisted — as the clip's own start frame — but is no
    // longer what assembly hands to Shotstack).
    const editReq = edit.lastReq as { timeline: Array<{ imageStorageKey?: string; videoClipStorageKey?: string }> };
    expect(editReq.timeline).toHaveLength(2);
    for (const entry of editReq.timeline) {
      expect(entry.videoClipStorageKey).toBeTruthy();
      expect(entry.imageStorageKey).toBeUndefined();
    }
  });

  it("the mandatory cost preflight refuses before any real video generation call when the planned total exceeds the remaining budget", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    // 8 beats × 15s × $0.112/s ≈ $13.44 — well over MAX_ITEM_SPEND_USD
    // ($8.00) on its own, before a single real Kling call.
    // 120s × 2.44 words/sec ≈ 293 words total needed to pass the
    // narration-duration guardrail — ~37 words/beat across 8 beats, so
    // this test fails for the real reason it's testing (the spend
    // preflight), not an unrelated narration-length rejection.
    const wordsPerBeat = Array.from({ length: 37 }, (_, w) => `w${w}`).join(" ");
    const expensiveBeats = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      beat_role: "context" as const,
      narration: `beat ${i}: ${wordsPerBeat}`,
      visual_direction: `visual ${i}`,
      starting_state: "s",
      action: "a",
      ending_state: "e",
      clip_duration_seconds: 15,
      subject_prominence: "full" as const,
      shot_type: "wide" as const,
      camera_movement: "static" as const,
      movement_intensity: "normal" as const,
      transition_in: "cut" as const,
      on_screen_text: null,
      retention_purpose: "r",
      start_seconds: i * 15,
      end_seconds: i * 15 + 15,
    }));
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [], duration_seconds: 120, script: expensiveBeats }),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 },
    });

    const item = await createRealContentItem();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toMatch(/production budget/i);
    // The real, structural point of this test: zero real video generation
    // calls happened — the preflight refused before the first submit().
    expect(video.calls).toHaveLength(0);
  });

  it("resumability: a beat whose job was already submitted (persisted job handle, no video_clip asset yet) is polled to completion, never resubmitted", async () => {
    const item = await createRealContentItem();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { storageKeysFor } = await import("@/lib/domain/contentWorkflow");
    const plan = makeContentPlan({ claims: [] }); // 2 beats (index 0, 1)

    // Manually replicate what a real run would have committed before a
    // crash: a version with its plan/safety_verdict already set, every
    // still/audio/caption/thumbnail asset already stored (asset_generation
    // already completed), and — the state this test is actually about —
    // beat 0's real Kling job already submitted and its handle durably
    // persisted, but NOT YET polled to completion (no video_clip asset for
    // it exists yet). Beat 1 has no job handle at all — a genuinely fresh
    // beat this resumed run must still submit normally.
    const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    await updateContentVersion(version.id, { plan });
    await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
    const started = await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
    expect(started.ok).toBe(true);

    const keys = storageKeysFor(item.id, version.id);
    async function seedAsset(
      key: string,
      kind: "audio" | "thumbnail" | "image" | "caption_track",
      contentType: string,
      dimensions?: { width: number; height: number },
    ) {
      const stored = await storage.put(key, textReadable(new Uint8Array([1, 2, 3])), contentType);
      await recordContentAsset({
        contentVersionId: version.id,
        kind,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      });
    }
    await seedAsset(keys.audio, "audio", "audio/mpeg");
    await storage.put(
      keys.alignment,
      textReadable(new TextEncoder().encode(JSON.stringify([{ word: "x", startSeconds: 0, endSeconds: 1 }]))),
      "application/json",
    );
    await seedAsset(keys.captions, "caption_track", "text/vtt");
    await seedAsset(keys.thumbnail, "thumbnail", "image/jpeg", { width: 768, height: 1344 });
    await seedAsset(keys.image(0), "image", "image/jpeg");
    await seedAsset(keys.image(1), "image", "image/jpeg");

    // Beat 0's "already submitted, not yet polled" real job — the exact
    // shape runVideoClipGenerationStage itself writes (a jobHandle string
    // from the real provider, persisted the instant submission succeeds).
    const alreadySubmittedHandle = JSON.stringify({ n: 999, durationSeconds: 5 }); // matches makeFakeVideoProvider's own jobHandle shape
    await storage.put(
      keys.videoClipJob(0),
      textReadable(new TextEncoder().encode(JSON.stringify({ jobHandle: alreadySubmittedHandle, submittedAt: new Date().toISOString() }))),
      "application/json",
    );

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");
    // The real point of this test: exactly ONE real new submission (beat
    // 1) — beat 0's already-live job was recovered and polled, never
    // resubmitted.
    expect(video.calls).toHaveLength(1);
    expect(video.calls[0]!.idempotencyKey).toBe(keys.videoClip(1));

    const assets = await listContentAssets(version.id);
    const videoClipAssets = assets.filter((a) => a.kind === "video_clip");
    expect(videoClipAssets).toHaveLength(2); // both beats' clips genuinely completed — one recovered, one freshly submitted
  });
});
