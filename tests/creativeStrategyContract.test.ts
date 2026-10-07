import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  getContentItem,
  listVersionsWithAssets,
  listCostsForContentItem,
  listActivity,
  listEvidence,
  listDeliverables,
  transitionContentItemState,
} from "@/lib/db/repositories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult } from "@/lib/media/types";
import { MAX_VERSIONS_PER_ITEM } from "@/lib/domain/contentProduction";
import { ContentVersionCapExceededError } from "@/lib/domain/contentProduction";
import { classifyProductionFailure } from "@/lib/domain/contentFailureClassification";
import { CreativeStrategySchema, type CreativeStrategy } from "@/lib/agents/contentBot/schema";
// The REAL class — used only for the direct, unmocked unit tests below
// (planCreativeStrategy itself, and classifyProductionFailure, which
// deliberately imports ContentBotError straight from ./errors rather than
// through the mockable aggregator, precisely so classification's own
// instanceof check is never affected by a test mocking that aggregator).
// Pipeline-level tests further down must instead use the MOCKED module's
// own ContentBotError class (via `contentBotModule.ContentBotError`),
// since contentWorkflow.ts's own `instanceof ContentBotError` check
// resolves against whatever "@/lib/agents/contentBot" is mocked to here.
import { ContentBotError } from "@/lib/agents/contentBot/errors";
import { makeContentPlan, makeCreativeStrategy, makeProductionBrief, makeAudienceContext, setupMissionReadyForProduction, makeFakeVideoProvider } from "./testUtils";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

// Reuses the REAL ContentBotError class (via importActual) rather than a
// second, separately-defined mock class — this is the one test file that
// needs both contentWorkflow.ts's own `instanceof ContentBotError` catch
// (which imports it from this same aggregator) AND
// contentFailureClassification.ts's classifier (which deliberately imports
// it straight from ./errors, bypassing this mock entirely — see that
// file's own comment) to agree on the SAME class, exactly as they do in
// the real app. A second, look-alike class here would make the two checks
// silently disagree — a real thing this test caught during development.
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

// The exact real-world failure (2026-09-27, Production 2 V1 on mission
// dd7ffd87-8bce-4764-9eff-5ac275dae60a): hook_mechanic, visual_hook, and
// disclosure_treatment each exceeded their real 300-character schema
// limit because the prompt only said "be compact... a short paragraph" —
// no explicit numeric ceiling matching the schema. This fixture
// reproduces that exact shape.
const OVERLONG = "This explanation goes on for a very long time, well past what a single compact sentence would need, restating the same idea in slightly different words several times over so that it comfortably exceeds three hundred characters in total length, which is exactly the kind of verbose answer the original prompt's vague 'short paragraph' guidance failed to prevent.";

function makeOverlongStrategyResponse(): Record<string, unknown> {
  return {
    hook_mechanic: OVERLONG,
    visual_hook: OVERLONG,
    pacing: { target_cut_count: 5, rationale: "A short, in-bounds rationale." },
    escalation_shape: "A short, in-bounds escalation shape.",
    visual_treatment: "A short, in-bounds visual treatment.",
    caption_treatment: "A short, in-bounds caption treatment.",
    disclosure_treatment: OVERLONG,
    retention_strategy: "A short, in-bounds retention strategy.",
    evidence_ids_referenced: [],
  };
}

/** A real ZodError from the real schema — not a hand-rolled fake — so classification tests exercise the genuine structural signal. */
function realValidationErrorFromOverlongResponse(): ZodError {
  const result = CreativeStrategySchema.safeParse(makeOverlongStrategyResponse());
  if (result.success) throw new Error("test fixture is broken: the overlong response unexpectedly passed validation");
  return result.error;
}

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

function makeFakeEditProvider(): EditProvider & { calls: number } {
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
        durationSeconds: 46,
        width: 1080,
        height: 1920,
        providerAssetId: "render-1",
        usage: { provider: "fake-edit", model: "fake-edit-model", unit: "seconds", quantity: 46, usdCost: 0.05 },
      };
    },
    async lookup() {
      return null;
    },
  };
}

describe("Creative Strategy prompt/schema contract — a real live failure and its fix", () => {
  it("the real planCreativeStrategy rejects an overlong response, carrying the real ZodError as its cause", async () => {
    const { planCreativeStrategy } = await import("@/lib/agents/contentBot/creativeStrategy");
    const { fakeAnthropicClient, fakeAnthropicMessage } = await import("./testUtils");
    const client = fakeAnthropicClient([fakeAnthropicMessage(makeOverlongStrategyResponse())]);

    let caught: unknown;
    try {
      await planCreativeStrategy({ brief: makeProductionBrief(), audience: makeAudienceContext() }, { client });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const err = caught as InstanceType<typeof ContentBotError>;
    expect(err.message).toMatch(/failed structural validation/i);
    expect(err.cause_).toBeInstanceOf(ZodError);
    const issues = (err.cause_ as ZodError).issues;
    expect(issues.some((i) => i.path.join(".") === "hook_mechanic" && i.code === "too_big")).toBe(true);
    expect(issues.some((i) => i.path.join(".") === "visual_hook" && i.code === "too_big")).toBe(true);
    expect(issues.some((i) => i.path.join(".") === "disclosure_treatment" && i.code === "too_big")).toBe(true);
  });

  it("the prompt now states explicit, schema-matching character limits for every Creative Strategy field", async () => {
    const { buildCreativeStrategySystemPrompt } = await import("@/lib/agents/contentBot/prompt");
    const prompt = buildCreativeStrategySystemPrompt(makeAudienceContext());
    expect(prompt).toMatch(/hook_mechanic.*300 characters/is);
    expect(prompt).toMatch(/visual_hook.*300 characters/is);
    expect(prompt).toMatch(/disclosure_treatment.*300 characters/is);
  });

  it("classifyProductionFailure recognizes a real Zod structural mismatch as the recoverable 'model_output_contract' category", () => {
    const error = new ContentBotError(
      "Content Bot's creative strategy failed structural validation: ...",
      { model: "claude-sonnet-5", inputTokens: 2391, outputTokens: 1207 },
      realValidationErrorFromOverlongResponse(),
    );
    expect(classifyProductionFailure(error)).toBe("model_output_contract");
  });

  it("never classifies a refusal or a non-validation ContentBotError as the recoverable contract category", () => {
    const refusal = new ContentBotError("Content Bot declined to produce a creative strategy for this mission.", {
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 0,
    });
    expect(classifyProductionFailure(refusal)).toBe("unclassified");
  });
});

describe("the real production pipeline settling a genuine Creative Strategy contract failure", () => {
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
  });

  async function createHarness() {
    const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
      reportOverrides: { production_recommendation: undefined },
    });
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    const item = await commissionPilotAnyway(mission.id, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidence[0]!.id],
      concept: "The original concept.",
      creativeDirection: "The original direction.",
    });
    return { item, mission, evidence };
  }

  it("settles to 'failed' with failure_category 'model_output_contract', records real cost, and never starts asset generation", async () => {
    const { item, mission } = await createHarness();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planCreativeStrategy).mockRejectedValue(
      new contentBotModule.ContentBotError(
        "Content Bot's creative strategy failed structural validation: ...",
        { model: "claude-sonnet-5", inputTokens: 2391, outputTokens: 1207 },
        realValidationErrorFromOverlongResponse(),
      ),
    );

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("failed"); // a real technical failure, never fabricated as "blocked" or silently ignored
    expect(settled.failure_category).toBe("model_output_contract");
    expect(image.calls).toHaveLength(0); // no asset generation after an invalid strategy
    expect(voice.calls).toBe(0);
    expect(edit.calls).toBe(0);

    const costs = await listCostsForContentItem(item.id);
    expect(costs.some((c) => c.input_tokens === 2391 && c.output_tokens === 1207)).toBe(true); // real cost never dropped

    const versions = await listVersionsWithAssets(item.id);
    expect(versions[0]!.plan).toBeNull();
    expect(versions[0]!.creative_strategy).toBeNull();
    expect(versions[0]!.status).toBe("failed");
    expect(settled.failure_reason).toMatch(/failed structural validation/i);
  });

  it("never loops: exactly one Creative Strategy call per real attempt, no automatic internal retry", async () => {
    const { item } = await createHarness();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planCreativeStrategy).mockRejectedValue(
      new contentBotModule.ContentBotError(
        "Content Bot's creative strategy failed structural validation: ...",
        { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1 },
        realValidationErrorFromOverlongResponse(),
      ),
    );

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(contentBotModule.planCreativeStrategy).toHaveBeenCalledTimes(1);
  });

  it("leaves the founder brief and Scout's real research completely unchanged after the failure", async () => {
    const { item, mission } = await createHarness();
    const briefBefore = item.brief;
    const evidenceBefore = await listEvidence(mission.id);
    const deliverablesBefore = await listDeliverables(mission.id);

    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planCreativeStrategy).mockRejectedValue(
      new contentBotModule.ContentBotError(
        "Content Bot's creative strategy failed structural validation: ...",
        { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1 },
        realValidationErrorFromOverlongResponse(),
      ),
    );
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    const itemAfter = await getContentItem(item.id);
    expect(itemAfter!.brief).toEqual(briefBefore);
    expect(await listEvidence(mission.id)).toEqual(evidenceBefore);
    expect(await listDeliverables(mission.id)).toEqual(deliverablesBefore);
  });

  it("Retry Production can safely start a new version once the contract is fixed, completing normally end to end", async () => {
    const { item } = await createHarness();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planCreativeStrategy).mockRejectedValueOnce(
      new contentBotModule.ContentBotError(
        "Content Bot's creative strategy failed structural validation: ...",
        { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1 },
        realValidationErrorFromOverlongResponse(),
      ),
    );

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const { runContentProductionPipeline, retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    const failed = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });
    expect(failed.state).toBe("failed");
    expect(failed.failure_category).toBe("model_output_contract");

    // The technical contract is now "fixed" — the mocked call returns a
    // real, in-bounds strategy for every subsequent call.
    vi.mocked(contentBotModule.planCreativeStrategy).mockResolvedValue({
      strategy: makeCreativeStrategy(),
      usage: { model: "claude-sonnet-5", inputTokens: 300, outputTokens: 150, usdCost: 0.006 },
    });
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 },
    });
    vi.mocked(contentBotModule.reviewContentSafety).mockResolvedValue({
      verdict: { verdict: "pass", reasons: [], concerns: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 200, outputTokens: 100, usdCost: 0.005 },
    });
    vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
      report: { overall_verdict: "pass", findings: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 400, outputTokens: 100, usdCost: 0.008 },
    });

    vi.stubEnv("MEDIA_IMAGE_PROVIDER", "fal-ai");
    vi.stubEnv("MEDIA_VOICE_PROVIDER", "elevenlabs");
    vi.stubEnv("MEDIA_EDIT_PROVIDER", "shotstack");

    const retried = await retryProductionAfterTechnicalFailure(item.id, founderId);
    expect(retried.state).toBe("generating");
    expect(retried.version_count).toBe(2);

    const versionsAfterRetry = await listVersionsWithAssets(item.id);
    expect(versionsAfterRetry).toHaveLength(2);
    // Nothing carried forward from the failed attempt — it had no real
    // plan/strategy to reuse — so this resumes into creative_strategy fresh.
    const newVersion = versionsAfterRetry.find((v) => v.version_number === 2)!;
    expect(newVersion.plan).toBeNull();
    expect(newVersion.creative_strategy).toBeNull();

    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });
    expect(settled.state).toBe("awaiting_review");
    expect(contentBotModule.planCreativeStrategy).toHaveBeenCalledTimes(2); // the failed attempt + the successful retry, never more
  });

  it("the 5-version cap still applies normally after a contract-failure retry sequence", async () => {
    const { item } = await createHarness();
    const atCap = await transitionContentItemState(item.id, ["planning"], "failed", {
      failure_reason: "Content Bot's creative strategy failed structural validation: ...",
      failure_category: "model_output_contract",
      version_count: MAX_VERSIONS_PER_ITEM,
    });
    expect(atCap.ok).toBe(true);

    vi.stubEnv("MEDIA_IMAGE_PROVIDER", "fal-ai");
    vi.stubEnv("MEDIA_VOICE_PROVIDER", "elevenlabs");
    vi.stubEnv("MEDIA_EDIT_PROVIDER", "shotstack");

    const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    await expect(retryProductionAfterTechnicalFailure(item.id, founderId)).rejects.toThrow(ContentVersionCapExceededError);
  });
});
