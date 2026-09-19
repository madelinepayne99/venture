import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ContentAsset, ContentAssetKind, ContentItem, ContentItemState, ContentVersion } from "@/lib/db/types";
import type { AudienceContext, MediaDeps, MediaResult, VoiceWordTiming } from "@/lib/media/types";
import type { ScoutReport } from "@/lib/agents/scout/schema";
import type { ContentPlan } from "@/lib/agents/contentBot/schema";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import type { StorageProvider } from "@/lib/storage/types";
import {
  getMission,
  getProject,
  listDeliverables,
  listEvidence,
  transitionMissionState,
  createContentItem,
  recordApproval,
  recordActivity,
  assignAgent,
  getAgentByKey,
  getContentItem,
  transitionContentItemState,
  incrementContentItemGenerationAttempts,
  getOpenVersion,
  getLatestVersion,
  getContentVersion,
  openNextVersion,
  updateContentVersion,
  listContentAssets,
  recordContentAsset,
  listApprovalsForContentItem,
  startStage,
  getOpenStage,
  completeStage,
  failStage,
  recordCost,
} from "@/lib/db/repositories";
import { MissionConcurrencyError, assertTransition } from "@/lib/domain/missionStates";
import {
  ContentItemConcurrencyError,
  assertContentItemTransition,
  isContentItemCancellable,
} from "@/lib/domain/contentItemStates";
import { buildProductionBrief, NoProductionRecommendationError } from "@/lib/domain/contentHandoff";
import {
  MAX_VERSIONS_PER_ITEM,
  MAX_GENERATION_ATTEMPTS_PER_VERSION,
  MAX_ASSET_CALLS_PER_VERSION,
  assertItemBudgetRemaining,
  ContentAssetCallCapExceededError,
  ContentVersionCapExceededError,
} from "@/lib/domain/contentProduction";
import { planContentVersion, reviewContentSafety, ContentBotError } from "@/lib/agents/contentBot";
import type { SafetyVerdict } from "@/lib/agents/contentBot/schema";
import {
  assertNoNamedIP,
  assertAudienceAppropriate,
  assertClaimsAreEvidenced,
  assertAssetsMatchPlan,
  ContentGuardrailError,
} from "@/lib/agents/contentBot/guardrails";
import { getImageProvider, getVoiceProvider, getEditProvider } from "@/lib/media/registry";
import { getStorageProvider } from "@/lib/storage/registry";
import { uploadToFalStorage } from "@/lib/media/providers/falStorage";
import { calculateUsdCost } from "@/lib/agents/pricing";
import {
  inngest,
  CONTENT_PRODUCTION_REQUESTED_EVENT,
  CONTENT_REVISION_REQUESTED_EVENT,
} from "@/lib/inngest/client";

export class ProductionApprovalValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ProductionApprovalValidationError";
  }
}

function validateApproveForProductionInput(input: {
  targetPlatform: AudienceContext["platform"];
  audience: AudienceContext["audience"];
  contentType: AudienceContext["contentType"];
  selectedEvidenceIds: string[];
}): string[] {
  const errors: string[] = [];
  const platforms: AudienceContext["platform"][] = ["youtube", "youtube_shorts", "tiktok"];
  const audiences: AudienceContext["audience"][] = ["general", "teen", "kids"];
  const contentTypes: AudienceContext["contentType"][] = ["educational", "comedy", "commentary", "product", "story"];
  if (!platforms.includes(input.targetPlatform)) errors.push("targetPlatform must be a real supported platform.");
  if (!audiences.includes(input.audience)) errors.push("audience must be a real supported audience.");
  if (!contentTypes.includes(input.contentType)) errors.push("contentType must be a real supported content type.");
  if (input.selectedEvidenceIds.length === 0) {
    errors.push("At least one piece of evidence must be selected for the production brief.");
  }
  return errors;
}

/**
 * The founder's separate "approve for production" decision — distinct
 * from the approval that dispatches Scout to research in the first place
 * (see CLAUDE.md's Content Bot milestone). Ordering mirrors
 * missionWorkflow.ts's approveMission exactly: the atomic mission-state
 * transition happens FIRST (a lost race here costs nothing, since nothing
 * has been created yet), the Inngest event is sent LAST and wrapped so a
 * send failure never corrupts the already-committed content item, and the
 * whole call returns immediately without waiting for Content Bot's work.
 */
export async function approveForProduction(
  missionId: string,
  founderId: string,
  input: {
    targetPlatform: AudienceContext["platform"];
    audience: AudienceContext["audience"];
    contentType: AudienceContext["contentType"];
    selectedEvidenceIds: string[];
    founderNotes?: string | null;
  },
): Promise<ContentItem> {
  const validationErrors = validateApproveForProductionInput(input);
  if (validationErrors.length > 0) {
    throw new ProductionApprovalValidationError(validationErrors);
  }

  const mission = await getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);

  const [deliverables, evidence] = await Promise.all([listDeliverables(missionId), listEvidence(missionId)]);
  const scoutDeliverable = deliverables.find((d) => d.kind === "scout_research_report" || d.kind === "scout_followup_report");
  if (!scoutDeliverable) {
    throw new Error(`Mission ${missionId} has no Scout report to build a production brief from.`);
  }
  // The most recent (highest-signal) report is the one actually offering the
  // recommendation — a follow-up report, when one exists, supersedes pass 1
  // exactly as the founder review UI already shows it.
  const latestScoutDeliverable =
    deliverables.filter((d) => d.kind === "scout_followup_report").at(-1) ?? scoutDeliverable;

  const report = latestScoutDeliverable.content as ScoutReport;
  if (!report.production_recommendation) {
    throw new NoProductionRecommendationError(missionId);
  }

  const invalidEvidenceIds = input.selectedEvidenceIds.filter((id) => !evidence.some((e) => e.id === id));
  if (invalidEvidenceIds.length > 0) {
    throw new ProductionApprovalValidationError([
      `selectedEvidenceIds contained ids that aren't real evidence for this mission: ${invalidEvidenceIds.join(", ")}.`,
    ]);
  }

  const project = mission.project_id ? (await getProject(mission.project_id)) ?? null : null;

  assertTransition(mission.state, "in_production");
  const transition = await transitionMissionState(missionId, [mission.state], "in_production");
  if (!transition.ok) {
    throw new MissionConcurrencyError(missionId, [mission.state], "in_production", transition.mission.state);
  }

  const contentBot = await getAgentByKey("content_bot");
  if (!contentBot) throw new Error("Content Bot agent is not registered — seed data is missing.");

  const brief = buildProductionBrief({
    mission,
    project,
    scoutDeliverable: { ...latestScoutDeliverable, content: report },
    evidence,
    selectedEvidenceIds: input.selectedEvidenceIds,
    founderNotes: input.founderNotes ?? null,
  });

  const audienceContext: AudienceContext = {
    platform: input.targetPlatform,
    audience: input.audience,
    contentType: input.contentType,
    workspaceType: project?.workspace_type ?? "commerce",
  };

  const item = await createContentItem({
    missionId,
    agentId: contentBot.id,
    sourceDeliverableId: latestScoutDeliverable.id,
    brief,
    audienceContext,
  });

  await assignAgent(missionId, contentBot.id, "lead");

  await recordApproval({
    missionId,
    founderId,
    decision: "approve_for_production",
    note: input.founderNotes ?? undefined,
    contentItemId: item.id,
  });
  await recordActivity({
    missionId,
    actor: `founder:${founderId}`,
    action: "approved_for_production",
    detail: `Target platform: ${input.targetPlatform}, audience: ${input.audience}, content type: ${input.contentType}.`,
  });

  try {
    await inngest.send({
      id: `content-production-requested-${item.id}`,
      name: CONTENT_PRODUCTION_REQUESTED_EVENT,
      data: { contentItemId: item.id, missionId },
    });
  } catch (sendError) {
    // Mirrors runScoutPipeline's followup-dispatch failure handling exactly:
    // a send failure here must never undo the content item that was just
    // committed — the self-healing watchdog (Phase 5) retries the dispatch.
    await recordActivity({
      missionId,
      actor: "system",
      action: "production_dispatch_failed",
      detail: `Could not send the production-requested dispatch event: ${
        sendError instanceof Error ? sendError.message : "unknown error"
      }. The content item remains correctly created at "planning" — the self-healing watchdog will retry the dispatch.`,
    });
  }

  return item;
}

// ---------------------------------------------------------------------------
// The founder's review decisions on a finished piece (Milestone C1, §11)
// ---------------------------------------------------------------------------

export class ContentDecisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentDecisionValidationError";
  }
}

/**
 * Every decision route shares this precondition: the version a founder is
 * looking at in the review UI must still genuinely be the item's latest
 * one. Refuses with a clear error rather than silently applying a
 * founder's decision to a version that's gone stale (e.g. two tabs open,
 * or a revision that started producing between page load and the click).
 */
async function assertIsLatestVersion(item: ContentItem, contentVersionId: string): Promise<void> {
  const latest = await getLatestVersion(item.id);
  if (!latest || latest.id !== contentVersionId) {
    throw new ContentDecisionValidationError(
      `This decision was made against a version that is no longer content item ${item.id}'s latest one — refresh and try again.`,
    );
  }
}

/**
 * Approving the finished piece. No Inngest event — this gate does not
 * publish (Publish is its own separate, later gate — see CLAUDE.md's
 * Content Bot milestone; C1 ends at "ready_to_publish").
 */
export async function approveContentVersion(
  contentItemId: string,
  founderId: string,
  input: { contentVersionId: string },
): Promise<ContentItem> {
  const item = await getContentItem(contentItemId);
  if (!item) throw new Error(`Content item ${contentItemId} not found.`);
  await assertIsLatestVersion(item, input.contentVersionId);

  assertContentItemTransition(item.state, "ready_to_publish");
  const transition = await transitionContentItemState(item.id, [item.state], "ready_to_publish", {
    approved_version_id: input.contentVersionId,
  });
  if (!transition.ok) {
    throw new ContentItemConcurrencyError(item.id, [item.state], "ready_to_publish", transition.item.state);
  }

  await recordApproval({
    missionId: item.mission_id,
    founderId,
    decision: "approve_content",
    contentItemId: item.id,
    contentVersionId: input.contentVersionId,
  });
  await recordActivity({
    missionId: item.mission_id,
    actor: `founder:${founderId}`,
    action: "content_approved",
    detail: "Version approved — ready to publish.",
  });

  return transition.item;
}

/**
 * Rejecting the piece outright — a real terminal decision, distinct from
 * asking for another pass. Also settles the mission itself into
 * "production_complete" (production is over for this mission either way,
 * approved or rejected); a mission that already moved on concurrently
 * (e.g. a founder cancelled it) is left exactly where it is rather than
 * overwritten.
 */
export async function rejectContentItem(
  contentItemId: string,
  founderId: string,
  input: { contentVersionId: string; note?: string | null },
): Promise<ContentItem> {
  const item = await getContentItem(contentItemId);
  if (!item) throw new Error(`Content item ${contentItemId} not found.`);
  await assertIsLatestVersion(item, input.contentVersionId);

  assertContentItemTransition(item.state, "rejected");
  const transition = await transitionContentItemState(item.id, [item.state], "rejected", {
    failure_reason: input.note ?? null,
  });
  if (!transition.ok) {
    throw new ContentItemConcurrencyError(item.id, [item.state], "rejected", transition.item.state);
  }

  await recordApproval({
    missionId: item.mission_id,
    founderId,
    decision: "reject_content",
    note: input.note ?? undefined,
    contentItemId: item.id,
    contentVersionId: input.contentVersionId,
  });
  await recordActivity({
    missionId: item.mission_id,
    actor: `founder:${founderId}`,
    action: "content_rejected",
    detail: input.note ?? undefined,
  });

  await transitionMissionState(item.mission_id, ["in_production"], "production_complete");

  return transition.item;
}

/**
 * "Send back with notes" — never a patch instruction: Content Bot may
 * rework the whole piece (see prompt.ts's buildContentPlanUserPrompt).
 * Guards the real version cap (layer 1 — a truthful 409 here is what keeps
 * the pipeline's own layer-2 backstop, in runContentProductionPipeline,
 * structurally unreachable in practice) and requires a real, non-empty
 * note. The Inngest event id is deterministic per DECISION
 * (content-revision-<itemId>-<approvalId>), not per item, so a double-
 * click on "Send back" yields one approval row and one dispatch, never two
 * revision passes for the same founder decision.
 */
export async function requestContentRevision(
  contentItemId: string,
  founderId: string,
  input: { contentVersionId: string; note: string },
): Promise<ContentItem> {
  const trimmedNote = typeof input.note === "string" ? input.note.trim() : "";
  if (!trimmedNote) {
    throw new ContentDecisionValidationError("A revision note is required to send a piece back for another pass.");
  }

  const item = await getContentItem(contentItemId);
  if (!item) throw new Error(`Content item ${contentItemId} not found.`);
  await assertIsLatestVersion(item, input.contentVersionId);

  if (item.version_count >= MAX_VERSIONS_PER_ITEM) {
    throw new ContentVersionCapExceededError(item.id);
  }

  assertContentItemTransition(item.state, "revision_requested");
  const transition = await transitionContentItemState(item.id, [item.state], "revision_requested");
  if (!transition.ok) {
    throw new ContentItemConcurrencyError(item.id, [item.state], "revision_requested", transition.item.state);
  }

  const approval = await recordApproval({
    missionId: item.mission_id,
    founderId,
    decision: "request_revision",
    note: trimmedNote,
    contentItemId: item.id,
    contentVersionId: input.contentVersionId,
  });
  await recordActivity({
    missionId: item.mission_id,
    actor: `founder:${founderId}`,
    action: "revision_requested",
    detail: trimmedNote,
  });

  try {
    await inngest.send({
      id: `content-revision-${item.id}-${approval.id}`,
      name: CONTENT_REVISION_REQUESTED_EVENT,
      data: { contentItemId: item.id, missionId: item.mission_id, approvalId: approval.id },
    });
  } catch (sendError) {
    // Mirrors approveForProduction's dispatch-failure handling exactly: a
    // send failure here must never undo the revision that was just
    // committed — contentWatchdogs.ts's revisionDispatchWatchdog retries it.
    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "revision_dispatch_failed",
      detail: `Could not send the revision-requested dispatch event: ${
        sendError instanceof Error ? sendError.message : "unknown error"
      }. The content item remains correctly at "revision_requested" — the self-healing watchdog will retry the dispatch.`,
    });
  }

  return transition.item;
}

/**
 * A founder cancelling production directly, without cancelling the whole
 * mission (see missionWorkflow.ts's cancelMission for the reverse
 * direction — cancelling a mission cascades to its content item the same
 * way). Same atomic-transition guarantee as every other cancellation in
 * this app: a "publishing" item is refused (see contentItemStates.ts —
 * that edge deliberately doesn't exist), and a genuinely concurrent
 * change is a real 409, never silently overwritten.
 */
export async function cancelContentItem(
  contentItemId: string,
  founderId: string,
  note?: string,
): Promise<ContentItem> {
  const item = await getContentItem(contentItemId);
  if (!item) throw new Error(`Content item ${contentItemId} not found.`);
  if (!isContentItemCancellable(item.state)) {
    throw new Error(`Content item ${contentItemId} cannot be cancelled from state "${item.state}".`);
  }

  const transition = await transitionContentItemState(item.id, [item.state], "cancelled", {
    failure_reason: note ?? null,
  });
  if (!transition.ok) {
    throw new ContentItemConcurrencyError(item.id, [item.state], "cancelled", transition.item.state);
  }

  await recordApproval({
    missionId: item.mission_id,
    founderId,
    decision: "cancelled",
    note,
    contentItemId: item.id,
  });
  await recordActivity({
    missionId: item.mission_id,
    actor: `founder:${founderId}`,
    action: "production_cancelled",
    detail: note,
  });

  return transition.item;
}

// ---------------------------------------------------------------------------
// Content Bot's real production pipeline (Milestone C1)
// ---------------------------------------------------------------------------

export interface ContentPipelineDeps {
  contentBot?: { client?: Anthropic };
  media?: MediaDeps;
  storage?: StorageProvider;
}

/**
 * Thrown internally the instant reality (the item's real persisted state)
 * has moved on from under the pipeline — a founder cancelled it, or it
 * otherwise changed, while a real provider call was in flight. Caught only
 * by runContentProductionPipeline's own top-level catch; never surfaced
 * past it. Mirrors runScoutPipeline's re-check-before-settling discipline,
 * but checked more often here on purpose: Content Bot's pipeline makes
 * many real, separately-priced provider calls (not Scout's single call),
 * so stopping the instant a founder acts is what actually avoids needless
 * real spend after a cancellation, not just an after-the-fact discard.
 */
class ProductionMovedOn extends Error {
  constructor(readonly item: ContentItem) {
    super(`Content item ${item.id} is no longer "generating" (now "${item.state}") — discarding remaining work.`);
    this.name = "ProductionMovedOn";
  }
}

/** The model safety judge's real "block" verdict — distinct from a code guardrail rejection, but routed to the same "blocked" (not "failed") item state, since both mean "we refused to make this," not "the tool broke." */
class ContentSafetyBlocked extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join("; ") || "The safety reviewer blocked this plan.");
    this.name = "ContentSafetyBlocked";
  }
}

async function assertStillGenerating(itemId: string): Promise<void> {
  const current = await getContentItem(itemId);
  if (!current) throw new Error(`Content item ${itemId} not found.`);
  if (current.state !== "generating") throw new ProductionMovedOn(current);
}

/** Exported for tests only, to precisely simulate a crashed-and-resumed run against real content_assets rows without duplicating this naming scheme in the test file. */
export function storageKeysFor(itemId: string, versionId: string) {
  return {
    audio: `content/${itemId}/${versionId}/voiceover.mp3`,
    alignment: `content/${itemId}/${versionId}/alignment.json`,
    captions: `content/${itemId}/${versionId}/captions.vtt`,
    thumbnail: `content/${itemId}/${versionId}/thumbnail.jpg`,
    video: `content/${itemId}/${versionId}/video.mp4`,
    image: (index: number) => `content/${itemId}/${versionId}/image-${index}.jpg`,
  };
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
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
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readJsonFile<T>(storage: StorageProvider, key: string): Promise<T> {
  const { stream } = await storage.open(key);
  const bytes = await readAllBytes(stream);
  return JSON.parse(Buffer.from(bytes).toString("utf-8")) as T;
}

function textStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Groups real word-level alignment (ElevenLabs' own timing data — no
 * separate transcription provider needed, see CLAUDE.md's Content Bot
 * milestone) into short, readable WebVTT cues.
 */
function buildCaptionVtt(alignment: VoiceWordTiming[], maxWordsPerCue = 6): string {
  if (alignment.length === 0) return "WEBVTT\n";
  const lines = ["WEBVTT", ""];
  for (let i = 0; i < alignment.length; i += maxWordsPerCue) {
    const chunk = alignment.slice(i, i + maxWordsPerCue);
    const start = chunk[0]!.startSeconds;
    const end = chunk[chunk.length - 1]!.endSeconds;
    const text = chunk.map((w) => w.word).join(" ");
    lines.push(`${formatVttTimestamp(start)} --> ${formatVttTimestamp(end)}`, text, "");
  }
  return lines.join("\n");
}

/**
 * Turns a local storage key into a real, publicly-fetchable HTTPS URL —
 * Shotstack's real contract (see shotstackEdit.ts's doc comment: by the
 * time an EditRequest reaches that provider, every `*StorageKey` field is
 * already such a URL, not an internal key). Prefers the storage provider's
 * own signed URL where supported; local disk (C1's only storage backend —
 * see CLAUDE.md's Content Bot milestone §0b) returns null for that, so
 * this stages a public copy on fal.ai's storage/CDN instead — the same
 * account already required for image generation, no new vendor.
 */
async function resolvePublicUrl(storage: StorageProvider, key: string): Promise<string> {
  const signed = await storage.signedReadUrl(key, 3600);
  if (signed) return signed;
  const { stream, contentType } = await storage.open(key);
  const bytes = await readAllBytes(stream);
  return uploadToFalStorage(bytes, contentType);
}

async function persistMediaResult(args: {
  storage: StorageProvider;
  storageKey: string;
  result: MediaResult;
  kind: ContentAssetKind;
  contentVersionId: string;
  contentItemId: string;
  missionId: string;
  agentId: string | null;
}): Promise<ContentAsset> {
  const stream = await args.result.open();
  const stored = await args.storage.put(args.storageKey, stream, args.result.contentType);
  const asset = await recordContentAsset({
    contentVersionId: args.contentVersionId,
    kind: args.kind,
    storageProvider: stored.storageProvider,
    storageKey: stored.storageKey,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    durationSeconds: args.result.durationSeconds,
    width: args.result.width,
    height: args.result.height,
    checksumSha256: stored.checksumSha256,
    generatorProvider: args.result.usage.provider,
    generatorModel: args.result.usage.model,
    providerAssetId: args.result.providerAssetId,
  });
  await recordCost({
    missionId: args.missionId,
    agentId: args.agentId,
    contentItemId: args.contentItemId,
    contentVersionId: args.contentVersionId,
    model: args.result.usage.model,
    usdCost: args.result.usage.usdCost,
    provider: args.result.usage.provider,
    unit: args.result.usage.unit,
    quantity: args.result.usage.quantity,
  });
  return asset;
}

async function persistTextAsset(args: {
  storage: StorageProvider;
  storageKey: string;
  text: string;
  contentType: string;
  kind: ContentAssetKind;
  contentVersionId: string;
}): Promise<ContentAsset> {
  const stored = await args.storage.put(args.storageKey, textStream(args.text), args.contentType);
  return recordContentAsset({
    contentVersionId: args.contentVersionId,
    kind: args.kind,
    storageProvider: stored.storageProvider,
    storageKey: stored.storageKey,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    checksumSha256: stored.checksumSha256,
  });
}

/** Prices and records a Claude-call failure's real partial token usage — mirrors runScoutPipeline's catch block exactly (never let a pricing failure block anything, never invent a dollar figure). */
async function recordTokenCostOnFailure(
  item: ContentItem,
  versionId: string | null,
  usage: { model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  if (usage.inputTokens + usage.outputTokens === 0) return;
  let usdCost: number | null;
  try {
    usdCost = calculateUsdCost(usage.model, { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens });
  } catch (pricingError) {
    console.error(
      `Could not price ${usage.inputTokens} in / ${usage.outputTokens} out tokens for model "${usage.model}" — recording the token usage with no dollar amount rather than inventing one.`,
      pricingError,
    );
    usdCost = null;
  }
  await recordCost({
    missionId: item.mission_id,
    agentId: item.agent_id,
    contentItemId: item.id,
    contentVersionId: versionId,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usdCost,
  });
}

async function runProductionPlanningStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  brief: ProductionBrief,
  deps: ContentPipelineDeps,
): Promise<ContentVersion<ContentPlan>> {
  if (version.plan) return version; // already drafted — resumed

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "production_planning", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(
      item.mission_id,
      "production_planning",
      "Content Bot is drafting the production plan.",
      { contentItemId: item.id, contentVersionId: version.id },
    );
  }

  let previousPlan: ContentPlan | undefined;
  let revisionNote: string | undefined;
  if (version.parent_version_id) {
    const parent = await getContentVersion(version.parent_version_id);
    previousPlan = (parent?.plan as ContentPlan | null) ?? undefined;
    const approvals = await listApprovalsForContentItem(item.id);
    const revisionApproval = approvals.filter((a) => a.decision === "request_revision").at(-1);
    revisionNote = revisionApproval?.note ?? undefined;
  }

  try {
    const { plan, usage } = await planContentVersion(
      { brief, audience: ctx, previousPlan, revisionNote },
      deps.contentBot ?? {},
    );
    await recordCost({
      missionId: item.mission_id,
      agentId: item.agent_id,
      contentItemId: item.id,
      contentVersionId: version.id,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usdCost: usage.usdCost,
    });

    assertNoNamedIP(plan, brief);
    assertAudienceAppropriate(plan, ctx);
    assertClaimsAreEvidenced(plan, brief);

    const updated = (await updateContentVersion(version.id, { plan })) as ContentVersion<ContentPlan>;
    await completeStage(
      stage.id,
      `Plan drafted: "${plan.title}" (${plan.duration_seconds}s, ${plan.script.length} beat(s)).`,
    );
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "production_plan_drafted",
      detail: `"${plan.title}" — ${plan.script.length} script beat(s), ${plan.duration_seconds}s target duration.`,
    });
    return updated;
  } catch (error) {
    if (error instanceof ContentBotError) {
      await recordTokenCostOnFailure(item, version.id, error.usage);
    }
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Production planning failed.");
    }
    throw error;
  }
}

async function runSafetyReviewStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  deps: ContentPipelineDeps,
): Promise<ContentVersion<ContentPlan>> {
  if (version.safety_verdict) return version; // already reviewed — resumed
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot run its safety review.`);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "safety_review", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(
      item.mission_id,
      "safety_review",
      "Reviewing the plan for audience/tone/safety fit.",
      { contentItemId: item.id, contentVersionId: version.id },
    );
  }

  try {
    const { verdict, usage } = await reviewContentSafety(plan, ctx, deps.contentBot ?? {});
    await recordCost({
      missionId: item.mission_id,
      agentId: item.agent_id,
      contentItemId: item.id,
      contentVersionId: version.id,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usdCost: usage.usdCost,
    });

    const updated = (await updateContentVersion(version.id, {
      safety_verdict: verdict,
    })) as ContentVersion<ContentPlan>;

    if (verdict.verdict === "block") {
      await failStage(stage.id, `Blocked: ${verdict.reasons.join("; ") || "no reason given"}.`);
    } else {
      await completeStage(
        stage.id,
        verdict.concerns.length > 0 ? `Passed, with concerns: ${verdict.concerns.join("; ")}` : "Passed.",
      );
    }
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "safety_review_completed",
      detail: `Verdict: ${verdict.verdict}.${verdict.reasons.length > 0 ? " " + verdict.reasons.join("; ") : ""}`,
    });
    return updated;
  } catch (error) {
    if (error instanceof ContentBotError) {
      await recordTokenCostOnFailure(item, version.id, error.usage);
    }
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Safety review failed.");
    }
    throw error;
  }
}

async function runAssetGenerationStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  deps: ContentPipelineDeps,
): Promise<void> {
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot generate its assets.`);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "asset_generation", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(
      item.mission_id,
      "asset_generation",
      "Generating real voiceover, stills, and captions.",
      { contentItemId: item.id, contentVersionId: version.id },
    );
  }

  const storage = deps.storage ?? getStorageProvider();
  const keys = storageKeysFor(item.id, version.id);

  try {
    const plannedCalls = 1 /* voiceover */ + 1 /* thumbnail */ + plan.script.length /* stills */;
    if (plannedCalls > MAX_ASSET_CALLS_PER_VERSION) {
      throw new ContentAssetCallCapExceededError(item.id, plannedCalls);
    }

    const existing = await listContentAssets(version.id);
    const hasAsset = (key: string) => existing.some((a) => a.storage_key === key);

    // Voiceover + captions are generated together: the raw word-level
    // alignment is staged as a plain working file (never a founder-facing
    // content_assets row — it's internal pipeline state, not a
    // deliverable) purely so a crash between storing the audio and
    // deriving captions can resume without paying for a second voice call.
    if (!hasAsset(keys.audio)) {
      await assertStillGenerating(item.id);
      const voiceProvider = deps.media?.voice ?? getVoiceProvider();
      const narration = [...plan.script]
        .sort((a, b) => a.index - b.index)
        .map((b) => b.narration)
        .join(" ");
      const req = {
        idempotencyKey: keys.audio,
        audience: ctx,
        text: narration,
        voiceKey: "default",
        pace: plan.voice_direction.pace,
      };
      await assertItemBudgetRemaining(item.id, voiceProvider.estimateUsd(req));
      const result = await voiceProvider.generate(req);
      await persistMediaResult({
        storage,
        storageKey: keys.audio,
        result,
        kind: "audio",
        contentVersionId: version.id,
        contentItemId: item.id,
        missionId: item.mission_id,
        agentId: item.agent_id,
      });
      await storage.put(keys.alignment, textStream(JSON.stringify(result.alignment)), "application/json");
    }

    if (!hasAsset(keys.captions)) {
      const alignment = await readJsonFile<VoiceWordTiming[]>(storage, keys.alignment);
      const vtt = buildCaptionVtt(alignment);
      await persistTextAsset({
        storage,
        storageKey: keys.captions,
        text: vtt,
        contentType: "text/vtt",
        kind: "caption_track",
        contentVersionId: version.id,
      });
    }

    if (!hasAsset(keys.thumbnail)) {
      await assertStillGenerating(item.id);
      const imageProvider = deps.media?.image ?? getImageProvider();
      const req = {
        idempotencyKey: keys.thumbnail,
        audience: ctx,
        prompt: plan.thumbnail_brief.prompt,
        aspectRatio: plan.aspect_ratio,
      };
      await assertItemBudgetRemaining(item.id, imageProvider.estimateUsd(req));
      const result = await imageProvider.generate(req);
      await persistMediaResult({
        storage,
        storageKey: keys.thumbnail,
        result,
        kind: "thumbnail",
        contentVersionId: version.id,
        contentItemId: item.id,
        missionId: item.mission_id,
        agentId: item.agent_id,
      });
    }

    for (const beat of plan.script) {
      const key = keys.image(beat.index);
      if (hasAsset(key)) continue;
      await assertStillGenerating(item.id);
      const imageProvider = deps.media?.image ?? getImageProvider();
      const req = { idempotencyKey: key, audience: ctx, prompt: beat.visual_direction, aspectRatio: plan.aspect_ratio };
      await assertItemBudgetRemaining(item.id, imageProvider.estimateUsd(req));
      const result = await imageProvider.generate(req);
      await persistMediaResult({
        storage,
        storageKey: key,
        result,
        kind: "image",
        contentVersionId: version.id,
        contentItemId: item.id,
        missionId: item.mission_id,
        agentId: item.agent_id,
      });
    }

    await completeStage(
      stage.id,
      `Generated voiceover, captions, thumbnail, and ${plan.script.length} still(s).`,
    );
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "assets_generated",
      detail: `Voiceover, captions, thumbnail, and ${plan.script.length} still(s) generated.`,
    });
  } catch (error) {
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Asset generation failed.");
    }
    throw error;
  }
}

async function runAssemblyStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  deps: ContentPipelineDeps,
): Promise<void> {
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot assemble it.`);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "assembly", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(item.mission_id, "assembly", "Assembling the final video.", {
      contentItemId: item.id,
      contentVersionId: version.id,
    });
  }

  const storage = deps.storage ?? getStorageProvider();
  const keys = storageKeysFor(item.id, version.id);

  try {
    const existing = await listContentAssets(version.id);
    if (existing.some((a) => a.storage_key === keys.video)) {
      await completeStage(stage.id, "Video already assembled — resumed.");
      return;
    }

    await assertStillGenerating(item.id);
    const editProvider = deps.media?.edit ?? getEditProvider();
    const voiceoverUrl = await resolvePublicUrl(storage, keys.audio);
    const captionUrl = existing.some((a) => a.storage_key === keys.captions)
      ? await resolvePublicUrl(storage, keys.captions)
      : undefined;
    const orderedBeats = [...plan.script].sort((a, b) => a.index - b.index);
    const resolvedTimeline = await Promise.all(
      orderedBeats.map(async (beat) => ({
        imageStorageKey: await resolvePublicUrl(storage, keys.image(beat.index)),
        startSeconds: beat.start_seconds,
        endSeconds: beat.end_seconds,
        motion: "slow_zoom" as const,
      })),
    );

    const req = {
      idempotencyKey: keys.video,
      audience: ctx,
      timeline: resolvedTimeline,
      voiceoverStorageKey: voiceoverUrl,
      captionStorageKey: captionUrl,
      aspectRatio: plan.aspect_ratio,
    };
    await assertItemBudgetRemaining(item.id, editProvider.estimateUsd(req));
    const result = await editProvider.generate(req);
    await persistMediaResult({
      storage,
      storageKey: keys.video,
      result,
      kind: "video",
      contentVersionId: version.id,
      contentItemId: item.id,
      missionId: item.mission_id,
      agentId: item.agent_id,
    });

    await completeStage(stage.id, `Assembled a ${result.durationSeconds ?? plan.duration_seconds}s video.`);
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "video_assembled",
      detail: `Final video assembled (${result.durationSeconds ?? plan.duration_seconds}s).`,
    });
  } catch (error) {
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Assembly failed.");
    }
    throw error;
  }
}

async function runFinalisationStage(item: ContentItem, version: ContentVersion<ContentPlan>): Promise<ContentItem> {
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot finalise it.`);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "finalisation", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(item.mission_id, "finalisation", "Checking the finished assets against the plan.", {
      contentItemId: item.id,
      contentVersionId: version.id,
    });
  }

  try {
    const assets = await listContentAssets(version.id);
    assertAssetsMatchPlan(assets, plan);

    await updateContentVersion(version.id, { status: "complete", completed_at: new Date().toISOString() });
    const transition = await transitionContentItemState(item.id, ["generating"], "awaiting_review");
    if (!transition.ok) {
      await completeStage(
        stage.id,
        `Finalised, but the item had already moved to "${transition.item.state}" — left unchanged.`,
      );
      return transition.item;
    }

    await completeStage(stage.id, "Ready for founder review.");
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "production_completed",
      detail: `"${plan.title}" is ready for founder review.`,
    });
    return transition.item;
  } catch (error) {
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Finalisation failed.");
    }
    throw error;
  }
}

/**
 * Content Bot's real production pipeline — called by the Inngest job
 * (lib/jobs/contentProductionJob.ts), not directly from an HTTP request.
 * Branches on the item's current REAL state, never on which event fired
 * it — the same resumability contract as missionWorkflow.ts's
 * runScoutPipeline. All five stages (planning, safety review, asset
 * generation, assembly, finalisation) run inside one call, the same shape
 * scoutResearchJob.ts already uses for Scout's own multi-step pipeline:
 * Inngest memoizes the call as a single step, and resumability after a
 * real crash comes from checking real DB/storage state (a version's
 * stored plan/safety_verdict, which content_assets rows already exist),
 * never from Inngest's own step memoization.
 */
export async function runContentProductionPipeline(
  contentItemId: string,
  deps: ContentPipelineDeps = {},
): Promise<ContentItem> {
  let item = await getContentItem(contentItemId);
  if (!item) throw new Error(`Content item ${contentItemId} not found.`);

  let version: ContentVersion<ContentPlan>;

  if (item.state === "planning") {
    const existingOpen = await getOpenVersion(item.id);
    version =
      (existingOpen as ContentVersion<ContentPlan> | undefined) ??
      ((await openNextVersion({
        contentItemId: item.id,
        parentVersionId: null,
        revisionApprovalId: null,
      })) as ContentVersion<ContentPlan>);

    assertContentItemTransition(item.state, "generating");
    const started = await transitionContentItemState(item.id, [item.state], "generating", {
      generation_attempt_count: 1,
    });
    if (!started.ok) {
      throw new ContentItemConcurrencyError(item.id, [item.state], "generating", started.item.state);
    }
    item = started.item;
    await recordActivity({ missionId: item.mission_id, actor: "system", action: "production_started" });
  } else if (item.state === "revision_requested") {
    // Layer 2 backstop against the version cap — layer 1 is the "Send Back
    // With Notes" route (Phase 6), which must refuse to even create this
    // revision_requested state once version_count already hits the cap.
    // Should be structurally unreachable, same reasoning as
    // missionWorkflow.ts's own layer-2 research-pass-cap check.
    if (item.version_count >= MAX_VERSIONS_PER_ITEM) {
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "revision_skipped_version_cap",
        detail: `Content item already has ${item.version_count} version(s) (cap: ${MAX_VERSIONS_PER_ITEM}) — refusing to open another.`,
      });
      return item;
    }

    const existingOpen = await getOpenVersion(item.id);
    if (existingOpen) {
      version = existingOpen as ContentVersion<ContentPlan>;
    } else {
      const parent = await getLatestVersion(item.id);
      const approvals = await listApprovalsForContentItem(item.id);
      const revisionApproval = approvals.filter((a) => a.decision === "request_revision").at(-1);
      version = (await openNextVersion({
        contentItemId: item.id,
        parentVersionId: parent?.id ?? null,
        revisionApprovalId: revisionApproval?.id ?? null,
      })) as ContentVersion<ContentPlan>;
    }

    assertContentItemTransition(item.state, "generating");
    const started = await transitionContentItemState(item.id, [item.state], "generating", {
      generation_attempt_count: 1,
    });
    if (!started.ok) {
      throw new ContentItemConcurrencyError(item.id, [item.state], "generating", started.item.state);
    }
    item = started.item;
    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "revision_started",
      detail: `Producing version ${version.version_number}.`,
    });
  } else if (item.state === "generating") {
    // Resuming after a crash mid-run.
    const existingOpen = await getOpenVersion(item.id);
    if (!existingOpen) {
      throw new Error(`Content item ${item.id} is "generating" but has no open version — inconsistent state.`);
    }
    if (item.generation_attempt_count >= MAX_GENERATION_ATTEMPTS_PER_VERSION) {
      // Unlike a mission resting in "awaiting_evidence", "generating" has
      // no founder-actionable UI — leaving it here forever would be the
      // exact silent limbo the stuck-mission watchdog exists to prevent.
      // A version stuck this many attempts without finishing is a real,
      // visible failure a founder can act on (retry via a fresh mission,
      // or just move on) rather than automatic retries continuing to spend.
      const reason = `Reached the cap of ${MAX_GENERATION_ATTEMPTS_PER_VERSION} generation attempts on this version without finishing — refusing to try again automatically.`;
      await updateContentVersion(existingOpen.id, {
        status: "failed",
        failure_reason: reason,
        completed_at: new Date().toISOString(),
      });
      const settlement = await transitionContentItemState(item.id, ["generating"], "failed", {
        failure_reason: reason,
      });
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "production_attempt_cap_exceeded",
        detail: reason,
      });
      return settlement.item;
    }
    item = await incrementContentItemGenerationAttempts(item.id);
    version = existingOpen as ContentVersion<ContentPlan>;
    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "production_resumed",
      detail: `Resuming version ${version.version_number} after an earlier attempt did not finish (attempt ${item.generation_attempt_count} of ${MAX_GENERATION_ATTEMPTS_PER_VERSION}).`,
    });
  } else {
    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "production_skipped",
      detail: `Content item was "${item.state}", not planning, revision_requested, or generating, when the production job ran — skipped.`,
    });
    return item;
  }

  const brief = item.brief as ProductionBrief;
  const ctx = item.audience_context as AudienceContext;

  try {
    version = await runProductionPlanningStage(item, version, ctx, brief, deps);
    version = await runSafetyReviewStage(item, version, ctx, deps);

    const verdict = version.safety_verdict as SafetyVerdict | null;
    if (verdict?.verdict === "block") {
      throw new ContentSafetyBlocked(verdict.reasons);
    }

    await runAssetGenerationStage(item, version, ctx, deps);
    await runAssemblyStage(item, version, ctx, deps);
    return await runFinalisationStage(item, version);
  } catch (error) {
    if (error instanceof ProductionMovedOn) {
      // The version itself must not be left stuck at status "generating"
      // forever — it genuinely never finished, and content_versions.status
      // is what getOpenVersion's own crash-resume query keys on. Marking
      // it failed here (never "complete", since no real finished asset set
      // exists) keeps that column honest without touching the item's own
      // real disposition, which the founder's action already decided.
      await updateContentVersion(version.id, {
        status: "failed",
        failure_reason: `Discarded — the content item moved to "${error.item.state}" while this version was still being produced.`,
        completed_at: new Date().toISOString(),
      });
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "production_discarded_after_state_change",
        detail: `Content item was already "${error.item.state}" by the time production work continued — remaining work was not applied, but any real cost already spent was recorded.`,
      });
      return error.item;
    }

    const reason = error instanceof Error ? error.message : "Unknown error during production.";
    const isRefusal = error instanceof ContentGuardrailError || error instanceof ContentSafetyBlocked;

    await updateContentVersion(version.id, {
      status: "failed",
      failure_reason: reason,
      completed_at: new Date().toISOString(),
    });
    const settlement = await transitionContentItemState(item.id, ["generating"], isRefusal ? "blocked" : "failed", {
      failure_reason: reason,
    });

    if (!settlement.ok) {
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "production_discarded_after_state_change",
        detail: `Production ${isRefusal ? "was refused" : "failed"} (${reason}), but the item was already "${settlement.item.state}" — its state was not overwritten.`,
      });
      return settlement.item;
    }

    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: isRefusal ? "production_blocked" : "production_failed",
      detail: reason,
    });
    return settlement.item;
  }
}
