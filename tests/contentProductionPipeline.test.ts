import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  listContentAssets,
  listVersionsWithAssets,
  listCostsForContentItem,
  contentItemSpendUsd,
  listActivity,
  openNextVersion,
  updateContentVersion,
  transitionContentItemState,
  recordContentAsset,
  recordCost,
  getOpenVersion,
} from "@/lib/db/repositories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult } from "@/lib/media/types";
import { MAX_GENERATION_ATTEMPTS_PER_VERSION, MAX_ITEM_SPEND_USD } from "@/lib/domain/contentProduction";
import { makeContentPlan, makeProductionRecommendation, setupMissionReadyForProduction } from "./testUtils";

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  CONTENT_PRODUCTION_REQUESTED_EVENT: "content/production_requested",
  CONTENT_REVISION_REQUESTED_EVENT: "content/revision_requested",
}));

vi.mock("@/lib/agents/contentBot", () => ({
  planContentVersion: vi.fn(),
  reviewContentSafety: vi.fn(),
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

function makeFakeStorage(): StorageProvider & { files: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    key: "fake-storage",
    files,
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

function makeFakeImageProvider(onGenerate?: (idempotencyKey: string) => Promise<void>): ImageProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    key: "fake-image",
    capability: "image",
    calls,
    estimateUsd: () => 0.003,
    async generate(req): Promise<MediaResult> {
      calls.push(req.idempotencyKey);
      if (onGenerate) await onGenerate(req.idempotencyKey);
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

describe("Content Bot's production pipeline (real Postgres, fixture providers)", () => {
  let founderId: string;

  beforeEach(async () => {
    await resetDbForTests();
    founderId = (await listFounders())[0]!.id;
    const inngestModule = await import("@/lib/inngest/client");
    vi.mocked(inngestModule.inngest.send).mockClear();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockReset();
    vi.mocked(contentBotModule.reviewContentSafety).mockReset();
    // claims: [] — the real frozen brief in these tests carries a real
    // evidence UUID, not the "evidence-1" fixture id makeContentPlan()
    // defaults to; assertClaimsAreEvidenced correctly rejects a mismatch,
    // so tests that aren't specifically about that guardrail avoid it here.
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 },
    });
    vi.mocked(contentBotModule.reviewContentSafety).mockResolvedValue({
      verdict: { verdict: "pass", reasons: [], concerns: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 200, outputTokens: 100, usdCost: 0.005 },
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

  it("runs the full five-stage pipeline end to end against real fixture providers", async () => {
    const item = await createRealContentItem();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("awaiting_review");
    // plan has 2 script beats -> 1 thumbnail + 2 stills = 3 real image calls.
    expect(image.calls).toHaveLength(3);
    expect(voice.calls).toBe(1);
    expect(edit.calls).toBe(1);

    const versions = await listVersionsWithAssets(item.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.status).toBe("complete");
    expect(versions[0]!.assets.map((a) => a.kind).sort()).toEqual(
      ["audio", "caption_track", "image", "image", "thumbnail", "video"].sort(),
    );

    const costs = await listCostsForContentItem(item.id);
    // 2 Claude calls (planning + safety) + 4 media calls (voice + thumbnail + 2 stills + edit... )
    expect(costs.length).toBeGreaterThanOrEqual(6);
    expect(await contentItemSpendUsd(item.id)).toBeGreaterThan(0);
  });

  it("resumes a crashed run without re-paying for assets that already exist", async () => {
    const item = await createRealContentItem();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();

    const { storageKeysFor } = await import("@/lib/domain/contentWorkflow");
    const plan = makeContentPlan({ claims: [] });

    // Manually replicate exactly what a real run would have committed
    // before "crashing": a version with its plan + safety_verdict already
    // set, and every asset except the final video already stored.
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
    await storage.put(keys.alignment, textReadable(new TextEncoder().encode(JSON.stringify([{ word: "x", startSeconds: 0, endSeconds: 1 }]))), "application/json");
    await seedAsset(keys.captions, "caption_track", "text/vtt");
    await seedAsset(keys.thumbnail, "thumbnail", "image/jpeg", { width: 768, height: 1344 });
    await seedAsset(keys.image(0), "image", "image/jpeg");
    await seedAsset(keys.image(1), "image", "image/jpeg");

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("awaiting_review");
    // Nothing already stored is regenerated — only assembly (the one real
    // missing asset) makes a real call.
    expect(image.calls).toHaveLength(0);
    expect(voice.calls).toBe(0);
    expect(edit.calls).toBe(1);

    const contentBotModule = await import("@/lib/agents/contentBot");
    expect(contentBotModule.planContentVersion).not.toHaveBeenCalled();
    expect(contentBotModule.reviewContentSafety).not.toHaveBeenCalled();

    const assets = await listContentAssets(version.id);
    expect(assets.map((a) => a.kind).sort()).toEqual(["audio", "caption_track", "image", "image", "thumbnail", "video"].sort());
  });

  it("settles to failed with real partial cost recorded when a provider genuinely fails", async () => {
    const item = await createRealContentItem();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const storage = makeFakeStorage();
    const brokenEdit: EditProvider = {
      key: "broken-edit",
      capability: "edit",
      estimateUsd: () => 0.05,
      generate: async () => {
        throw new Error("Shotstack render failed: simulated provider outage.");
      },
      lookup: async () => null,
    };

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit: brokenEdit }, storage });

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toContain("simulated provider outage");
    // The real spend up to the failure point is preserved, never dropped.
    const spent = await contentItemSpendUsd(item.id);
    expect(spent).toBeGreaterThan(0);
    const versions = await listVersionsWithAssets(item.id);
    expect(versions[0]!.status).toBe("failed");
  });

  it("routes a model safety-judge block to 'blocked', never 'failed', before any real asset spend", async () => {
    const item = await createRealContentItem();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.reviewContentSafety).mockResolvedValue({
      verdict: { verdict: "block", reasons: ["Tone mismatch for the stated audience."], concerns: [] },
      usage: { model: "claude-sonnet-5", inputTokens: 200, outputTokens: 100, usdCost: 0.005 },
    });

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("blocked");
    expect(image.calls).toHaveLength(0);
    expect(voice.calls).toBe(0);
    expect(edit.calls).toBe(0);
    const versions = await listVersionsWithAssets(item.id);
    expect(versions[0]!.status).toBe("failed");
    expect(versions[0]!.failure_reason).toContain("Tone mismatch");
  });

  it("routes a code-level guardrail rejection (named IP) to 'blocked' too", async () => {
    const item = await createRealContentItem();
    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ hook: "A recreation of the viral counting video everyone loved.", claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, usdCost: 0.01 },
    });

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("blocked");
    expect(voice.calls).toBe(0);
  });

  it("refuses to spend past the real per-item budget cap", async () => {
    const item = await createRealContentItem();
    // Pre-load the ledger past the cap — the very first real media call
    // (voiceover) must refuse before spending anything more.
    await recordCost({
      missionId: null,
      agentId: null,
      contentItemId: item.id,
      model: "n/a",
      usdCost: MAX_ITEM_SPEND_USD + 1,
      provider: "test-fixture",
      unit: "seconds",
      quantity: 1,
    });

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toContain("budget");
    expect(voice.calls).toBe(0);
    expect(image.calls).toHaveLength(0);
  });

  it("fails a version outright once it has exhausted its real generation-attempt cap, rather than retrying forever", async () => {
    const item = await createRealContentItem();
    await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
    const started = await transitionContentItemState(item.id, ["planning"], "generating", {
      generation_attempt_count: MAX_GENERATION_ATTEMPTS_PER_VERSION,
    });
    expect(started.ok).toBe(true);

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();
    const contentBotModule = await import("@/lib/agents/contentBot");

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("failed");
    expect(settled.failure_reason).toContain("generation attempts");
    expect(contentBotModule.planContentVersion).not.toHaveBeenCalled();
    expect(voice.calls).toBe(0);
  });

  it("refuses to open a version past the real version cap, leaving the item exactly where it was", async () => {
    const item = await createRealContentItem();
    const atCap = await transitionContentItemState(item.id, ["planning"], "revision_requested", {
      version_count: 5,
    });
    expect(atCap.ok).toBe(true);

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("revision_requested");
    expect(voice.calls).toBe(0);
    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "revision_skipped_version_cap")).toBe(true);
  });

  it("discards remaining work the instant a founder cancels mid-generation, while preserving the real cost already spent", async () => {
    const item = await createRealContentItem();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const storage = makeFakeStorage();
    // Cancels the item for real, from inside the very first image call
    // (the thumbnail) — simulating a founder's cancel landing exactly
    // between two real provider calls.
    const image = makeFakeImageProvider(async () => {
      await transitionContentItemState(item.id, ["generating"], "cancelled", {
        failure_reason: "Cancelled by founder mid-production (test).",
      });
    });

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit }, storage });

    expect(settled.state).toBe("cancelled");
    // The thumbnail call itself completed (and its real cost was already
    // recorded before the cancellation was even visible to the pipeline);
    // no still image or the video was ever generated afterward.
    expect(image.calls).toHaveLength(1);
    expect(edit.calls).toBe(0);

    const spent = await contentItemSpendUsd(item.id);
    expect(spent).toBeGreaterThan(0);

    const openVersion = await getOpenVersion(item.id);
    expect(openVersion).toBeUndefined(); // no longer "generating"

    const activity = await listActivity(item.mission_id);
    expect(activity.some((a) => a.action === "production_discarded_after_state_change")).toBe(true);
  });
});
