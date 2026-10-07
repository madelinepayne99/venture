import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, listVersionsWithAssets } from "@/lib/db/repositories";
import type { StorageProvider, StoredObject } from "@/lib/storage/types";
import type { ImageProvider, VoiceProvider, EditProvider, MediaResult, VoiceMediaResult, ImageRequest } from "@/lib/media/types";
import type { VisualIdentity, ScriptBeat } from "@/lib/agents/contentBot/schema";
import { makeContentPlan, makeCreativeStrategy, setupMissionReadyForProduction, makeFakeVideoProvider } from "./testUtils";

// Regression coverage for the Production 4 forensic fix: a per-beat
// "subject_prominence" field (full/faint/absent) that stops
// reference-conditioning from fighting shots whose own narrative purpose
// is to show the recurring subject camouflaged or absent.

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

const IDENTITY: VisualIdentity = {
  canonical_description: "A lean, glass-skinned forest creature with glowing veins.",
  immutable_traits: ["transparent skin", "glowing veins", "pale eyes"],
  continuity_notes: "Keep the silhouette identical across shots.",
  reference_asset_id: null,
};

describe("subject_prominence — unit-level (promptForBeatProminence / referenceImageUrlForProminence / beatSubjectProminence)", () => {
  it("\"full\" sends the reference image and the canonical identity text, unchanged from before this field existed", async () => {
    const { promptForBeatProminence, referenceImageUrlForProminence, withVisualIdentity } = await import("@/lib/domain/contentWorkflow");
    const prompt = promptForBeatProminence("a wide forest shot", IDENTITY, "full");
    expect(prompt).toBe(withVisualIdentity("a wide forest shot", IDENTITY)); // byte-identical to the pre-existing behavior
    expect(prompt).toContain(IDENTITY.canonical_description);
    expect(prompt).toContain("transparent skin");

    const url = referenceImageUrlForProminence("https://example.test/reference.jpg", "full");
    expect(url).toBe("https://example.test/reference.jpg");
  });

  it("\"faint\" sends the reference image AND the canonical identity, plus an explicit reduced-visibility instruction", async () => {
    const { promptForBeatProminence, referenceImageUrlForProminence } = await import("@/lib/domain/contentWorkflow");
    const prompt = promptForBeatProminence("a wide forest shot", IDENTITY, "faint");
    // Identity is still preserved — this is NOT the same as disabling conditioning.
    expect(prompt).toContain(IDENTITY.canonical_description);
    expect(prompt).toContain("transparent skin");
    // The new, stronger instruction is present and explicitly prioritizes
    // reduced visibility over the reference's normal clarity.
    expect(prompt).toMatch(/camouflaged|obscured|faintly|partially visible/i);
    expect(prompt).toMatch(/prioritize|reduced visibility/i);

    const url = referenceImageUrlForProminence("https://example.test/reference.jpg", "faint");
    expect(url).toBe("https://example.test/reference.jpg"); // still conditioned
  });

  it("\"absent\" sends NEITHER referenceImageUrl NOR any canonical subject identity text", async () => {
    const { promptForBeatProminence, referenceImageUrlForProminence } = await import("@/lib/domain/contentWorkflow");
    const prompt = promptForBeatProminence("an empty forest clearing", IDENTITY, "absent");
    expect(prompt).toBe("an empty forest clearing"); // the base prompt, completely untouched
    expect(prompt).not.toContain(IDENTITY.canonical_description);
    expect(prompt).not.toContain("transparent skin");
    expect(prompt).not.toContain("glowing veins");

    const url = referenceImageUrlForProminence("https://example.test/reference.jpg", "absent");
    expect(url).toBeUndefined();
  });

  it("old beats with no subject_prominence key at all default to \"full\" — genuine backward compatibility, not just a type default", async () => {
    const { beatSubjectProminence } = await import("@/lib/domain/contentWorkflow");
    // Simulates a real pre-existing DB row: a beat object with the key
    // genuinely absent (not just set to undefined), exactly what a plan
    // persisted before this field existed looks like when read back.
    const legacyBeat = { index: 0 } as unknown as Pick<ScriptBeat, "subject_prominence">;
    expect(beatSubjectProminence(legacyBeat)).toBe("full");
  });

  it("no identity at all (visual_identity: null): \"full\" and \"absent\" are both just the base prompt untouched", async () => {
    const { promptForBeatProminence, referenceImageUrlForProminence } = await import("@/lib/domain/contentWorkflow");
    expect(promptForBeatProminence("a shot", null, "full")).toBe("a shot");
    expect(promptForBeatProminence("a shot", null, "absent")).toBe("a shot");
    // "faint" with no identity still appends the reduced-visibility
    // instruction (a plan author could theoretically set faint with no
    // identity — the function doesn't need to special-case that
    // combination, it just has nothing to preserve identity-wise).
    const faintPrompt = promptForBeatProminence("a shot", null, "faint");
    expect(faintPrompt).toContain("a shot");
    expect(faintPrompt).not.toBe("a shot");
    expect(faintPrompt).toMatch(/camouflaged|obscured|faintly|partially visible/i);

    expect(referenceImageUrlForProminence(undefined, "full")).toBeUndefined();
    expect(referenceImageUrlForProminence(undefined, "absent")).toBeUndefined();
  });
});

describe("Visual QC receives and documents the intended prominence per asset", () => {
  it("the real prompt sent to the QC model includes each asset's expectedProminence, with a clear definition of what each value means", async () => {
    const { reviewVisualQuality } = await import("@/lib/agents/contentBot/visualQC");
    const { fakeAnthropicClientWithCalls, fakeAnthropicMessage } = await import("./testUtils");
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage({ overall_verdict: "pass", findings: [] })]);
    await reviewVisualQuality(
      {
        plan: { visual_identity: IDENTITY, disclosure: { text: "x", placement: "persistent_badge" } },
        audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
        assets: [
          { assetRef: "beat_1", description: "creature clearly visible", contentType: "image/jpeg", base64: "AAAA", expectedProminence: "full" },
          { assetRef: "beat_2", description: "creature camouflaged", contentType: "image/jpeg", base64: "AAAA", expectedProminence: "faint" },
          { assetRef: "beat_3", description: "empty clearing", contentType: "image/jpeg", base64: "AAAA", expectedProminence: "absent" },
        ],
      },
      { client },
    );
    const params = calls[0] as { system: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    const userTexts = params.messages[0]!.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

    expect(userTexts).toMatch(/beat_1[\s\S]*"full"/);
    expect(userTexts).toMatch(/beat_2[\s\S]*"faint"/);
    expect(userTexts).toMatch(/beat_3[\s\S]*"absent"/);

    // The system prompt tells the model HOW to judge each value, not just
    // that the label exists.
    const normalize = (s: string) => s.replace(/\s+/g, " ");
    expect(normalize(params.system)).toMatch(/faint.*(is not a defect|correctly camouflaged|correctly obscured)/i);
    expect(normalize(params.system)).toMatch(/absent.*(being absent is correct|correct)/i);
  });

  it("a genuinely faint/absent depiction does not need to be flagged just because the subject isn't clearly visible — QC's own judgment, exercised against a real schema-valid response", async () => {
    const { reviewVisualQuality } = await import("@/lib/agents/contentBot/visualQC");
    const { fakeAnthropicClientWithCalls, fakeAnthropicMessage } = await import("./testUtils");
    // The model, correctly informed of the "absent" expectation, returns
    // a clean pass for a shot with no subject visible — proving nothing
    // in the schema/parsing layer forces a mismatch finding just because
    // the described content differs from a "full" shot.
    const { client } = fakeAnthropicClientWithCalls([fakeAnthropicMessage({ overall_verdict: "pass", findings: [] })]);
    const result = await reviewVisualQuality(
      {
        plan: { visual_identity: IDENTITY, disclosure: { text: "x", placement: "persistent_badge" } },
        audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
        assets: [{ assetRef: "beat_3", description: "empty clearing, no trace of the creature", contentType: "image/jpeg", base64: "AAAA", expectedProminence: "absent" }],
      },
      { client },
    );
    expect(result.report.overall_verdict).toBe("pass");
    expect(result.report.findings).toHaveLength(0);
  });
});

describe("normal continuity behavior (subject_prominence: \"full\") is unchanged end to end", () => {
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
  type ImageCall = { idempotencyKey: string; referenceImageUrl?: string; prompt: string };
  function makeFakeImageProvider(): ImageProvider & { calls: ImageCall[] } {
    const calls: ImageCall[] = [];
    return {
      key: "fake-image",
      capability: "image",
      calls,
      estimateUsd: () => 0.003,
      async generate(req: ImageRequest): Promise<MediaResult> {
        calls.push({ idempotencyKey: req.idempotencyKey, referenceImageUrl: req.referenceImageUrl, prompt: req.prompt });
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
  function makeFakeEditProvider(durationSeconds = 45): EditProvider {
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

  it("a plan where every beat is \"full\" (the default/omitted case) behaves exactly like before this field existed — every beat and the thumbnail get the reference + identity text", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    // makeContentPlan's own default fixture never sets subject_prominence
    // explicitly on its beats (it relies on the schema's own default) —
    // using it unmodified here IS the "old fixture" backward-compat case.
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan: makeContentPlan({
        claims: [],
        visual_identity: {
          canonical_description: "A lean, glass-skinned forest creature with glowing veins.",
          immutable_traits: ["transparent skin"],
          continuity_notes: "Keep the silhouette identical across shots.",
          reference_asset_id: null,
        },
      }),
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
    const plan = versions[0]!.plan as { script: Array<{ subject_prominence?: string }> };
    // The default fixture's own beats: confirm they really did resolve to "full".
    expect(plan.script.every((b) => (b.subject_prominence ?? "full") === "full")).toBe(true);

    // Every conditioned call (everything after the reference's own
    // generation) carries a referenceImageUrl — nothing skipped, nothing
    // different from the pre-existing behavior.
    const [referenceCall, ...rest] = image.calls;
    expect(referenceCall!.referenceImageUrl).toBeUndefined();
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((c) => typeof c.referenceImageUrl === "string" && c.referenceImageUrl!.length > 0)).toBe(true);
    expect(rest.every((c) => c.prompt.includes("A lean, glass-skinned forest creature with glowing veins."))).toBe(true);
  });

  it("a mixed plan (full/faint/absent) conditions each beat correctly: full+faint get the reference image, absent does not; only full+faint prompts carry the identity text", async () => {
    const contentBotModule = await import("@/lib/agents/contentBot");
    const plan = makeContentPlan({
      claims: [],
      duration_seconds: 5, // matches this fixture's deliberately minimal "n" narration per beat
      visual_identity: {
        canonical_description: "A lean, glass-skinned forest creature with glowing veins.",
        immutable_traits: ["transparent skin"],
        continuity_notes: "Keep the silhouette identical across shots.",
        reference_asset_id: null,
      },
      script: [
        {
          index: 0,
          beat_role: "hook",
          narration: "n",
          visual_direction: "the creature stands in a clearing",
          starting_state: "s",
          action: "a",
          ending_state: "e",
          clip_duration_seconds: 5,
          subject_prominence: "full",
          shot_type: "wide",
          camera_movement: "static",
          movement_intensity: "normal",
          transition_in: "cut",
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 0,
          end_seconds: 2,
        },
        {
          index: 1,
          beat_role: "context",
          narration: "n",
          visual_direction: "the creature blends into dappled light",
          starting_state: "s",
          action: "a",
          ending_state: "e",
          clip_duration_seconds: 5,
          subject_prominence: "faint",
          shot_type: "wide",
          camera_movement: "static",
          movement_intensity: "normal",
          transition_in: "cut",
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 2,
          end_seconds: 4,
        },
        {
          index: 2,
          beat_role: "reveal",
          narration: "n",
          visual_direction: "an empty forest clearing, calm ambience",
          starting_state: "s",
          action: "a",
          ending_state: "e",
          clip_duration_seconds: 5,
          subject_prominence: "absent",
          shot_type: "wide",
          camera_movement: "static",
          movement_intensity: "normal",
          transition_in: "cut",
          on_screen_text: null,
          retention_purpose: "r",
          start_seconds: 4,
          end_seconds: 6,
        },
      ],
    });
    vi.mocked(contentBotModule.planContentVersion).mockResolvedValue({
      plan,
      usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, usdCost: 0.001 },
    });

    const item = await createHarness();
    const image = makeFakeImageProvider();
    const voice = makeFakeVoiceProvider();
    const edit = makeFakeEditProvider(5);
    const video = makeFakeVideoProvider(); // matches this fixture's duration_seconds: 5
    const storage = makeFakeStorage();
    const { runContentProductionPipeline, storageKeysFor } = await import("@/lib/domain/contentWorkflow");
    const settled = await runContentProductionPipeline(item.id, { media: { image, voice, edit, video }, storage });

    expect(settled.state).toBe("awaiting_review");

    const versions = await listVersionsWithAssets(item.id);
    const versionId = versions[0]!.id;
    const keys = storageKeysFor(item.id, versionId);

    const fullCall = image.calls.find((c) => c.idempotencyKey === keys.image(0))!;
    const faintCall = image.calls.find((c) => c.idempotencyKey === keys.image(1))!;
    const absentCall = image.calls.find((c) => c.idempotencyKey === keys.image(2))!;
    const thumbnailCall = image.calls.find((c) => c.idempotencyKey === keys.thumbnail)!;

    // full
    expect(fullCall.referenceImageUrl).toBeTruthy();
    expect(fullCall.prompt).toContain("A lean, glass-skinned forest creature with glowing veins.");

    // faint — reference image still sent, identity still described, PLUS
    // the reduced-visibility instruction.
    expect(faintCall.referenceImageUrl).toBeTruthy();
    expect(faintCall.prompt).toContain("A lean, glass-skinned forest creature with glowing veins.");
    expect(faintCall.prompt).toMatch(/camouflaged|obscured|faintly|partially visible/i);

    // absent — no reference image, and no identity text at all (only the
    // beat's own environmental visual_direction).
    expect(absentCall.referenceImageUrl).toBeUndefined();
    expect(absentCall.prompt).not.toContain("A lean, glass-skinned forest creature with glowing veins.");
    expect(absentCall.prompt).not.toContain("transparent skin");
    expect(absentCall.prompt).toBe("an empty forest clearing, calm ambience");

    // Thumbnail is unaffected by any of this — always "full" behavior.
    expect(thumbnailCall.referenceImageUrl).toBeTruthy();
    expect(thumbnailCall.prompt).toContain("A lean, glass-skinned forest creature with glowing veins.");
  });
});
