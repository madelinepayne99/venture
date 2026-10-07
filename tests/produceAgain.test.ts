import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import {
  listFounders,
  getMission,
  getContentItem,
  listContentItemsForMissions,
  listAssignments,
  listApprovalsForContentItem,
  listActivity,
  listDeliverables,
  listEvidence,
  listVersionsWithAssets,
  contentItemSpendUsd,
  recordCost,
  openNextVersion,
  updateContentVersion,
  transitionContentItemState,
} from "@/lib/db/repositories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult } from "@/lib/media/types";
import { MAX_VERSIONS_PER_ITEM } from "@/lib/domain/contentProduction";
import { makeContentPlan, makeCreativeStrategy, setupMissionReadyForProduction, makeFakeVideoProvider } from "./testUtils";

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

function textReadable(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
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

const PRODUCE_AGAIN_INPUT = {
  targetPlatform: "youtube_shorts" as const,
  audience: "general" as const,
  contentType: "educational" as const,
  concept: "A second, independent take on the same research.",
  creativeDirection: "Different pacing and visuals from production 1.",
};

describe("produceAgainFromMission — one Scout mission, many independent productions", () => {
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

  /** A real mission + evidence, with NO production_recommendation (so commissionPilotAnyway is the legitimate first-production path — mirrors the real live mission this feature was built for). */
  async function createResearchedMission() {
    return setupMissionReadyForProduction(founderId, { reportOverrides: { production_recommendation: undefined } });
  }

  async function commissionFirstProduction(missionId: string, evidenceId: string) {
    const { commissionPilotAnyway } = await import("@/lib/domain/contentWorkflow");
    return commissionPilotAnyway(missionId, founderId, {
      targetPlatform: "youtube_shorts",
      audience: "general",
      contentType: "educational",
      selectedEvidenceIds: [evidenceId],
      concept: "The original production.",
      creativeDirection: "The original creative direction.",
    });
  }

  it("allows one mission to own multiple independent Content Items", async () => {
    const { mission, evidence } = await createResearchedMission();
    const itemA = await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    expect(itemB.id).not.toBe(itemA.id);
    const allItems = await listContentItemsForMissions([mission.id]);
    expect(allItems.map((i) => i.id).sort()).toEqual([itemA.id, itemB.id].sort());
  });

  it("each new production begins independently at Version 1, and existing history is untouched", async () => {
    const { mission, evidence } = await createResearchedMission();
    const itemA = await commissionFirstProduction(mission.id, evidence[0]!.id);

    // Drive item A through a couple of real versions, exactly like a real
    // production lifecycle would — this is the "existing V1-V5 history"
    // stand-in that must remain byte-for-byte unchanged.
    const versionA1 = await openNextVersion({ contentItemId: itemA.id, parentVersionId: null, revisionApprovalId: null });
    await updateContentVersion(versionA1.id, { plan: makeContentPlan({ claims: [] }) });
    await transitionContentItemState(itemA.id, ["planning"], "generating", { generation_attempt_count: 1 });
    const itemABefore = await getContentItem(itemA.id);
    const versionsABefore = await listVersionsWithAssets(itemA.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    expect(itemB.version_count).toBe(0); // fresh, no version created yet
    expect(itemB.state).toBe("planning");

    const versionB1 = await openNextVersion({ contentItemId: itemB.id, parentVersionId: null, revisionApprovalId: null });
    expect(versionB1.version_number).toBe(1); // independent numbering, not continuing item A's

    // Item A is completely undisturbed by item B's creation.
    const itemAAfter = await getContentItem(itemA.id);
    expect(itemAAfter).toEqual(itemABefore);
    const versionsAAfter = await listVersionsWithAssets(itemA.id);
    expect(versionsAAfter).toEqual(versionsABefore);
  });

  it("the 5-version cap is still enforced independently per Content Item", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const atCap = await transitionContentItemState(itemB.id, ["planning"], "revision_requested", {
      version_count: MAX_VERSIONS_PER_ITEM,
    });
    expect(atCap.ok).toBe(true);

    const { runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const settled = await runContentProductionPipeline(itemB.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("revision_requested"); // refused to open a 6th version, unaffected by item A
    const activity = await listActivity(mission.id);
    expect(activity.some((a) => a.action === "revision_skipped_version_cap")).toBe(true);
  });

  it("never reruns Scout and never mutates the mission's research/evidence", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const deliverablesBefore = await listDeliverables(mission.id);
    const evidenceBefore = await listEvidence(mission.id);
    const missionBefore = await getMission(mission.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const deliverablesAfter = await listDeliverables(mission.id);
    const evidenceAfter = await listEvidence(mission.id);
    expect(deliverablesAfter).toEqual(deliverablesBefore); // no new/changed Scout report
    expect(evidenceAfter).toEqual(evidenceBefore); // no new/changed evidence rows

    const missionAfter = await getMission(mission.id);
    expect(missionAfter!.research_pass_count).toBe(missionBefore!.research_pass_count); // Scout genuinely never ran again
  });

  it("freezes a correct, independent ProductionBrief for the new production", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const brief = itemB.brief as {
      source: string;
      mission: { id: string };
      evidence: Array<{ id: string }>;
      founder_commission: { concept: string; creative_direction: string; commissioned_by_founder_id: string };
    };
    expect(brief.source).toBe("founder_commissioned");
    expect(brief.mission.id).toBe(mission.id);
    expect(brief.evidence.map((e) => e.id)).toEqual([evidence[0]!.id]);
    expect(brief.founder_commission.concept).toBe(PRODUCE_AGAIN_INPUT.concept);
    expect(brief.founder_commission.creative_direction).toBe(PRODUCE_AGAIN_INPUT.creativeDirection);
    expect(brief.founder_commission.commissioned_by_founder_id).toBe(founderId);
  });

  it("never creates a duplicate Content Bot mission assignment across multiple productions", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });
    await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const assignments = await listAssignments(mission.id);
    const leadAssignments = assignments.filter((a) => a.role === "lead");
    expect(leadAssignments).toHaveLength(1); // never a duplicate, across 3 total productions now
  });

  it("gives Produce Again its own distinct, auditable decision and activity — never conflated with the first production", async () => {
    const { mission, evidence } = await createResearchedMission();
    const itemA = await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const approvalsA = await listApprovalsForContentItem(itemA.id);
    const approvalsB = await listApprovalsForContentItem(itemB.id);
    expect(approvalsA.some((a) => a.decision === "commission_pilot_anyway")).toBe(true);
    expect(approvalsA.some((a) => a.decision === "produce_again")).toBe(false);
    expect(approvalsB.some((a) => a.decision === "produce_again")).toBe(true);
    expect(approvalsB.some((a) => a.decision === "commission_pilot_anyway")).toBe(false);

    const activity = await listActivity(mission.id);
    expect(activity.some((a) => a.action === "production_again_requested")).toBe(true);
    expect(activity.some((a) => a.action === "commissioned_pilot_anyway")).toBe(true);
  });

  it("is idempotent under a double-submit: the same idempotencyKey never creates a second production", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const idempotencyKey = randomUUID();
    const input = { ...PRODUCE_AGAIN_INPUT, selectedEvidenceIds: [evidence[0]!.id], idempotencyKey };

    const first = await produceAgainFromMission(mission.id, founderId, input);
    const second = await produceAgainFromMission(mission.id, founderId, input); // sequential retry, same key

    expect(second.id).toBe(first.id);
    const allItems = await listContentItemsForMissions([mission.id]);
    // The original production + exactly one from this idempotency key, never two.
    expect(allItems).toHaveLength(2);

    const inngestModule = await import("@/lib/inngest/client");
    expect(inngestModule.inngest.send).toHaveBeenCalledTimes(2); // 1 for the first production, 1 for this one — never a third
  });

  it("is idempotent under genuinely concurrent double-submission of the same request", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const idempotencyKey = randomUUID();
    const input = { ...PRODUCE_AGAIN_INPUT, selectedEvidenceIds: [evidence[0]!.id], idempotencyKey };

    const [a, b] = await Promise.all([
      produceAgainFromMission(mission.id, founderId, input),
      produceAgainFromMission(mission.id, founderId, input),
    ]);

    // Both either return the same item, or one wins the DB race and the
    // other observes it via the replay check — either way, exactly one
    // real production results.
    const allItems = await listContentItemsForMissions([mission.id]);
    expect(allItems).toHaveLength(2);
    expect(a.id).toBe(b.id);
  });

  it("a genuine later Produce Again with a fresh idempotencyKey still creates a real, independent third production", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });
    const itemC = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      concept: "A completely different third concept.",
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    expect(itemC.id).not.toBe(itemB.id);
    const allItems = await listContentItemsForMissions([mission.id]);
    expect(allItems).toHaveLength(3); // no artificial cap on production count
  });

  it("mission state is monotonic — a second/third production never moves the mission backwards", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);
    const missionAfterFirst = await getMission(mission.id);
    expect(missionAfterFirst!.state).toBe("in_production");

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const missionAfterSecond = await getMission(mission.id);
    expect(missionAfterSecond!.state).toBe("in_production"); // unchanged, never reset to ready_for_founders_review
  });

  it("keeps costs isolated and independently accounted per Content Item", async () => {
    const { mission, evidence } = await createResearchedMission();
    const itemA = await commissionFirstProduction(mission.id, evidence[0]!.id);
    await recordCost({
      missionId: mission.id,
      agentId: null,
      contentItemId: itemA.id,
      model: "claude-sonnet-5",
      usdCost: 1.23,
      provider: "anthropic",
      unit: "tokens",
      quantity: 500,
    });

    const { produceAgainFromMission } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    expect(await contentItemSpendUsd(itemA.id)).toBeCloseTo(1.23, 5);
    expect(await contentItemSpendUsd(itemB.id)).toBe(0); // untouched by item A's spend
  });

  it("runs Creative Strategy and mandatory Visual QC normally for the new production, exactly like any first production", async () => {
    const { mission, evidence } = await createResearchedMission();
    await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission, runContentProductionPipeline } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    const contentBotModule = await import("@/lib/agents/contentBot");
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({ claims: [] }),
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });
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

    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider();
    const video = makeFakeVideoProvider();
    const storage = makeFakeStorage();
    const settled = await runContentProductionPipeline(itemB.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");
    expect(contentBotModule.planCreativeStrategy).toHaveBeenCalledTimes(1);
    expect(contentBotModule.reviewVisualQuality).toHaveBeenCalledTimes(1);

    const versions = await listVersionsWithAssets(itemB.id);
    expect(versions[0]!.creative_strategy).toBeTruthy();
    expect((versions[0]!.qc_report as { overall_verdict: string }).overall_verdict).toBe("pass");
  });

  it("Retry Production still works independently per Content Item alongside another production on the same mission", async () => {
    const { mission, evidence } = await createResearchedMission();
    const itemA = await commissionFirstProduction(mission.id, evidence[0]!.id);

    const { produceAgainFromMission, retryProductionAfterTechnicalFailure } = await import("@/lib/domain/contentWorkflow");
    const itemB = await produceAgainFromMission(mission.id, founderId, {
      ...PRODUCE_AGAIN_INPUT,
      selectedEvidenceIds: [evidence[0]!.id],
      idempotencyKey: randomUUID(),
    });

    // Drive item B into a real, recoverable technical failure — same
    // fixture pattern as tests/retryProduction.test.ts.
    let version = await openNextVersion({ contentItemId: itemB.id, parentVersionId: null, revisionApprovalId: null });
    version = await updateContentVersion(version.id, { plan: makeContentPlan({ claims: [] }) });
    version = await updateContentVersion(version.id, { safety_verdict: { verdict: "pass", reasons: [], concerns: [] } });
    await transitionContentItemState(itemB.id, ["planning"], "generating", { generation_attempt_count: 1 });
    await updateContentVersion(version.id, { status: "failed", failure_reason: "Provider auth failure (test)." });
    const failed = await transitionContentItemState(itemB.id, ["generating"], "failed", {
      failure_reason: "Provider auth failure (test).",
      failure_category: "provider_auth",
    });
    expect(failed.ok).toBe(true);

    vi.stubEnv("MEDIA_IMAGE_PROVIDER", "fal-ai");
    vi.stubEnv("MEDIA_VOICE_PROVIDER", "elevenlabs");
    vi.stubEnv("MEDIA_EDIT_PROVIDER", "shotstack");

    const retried = await retryProductionAfterTechnicalFailure(itemB.id, founderId);
    expect(retried.state).toBe("generating");

    // Item A (a completely different production on the same mission) is
    // entirely unaffected by item B's failure/retry.
    const itemAAfter = await getContentItem(itemA.id);
    expect(itemAAfter!.state).toBe(itemA.state);
    expect(itemAAfter!.failure_category).toBeNull();
  });

  it("refuses a mission whose research never completed (e.g. still researching)", async () => {
    const { createProject, createMission } = await import("@/lib/db/repositories");
    const project = await createProject({ name: "Not yet researched", workspaceType: "commerce" });
    const mission = await createMission({
      founderId,
      projectId: project.id,
      title: "Still researching",
      brief: "Not done yet.",
    });

    const { produceAgainFromMission, MissionNotReadyForProductionError } = await import("@/lib/domain/contentWorkflow");
    await expect(
      produceAgainFromMission(mission.id, founderId, {
        ...PRODUCE_AGAIN_INPUT,
        // Non-empty so input validation passes and the mission-state check
        // (not the "real evidence" check, which runs later) is what fires.
        selectedEvidenceIds: ["not-a-real-evidence-id"],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(MissionNotReadyForProductionError);
  });
});
