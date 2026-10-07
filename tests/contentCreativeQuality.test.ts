import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, listVersionsWithAssets, listActivity, recordCost } from "@/lib/db/repositories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult, VoiceWordTiming } from "@/lib/media/types";
import { MAX_QC_REGENERATIONS_PER_VERSION, MAX_ITEM_SPEND_USD } from "@/lib/domain/contentProduction";
import { CreativeStrategySchema, ContentPlanSchema } from "@/lib/agents/contentBot/schema";
import { CAMERA_MOVEMENTS, MOVEMENT_INTENSITIES } from "@/lib/media/types";
import { shotstackEffect, TRANSITION_TO_SHOTSTACK, buildTitleClips, buildTimeline } from "@/lib/media/providers/shotstackEdit";
import { assertNoNamedIP, assertAudienceAppropriate } from "@/lib/agents/contentBot/guardrails";
import { makeContentPlan, makeCreativeStrategy, setupMissionReadyForProduction, makeProductionBrief, makeFakeVideoProvider } from "./testUtils";

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

/** Captures every prompt it's asked to generate an image for — the key tool for proving text/disclosure/continuity never leak into or out of image prompts incorrectly. */
function makeCapturingImageProvider(): ImageProvider & { prompts: string[]; calls: string[] } {
  const prompts: string[] = [];
  const calls: string[] = [];
  return {
    key: "fake-image",
    capability: "image",
    prompts,
    calls,
    estimateUsd: () => 0.003,
    async generate(req): Promise<MediaResult> {
      calls.push(req.idempotencyKey);
      prompts.push(req.prompt);
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
        alignment: [
          { word: "Here", startSeconds: 0, endSeconds: 0.3 },
          { word: "are", startSeconds: 0.3, endSeconds: 0.5 },
          { word: "five", startSeconds: 0.5, endSeconds: 0.8 },
          { word: "games.", startSeconds: 0.8, endSeconds: 1.3 },
        ],
      };
    },
    async lookup() {
      return null;
    },
  };
}

function makeFakeEditProvider(durationSeconds = 46): EditProvider & { calls: number; lastReq: unknown } {
  let calls = 0;
  let lastReq: unknown;
  return {
    key: "fake-edit",
    capability: "edit",
    get calls() {
      return calls;
    },
    get lastReq() {
      return lastReq;
    },
    estimateUsd: () => 0.05,
    async generate(req): Promise<MediaResult> {
      calls += 1;
      lastReq = req;
      return {
        open: async () => textReadable(new Uint8Array([1, 2, 3, 4, 5])),
        contentType: "video/mp4",
        byteSize: null,
        // Matches makeContentPlan()'s default 45s target within
        // assertAssetsMatchPlan's 15s tolerance by default — tests using a
        // plan with a meaningfully different duration_seconds pass their
        // own matching durationSeconds here instead.
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
  vi.mocked(contentBotModule.reviewContentSafety).mockResolvedValue({
    verdict: { verdict: "pass", reasons: [], concerns: [] },
    usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
  });
  vi.mocked(contentBotModule.planCreativeStrategy).mockResolvedValue({
    strategy: makeCreativeStrategy(),
    usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
  });
  // findings holds only genuine problems now — a clean pass is empty.
  vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
    report: { overall_verdict: "pass", findings: [] },
    usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
  });
});

/** Shared setup: a real content item at "planning", ready for the pipeline to run against fixture providers. */
async function createHarness() {
  const { mission, evidence } = await setupMissionReadyForProduction(founderId);
  const { approveForProduction } = await import("@/lib/domain/contentWorkflow");
  const item = await approveForProduction(mission.id, founderId, {
    targetPlatform: "youtube_shorts",
    audience: "general",
    contentType: "educational",
    selectedEvidenceIds: [evidence[0]!.id],
  });
  return { item, mission };
}

describe("Creative Quality schemas", () => {
  it("CreativeStrategySchema accepts a real, compact strategy and rejects one missing required fields", () => {
    const valid = CreativeStrategySchema.safeParse({
      hook_mechanic: "x",
      visual_hook: "x",
      pacing: { target_cut_count: 5, rationale: "x" },
      escalation_shape: "x",
      visual_treatment: "x",
      caption_treatment: "x",
      disclosure_treatment: "x",
      retention_strategy: "x",
      evidence_ids_referenced: [],
    });
    expect(valid.success).toBe(true);

    const invalid = CreativeStrategySchema.safeParse({ hook_mechanic: "x" });
    expect(invalid.success).toBe(false);
  });

  it("ContentPlanSchema requires disclosure and hook_visual, and accepts a null visual_identity", () => {
    const plan = makeContentPlan();
    expect(ContentPlanSchema.safeParse(plan).success).toBe(true);

    const { disclosure: _drop, ...withoutDisclosure } = plan;
    expect(ContentPlanSchema.safeParse(withoutDisclosure).success).toBe(false);

    expect(ContentPlanSchema.safeParse({ ...plan, visual_identity: null }).success).toBe(true);
  });
});

describe("motion/transition vocabulary — constrained to real, verified Shotstack values only", () => {
  const REAL_EFFECT_PATTERN = /^(zoomIn|zoomOut|slideLeft|slideRight|slideUp|slideDown)(Slow|Fast)?$/;

  it("every camera_movement/movement_intensity combination maps to undefined (static) or a real Shotstack effect string", () => {
    for (const movement of CAMERA_MOVEMENTS) {
      for (const intensity of MOVEMENT_INTENSITIES) {
        const effect = shotstackEffect(movement, intensity);
        if (movement === "static") {
          expect(effect).toBeUndefined();
        } else {
          expect(effect).toMatch(REAL_EFFECT_PATTERN);
        }
      }
    }
  });

  it("every transition_in value (other than cut) maps to a real Shotstack transition string", () => {
    const REAL_TRANSITIONS = new Set(["fade", "wipeLeft", "wipeRight", "slideLeft", "slideRight", "slideUp", "slideDown", "zoom"]);
    for (const value of Object.values(TRANSITION_TO_SHOTSTACK)) {
      expect(REAL_TRANSITIONS.has(value)).toBe(true);
    }
  });

  it("buildTimeline never emits a fabricated effect/transition, and 'cut'/'static' omit those properties entirely", () => {
    const timeline = buildTimeline(
      {
        idempotencyKey: "k",
        audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
        timeline: [
          { imageStorageKey: "img1", startSeconds: 0, endSeconds: 5, cameraMovement: "static", movementIntensity: "normal", transitionIn: "cut" },
          { imageStorageKey: "img2", startSeconds: 5, endSeconds: 10, cameraMovement: "zoom_in", movementIntensity: "fast", transitionIn: "fade" },
        ],
        voiceoverStorageKey: "voice.mp3",
        aspectRatio: "9:16",
      },
      "voice.mp3",
      null,
    );

    const imageTrack = timeline.tracks.find((t) => t.clips.some((c) => (c.asset as { type: string }).type === "image"))!;
    const [clip1, clip2] = imageTrack.clips as Array<Record<string, unknown>>;
    expect(clip1!.effect).toBeUndefined();
    expect(clip1!.transition).toBeUndefined();
    expect(clip2!.effect).toBe("zoomInFast");
    expect((clip2!.transition as { in: string }).in).toBe("fade");
  });
});

describe("text/disclosure separation — structural rendering, never baked into an image prompt", () => {
  it("buildTitleClips produces real TitleAsset clips for a badge and an end_card, never an image asset", () => {
    const clips = buildTitleClips([
      { text: "AI-generated, fictional content.", startSeconds: 0, endSeconds: 30, style: "badge" },
      { text: "Not real footage.", startSeconds: 27, endSeconds: 30, style: "end_card" },
    ]);
    expect(clips).toHaveLength(2);
    const [badge, endCard] = clips as Array<{ asset: Record<string, unknown> }>;
    expect(badge!.asset.type).toBe("title");
    expect(badge!.asset.text).toBe("AI-generated, fictional content.");
    expect(badge!.asset.background).toBeDefined(); // a badge gets a legibility background
    expect(endCard!.asset.type).toBe("title");
    expect(endCard!.asset.size).toBe("medium");
  });

  it("a full pipeline run never asks the image provider to render disclosure or on-screen text", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    const distinctiveDisclosure = "ZZZ-DISCLOSURE-MARKER-ZZZ";
    const distinctiveOnScreenText = "ZZZ-ONSCREEN-MARKER-ZZZ";
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({
        claims: [],
        duration_seconds: 5, // matches this test's deliberately minimal 1-word filler narration
        disclosure: { text: distinctiveDisclosure, placement: "persistent_badge" },
        script: [
          {
            index: 0,
            beat_role: "hook",
            narration: "n",
            visual_direction: "a bright original scene",
            starting_state: "s",
            action: "a",
            ending_state: "e",
            clip_duration_seconds: 5,
            subject_prominence: "full" as const,
            shot_type: "wide",
            camera_movement: "static",
            movement_intensity: "normal",
            transition_in: "cut",
            on_screen_text: { text: distinctiveOnScreenText, role: "emphasis" },
            retention_purpose: "r",
            start_seconds: 0,
            end_seconds: 5,
          },
        ],
      }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });

    const { item } = await createHarness();
    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider(5);
    const video = makeFakeVideoProvider(); // matches this test's duration_seconds: 5
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");
    for (const prompt of image.prompts) {
      expect(prompt).not.toContain(distinctiveDisclosure);
      expect(prompt).not.toContain(distinctiveOnScreenText);
    }
    // But the final assembled EditRequest DOES carry them, structurally.
    const editReq = edit.lastReq as { onScreenText: Array<{ text: string }> };
    expect(editReq.onScreenText.some((t) => t.text === distinctiveDisclosure)).toBe(true);
    expect(editReq.onScreenText.some((t) => t.text === distinctiveOnScreenText)).toBe(true);
  });
});

describe("visual continuity — canonical_description propagated mechanically into every relevant image prompt", () => {
  it("withVisualIdentity concatenates the canonical description and immutable traits", async () => {
    const { withVisualIdentity } = await import("@/lib/domain/contentWorkflow");
    expect(withVisualIdentity("a scene", null)).toBe("a scene");
    const withId = withVisualIdentity("a scene", {
      canonical_description: "a blue glowing creature",
      immutable_traits: ["glowing blue veins"],
      continuity_notes: "",
      reference_asset_id: null,
    });
    expect(withId).toContain("a scene");
    expect(withId).toContain("a blue glowing creature");
    expect(withId).toContain("glowing blue veins");
  });

  it("every generated still (thumbnail + every beat) carries the canonical description when visual_identity is set", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    const canonical = "ZZZ-CANONICAL-CREATURE-ZZZ";
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({
        claims: [],
        visual_identity: { canonical_description: canonical, immutable_traits: [], continuity_notes: "", reference_asset_id: null },
      }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });

    const { item } = await createHarness();
    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(image.prompts.length).toBeGreaterThan(0);
    for (const prompt of image.prompts) {
      expect(prompt).toContain(canonical);
    }
  });
});

describe("Visual QC — mandatory, bounded regeneration, cost ceiling, and stop-for-review", () => {
  it("is mandatory: reviewVisualQuality is always called, with every generated still shown to it", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
    // findings holds only genuine problems now — a clean pass is an empty array, never one entry per asset.
    vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
      report: { overall_verdict: "pass", findings: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });

    const { item } = await createHarness();
    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");
    expect(contentBotModule.reviewVisualQuality).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(contentBotModule.reviewVisualQuality).mock.calls[0]![0];
    // thumbnail + 2 script beats in the default fixture plan
    expect(callArg.assets).toHaveLength(3);

    const versions = await listVersionsWithAssets(item.id);
    expect((versions[0]!.qc_report as { overall_verdict: string }).overall_verdict).toBe("pass");
    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "visual_qc_passed")).toBe(true);
  });

  it("regenerates exactly the flagged asset (bounded), re-checks only it, and proceeds to assembly once it passes", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
    let qcCallCount = 0;
    vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => {
      qcCallCount += 1;
      if (qcCallCount === 1) {
        // findings holds only genuine problems — only beat_0 gets an entry.
        return {
          report: {
            overall_verdict: "flag",
            findings: assets
              .filter((a) => a.assetRef === "beat_0")
              .map((a) => ({ asset_ref: a.assetRef, issue_types: ["garbled_or_unintended_text" as const], reasons: ["Garbled text baked into the image."] })),
          },
          usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
        };
      }
      // The recheck call — only the regenerated asset is present, and it's
      // now fixed, so findings is empty (nothing left to report).
      expect(assets).toHaveLength(1);
      expect(assets[0]!.assetRef).toBe("beat_0");
      return {
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      };
    });

    const { item } = await createHarness();
    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");
    expect(edit.calls).toBe(1); // assembly genuinely ran
    // 1 thumbnail + 2 stills on the initial pass, plus exactly 1 regeneration.
    expect(image.calls).toHaveLength(4);
    expect(image.calls.filter((k) => k.includes("qc-retry"))).toHaveLength(1);
    expect(qcCallCount).toBe(2); // initial + exactly one recheck — never a third call

    const versions = await listVersionsWithAssets(item.id);
    expect(versions[0]!.qc_regeneration_count).toBe(1);
    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "visual_qc_passed_after_regeneration")).toBe(true);
  });

  it("never loops: if the regenerated asset is flagged again, stops for founder review before assembly — never a second regeneration attempt for it", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
    // findings holds only genuine problems — only "thumbnail" gets an entry,
    // and the recheck (of the regenerated thumbnail) is flagged again too.
    vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => ({
      report: {
        overall_verdict: "flag",
        findings: assets
          .filter((a) => a.assetRef === "thumbnail")
          .map((a) => ({ asset_ref: a.assetRef, issue_types: ["watermark_or_logo" as const], reasons: ["Appears to contain a watermark."] })),
      },
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    }));

    const { item } = await createHarness();
    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("blocked"); // stopped for founder review, never assembled
    expect(edit.calls).toBe(0); // assembly never ran on known-bad assets
    expect(image.calls.filter((k) => k.includes("qc-retry"))).toHaveLength(1); // exactly one regeneration attempt, never a second
    expect(settled.failure_category).toBeNull(); // never eligible for Retry Production

    const versions = await listVersionsWithAssets(item.id);
    expect((versions[0]!.qc_report as { overall_verdict: string }).overall_verdict).toBe("flag");
    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "visual_qc_unresolved")).toBe(true);
  });

  it("enforces the regeneration ceiling: more flagged assets than the cap leaves the excess un-regenerated and unresolved", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    // 4 script beats + 1 thumbnail = 5 checkable assets, all flagged —
    // more than MAX_QC_REGENERATIONS_PER_VERSION (3).
    const manyBeats = Array.from({ length: 4 }, (_, i) => ({
      index: i,
      beat_role: "context" as const,
      narration: `n${i}`,
      visual_direction: `v${i}`,
      starting_state: "s",
      action: "a",
      ending_state: "e",
      clip_duration_seconds: 5,
      subject_prominence: "full" as const,
      shot_type: "wide" as const,
      camera_movement: "static" as const,
      movement_intensity: "normal" as const,
      transition_in: "cut" as const,
      on_screen_text: null,
      retention_purpose: "r",
      start_seconds: i * 5,
      end_seconds: i * 5 + 5,
    }));
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      // duration_seconds matches this test's deliberately minimal filler narration ("n0".."n3").
      plan: makeContentPlan({ claims: [], duration_seconds: 5, script: manyBeats }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
    // Every asset is genuinely flagged here — findings legitimately has one entry per asset.
    vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => ({
      report: {
        overall_verdict: "flag",
        findings: assets.map((a) => ({ asset_ref: a.assetRef, issue_types: ["composition_failure" as const], reasons: ["Broken."] })),
      },
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    }));

    const { item } = await createHarness();
    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("blocked");
    expect(edit.calls).toBe(0);
    // Exactly MAX_QC_REGENERATIONS_PER_VERSION regenerations, never all 5 flagged assets.
    expect(image.calls.filter((k) => k.includes("qc-retry"))).toHaveLength(MAX_QC_REGENERATIONS_PER_VERSION);

    const versions = await listVersionsWithAssets(item.id);
    expect(versions[0]!.qc_regeneration_count).toBe(MAX_QC_REGENERATIONS_PER_VERSION);
    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "visual_qc_unresolved" && a.detail?.includes("regeneration cap reached"))).toBe(true);
  });

  it("a QC regeneration can never bypass the per-item spend cap", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
    vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => ({
      report: {
        overall_verdict: "flag",
        findings: assets
          .filter((a) => a.assetRef === "beat_0")
          .map((a) => ({ asset_ref: a.assetRef, issue_types: ["subject_mismatch" as const], reasons: ["Wrong subject."] })),
      },
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    }));

    const { item } = await createHarness();
    // Pre-load spend right up to the cap — the QC regeneration's own
    // pre-flight budget check must refuse before spending anything more.
    await recordCost({
      missionId: null,
      agentId: null,
      contentItemId: item.id,
      model: "n/a",
      usdCost: MAX_ITEM_SPEND_USD - 0.001,
      provider: "test-fixture",
      unit: "seconds",
      quantity: 1,
    });

    const image = makeCapturingImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("failed"); // a genuine budget refusal, not a fabricated pass
    expect(settled.failure_reason).toContain("budget");
    expect(settled.failure_category).toBe("budget_exhausted");
    expect(image.calls.filter((k) => k.includes("qc-retry"))).toHaveLength(0); // refused before any real regeneration spend
    expect(edit.calls).toBe(0);
  });
});

describe("caption chunking — phrase-aware, short-form-native groups", () => {
  it("breaks into groups of at most 4 words", async () => {
    const { buildCaptionVtt } = await import("@/lib/domain/contentWorkflow");
    const alignment: VoiceWordTiming[] = [
      { word: "one", startSeconds: 0, endSeconds: 0.2 },
      { word: "two", startSeconds: 0.2, endSeconds: 0.4 },
      { word: "three", startSeconds: 0.4, endSeconds: 0.6 },
      { word: "four", startSeconds: 0.6, endSeconds: 0.8 },
      { word: "five", startSeconds: 0.8, endSeconds: 1.0 },
      { word: "six", startSeconds: 1.0, endSeconds: 1.2 },
    ];
    const vtt = buildCaptionVtt(alignment);
    const textLines = vtt.split("\n").filter((l) => l && !l.includes("-->") && l !== "WEBVTT");
    for (const line of textLines) {
      expect(line.split(" ").length).toBeLessThanOrEqual(4);
    }
  });

  it("breaks early right after sentence-ending punctuation once a cue has at least 2 words", async () => {
    const { buildCaptionVtt } = await import("@/lib/domain/contentWorkflow");
    const alignment: VoiceWordTiming[] = [
      { word: "This", startSeconds: 0, endSeconds: 0.2 },
      { word: "works.", startSeconds: 0.2, endSeconds: 0.4 },
      { word: "Then", startSeconds: 0.4, endSeconds: 0.6 },
      { word: "more.", startSeconds: 0.6, endSeconds: 0.8 },
    ];
    const vtt = buildCaptionVtt(alignment);
    const textLines = vtt.split("\n").filter((l) => l && !l.includes("-->") && l !== "WEBVTT");
    expect(textLines).toEqual(["This works.", "Then more."]);
  });
});

describe("existing guardrails still cover the new Creative Quality fields (generic recursive walk, no maintained list)", () => {
  it("assertNoNamedIP rejects imitation language inside hook_visual", () => {
    const plan = makeContentPlan({ hook_visual: "Shot in the style of a famous director." });
    const brief = makeProductionBrief();
    expect(() => assertNoNamedIP(plan, brief)).toThrow(/imitation language/i);
  });

  it("assertAudienceAppropriate rejects a banned phrase inside a beat's on_screen_text", () => {
    const plan = makeContentPlan({
      script: [
        {
          index: 0,
          beat_role: "hook",
          narration: "n",
          visual_direction: "v",
          starting_state: "s",
          action: "a",
          ending_state: "e",
          clip_duration_seconds: 5,
          subject_prominence: "full" as const,
          shot_type: "wide",
          camera_movement: "static",
          movement_intensity: "normal",
          transition_in: "cut",
          on_screen_text: { text: "Subscribe now!", role: "emphasis" },
          retention_purpose: "r",
          start_seconds: 0,
          end_seconds: 5,
        },
      ],
    });
    expect(() =>
      assertAudienceAppropriate(plan, { platform: "youtube_shorts", audience: "kids", contentType: "story", workspaceType: "commerce" }),
    ).toThrow(/kids/i);
  });
});
