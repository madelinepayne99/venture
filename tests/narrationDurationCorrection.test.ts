import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, listActivity } from "@/lib/db/repositories";
import { MEASURED_WORDS_PER_SECOND, acceptableNarrationWordRange } from "@/lib/agents/contentBot/guardrails";
import { buildContentPlanSystemPrompt, buildGuardrailCorrectionUserPrompt } from "@/lib/agents/contentBot/prompt";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, VideoProvider, MediaResult, VoiceMediaResult } from "@/lib/media/types";
import {
  makeContentPlan,
  makeCreativeStrategy,
  makeProductionBrief,
  makeAudienceContext,
  setupMissionReadyForProduction,
  makeFakeVideoProvider,
} from "./testUtils";

// Regression coverage for the real "YouTube kids" episode live failure:
// the one-bounded-correction attempt made narration SHORTER (229 → 147
// words) when its 170s target needed roughly 400+ — because the
// correction prompt was generic ("change the creative substance") and
// gave Content Bot no actual numbers. This proves the guardrail-aware
// correction, the generalized initial-planning guidance, and the single
// shared narration/duration calculation that backs both.

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

vi.mock("@/lib/agents/contentBot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agents/contentBot")>("@/lib/agents/contentBot");
  return {
    ...actual,
    planContentVersion: vi.fn(),
    reviewContentSafety: vi.fn(),
    planCreativeStrategy: vi.fn(),
    reviewVisualQuality: vi.fn(),
  };
});

function wordsOfLength(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
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
      return { storageProvider: "fake-storage", storageKey: key, contentType, byteSize: bytes.byteLength, checksumSha256: createHash("sha256").update(bytes).digest("hex") };
    },
    async open(key) {
      const f = files.get(key);
      if (!f) throw new Error(`fake storage: missing key ${key}`);
      return { stream: textReadable(f.bytes), contentType: f.contentType, byteSize: f.bytes.byteLength };
    },
    async head(key) {
      const f = files.get(key);
      if (!f) return null;
      return { storageProvider: "fake-storage", storageKey: key, contentType: f.contentType, byteSize: f.bytes.byteLength, checksumSha256: createHash("sha256").update(f.bytes).digest("hex") };
    },
    async signedReadUrl(key) {
      return `https://fake-storage.test/${encodeURIComponent(key)}`;
    },
  };
}
function makeFakeImageProvider(): ImageProvider {
  return {
    key: "fake-image",
    capability: "image",
    estimateUsd: () => 0.003,
    async generate(): Promise<MediaResult> {
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
function makeFakeEditProvider(durationSeconds = 170): EditProvider {
  return {
    key: "fake-edit",
    capability: "edit",
    estimateUsd: () => 0.05,
    async generate(): Promise<MediaResult> {
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
/** An image/voice/edit provider whose generate() must never be called — used to prove a blocked run spends nothing on assets. */
function makeUncallableProvider<T extends { capability: string }>(capability: T["capability"], estimateUsd: () => number): T {
  return {
    key: "uncallable",
    capability,
    estimateUsd,
    async generate(): Promise<never> {
      throw new Error(`${capability} provider must never be called — blocked before any asset spend`);
    },
    async lookup() {
      return null;
    },
  } as unknown as T;
}

describe("initial planning guidance — the general duration/pace formula", () => {
  const prompt = buildContentPlanSystemPrompt({ platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" });

  it("states the general formula (words ≈ duration_seconds × the real measured rate), not a fixed 30-second word count", () => {
    expect(prompt).toContain(`duration_seconds × ${MEASURED_WORDS_PER_SECOND}`);
    expect(prompt).not.toMatch(/65-80 words/);
    expect(prompt).not.toMatch(/NOT 115\+ words/);
  });

  it("illustrates the formula at more than one duration, scaling beyond the old 30-second-only example", () => {
    const thirty = acceptableNarrationWordRange(30, "natural");
    const ninety = acceptableNarrationWordRange(90, "natural");
    expect(prompt).toContain(`~30s needs roughly ${thirty.min}-${thirty.max} words`);
    expect(prompt).toContain(`~90s needs roughly ${ninety.min}-${ninety.max} words`);
    expect(thirty.min).not.toBe(ninety.min);
  });

  it("a 30-second plan's guidance matches the real shared calculation exactly (cross-checked, not eyeballed)", () => {
    const { min, max } = acceptableNarrationWordRange(30, "natural");
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
    expect(prompt).toContain(`${min}-${max} words`);
  });
});

describe("acceptableNarrationWordRange — the shared calculation itself", () => {
  it("a 170-second, natural-pace plan (the exact real failure's shape) computes the correct target range", () => {
    const { min, max, target } = acceptableNarrationWordRange(170, "natural");
    expect(target).toBe(Math.round(170 * MEASURED_WORDS_PER_SECOND));
    expect(min).toBe(Math.ceil((170 - 59.5) * MEASURED_WORDS_PER_SECOND));
    expect(max).toBe(Math.floor((170 + 59.5) * MEASURED_WORDS_PER_SECOND));
    expect(229).toBeLessThan(min);
    expect(147).toBeLessThan(min);
  });

  it("another duration and pace also compute correctly (not hardcoded to 170s or \"natural\")", () => {
    const short = acceptableNarrationWordRange(15, "brisk");
    expect(short.target).toBe(Math.round(15 * MEASURED_WORDS_PER_SECOND));
    expect(short.min).toBeLessThan(short.target);
    expect(short.max).toBeGreaterThan(short.target);

    const long = acceptableNarrationWordRange(300, "slow");
    expect(long.target).toBe(Math.round(300 * MEASURED_WORDS_PER_SECOND));
    expect(long.min).toBeLessThan(long.target);
  });
});

function makeBeat(narrationWords: number, durationSeconds: number) {
  return {
    index: 1,
    beat_role: "hook" as const,
    narration: wordsOfLength(narrationWords),
    visual_direction: "v",
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
    start_seconds: 0,
    end_seconds: durationSeconds,
  };
}

describe("guardrail-aware correction prompt", () => {
  it("narration_duration_mismatch gets the actual numeric target, not the generic \"change the creative substance\" text", () => {
    const shortPlan = makeContentPlan({
      claims: [],
      duration_seconds: 170,
      voice_direction: { pace: "natural" },
      script: [makeBeat(147, 170)],
    });
    const block = buildGuardrailCorrectionUserPrompt(
      makeProductionBrief(),
      makeAudienceContext(),
      shortPlan,
      `This plan's narration (147 words) would take roughly 60.2s to speak, which diverges from the plan's own 170s target.`,
      "narration_duration_mismatch",
      makeCreativeStrategy(),
    );

    expect(block).not.toMatch(/genuinely change the creative substance/i);
    expect(block).toMatch(/NARRATION LENGTH problem, not a creative-content problem/i);
    expect(block).toContain("Target duration: 170s");
    expect(block).toContain('pace you selected: "natural"');
    expect(block).toContain("Your previous narration: 147 words");
    const { min, max, target } = acceptableNarrationWordRange(170, "natural");
    expect(block).toContain(`approximately ${min}-${max} words (target ≈${target} words)`);
  });

  it("clearly says LONGER, with a real word count, when narration undershoots (the exact real failure's direction)", () => {
    const shortPlan = makeContentPlan({
      claims: [],
      duration_seconds: 170,
      voice_direction: { pace: "natural" },
      script: [makeBeat(147, 170)],
    });
    const block = buildGuardrailCorrectionUserPrompt(makeProductionBrief(), makeAudienceContext(), shortPlan, "rejected — too short", "narration_duration_mismatch");
    expect(block).toMatch(/needs to become LONGER/);
    expect(block).toMatch(/\d+ more words/);
    const { min } = acceptableNarrationWordRange(170, "natural");
    expect(block).toContain(`${min - 147} more words`);
  });

  it("clearly says SHORTER, with a real word count, when narration overshoots", () => {
    const longPlan = makeContentPlan({
      claims: [],
      duration_seconds: 30,
      voice_direction: { pace: "natural" },
      script: [makeBeat(300, 30)],
    });
    const block = buildGuardrailCorrectionUserPrompt(makeProductionBrief(), makeAudienceContext(), longPlan, "rejected — too long", "narration_duration_mismatch");
    expect(block).toMatch(/needs to become SHORTER/);
    expect(block).toMatch(/\d+ fewer words/);
    const { max } = acceptableNarrationWordRange(30, "natural");
    expect(block).toContain(`${300 - max} fewer words`);
  });

  it("a different guardrail code (e.g. named_ip) still gets the existing generic correction text, byte-for-byte unchanged", () => {
    const plan = makeContentPlan({ claims: [] });
    const block = buildGuardrailCorrectionUserPrompt(makeProductionBrief(), makeAudienceContext(), plan, 'Content plan references a named work: "Bluey".', "named_ip");
    expect(block).toMatch(/genuinely change the creative substance/i);
    expect(block).not.toMatch(/NARRATION LENGTH problem/i);
    expect(block).not.toContain("Target duration:");
  });
});

describe("full pipeline: corrected candidates are still revalidated, and a second failed correction still blocks", () => {
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
    vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
      report: { overall_verdict: "pass", findings: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
  });

  function shortPlan170() {
    return makeContentPlan({ claims: [], duration_seconds: 170, voice_direction: { pace: "natural" }, script: [makeBeat(147, 170)] });
  }

  async function createHarness() {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    return commissionPilotAnyway(mission.id, founderId, {
      targetPlatform: "youtube",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
      concept: "concept",
      creativeDirection: "direction",
    });
  }

  it("the correction call receives guardrailCorrection.code === \"narration_duration_mismatch\", and a genuinely fixed candidate is revalidated and succeeds", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    const { min } = acceptableNarrationWordRange(170, "natural");
    const fixedPlan = makeContentPlan({
      claims: [],
      duration_seconds: 170,
      voice_direction: { pace: "natural" },
      script: [makeBeat(min + 20, 170)], // genuinely inside the real acceptable range
    });
    vi.mocked(contentBotModule.planContentVersion)
      .mockResolvedValueOnce({ plan: shortPlan170(), usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 } })
      .mockResolvedValueOnce({ plan: fixedPlan, usage: { model: "claude-sonnet-5", inputTokens: 600, outputTokens: 320, usdCost: 0.012 } });

    const item = await createHarness();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider(170);
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review"); // the corrected, genuinely-fixed candidate was revalidated and succeeded
    expect(contentBotModule.planContentVersion).toHaveBeenCalledTimes(2);
    const secondCallArgs = vi.mocked(contentBotModule.planContentVersion).mock.calls[1]![0] as { guardrailCorrection?: { code: string } };
    expect(secondCallArgs.guardrailCorrection?.code).toBe("narration_duration_mismatch");

    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "production_plan_auto_corrected")).toBe(true);
  });

  it("a second, STILL-failing correction is still blocked — never a third attempt, zero asset spend", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion)
      .mockResolvedValueOnce({ plan: shortPlan170(), usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 } })
      .mockResolvedValueOnce({ plan: shortPlan170(), usage: { model: "claude-sonnet-5", inputTokens: 600, outputTokens: 320, usdCost: 0.012 } });

    const item = await createHarness();
    const image = makeUncallableProvider<ImageProvider>("image", () => 0.003);
    const voice = makeUncallableProvider<VoiceProvider>("voice", () => 0.01);
    const edit = makeUncallableProvider<EditProvider>("edit", () => 0.05);
    const video = makeUncallableProvider<VideoProvider>("video", () => 0.1); // never reached — blocked during planning, before any asset generation
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("blocked");
    expect(settled.failure_category).toBeNull();
    expect(contentBotModule.planContentVersion).toHaveBeenCalledTimes(2); // exactly one correction, never a third
  });
});
