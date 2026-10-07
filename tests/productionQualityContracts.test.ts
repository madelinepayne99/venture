import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  listVersionsWithAssets,
  listCostsForContentItem,
  listActivity,
  openNextVersion,
  updateContentVersion,
  transitionContentItemState,
} from "@/lib/db/repositories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult } from "@/lib/media/types";
import { VisualQCReportSchema, VisualQCFindingSchema } from "@/lib/agents/contentBot/schema";
import { ContentGuardrailError, assertNarrationFitsDuration } from "@/lib/agents/contentBot/guardrails";
import { ContentBotError } from "@/lib/agents/contentBot/errors";
import {
  makeContentPlan,
  makeCreativeStrategy,
  setupMissionReadyForProduction,
  fakeAnthropicClientWithCalls,
  fakeAnthropicMessage,
  makeFakeVideoProvider,
} from "./testUtils";

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

function makeFakeVoiceProvider(): VoiceProvider & { calls: number } {
  let calls = 0;
  return {
    key: "fake-voice",
    capability: "voice",
    get calls() {
      return calls;
    },
    estimateUsd: () => 0.01,
    async generate(req): Promise<VoiceMediaResult> {
      calls += 1;
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

function makeFakeEditProvider(durationSeconds = 46): EditProvider & { calls: number } {
  let calls = 0;
  return {
    key: "fake-edit",
    capability: "edit",
    get calls() {
      return calls;
    },
    estimateUsd: () => 0.05,
    async generate(): Promise<MediaResult> {
      calls += 1;
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

// A 13-beat script, exactly mirroring the real live failure's shape (13
// script beats + 1 thumbnail = 14 real checkable assets).
function makeManyBeats(count: number, narrationWords: number) {
  const words = Array.from({ length: narrationWords }, (_, i) => `word${i}`).join(" ");
  const perBeatWords = Math.ceil(narrationWords / count);
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    beat_role: "context" as const,
    narration: words
      .split(" ")
      .slice(i * perBeatWords, (i + 1) * perBeatWords)
      .join(" ") || "beat",
    visual_direction: `visual for beat ${i}`,
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
    start_seconds: i * 2,
    end_seconds: i * 2 + 2,
  }));
}

describe("A. Visual QC finding-count contract — the same prompt/schema misalignment class as Creative Strategy", () => {
  it("the real system prompt now says findings hold only genuine problems, caps at 12, and requires prioritization/consolidation", async () => {
    const { reviewVisualQuality } = await import("@/lib/agents/contentBot/visualQC");
    const { client, calls } = fakeAnthropicClientWithCalls([
      fakeAnthropicMessage({ overall_verdict: "pass", findings: [] }),
    ]);
    await reviewVisualQuality(
      {
        plan: { visual_identity: null, disclosure: { text: "x", placement: "persistent_badge" } },
        audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
        assets: [{ assetRef: "thumbnail", description: "d", contentType: "image/jpeg", base64: "AAAA" }],
      },
      { client },
    );
    const params = calls[0] as { system: string };
    // Backslash-continued template-literal lines retain their source
    // indentation as literal whitespace — \s+ tolerates that rather than
    // asserting on exact single spaces.
    const normalize = (s: string) => s.replace(/\s+/g, " ");
    expect(normalize(params.system)).toMatch(/only report images with a real problem/i);
    expect(normalize(params.system)).toMatch(/at most 12/i);
    expect(normalize(params.system)).toMatch(/most material and actionable/i);
    expect(normalize(params.system)).toMatch(/do not create a separate finding for every one/i);
  });

  it("VisualQCReportSchema still caps findings at exactly 12 — the bound was not simply raised", () => {
    const tooMany = {
      overall_verdict: "flag",
      findings: Array.from({ length: 13 }, (_, i) => ({ asset_ref: `beat_${i}`, issue_types: ["composition_failure"], reasons: ["broken"] })),
    };
    const result = VisualQCReportSchema.safeParse(tooMany);
    expect(result.success).toBe(false);

    const exactlyTwelve = { ...tooMany, findings: tooMany.findings.slice(0, 12) };
    expect(VisualQCReportSchema.safeParse(exactlyTwelve).success).toBe(true);
  });

  it("a real 14-asset check (13 beats + thumbnail, mirroring the live failure) with 0 real problems is now structurally valid — the old contract made this impossible regardless of quality", () => {
    const fourteenAssetsAllFine = { overall_verdict: "pass" as const, findings: [] };
    expect(VisualQCReportSchema.safeParse(fourteenAssetsAllFine).success).toBe(true);
  });

  it("VisualQCFindingSchema requires at least one real issue_type — a finding can't exist without a real reason", () => {
    const result = VisualQCFindingSchema.safeParse({ asset_ref: "beat_0", issue_types: [], reasons: [] });
    expect(result.success).toBe(false);
  });

  it("the real reviewVisualQuality still rejects a genuinely overlong findings array (13 real problems) with a real ZodError", async () => {
    const { reviewVisualQuality } = await import("@/lib/agents/contentBot/visualQC");
    const overlong = {
      overall_verdict: "flag",
      findings: Array.from({ length: 13 }, (_, i) => ({ asset_ref: `beat_${i}`, issue_types: ["composition_failure"], reasons: ["broken"] })),
    };
    const client = fakeAnthropicClientWithCalls([fakeAnthropicMessage(overlong)]).client;
    let caught: unknown;
    try {
      await reviewVisualQuality(
        {
          plan: { visual_identity: null, disclosure: { text: "x", placement: "persistent_badge" } },
          audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
          assets: Array.from({ length: 13 }, (_, i) => ({ assetRef: `beat_${i}`, description: "d", contentType: "image/jpeg", base64: "AAAA" })),
        },
        { client },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentBotError);
    expect((caught as ContentBotError).cause_).toBeInstanceOf(ZodError);
  });

  describe("full pipeline with a real 13-beat (14-asset) plan", () => {
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
    });

    async function createHarness() {
      const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
        reportOverrides: { production_recommendation: undefined },
      });
      const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
      return commissionPilotAnyway(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
        concept: "concept",
        creativeDirection: "direction",
      });
    }

    // Real motion-first constraint, discovered while adapting this exact
    // test (see CLAUDE.md's Content Bot motion-first milestone): every
    // beat now needs TWO real provider calls (its still start frame, then
    // its real Kling clip), not one — assertPlannedCallsWithinCap counts
    // both. The original real failure this test mirrors had 13 script
    // beats (1 voice + 1 thumbnail + 13 stills = 15 calls, comfortably
    // under MAX_ASSET_CALLS_PER_VERSION's 20); the SAME 13 beats under the
    // new two-call-per-beat reality would need 1+1+13+13=28 calls — over
    // the cap. MAX_ASSET_CALLS_PER_VERSION is deliberately NOT raised to
    // make this fit (same "do not silently raise a fixed cap" discipline
    // as MAX_ITEM_SPEND_USD) — this test's own beat count is reduced to 8
    // instead (1+1+8+8=18, under the cap), which still exercises the exact
    // same QC finding-count contract (many assets, few genuine problems)
    // this test is actually about. A real production with more beats than
    // this cap now allows is a genuine, founder-visible constraint — not
    // silently worked around here.
    it("real assets with only 2 genuine problems produces a small findings array, regenerates only those 2, and completes", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      const manyBeats = makeManyBeats(8, 80); // ~10 words/beat, realistic-looking narration
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: makeContentPlan({ claims: [], duration_seconds: 33, script: manyBeats }), // 80 words / 2.44wps ≈ 32.8s, well within tolerance of 33s
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      let qcCalls = 0;
      vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => {
        qcCalls += 1;
        if (qcCalls === 1) {
          expect(assets.length).toBe(9); // 8 beats + thumbnail
          return {
            report: {
              overall_verdict: "flag",
              findings: [
                { asset_ref: "beat_0", issue_types: ["composition_failure" as const], reasons: ["broken"] },
                { asset_ref: "beat_5", issue_types: ["garbled_or_unintended_text" as const], reasons: ["garbled"] },
              ],
            },
            usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
          };
        }
        return { report: { overall_verdict: "pass", findings: [] }, usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 } };
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider(33);
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      expect(image.calls.filter((k) => k.includes("qc-retry"))).toHaveLength(2); // only the 2 genuinely flagged assets
      expect(qcCalls).toBe(2); // initial + one recheck, never more
    });
  });
});

describe("B. Narration-length-vs-duration contract — catches a real 59s-voiceover-vs-30s-brief class of mismatch", () => {
  it("rejects Production 3's exact real shape (115 words, 32s target, \"brisk\" pace) — previously passed under the old per-pace wps table, now correctly caught", () => {
    // The exact real Production 3 shape: 115 words, duration_seconds: 32,
    // pace "brisk". Under the OLD table (brisk ≈3.0 wps) this estimated
    // ~38.3s — only 6.3s off a 32s target, inside the 11.2s tolerance, so
    // it was never caught. Real ElevenLabs output was 47.2s (≈2.44
    // words/sec — pace never actually changed real speaking rate before
    // this fix). At the corrected, real-measured rate this now estimates
    // ~47.1s — a near-exact match to what actually happened — which is
    // 15.1s off the 32s target, outside tolerance, and correctly rejected.
    const words = Array.from({ length: 115 }, (_, i) => `w${i}`).join(" ");
    const plan = makeContentPlan({
      claims: [],
      duration_seconds: 32,
      voice_direction: { pace: "brisk" },
      script: [
        {
          index: 1,
          beat_role: "hook",
          narration: words,
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
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 0,
          end_seconds: 32,
        },
      ],
    });
    expect(() => assertNarrationFitsDuration(plan)).toThrow(ContentGuardrailError);
    try {
      assertNarrationFitsDuration(plan);
    } catch (error) {
      expect((error as ContentGuardrailError).code).toBe("narration_duration_mismatch");
      expect((error as ContentGuardrailError).message).toMatch(/32s target/);
    }
  });

  it("assertNarrationFitsDuration rejects narration that would take roughly double the stated duration to speak (the exact real shape)", () => {
    // ~158 words at the guardrail's real measured rate (2.44 wps) is
    // ~65s — matches the real live failure (30s target, ~59s real
    // ElevenLabs output).
    const words = Array.from({ length: 158 }, (_, i) => `w${i}`).join(" ");
    const plan = makeContentPlan({
      claims: [],
      duration_seconds: 30,
      script: [
        {
          index: 0,
          beat_role: "hook",
          narration: words,
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
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 0,
          end_seconds: 30,
        },
      ],
    });
    expect(() => assertNarrationFitsDuration(plan)).toThrow(ContentGuardrailError);
    try {
      assertNarrationFitsDuration(plan);
    } catch (error) {
      expect((error as ContentGuardrailError).code).toBe("narration_duration_mismatch");
      expect((error as ContentGuardrailError).message).toMatch(/30s target/);
    }
  });

  it("does not reject narration that realistically fits its stated duration", () => {
    // ~75 words at the guardrail's real measured rate (2.44 wps) ≈ 31s —
    // a realistic 30s script.
    const words = Array.from({ length: 75 }, (_, i) => `w${i}`).join(" ");
    const plan = makeContentPlan({
      claims: [],
      duration_seconds: 30,
      script: [
        {
          index: 0,
          beat_role: "hook",
          narration: words,
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
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 0,
          end_seconds: 30,
        },
      ],
    });
    expect(() => assertNarrationFitsDuration(plan)).not.toThrow();
  });

  it("uses a relative tolerance, not a hardcoded 30-second (TikTok) assumption — the same word count is judged against whatever duration_seconds actually is", () => {
    // 150 words fits comfortably in a 60s target (2.44 words/sec => ~61s,
    // within a 21s tolerance) but would fail a 30s target — proving the
    // check is genuinely relative to duration_seconds, never hardcoded to
    // any one platform's typical length.
    const words = Array.from({ length: 150 }, (_, i) => `w${i}`).join(" ");
    const makePlanWithDuration = (durationSeconds: number) =>
      makeContentPlan({
        claims: [],
        duration_seconds: durationSeconds,
        script: [
          {
            index: 0,
            beat_role: "hook",
            narration: words,
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
            on_screen_text: null,
            retention_purpose: "r",
            start_seconds: 0,
            end_seconds: durationSeconds,
          },
        ],
      });

    expect(() => assertNarrationFitsDuration(makePlanWithDuration(30))).toThrow(ContentGuardrailError);
    expect(() => assertNarrationFitsDuration(makePlanWithDuration(60))).not.toThrow();
  });

  it("the real prompt now states an explicit words-per-duration relationship tied to duration_seconds", async () => {
    // Wording generalized in the narration-duration auto-correction fix
    // (see tests/narrationDurationCorrection.test.ts for the full
    // coverage of that change) — no longer the literal phrase
    // "words/sec", but the same underlying real measured-rate budget,
    // now expressed as a general formula rather than a single fixed
    // example.
    const { buildContentPlanSystemPrompt } = await import("@/lib/agents/contentBot/prompt");
    const prompt = buildContentPlanSystemPrompt({ platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" });
    expect(prompt).toMatch(/words needed.*duration_seconds/i);
    expect(prompt).toMatch(/duration_seconds/i);
  });

  describe("full pipeline: caught before any real asset spend, auto-corrected once, then blocked (never Retry-Production-eligible) if still wrong", () => {
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

    function badDurationPlan() {
      const words = Array.from({ length: 158 }, (_, i) => `w${i}`).join(" ");
      return makeContentPlan({
        claims: [],
        duration_seconds: 30,
        script: [
          {
            index: 0,
            beat_role: "hook",
            narration: words,
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
            on_screen_text: null,
            retention_purpose: "r",
            start_seconds: 0,
            end_seconds: 30,
          },
        ],
      });
    }

    async function createHarness() {
      const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
        reportOverrides: { production_recommendation: undefined },
      });
      const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
      return commissionPilotAnyway(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
        concept: "concept",
        creativeDirection: "direction",
      });
    }

    it("is caught immediately after planning, before any real voice/image/edit spend, and auto-corrects once to a successful completion", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion)
        .mockResolvedValueOnce({ plan: badDurationPlan(), usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 } })
        .mockResolvedValueOnce({
          plan: makeContentPlan({ claims: [] }), // the default fixture's narration genuinely fits its 45s duration
          usage: { model: "claude-sonnet-5", inputTokens: 600, outputTokens: 320, usdCost: 0.012 },
        });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review"); // reached the end — corrected, never blocked
      expect(contentBotModule.planContentVersion).toHaveBeenCalledTimes(2); // exactly one correction, no loop
      const activity = await listActivity(item.mission_id);
      expect(activity.some((a) => a.action === "production_plan_guardrail_correction_attempted")).toBe(true);
      expect(activity.some((a) => a.action === "production_plan_auto_corrected")).toBe(true);

      const costs = await listCostsForContentItem(item.id);
      const planningCosts = costs.filter((c) => c.input_tokens === 500 || c.input_tokens === 600);
      expect(planningCosts).toHaveLength(2); // both real planning attempts' cost recorded, never dropped
    });

    it("blocks (never fails, never Retry-Production-eligible) when the corrected plan ALSO mismatches duration — no asset spend on either attempt", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion)
        .mockResolvedValueOnce({ plan: badDurationPlan(), usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 } })
        .mockResolvedValueOnce({ plan: badDurationPlan(), usage: { model: "claude-sonnet-5", inputTokens: 600, outputTokens: 320, usdCost: 0.012 } });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("blocked"); // a real, honest refusal — never "failed"
      expect(settled.failure_category).toBeNull(); // never eligible for Retry Production — this is a planning/creative defect, not a technical contract failure
      expect(contentBotModule.planContentVersion).toHaveBeenCalledTimes(2); // exactly one correction, never a third
      expect(image.calls).toHaveLength(0); // no asset spend on either attempt
      expect(voice.calls).toBe(0);
      expect(edit.calls).toBe(0);

      const versions = await listVersionsWithAssets(item.id);
      expect(versions[0]!.plan).toBeNull(); // the rejected plan is never persisted
    });

    it("catches Production 3's exact real shape (115 words, 32s, brisk) before any real voice/image/edit call — previously would have passed and spent on 11 real images + a mismatched voiceover", async () => {
      function production3Plan() {
        const words = Array.from({ length: 115 }, (_, i) => `w${i}`).join(" ");
        return makeContentPlan({
          claims: [],
          duration_seconds: 32,
          voice_direction: { pace: "brisk" },
          script: [
            {
              index: 1,
              beat_role: "hook",
              narration: words,
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
              on_screen_text: null,
              retention_purpose: "r",
              start_seconds: 0,
              end_seconds: 32,
            },
          ],
        });
      }
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion)
        .mockResolvedValueOnce({ plan: production3Plan(), usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 } })
        .mockResolvedValueOnce({ plan: production3Plan(), usage: { model: "claude-sonnet-5", inputTokens: 600, outputTokens: 320, usdCost: 0.012 } });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("blocked");
      expect(settled.failure_category).toBeNull();
      expect(image.calls).toHaveLength(0); // zero of the 11 real image calls Production 3 actually made
      expect(voice.calls).toBe(0); // zero — the real 47.2s ElevenLabs call never happens this time
      expect(edit.calls).toBe(0);
    });
  });
});

describe("C. A copied-forward plan (e.g. Retry Production reusing a pre-existing version's plan) is re-checked against every CURRENT guardrail before reuse", () => {
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
    vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
      report: { overall_verdict: "pass", findings: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
  });

  function badDurationPlan() {
    // The exact real live shape: duration_seconds correctly says 30, but
    // the narration itself takes roughly double that to actually speak.
    const words = Array.from({ length: 158 }, (_, i) => `w${i}`).join(" ");
    return makeContentPlan({
      claims: [],
      duration_seconds: 30,
      script: [
        {
          index: 0,
          beat_role: "hook",
          narration: words,
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
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 0,
          end_seconds: 30,
        },
      ],
    });
  }

  async function createHarness() {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    return commissionPilotAnyway(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
      concept: "concept",
      creativeDirection: "direction",
    });
  }

  // Simulates exactly what retryProductionAfterTechnicalFailure does: open
  // a new version, copy a plan onto it directly (no planContentVersion
  // call, no guardrail check at copy time), and move the item straight to
  // "generating" — the same shape a real resumed/retried run has.
  async function seedResumedVersionWithPlan(itemId: string, plan: ReturnType<typeof makeContentPlan>) {
    const version = await openNextVersion({ contentItemId: itemId, parentVersionId: null, revisionApprovalId: null });
    // Mirrors exactly what retryProductionAfterTechnicalFailure copies
    // forward: plan, safety_verdict, AND creative_strategy — all three
    // already-decided stages must be present for the resumed run to reach
    // runProductionPlanningStage without needing any of the mocked Claude
    // calls to be configured.
    await updateContentVersion(version.id, {
      plan,
      safety_verdict: { verdict: "pass", reasons: [], concerns: [] },
      creative_strategy: makeCreativeStrategy(),
    });
    const started = await transitionContentItemState(itemId, ["planning"], "generating", { generation_attempt_count: 1 });
    expect(started.ok).toBe(true);
    return version;
  }

  it("blocks a resumed run whose copied-forward plan fails the CURRENT duration guardrail — never silently reused, zero asset spend", async () => {
    const item = await createHarness();
    await seedResumedVersionWithPlan(item.id, badDurationPlan());

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("blocked"); // a real refusal, never silently reused
    expect(settled.failure_category).toBeNull(); // a planning/creative defect, not a technical contract failure
    const contentBotModule = await import("@/lib/agents/contentBot");
    expect(contentBotModule.planContentVersion).not.toHaveBeenCalled(); // no new planning call spent to discover this
    expect(image.calls).toHaveLength(0);
    expect(voice.calls).toBe(0);
    expect(edit.calls).toBe(0);
  });

  it("resumes a copied-forward plan that already satisfies every current guardrail with zero extra planning calls", async () => {
    const item = await createHarness();
    await seedResumedVersionWithPlan(item.id, makeContentPlan({ claims: [] })); // default fixture genuinely fits its own duration

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review"); // reused the valid plan straight through to completion
    const contentBotModule = await import("@/lib/agents/contentBot");
    expect(contentBotModule.planContentVersion).not.toHaveBeenCalled(); // the whole point of reuse — no wasted Claude call
  });
});
