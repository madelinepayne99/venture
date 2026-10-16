import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  listVersionsWithAssets,
  listContentAssets,
  listCostsForContentItem,
  listActivity,
  openNextVersion,
  updateContentVersion,
  transitionContentItemState,
  recordContentAsset,
  recordCost,
  getLatestVersion,
} from "@/lib/db/repositories";
import { MAX_ASSET_CALLS_PER_VERSION, MAX_ITEM_SPEND_USD } from "@/lib/domain/contentProduction";
import { isRecoverableFailureCategory } from "@/lib/domain/contentFailureCategories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult, ImageRequest } from "@/lib/media/types";
import { MediaProviderError } from "@/lib/media/types";
import { makeContentPlan, makeCreativeStrategy, setupMissionReadyForProduction, makeFakeVideoProvider } from "./testUtils";

// This file exercises the reference-image continuity design end to end:
// generation/storage, its own QC gate (pass, rejection, one bounded
// replacement), resume after storage but before QC, Retry Production's
// checksum-verified copy-forward, Produce Again's fresh reference, real
// conditioning of every beat + the thumbnail, the untouched full-batch QC
// gate and spend caps, and correct failure/retry classification.

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

type ImageCall = { idempotencyKey: string; referenceImageUrl?: string; prompt: string };

function makeFakeImageProvider(opts: { failFirstCallWithStatus?: number } = {}): ImageProvider & { calls: ImageCall[] } {
  const calls: ImageCall[] = [];
  let n = 0;
  return {
    key: "fake-image",
    capability: "image",
    calls,
    estimateUsd: () => 0.003,
    async generate(req: ImageRequest): Promise<MediaResult> {
      n += 1;
      calls.push({ idempotencyKey: req.idempotencyKey, referenceImageUrl: req.referenceImageUrl, prompt: req.prompt });
      if (opts.failFirstCallWithStatus && n === 1) {
        throw new MediaProviderError(
          "fal-ai",
          opts.failFirstCallWithStatus,
          "unauthorized",
          `fal.ai image generation failed (${opts.failFirstCallWithStatus}): unauthorized`,
        );
      }
      // Distinct bytes per call so each generated image has its own real,
      // distinguishable checksum — needed for the "regeneration produces a
      // different asset" and "retry copies the exact same bytes" tests.
      return {
        open: async () => textReadable(new Uint8Array([1, 2, 3, n])),
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

function makeFakeEditProvider(durationSeconds = 45): EditProvider & { calls: number } {
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

function planWithIdentity(overrides: Partial<Parameters<typeof makeContentPlan>[0]> = {}) {
  return makeContentPlan({
    claims: [],
    visual_identity: {
      canonical_description: "A small translucent forest creature with glowing blue veins and a narrow elongated skull.",
      immutable_traits: ["translucent skin", "no antlers", "pale-blue eyes"],
      continuity_notes: "Keep skin translucency and eye color identical in every shot.",
      reference_asset_id: null,
    },
    ...overrides,
  });
}

describe("Reference-image continuity", () => {
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

  describe("generation and storage", () => {
    it("generates and stores a reference_image asset before any beat/thumbnail call, unconditioned (no referenceImageUrl on its own request)", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      let refCheckCalls = 0;
      vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => {
        if (assets.length === 1 && assets[0]!.assetRef === "reference") refCheckCalls += 1;
        return { report: { overall_verdict: "pass", findings: [] }, usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 } };
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      expect(refCheckCalls).toBe(1);

      const versions = await listVersionsWithAssets(item.id);
      const referenceAssets = versions[0]!.assets.filter((a) => a.kind === "reference_image");
      expect(referenceAssets).toHaveLength(1);

      // The very first image call is the reference's own generation, and
      // it carries no referenceImageUrl — nothing to condition against yet.
      expect(image.calls[0]!.referenceImageUrl).toBeUndefined();
      // Every image call after it (beats + thumbnail) DOES carry one.
      expect(image.calls.slice(1).every((c) => c.referenceImageUrl)).toBe(true);
    });

    it("is a genuine no-op (zero extra cost) for a plan with no visual_identity", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: makeContentPlan({ claims: [] }), // default fixture has visual_identity: null
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      const versions = await listVersionsWithAssets(item.id);
      expect(versions[0]!.assets.some((a) => a.kind === "reference_image")).toBe(false);
      expect(image.calls.every((c) => c.referenceImageUrl === undefined)).toBe(true);
    });
  });

  describe("reference QC — pass, rejection, and one bounded replacement", () => {
    it("passes on the first check — exactly one reference image call, one QC call, then proceeds to the batch", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      const referenceCalls = image.calls.filter((c) => c.referenceImageUrl === undefined);
      expect(referenceCalls).toHaveLength(1); // exactly one — no regeneration needed
      const versions = await listVersionsWithAssets(item.id);
      expect(versions[0]!.reference_regeneration_count).toBe(0);
    });

    it("flags on the first check, regenerates exactly once, passes on the recheck, and proceeds to the batch", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      let refChecks = 0;
      vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => {
        if (assets.length === 1 && assets[0]!.assetRef === "reference") {
          refChecks += 1;
          if (refChecks === 1) {
            return {
              report: { overall_verdict: "flag" as const, findings: [{ asset_ref: "reference", issue_types: ["continuity_break" as const], reasons: ["has antlers"] }] },
              usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
            };
          }
          return { report: { overall_verdict: "pass" as const, findings: [] }, usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 } };
        }
        return { report: { overall_verdict: "pass" as const, findings: [] }, usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 } };
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      expect(refChecks).toBe(2); // initial + exactly one recheck, never more
      const referenceCalls = image.calls.filter((c) => c.referenceImageUrl === undefined);
      expect(referenceCalls).toHaveLength(2); // original + exactly one regeneration
      const versions = await listVersionsWithAssets(item.id);
      expect(versions[0]!.reference_regeneration_count).toBe(1);

      const activity = await listActivity(item.mission_id);
      expect(activity.some((a) => a.action === "reference_regeneration_attempted")).toBe(true);
    });

    it("blocks (never fails) when the reference is still rejected after one regeneration — zero beat/thumbnail spend", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => {
        if (assets.length === 1 && assets[0]!.assetRef === "reference") {
          return {
            report: { overall_verdict: "flag" as const, findings: [{ asset_ref: "reference", issue_types: ["continuity_break" as const], reasons: ["has antlers"] }] },
            usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
          };
        }
        throw new Error("the full-batch QC must never be reached — no beat/thumbnail assets should exist yet");
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("blocked");
      expect(settled.failure_category).toBeNull(); // a real refusal, never Retry-Production-eligible
      const referenceCalls = image.calls.filter((c) => c.referenceImageUrl === undefined);
      expect(referenceCalls).toHaveLength(2); // original + exactly one regeneration, never more
      expect(image.calls.filter((c) => c.referenceImageUrl)).toHaveLength(0); // zero beat/thumbnail image calls
      expect(voice.calls).toBe(0);
      expect(edit.calls).toBe(0);

      const activity = await listActivity(item.mission_id);
      expect(activity.some((a) => a.action === "reference_qc_unresolved")).toBe(true);
    });
  });

  describe("resume after reference storage but before QC", () => {
    it("runs ONLY the QC check on resume — never regenerates an image that already exists", async () => {
      const { storageKeysFor } = await import("@/lib/domain/contentWorkflow");
      const item = await createHarness();
      const plan = planWithIdentity();
      const storage = makeFakeStorage();

      // Manually replicate exactly what a real run would have committed
      // before "crashing": a version with plan/safety_verdict/strategy set
      // and the reference image already stored, but no reference_qc_verdict
      // yet.
      const version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
      await updateContentVersion(version.id, { plan });
      await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
      await updateContentVersion(version.id, { creative_strategy: makeCreativeStrategy() });
      const started = await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
      expect(started.ok).toBe(true);

      const keys = storageKeysFor(item.id, version.id);
      const stored = await storage.put(keys.reference, textReadable(new Uint8Array([7, 7, 7])), "image/jpeg");
      await recordContentAsset({
        contentVersionId: version.id,
        kind: "reference_image",
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
      });

      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      // No call carries an undefined referenceImageUrl AND a fresh
      // generation for the reference key specifically — the reference
      // itself is never regenerated; only beat/thumbnail calls happen.
      expect(image.calls.filter((c) => c.referenceImageUrl === undefined)).toHaveLength(0);
      expect(image.calls.filter((c) => c.referenceImageUrl)).toHaveLength(plan.script.length + 1); // beats + thumbnail
    });
  });

  describe("Retry Production — checksum-verified copy-forward, never a new reference call", () => {
    async function createFailedContentItemWithReference(opts: {
      referenceVerdict: "pass" | "flag" | "none";
      mismatchChecksum?: boolean;
    }) {
      const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
        reportOverrides: { production_recommendation: undefined },
      });
      const { commissionPilotAnyway, storageKeysFor } = await import("@/lib/domain/contentWorkflow");
      const item = await commissionPilotAnyway(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
        concept: "concept",
        creativeDirection: "direction",
      });

      const plan = planWithIdentity();
      const storage = makeFakeStorage();
      let version = await openNextVersion({ contentItemId: item.id, parentVersionId: null, revisionApprovalId: null });
      version = await updateContentVersion(version.id, { plan });
      version = await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
      version = await updateContentVersion(version.id, { creative_strategy: makeCreativeStrategy() });

      let referenceChecksum: string | null = null;
      if (opts.referenceVerdict !== "none") {
        const keys = storageKeysFor(item.id, version.id);
        const stored = await storage.put(keys.reference, textReadable(new Uint8Array([5, 5, 5])), "image/jpeg");
        referenceChecksum = stored.checksumSha256;
        await recordContentAsset({
          contentVersionId: version.id,
          kind: "reference_image",
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
          checksumSha256: stored.checksumSha256,
        });
        version = await updateContentVersion(version.id, {
          reference_qc_verdict: {
            report: { overall_verdict: opts.referenceVerdict, findings: opts.referenceVerdict === "flag" ? [{ asset_ref: "reference", issue_types: ["continuity_break"], reasons: ["bad"] }] : [] },
            reference_checksum_sha256: opts.mismatchChecksum ? "deliberately-wrong-checksum" : (referenceChecksum ?? ""),
          },
        });
      }

      const toGenerating = await transitionContentItemState(item.id, ["planning"], "generating", { generation_attempt_count: 1 });
      expect(toGenerating.ok).toBe(true);
      const { getActiveOrganizationForFounder } = await import("@/lib/domain/organizationWorkflow");
      const organization = await getActiveOrganizationForFounder(founderId);
      await recordCost({
        missionId: item.mission_id,
        organizationId: organization.id,
        agentId: null,
        contentItemId: item.id,
        model: "claude-sonnet-5",
        usdCost: 0.02,
        provider: "anthropic",
        unit: "tokens",
        quantity: 900,
      });
      version = await updateContentVersion(version.id, {
        status: "failed",
        failure_reason: "Could not list ElevenLabs voices (401): missing_permissions voices_read.",
        completed_at: new Date().toISOString(),
      });
      const failed = await transitionContentItemState(item.id, ["generating"], "failed", {
        failure_reason: "Could not list ElevenLabs voices (401): missing_permissions voices_read.",
        failure_category: "provider_auth",
      });
      expect(failed.ok).toBe(true);

      return { item: failed.item, failedVersion: version, storage };
    }

    beforeEach(() => {
      vi.stubEnv("MEDIA_IMAGE_PROVIDER", "fal-ai");
      vi.stubEnv("MEDIA_VOICE_PROVIDER", "elevenlabs");
      vi.stubEnv("MEDIA_EDIT_PROVIDER", "shotstack");
    });

    it("copies the exact reference bytes and the passed verdict forward — no new image call, no new QC call needed to resume", async () => {
      const { item, failedVersion, storage } = await createFailedContentItemWithReference({ referenceVerdict: "pass" });

      const { retryProductionAfterTechnicalFailure, storageKeysFor } = await import("@/lib/domain/contentWorkflow");
      const retried = await retryProductionAfterTechnicalFailure(item.id, founderId, { storage });
      expect(retried.state).toBe("generating");

      const nextVersion = await getLatestVersion(item.id);
      expect(nextVersion!.id).not.toBe(failedVersion.id);

      const assets = await listContentAssets(nextVersion!.id);
      const referenceAsset = assets.find((a) => a.kind === "reference_image");
      expect(referenceAsset).toBeDefined();

      const oldAssets = await listContentAssets(failedVersion.id);
      const oldReference = oldAssets.find((a) => a.kind === "reference_image")!;
      // Exact same bytes — proven by an identical checksum, not merely a
      // copied field.
      expect(referenceAsset!.checksum_sha256).toBe(oldReference.checksum_sha256);
      expect(referenceAsset!.storage_key).not.toBe(oldReference.storage_key); // new version's own key

      const verdict = nextVersion!.reference_qc_verdict as { report: { overall_verdict: string }; reference_checksum_sha256: string };
      expect(verdict.report.overall_verdict).toBe("pass");
      expect(verdict.reference_checksum_sha256).toBe(referenceAsset!.checksum_sha256);

      // Resuming the pipeline now must not call the image provider for the
      // reference at all — runReferenceGenerationStage's own checksum
      // check short-circuits immediately.
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      expect(image.calls.filter((c) => c.referenceImageUrl === undefined)).toHaveLength(0); // zero new reference calls
    });

    it("does NOT copy a reference whose verdict was never a pass — the retried run regenerates and re-checks it from scratch", async () => {
      const { item, storage } = await createFailedContentItemWithReference({ referenceVerdict: "flag" });

      const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
      const retried = await retryProductionAfterTechnicalFailure(item.id, founderId, { storage });
      const nextVersion = await getLatestVersion(item.id);
      expect(nextVersion!.reference_qc_verdict).toBeNull();
      const assets = await listContentAssets(nextVersion!.id);
      expect(assets.some((a) => a.kind === "reference_image")).toBe(false);
      expect(retried.id).toBe(item.id);
    });

    it("does NOT copy a reference whose stored verdict's checksum doesn't match the actual asset — never trusts a mismatched verdict", async () => {
      const { item, storage } = await createFailedContentItemWithReference({ referenceVerdict: "pass", mismatchChecksum: true });

      const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
      await retryProductionAfterTechnicalFailure(item.id, founderId, { storage });
      const nextVersion = await getLatestVersion(item.id);
      expect(nextVersion!.reference_qc_verdict).toBeNull();
      const assets = await listContentAssets(nextVersion!.id);
      expect(assets.some((a) => a.kind === "reference_image")).toBe(false);
    });

    it("has nothing to copy when the failed version never had a reference at all — regenerates normally", async () => {
      const { item, storage } = await createFailedContentItemWithReference({ referenceVerdict: "none" });

      const { retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
      const retried = await retryProductionAfterTechnicalFailure(item.id, founderId, { storage });
      expect(retried.state).toBe("generating");
      const nextVersion = await getLatestVersion(item.id);
      const assets = await listContentAssets(nextVersion!.id);
      expect(assets.some((a) => a.kind === "reference_image")).toBe(false);
    });
  });

  describe("Produce Again generates a genuinely fresh reference", () => {
    it("calls the image provider for a new reference on a second, independent production — never reuses another item's asset", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const { mission, evidence } = await setupMissionReadyForProduction(founderId, {
        reportOverrides: { production_recommendation: undefined },
      });
      const { commissionPilotAnyway, produceAgainFromMission, runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const firstItem = await commissionPilotAnyway(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
        concept: "concept 1",
        creativeDirection: "direction 1",
      });
      const storage1 = makeFakeStorage();
      const image1 = makeFakeImageProvider();
      await runContentProductionPipeline(firstItem.id, { media: { image: image1, voice: makeFakeVoiceProvider(), edit: makeFakeEditProvider(), video: makeFakeVideoProvider() }, storage: storage1 });
      expect(image1.calls.filter((c) => c.referenceImageUrl === undefined)).toHaveLength(1);

      const secondItem = await produceAgainFromMission(mission.id, founderId, {
        targetPlatform: "youtube_shorts",
        audience: "general",
        contentType: "educational",
        selectedEvidenceIds: [evidence[0]!.id],
        concept: "concept 2 — a different angle",
        creativeDirection: "direction 2",
        idempotencyKey: "produce-again-ref-test-1",
      });
      expect(secondItem.id).not.toBe(firstItem.id);

      const storage2 = makeFakeStorage();
      const image2 = makeFakeImageProvider();
      const settled2 = await runContentProductionPipeline(secondItem.id, { media: { image: image2, voice: makeFakeVoiceProvider(), edit: makeFakeEditProvider(), video: makeFakeVideoProvider() }, storage: storage2 });

      expect(settled2.state).toBe("awaiting_review");
      // A genuinely new, real image call for the second item's own reference.
      expect(image2.calls.filter((c) => c.referenceImageUrl === undefined)).toHaveLength(1);

      const versions2 = await listVersionsWithAssets(secondItem.id);
      const versions1 = await listVersionsWithAssets(firstItem.id);
      const ref1 = versions1[0]!.assets.find((a) => a.kind === "reference_image")!;
      const ref2 = versions2[0]!.assets.find((a) => a.kind === "reference_image")!;
      expect(ref2.id).not.toBe(ref1.id);
      expect(ref2.content_version_id).not.toBe(ref1.content_version_id);
    });
  });

  describe("reference conditioning reaches every intended beat image and the thumbnail", () => {
    it("every beat AND the thumbnail carry the resolved referenceImageUrl; only the reference's own generation does not", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      const plan = planWithIdentity();
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan,
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("awaiting_review");
      // 1 reference + 1 thumbnail + N beats = total image calls.
      expect(image.calls).toHaveLength(1 + 1 + plan.script.length);
      const [referenceCall, ...rest] = image.calls;
      expect(referenceCall!.referenceImageUrl).toBeUndefined();
      expect(rest.every((c) => typeof c.referenceImageUrl === "string" && c.referenceImageUrl!.length > 0)).toBe(true);
      // Every conditioned call points at the SAME reference — a single
      // canonical subject, not a different one per call.
      const urls = new Set(rest.map((c) => c.referenceImageUrl));
      expect(urls.size).toBe(1);
    });
  });

  describe("the existing mandatory full-batch Visual QC gate and spend caps are untouched", () => {
    it("the full-batch QC can still flag and block AFTER a reference that itself passed — both gates are real and independent", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockImplementation(async ({ assets }) => {
        if (assets.length === 1 && assets[0]!.assetRef === "reference") {
          return { report: { overall_verdict: "pass" as const, findings: [] }, usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 } };
        }
        // The full batch (thumbnail + beats) still fails on its own merits.
        return {
          report: { overall_verdict: "flag" as const, findings: [{ asset_ref: "beat_0", issue_types: ["composition_failure" as const], reasons: ["broken"] }] },
          usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
        };
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("blocked");
      // Real beat/thumbnail spend DID happen (the reference passed, so the
      // batch was genuinely generated) — proving the reference gate didn't
      // somehow swallow or replace the real full-batch gate.
      // thumbnail + 2 default beats + the full-batch QC's own one bounded
      // regeneration attempt on the flagged beat_0 (still reference-
      // conditioned — proving the QC-regeneration path stays conditioned too).
      expect(image.calls.filter((c) => c.referenceImageUrl)).toHaveLength(4);
    });

    it("MAX_ASSET_CALLS_PER_VERSION accounts for the reference image — a plan just over the cap once it's counted is refused before any spend", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      const manyBeats = Array.from({ length: MAX_ASSET_CALLS_PER_VERSION - 1 }, (_, i) => ({
        index: i,
        beat_role: "context" as const,
        narration: "word ".repeat(2).trim(),
        visual_direction: `beat ${i}`,
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
        start_seconds: i,
        end_seconds: i + 1,
      }));
      // 1 voiceover + 1 thumbnail + (MAX-1) stills + 1 reference = MAX + 1 — over the cap only because the reference is now correctly counted.
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity({ script: manyBeats, duration_seconds: manyBeats.length }),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "pass", findings: [] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const item = await createHarness();
      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("failed"); // ContentAssetCallCapExceededError — a real, technical/budget refusal
      expect(image.calls).toHaveLength(0); // refused BEFORE any spend, reference included
      expect(voice.calls).toBe(0);
    });

    it("the item spend cap (MAX_ITEM_SPEND_USD) is checked before the reference call itself, not only before beat calls", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const item = await createHarness();
      // Pre-spend right up to the cap so the very next call (the
      // reference's own generation) would exceed it.
      const { getActiveOrganizationForFounder } = await import("@/lib/domain/organizationWorkflow");
      const organization = await getActiveOrganizationForFounder(founderId);
      await recordCost({
        missionId: item.mission_id,
        organizationId: organization.id,
        agentId: null,
        contentItemId: item.id,
        model: "fake",
        usdCost: MAX_ITEM_SPEND_USD - 0.001,
        provider: "fake-image",
        unit: "images",
        quantity: 1,
      });

      const image = makeFakeImageProvider();
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("failed");
      expect(image.calls).toHaveLength(0); // refused before the reference call itself
    });
  });

  describe("failure and retry classification — technical vs. QC failures for the reference stage", () => {
    it("a technical error generating the reference settles to \"failed\" with a real failure_category and stays Retry-Production-eligible", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

      const item = await createHarness();
      const image = makeFakeImageProvider({ failFirstCallWithStatus: 401 });
      const voice = makeFakeVoiceProvider();
      const edit = makeFakeEditProvider();
      const video = makeFakeVideoProvider();
      const storage = makeFakeStorage();
      const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
      const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

      expect(settled.state).toBe("failed"); // a technical breakdown, never "blocked"
      expect(settled.failure_category).toBe("provider_auth");
      expect(isRecoverableFailureCategory(settled.failure_category)).toBe(true);
      expect(voice.calls).toBe(0); // never reached asset_generation's beat/thumbnail batch
    });

    it("a QC rejection of the reference settles to \"blocked\" with no failure_category and is explicitly NOT Retry-Production-eligible", async () => {
      const contentBotModule = await import("@/lib/agents/contentBot");
      vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
        plan: planWithIdentity(),
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });
      vi.mocked(contentBotModule.reviewVisualQuality).mockResolvedValue({
        report: { overall_verdict: "flag", findings: [{ asset_ref: "reference", issue_types: ["continuity_break"], reasons: ["bad"] }] },
        usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
      });

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
      expect(isRecoverableFailureCategory(settled.failure_category)).toBe(false);

      vi.stubEnv("MEDIA_IMAGE_PROVIDER", "fal-ai");
      vi.stubEnv("MEDIA_VOICE_PROVIDER", "elevenlabs");
      vi.stubEnv("MEDIA_EDIT_PROVIDER", "shotstack");
      const { retryProductionAfterTechnicalFailure, NotRecoverableFailureError } = await import("@/lib/domain/contentWorkflow");
      await expect(retryProductionAfterTechnicalFailure(item.id, founderId)).rejects.toBeInstanceOf(NotRecoverableFailureError);
    });
  });
});
