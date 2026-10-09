import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ContentAsset, ContentAssetKind, ContentItem, ContentItemState, ContentVersion, MissionState } from "@/lib/db/types";
import type { AudienceContext, MediaDeps, MediaResult, VoiceWordTiming, VideoProvider, VideoRequest, AsyncMediaProvider } from "@/lib/media/types";
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
  listContentItemsForMissions,
  recordApproval,
  recordActivity,
  assignAgent,
  hasAssignment,
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
  updateContentAsset,
  getContentAsset,
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
import {
  buildProductionBrief,
  buildFounderCommissionedBrief,
  NoProductionRecommendationError,
} from "@/lib/domain/contentHandoff";
import { hasMeaningfulEvidence } from "@/lib/agents/scout/guardrails";
import { classifyProductionFailure, isRecoverableFailureCategory } from "@/lib/domain/contentFailureClassification";
import {
  MAX_VERSIONS_PER_ITEM,
  MAX_GENERATION_ATTEMPTS_PER_VERSION,
  MAX_ASSET_CALLS_PER_VERSION,
  MAX_QC_REGENERATIONS_PER_VERSION,
  MAX_REFERENCE_REGENERATIONS,
  assertItemBudgetRemaining,
  ContentAssetCallCapExceededError,
  ContentVersionCapExceededError,
} from "@/lib/domain/contentProduction";
import {
  planContentVersion,
  reviewContentSafety,
  planCreativeStrategy,
  reviewVisualQuality,
  ContentBotError,
  type VisualQCAssetInput,
} from "@/lib/agents/contentBot";
import type { SafetyVerdict, VisualQCReport, VisualIdentity, CreativeStrategy, ScriptBeat, SubjectProminence } from "@/lib/agents/contentBot/schema";
import {
  assertNoNamedIP,
  assertAudienceAppropriate,
  assertClaimsAreEvidenced,
  assertNarrationFitsDuration,
  assertAssetsMatchPlan,
  ContentGuardrailError,
} from "@/lib/agents/contentBot/guardrails";
import { getImageProvider, getVoiceProvider, getEditProvider, getVideoProvider } from "@/lib/media/registry";
import { NoProviderConfiguredError } from "@/lib/media/types";
import { getStorageProvider } from "@/lib/storage/registry";
import { uploadToFalStorage } from "@/lib/media/providers/falStorage";
import { calculateUsdCost } from "@/lib/agents/pricing";
import {
  inngest,
  CONTENT_PRODUCTION_REQUESTED_EVENT,
  CONTENT_REVISION_REQUESTED_EVENT,
} from "@/lib/inngest/client";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

/**
 * The real tenant-ownership check for every founder-facing Content Bot
 * action (Master Development Mission 6 — Content Bot's own routes had
 * the exact same gap Phase E found and fixed for Founders' Desk: a
 * founderId parameter that was never actually checked against the
 * resource being acted on). `content_items` has no direct
 * `organization_id` column of its own — it's scoped transitively through
 * `mission_id → missions.organization_id`, the same real chain
 * `listContentItemsForMissions` already relies on — so this resolves the
 * owning mission and compares there, deliberately throwing the exact
 * same "not found" a missing resource would, never confirming or
 * denying that a piece of content exists in a different organization.
 */
async function assertContentItemInFoundersOrganization(
  missionId: string,
  founderId: string,
  notFoundMessage: string,
): Promise<void> {
  const [mission, organization] = await Promise.all([getMission(missionId), getActiveOrganizationForFounder(founderId)]);
  if (!mission || mission.organization_id !== organization.id) {
    throw new Error(notFoundMessage);
  }
}

export class ProductionApprovalValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ProductionApprovalValidationError";
  }
}

export class MissionStrandedInProductionError extends Error {
  constructor(missionId: string) {
    super(
      `Mission ${missionId} is already "in_production" but has no content item — a previous production attempt ` +
        `moved it there and then genuinely failed before Content Bot was ever dispatched (see CLAUDE.md's Content ` +
        `Bot milestone, C1 follow-up fixes). This needs the sanctioned recoverStrandedProduction recovery, not a ` +
        `plain retry.`,
    );
    this.name = "MissionStrandedInProductionError";
  }
}

/**
 * Both approveForProduction and commissionPilotAnyway share this exact
 * structural risk: their own atomic ready_for_founders_review ->
 * in_production transition can commit and then genuinely fail before a
 * content item is ever created (the live bug this was written for — a
 * missing "content_bot" agent seed row). A second call on such a mission
 * must never re-attempt (or silently re-validate) the transition — it
 * either resolves idempotently to the real, already-created item (a
 * genuine duplicate call after success), or refuses with a clear,
 * distinct, actionable error naming the stranded state, instead of the
 * confusing generic IllegalMissionTransitionError a bare
 * assertTransition("in_production", "in_production") would throw.
 */
async function resolveAlreadyInProduction(missionId: string): Promise<ContentItem> {
  const [existingItem] = await listContentItemsForMissions([missionId]);
  if (existingItem) return existingItem;
  throw new MissionStrandedInProductionError(missionId);
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
  const organization = await getActiveOrganizationForFounder(founderId);
  if (!mission || mission.organization_id !== organization.id) {
    throw new Error(`Mission ${missionId} not found.`);
  }

  if (mission.state === "in_production") {
    return resolveAlreadyInProduction(missionId);
  }

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

  // Guarded, not unconditional — "Content Bot is lead on this mission" is a
  // real fact true once, not once per content item. Once multiple
  // independent productions can exist for one mission (see
  // produceAgainFromMission below), an unconditional insert here would hit
  // agent_assignments' own real UNIQUE (mission_id, agent_id, role)
  // constraint on the second production. Mirrors the exact resumability
  // pattern Scout's own dispatch already uses this same helper for.
  if (!(await hasAssignment(missionId, contentBot.id))) {
    await assignAgent(missionId, contentBot.id, "lead");
  }

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
// "Scout advises, founders decide" — the explicit founder override. Never
// automatically available and never a general bypass: gated to the same
// eligible predecessor state as the normal path, to a genuinely preserved
// Scout deliverable, to the SAME structural evidence bar Scout's own
// guardrail already enforces, and mutually exclusive with the normal path
// (a mission whose Scout report already carries a real
// production_recommendation must use approveForProduction instead).
// ---------------------------------------------------------------------------

export class CommissionPilotValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "CommissionPilotValidationError";
  }
}

/**
 * Thrown when a founder tries to use the override on a mission whose Scout
 * report already has a real, structured production_recommendation — that
 * mission must go through the normal approveForProduction gate instead, so
 * a content item's real origin (Scout-recommended vs. founder-commissioned)
 * is never ambiguous.
 */
export class ProductionRecommendationAlreadyExistsError extends Error {
  constructor(missionId: string) {
    super(
      `Mission ${missionId}'s Scout report already has a production_recommendation — use the normal Approve for ` +
        `production action instead of commissioning it directly.`,
    );
    this.name = "ProductionRecommendationAlreadyExistsError";
  }
}

/**
 * Thrown when the preserved Scout report doesn't clear the same structural
 * evidence bar Scout's own guardrail (hasMeaningfulEvidence, see
 * lib/agents/scout/guardrails.ts) already requires for a ready_for_founders_review
 * verdict — independent of what verdict the report actually carries. A
 * founder may override Scout's caution/judgment; this override was never
 * meant to be a way around a report with no real sourced facts.
 */
export class InsufficientEvidenceToCommissionError extends Error {
  constructor(missionId: string) {
    super(
      `Mission ${missionId}'s preserved Scout research has no verified fact backed by a real, dated source — ` +
        `there is nothing to responsibly commission a pilot from yet.`,
    );
    this.name = "InsufficientEvidenceToCommissionError";
  }
}

function validateCommissionPilotInput(input: {
  targetPlatform: AudienceContext["platform"];
  audience: AudienceContext["audience"];
  contentType: AudienceContext["contentType"];
  selectedEvidenceIds: string[];
  concept: string;
  creativeDirection: string;
}): string[] {
  const errors = validateApproveForProductionInput(input);
  if (!input.concept.trim()) {
    errors.push("concept is required to commission production without Scout's own recommendation.");
  }
  if (!input.creativeDirection.trim()) {
    errors.push("creativeDirection is required to commission production without Scout's own recommendation.");
  }
  return errors;
}

/**
 * The founder-controlled override: commission a pilot from Scout's
 * genuinely preserved research even though Scout itself did not supply a
 * structured production_recommendation. Ordering, the atomic
 * ready_for_founders_review -> in_production transition (the same
 * mechanism that already makes approveForProduction safe against a
 * double-click or a genuinely concurrent duplicate call), the Content Bot
 * assignment, and the dispatch-failure handling are all identical to
 * approveForProduction — this is a sibling of that function, not a
 * parallel, differently-guarded path. What differs is only: which brief
 * builder runs, the extra evidence/mutual-exclusivity checks below, and
 * the distinct "commission_pilot_anyway" decision/activity vocabulary that
 * permanently records this as a founder override rather than a Scout
 * recommendation.
 */
export async function commissionPilotAnyway(
  missionId: string,
  founderId: string,
  input: {
    targetPlatform: AudienceContext["platform"];
    audience: AudienceContext["audience"];
    contentType: AudienceContext["contentType"];
    selectedEvidenceIds: string[];
    concept: string;
    creativeDirection: string;
    doNotImitate?: string[];
    founderNotes?: string | null;
  },
): Promise<ContentItem> {
  const validationErrors = validateCommissionPilotInput(input);
  if (validationErrors.length > 0) {
    throw new CommissionPilotValidationError(validationErrors);
  }

  const mission = await getMission(missionId);
  const organization = await getActiveOrganizationForFounder(founderId);
  if (!mission || mission.organization_id !== organization.id) {
    throw new Error(`Mission ${missionId} not found.`);
  }

  if (mission.state === "in_production") {
    return resolveAlreadyInProduction(missionId);
  }

  const [deliverables, evidence] = await Promise.all([listDeliverables(missionId), listEvidence(missionId)]);
  const scoutDeliverable = deliverables.find((d) => d.kind === "scout_research_report" || d.kind === "scout_followup_report");
  if (!scoutDeliverable) {
    throw new Error(`Mission ${missionId} has no preserved Scout report to commission a pilot from.`);
  }
  const latestScoutDeliverable =
    deliverables.filter((d) => d.kind === "scout_followup_report").at(-1) ?? scoutDeliverable;

  const report = latestScoutDeliverable.content as ScoutReport;

  // Mutual exclusivity with the normal path — never ambiguous which gate a
  // content item came through.
  if (report.production_recommendation) {
    throw new ProductionRecommendationAlreadyExistsError(missionId);
  }
  // The same structural bar Scout's own guardrail enforces, independent of
  // verdict — a founder overrides Scout's judgment, never a report with no
  // real evidence behind it.
  if (!hasMeaningfulEvidence(report)) {
    throw new InsufficientEvidenceToCommissionError(missionId);
  }

  const invalidEvidenceIds = input.selectedEvidenceIds.filter((id) => !evidence.some((e) => e.id === id));
  if (invalidEvidenceIds.length > 0) {
    throw new CommissionPilotValidationError([
      `selectedEvidenceIds contained ids that aren't real evidence for this mission: ${invalidEvidenceIds.join(", ")}.`,
    ]);
  }

  const project = mission.project_id ? (await getProject(mission.project_id)) ?? null : null;

  // Same eligible predecessor state as the normal path (only
  // ready_for_founders_review legally transitions to in_production — see
  // missionStates.ts), and the same atomic-write idempotency guarantee: a
  // genuinely concurrent double-click loses this race and gets a clean
  // MissionConcurrencyError, never a duplicate content item.
  assertTransition(mission.state, "in_production");
  const transition = await transitionMissionState(missionId, [mission.state], "in_production");
  if (!transition.ok) {
    throw new MissionConcurrencyError(missionId, [mission.state], "in_production", transition.mission.state);
  }

  const contentBot = await getAgentByKey("content_bot");
  if (!contentBot) throw new Error("Content Bot agent is not registered — seed data is missing.");

  const brief = buildFounderCommissionedBrief({
    mission,
    project,
    scoutDeliverable: { ...latestScoutDeliverable, content: report },
    evidence,
    selectedEvidenceIds: input.selectedEvidenceIds,
    founderNotes: input.founderNotes ?? null,
    founderId,
    concept: input.concept,
    creativeDirection: input.creativeDirection,
    doNotImitate: input.doNotImitate,
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

  // See the identical guard/comment in approveForProduction above.
  if (!(await hasAssignment(missionId, contentBot.id))) {
    await assignAgent(missionId, contentBot.id, "lead");
  }

  // A distinct decision/action vocabulary, permanently distinguishing this
  // from "approve_for_production" / "approved_for_production" in the real
  // audit trail — who commissioned it and when is the founder_id + the
  // approvals table's own decided_at column, not a new table.
  await recordApproval({
    missionId,
    founderId,
    decision: "commission_pilot_anyway",
    note: input.founderNotes ?? undefined,
    contentItemId: item.id,
  });
  await recordActivity({
    missionId,
    actor: `founder:${founderId}`,
    action: "commissioned_pilot_anyway",
    detail:
      `Founder commissioned production directly — Scout did not supply a production_recommendation for this ` +
      `mission. Concept: "${input.concept}". Target platform: ${input.targetPlatform}, audience: ${input.audience}, ` +
      `content type: ${input.contentType}.`,
  });

  try {
    await inngest.send({
      id: `content-production-requested-${item.id}`,
      name: CONTENT_PRODUCTION_REQUESTED_EVENT,
      data: { contentItemId: item.id, missionId },
    });
  } catch (sendError) {
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

export class ProduceAgainValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ProduceAgainValidationError";
  }
}

/**
 * The mission states from which a genuinely new, independent production
 * may be started — any state that means "this mission's Scout research
 * genuinely completed at some point." `ready_for_founders_review` covers a
 * mission's very first production; `in_production`/`production_complete`
 * cover every subsequent one, since — under the one-mission-many-
 * productions architecture — reaching those states no longer means "a
 * production already exists and no other may start," only "at least one
 * has." Deliberately excludes every state where research never completed
 * or was abandoned (draft/queued/researching/awaiting_evidence/rejected/
 * failed/cancelled) — Produce Again must never imply or trigger a Scout
 * run.
 */
const PRODUCIBLE_MISSION_STATES: MissionState[] = ["ready_for_founders_review", "in_production", "production_complete"];

export class MissionNotReadyForProductionError extends Error {
  constructor(missionId: string, actualState: MissionState) {
    super(
      `Mission ${missionId} has no completed Scout research to produce from yet (real state: "${actualState}") — ` +
        `Produce Again requires a mission that has reached at least "ready_for_founders_review". This never triggers ` +
        `Scout — if research genuinely isn't done, there is nothing to produce from.`,
    );
    this.name = "MissionNotReadyForProductionError";
  }
}

/**
 * "Produce Again" — starts a genuinely new, independent Content Item
 * production from a mission whose Scout research already exists, without
 * re-running Scout, mutating its report/evidence, or touching any earlier
 * production's own content item (CLAUDE.md's Content Bot multi-production
 * milestone). Deliberately a separate, distinctly-named function from
 * approveForProduction/commissionPilotAnyway — a mission's FIRST
 * production and every subsequent one must stay distinguishable in the
 * real audit trail (a distinct "produce_again" approval decision and
 * "production_again_requested" activity action below), never folded into
 * the existing "commission_pilot_anyway" vocabulary even though the
 * mechanics (a founder-supplied concept/creative direction, since a
 * subsequent production is always a deliberate new founder decision
 * regardless of whether the underlying Scout report ever carried a
 * production_recommendation) are otherwise the same shape as
 * commissionPilotAnyway.
 *
 * Reuses the SAME, unmutated `deliverables`/`evidence` rows a first
 * production would — read again, never copied, never duplicated into a
 * second mission. `buildFounderCommissionedBrief` freezes its own
 * independent `ProductionBrief` snapshot exactly as it already does for
 * commissionPilotAnyway, so each production's provenance (which Scout
 * report, which evidence, which founder commission) is exact and
 * self-contained, never inferred.
 *
 * Mission state is monotonic: the very first production on a mission still
 * performs the real `ready_for_founders_review -> in_production`
 * transition (identical to commissionPilotAnyway's own — a lost race here
 * is fine, since it only means a concurrent request already made the same
 * move); every subsequent production makes NO further mission-state
 * transition at all, since the mission is already at or past
 * "in_production" — there is nothing for it to move to. This is what keeps
 * multiple simultaneous productions genuinely independent instead of
 * fighting over one mission-level slot.
 *
 * Idempotency without a mission-level uniqueness key: `input.idempotencyKey`
 * (a real UUID the caller/UI generates once per Produce Again attempt,
 * held across any retry of that same attempt) becomes this production's
 * own `content_items.id` (see createContentItem's optional `id` param).
 * A genuine double-submit of the exact same attempt collides on that real
 * primary key and is detected up front, returning the already-created item
 * instead of creating a duplicate; a later, deliberate Produce Again click
 * always supplies a fresh idempotencyKey, so this can never cap how many
 * productions a mission may have — the one thing a mission-level unique
 * constraint would have done wrong.
 */
export async function produceAgainFromMission(
  missionId: string,
  founderId: string,
  input: {
    targetPlatform: AudienceContext["platform"];
    audience: AudienceContext["audience"];
    contentType: AudienceContext["contentType"];
    selectedEvidenceIds: string[];
    concept: string;
    creativeDirection: string;
    doNotImitate?: string[];
    founderNotes?: string | null;
    idempotencyKey: string;
  },
): Promise<ContentItem> {
  const validationErrors = validateCommissionPilotInput(input);
  if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
    validationErrors.push("idempotencyKey is required so a repeated/duplicate submission can be detected safely.");
  }
  if (validationErrors.length > 0) {
    throw new ProduceAgainValidationError(validationErrors);
  }

  // Idempotent replay — see this function's own doc comment. Checked
  // before anything else is read or written, so a genuine duplicate
  // submission costs nothing beyond this one lookup.
  const existingReplay = await getContentItem(input.idempotencyKey);
  if (existingReplay) {
    if (existingReplay.mission_id !== missionId) {
      throw new ProduceAgainValidationError([
        `idempotencyKey "${input.idempotencyKey}" is already used by a content item for a different mission — ` +
          `this should never happen with a real, freshly-generated UUID; generate a new one and retry.`,
      ]);
    }
    return existingReplay;
  }

  const mission = await getMission(missionId);
  const organization = await getActiveOrganizationForFounder(founderId);
  if (!mission || mission.organization_id !== organization.id) {
    throw new Error(`Mission ${missionId} not found.`);
  }

  if (!PRODUCIBLE_MISSION_STATES.includes(mission.state)) {
    throw new MissionNotReadyForProductionError(missionId, mission.state);
  }

  const [deliverables, evidence] = await Promise.all([listDeliverables(missionId), listEvidence(missionId)]);
  const scoutDeliverable = deliverables.find((d) => d.kind === "scout_research_report" || d.kind === "scout_followup_report");
  if (!scoutDeliverable) {
    throw new Error(`Mission ${missionId} has no preserved Scout report to produce another content item from.`);
  }
  const latestScoutDeliverable =
    deliverables.filter((d) => d.kind === "scout_followup_report").at(-1) ?? scoutDeliverable;
  const report = latestScoutDeliverable.content as ScoutReport;

  // Same structural evidence bar every founder-authored commission enforces
  // — a subsequent production still can't be built on a report with no
  // real evidence behind it.
  if (!hasMeaningfulEvidence(report)) {
    throw new InsufficientEvidenceToCommissionError(missionId);
  }

  const invalidEvidenceIds = input.selectedEvidenceIds.filter((id) => !evidence.some((e) => e.id === id));
  if (invalidEvidenceIds.length > 0) {
    throw new ProduceAgainValidationError([
      `selectedEvidenceIds contained ids that aren't real evidence for this mission: ${invalidEvidenceIds.join(", ")}.`,
    ]);
  }

  const project = mission.project_id ? (await getProject(mission.project_id)) ?? null : null;

  // The one-time, monotonic mission transition — see this function's own
  // doc comment. Only ever attempted from ready_for_founders_review;
  // already-past-it missions (every second-or-later production) skip this
  // entirely.
  if (mission.state === "ready_for_founders_review") {
    assertTransition(mission.state, "in_production");
    const transition = await transitionMissionState(missionId, [mission.state], "in_production");
    if (!transition.ok && !PRODUCIBLE_MISSION_STATES.includes(transition.mission.state)) {
      // A genuinely concurrent request moved the mission somewhere
      // incompatible (e.g. cancelled) between our read and this write —
      // refuse, exactly like the first-production gate always has. Losing
      // the race to another concurrent Produce Again/first-production
      // request that ALSO landed on a producible state is fine — this
      // production proceeds independently regardless of which request
      // "won" the mission-level transition.
      throw new MissionConcurrencyError(missionId, [mission.state], "in_production", transition.mission.state);
    }
  }

  const contentBot = await getAgentByKey("content_bot");
  if (!contentBot) throw new Error("Content Bot agent is not registered — seed data is missing.");

  const brief = buildFounderCommissionedBrief({
    mission,
    project,
    scoutDeliverable: { ...latestScoutDeliverable, content: report },
    evidence,
    selectedEvidenceIds: input.selectedEvidenceIds,
    founderNotes: input.founderNotes ?? null,
    founderId,
    concept: input.concept,
    creativeDirection: input.creativeDirection,
    doNotImitate: input.doNotImitate,
  });

  const audienceContext: AudienceContext = {
    platform: input.targetPlatform,
    audience: input.audience,
    contentType: input.contentType,
    workspaceType: project?.workspace_type ?? "commerce",
  };

  let item: ContentItem;
  try {
    item = await createContentItem({
      id: input.idempotencyKey,
      missionId,
      agentId: contentBot.id,
      sourceDeliverableId: latestScoutDeliverable.id,
      brief,
      audienceContext,
    });
  } catch (error) {
    // The pre-check above (getContentItem(input.idempotencyKey)) is not
    // itself atomic — two genuinely concurrent requests for the exact same
    // idempotencyKey can both pass it before either has inserted. The real
    // primary-key uniqueness on content_items.id is what actually
    // serializes them: the losing request's insert fails with Postgres'
    // real 23505 (unique_violation), which is caught here and resolved by
    // re-fetching and returning what the winning request created — never
    // treated as a genuine failure, and never allowed to fall through to
    // assignAgent/recordApproval/recordActivity/dispatch a second time for
    // what is really the same logical production.
    // Drizzle wraps the real postgres.js error as DrizzleQueryError, whose
    // own `.message` is just "Failed query: ...\nparams: ..." — the actual
    // Postgres error (and its real `.code`) is the `.cause`, not the
    // top-level error itself.
    const pgCode =
      (error as { code?: string } | undefined)?.code ??
      (error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined);
    const isDuplicateContentItemId = pgCode === "23505";
    if (isDuplicateContentItemId) {
      const replay = await getContentItem(input.idempotencyKey);
      if (replay) return replay;
    }
    throw error;
  }

  // See the identical guard/comment in approveForProduction/
  // commissionPilotAnyway above — even more load-bearing here, since a
  // mission with multiple productions will very often already have this
  // assignment from an earlier one.
  if (!(await hasAssignment(missionId, contentBot.id))) {
    await assignAgent(missionId, contentBot.id, "lead");
  }

  // A distinct decision/action vocabulary, permanently distinguishing a
  // founder-requested subsequent production from the mission's original
  // production (whichever gate created it) in the real audit trail.
  await recordApproval({
    missionId,
    founderId,
    decision: "produce_again",
    note: input.founderNotes ?? undefined,
    contentItemId: item.id,
  });
  await recordActivity({
    missionId,
    actor: `founder:${founderId}`,
    action: "production_again_requested",
    detail:
      `Founder started a new, independent production (content item ${item.id}) from this mission's existing, ` +
      `unmutated Scout research — no new research was run. Concept: "${input.concept}". Target platform: ` +
      `${input.targetPlatform}, audience: ${input.audience}, content type: ${input.contentType}.`,
  });

  try {
    await inngest.send({
      id: `content-production-requested-${item.id}`,
      name: CONTENT_PRODUCTION_REQUESTED_EVENT,
      data: { contentItemId: item.id, missionId },
    });
  } catch (sendError) {
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
  await assertContentItemInFoundersOrganization(item.mission_id, founderId, `Content item ${contentItemId} not found.`);
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
  await assertContentItemInFoundersOrganization(item.mission_id, founderId, `Content item ${contentItemId} not found.`);
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
  await assertContentItemInFoundersOrganization(item.mission_id, founderId, `Content item ${contentItemId} not found.`);
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

export class NotRecoverableFailureError extends Error {
  constructor(contentItemId: string, category: string | null) {
    super(
      `Content item ${contentItemId}'s failure ("${category ?? "unclassified"}") is not eligible for automatic ` +
        `Retry Production — this needs a founder decision (Send Back With Notes, or a new mission), not a plain retry.`,
    );
    this.name = "NotRecoverableFailureError";
  }
}

/**
 * "Retry Production" — the narrow, founder-triggered recovery for a
 * content item that failed for a genuinely recoverable, technical/provider
 * reason (see contentFailureClassification.ts). Deliberately NOT the same
 * mechanism as requestContentRevision above: a creative revision and a
 * technical retry are different events that must stay distinguishable in
 * Venture HQ forever, not just in this one call — see the distinct
 * "retry_production" approval decision and "production_retry_requested"
 * activity action below, and contentFailureClassification.ts's own doc
 * comment for the real bug (a live ElevenLabs 401) this exists for.
 *
 * Deliberately reuses the failed version's own already-valid, already-paid-
 * for plan and safety verdict rather than asking Content Bot to redo
 * either — a technical failure at the asset-generation layer says nothing
 * about whether the creative plan was fine (it was; it already passed
 * every guardrail and the safety judge). This is also what keeps a retry
 * cheap: it makes no Anthropic call at all, only the one media-provider
 * call that failed before (and whatever comes after it).
 *
 * Uses the state machine's own failed -> planning edge (see
 * missionStates.ts's mission-level equivalents for the same pattern) as
 * one real, structural step, then planning -> generating immediately
 * within this same call — both already-legal edges, no new one added.
 * By the time the dispatched Inngest event actually runs
 * runContentProductionPipeline, the item is already "generating" with a
 * version that already has plan/safety_verdict set, so the pipeline's own
 * existing resumability guards (`if (version.plan) return version` /
 * `if (version.safety_verdict) return version`) skip straight to
 * asset_generation — no new pipeline branch needed for that part.
 */
export async function retryProductionAfterTechnicalFailure(
  contentItemId: string,
  founderId: string,
  deps: { storage?: StorageProvider } = {},
): Promise<ContentItem> {
  const item = await getContentItem(contentItemId);
  if (!item) throw new Error(`Content item ${contentItemId} not found.`);
  await assertContentItemInFoundersOrganization(item.mission_id, founderId, `Content item ${contentItemId} not found.`);

  if (!isRecoverableFailureCategory(item.failure_category)) {
    throw new NotRecoverableFailureError(contentItemId, item.failure_category);
  }

  if (item.version_count >= MAX_VERSIONS_PER_ITEM) {
    throw new ContentVersionCapExceededError(item.id);
  }

  // Revalidate whatever can be checked safely without generating any real
  // asset — a cheap, local, no-network registry lookup (the same one every
  // real pipeline run already does) rather than a live provider ping,
  // which would itself be a real (if free) provider call this function
  // must not make on its own initiative.
  try {
    getImageProvider();
    getVoiceProvider();
    getEditProvider();
  } catch (configError) {
    if (configError instanceof NoProviderConfiguredError) {
      throw new NotRecoverableFailureError(contentItemId, item.failure_category);
    }
    throw configError;
  }

  const failedVersion = await getLatestVersion(item.id);
  if (!failedVersion) throw new Error(`Content item ${contentItemId} has no version to retry.`);

  // Same atomic-transition idempotency guarantee as every other content-
  // item decision in this file: a genuinely concurrent double-click loses
  // this race and gets a clean ContentItemConcurrencyError, never a
  // duplicate version or a double dispatch.
  assertContentItemTransition(item.state, "planning");
  const toPlanning = await transitionContentItemState(item.id, [item.state], "planning");
  if (!toPlanning.ok) {
    throw new ContentItemConcurrencyError(item.id, [item.state], "planning", toPlanning.item.state);
  }

  const nextVersion = await openNextVersion({
    contentItemId: item.id,
    parentVersionId: failedVersion.id,
    revisionApprovalId: null, // this is a retry approval, not a revision one — see the approvals row below
  });
  await updateContentVersion(nextVersion.id, {
    plan: failedVersion.plan,
    safety_verdict: failedVersion.safety_verdict,
    // The creative strategy is a creative-layer artifact, unaffected by a
    // technical provider failure — reused exactly like plan/safety_verdict
    // so no new Claude call is needed for it either. qc_report/
    // qc_regeneration_count are deliberately NOT copied forward (they
    // default to null/0 on the new version): Visual QC must re-run against
    // whatever this new version's asset_generation pass actually produces,
    // never against the failed version's (possibly nonexistent) assets.
    creative_strategy: failedVersion.creative_strategy,
  });

  // Copy the reference image forward too, when — and only when — the
  // failed version's own reference genuinely already passed its QC check.
  // A copied-forward verdict is trusted ONLY if it is explicitly "pass"
  // AND its checksum matches the exact asset being copied right now —
  // never assumed valid just because the field is non-null. This avoids
  // both a wasted fal.ai call (the reference is a creative-layer artifact,
  // unaffected by a technical failure, exactly like plan/creative_strategy
  // above) and a real risk specific to this asset: flux/schnell has no
  // seed control, so blindly regenerating it on retry could silently
  // produce a visibly DIFFERENT-looking creature than the one the founder
  // already saw pass review.
  const failedReferenceVerdict = failedVersion.reference_qc_verdict as ReferenceQcVerdict | null;
  if (failedReferenceVerdict?.report.overall_verdict === "pass") {
    const storage = deps.storage ?? getStorageProvider();
    const failedAssets = await listContentAssets(failedVersion.id);
    const oldKeys = storageKeysFor(item.id, failedVersion.id);
    const referenceAsset = failedAssets.find((a) => a.storage_key === oldKeys.reference);
    if (referenceAsset && referenceAsset.checksum_sha256 === failedReferenceVerdict.reference_checksum_sha256) {
      const { stream, contentType } = await storage.open(referenceAsset.storage_key);
      const bytes = await readAllBytes(stream);
      const newKeys = storageKeysFor(item.id, nextVersion.id);
      const putResult = await storage.put(newKeys.reference, bytesToStream(bytes), contentType);
      await recordContentAsset({
        contentVersionId: nextVersion.id,
        kind: "reference_image",
        storageProvider: putResult.storageProvider,
        storageKey: putResult.storageKey,
        contentType: putResult.contentType,
        byteSize: putResult.byteSize,
        width: referenceAsset.width,
        height: referenceAsset.height,
        checksumSha256: putResult.checksumSha256,
        generatorProvider: referenceAsset.generator_provider,
        generatorModel: referenceAsset.generator_model,
        providerAssetId: referenceAsset.provider_asset_id,
      });
      // The copied bytes are identical to the source, so their checksum
      // is too — this verdict will validly match on resume
      // (runReferenceGenerationStage's own checksum check), meaning no
      // new QC call is needed either, not just no new image call.
      await updateContentVersion(nextVersion.id, {
        reference_qc_verdict: { report: failedReferenceVerdict.report, reference_checksum_sha256: putResult.checksumSha256 },
      });
    }
    // If the asset is missing, or its checksum doesn't match the stored
    // verdict, nothing is copied — runReferenceGenerationStage correctly
    // regenerates and re-checks it from scratch on the retried run,
    // exactly as if this version never had a reference at all.
  }

  assertContentItemTransition("planning", "generating");
  const toGenerating = await transitionContentItemState(item.id, ["planning"], "generating", {
    generation_attempt_count: 1,
  });
  if (!toGenerating.ok) {
    throw new ContentItemConcurrencyError(item.id, ["planning"], "generating", toGenerating.item.state);
  }

  const approval = await recordApproval({
    missionId: item.mission_id,
    founderId,
    decision: "retry_production",
    note: `Retrying after a recoverable technical failure ("${item.failure_category}").`,
    contentItemId: item.id,
    contentVersionId: nextVersion.id,
  });
  await recordActivity({
    missionId: item.mission_id,
    actor: `founder:${founderId}`,
    action: "production_retry_requested",
    detail:
      `Retrying after a recoverable technical failure ("${item.failure_category}"): ${item.failure_reason ?? ""} ` +
      `The existing creative plan and safety review are reused as-is — this is a technical retry, not a founder ` +
      `creative revision.`,
  });

  try {
    await inngest.send({
      id: `content-production-requested-${nextVersion.id}`,
      name: CONTENT_PRODUCTION_REQUESTED_EVENT,
      data: { contentItemId: item.id, missionId: item.mission_id },
    });
  } catch (sendError) {
    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "production_dispatch_failed",
      detail: `Could not send the production-requested dispatch event for the retry: ${
        sendError instanceof Error ? sendError.message : "unknown error"
      }. The content item remains correctly at "generating" — the self-healing watchdog will retry the dispatch.`,
    });
  }

  void approval;
  return toGenerating.item;
}

export class ContentAssetNotFoundError extends Error {
  constructor(assetId: string) {
    super(`Content asset ${assetId} not found.`);
    this.name = "ContentAssetNotFoundError";
  }
}

/**
 * The real ownership chain for one generated file — asset -> version ->
 * item -> mission -> organization — resolved and checked here rather
 * than inline in the streaming route, so it's directly testable the same
 * way every other tenant-boundary check in this codebase is (Master
 * Development Mission 6). Real generated media is the single most
 * sensitive thing Content Bot produces; this previously had no ownership
 * check at all.
 */
export async function getOwnedContentAsset(assetId: string, founderId: string): Promise<ContentAsset> {
  const asset = await getContentAsset(assetId);
  const version = asset ? await getContentVersion(asset.content_version_id) : undefined;
  const item = version ? await getContentItem(version.content_item_id) : undefined;
  const mission = item ? await getMission(item.mission_id) : undefined;
  const organization = await getActiveOrganizationForFounder(founderId);
  if (!asset || !version || !item || !mission || mission.organization_id !== organization.id) {
    throw new ContentAssetNotFoundError(assetId);
  }
  return asset;
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
  await assertContentItemInFoundersOrganization(item.mission_id, founderId, `Content item ${contentItemId} not found.`);
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

/**
 * The mandatory Visual QC stage's unresolved-issues outcome (CLAUDE.md's
 * Content Bot Creative Quality milestone) — routed to the same "blocked"
 * (not "failed") item state as a safety/guardrail refusal, for the same
 * reason: this is "we found a real, checkable problem and are stopping
 * for founder review," never "the tool broke," and never a fabricated
 * completion (assembling known-bad assets and presenting them as finished
 * would be exactly that). Deliberately never assigned a failure_category —
 * a QC stop is not a recoverable technical failure Retry Production should
 * ever apply to; it needs a founder decision (revise the brief/direction,
 * or reject), same as a safety block.
 */
export class VisualQCBlocked extends Error {
  constructor(readonly report: VisualQCReport) {
    // findings holds only genuine problems now (see VisualQCReportSchema's
    // own doc comment) — no per-item verdict to filter by.
    super(
      `Visual QC found unresolved issues: ${report.findings
        .map((f) => `${f.asset_ref} (${f.issue_types.join(", ") || "unspecified"})`)
        .join("; ")}`,
    );
    this.name = "VisualQCBlocked";
  }
}

/**
 * The reference-image continuity check's own persisted result (see
 * content_versions.reference_qc_verdict). `reference_checksum_sha256` is
 * what makes a copied-forward verdict self-verifying — see
 * runReferenceGenerationStage's own resume logic for why a verdict is
 * only ever trusted when this matches the reference asset actually
 * present on the version, never assumed valid just because the field is
 * non-null.
 */
export type ReferenceQcVerdict = {
  report: VisualQCReport;
  reference_checksum_sha256: string;
};

/**
 * The reference-image continuity check's own unresolved-rejection outcome
 * — routed to the same "blocked" (not "failed") item state as a Visual QC
 * or safety refusal, and for the same reason: this is a real, honest "we
 * refused to make this," never a technical failure, so it must never be
 * Retry-Production-eligible. Deliberately distinct from VisualQCBlocked
 * (which fires after the full beat/thumbnail batch already exists): this
 * fires BEFORE that batch is ever generated, which is the entire point of
 * checking the reference early — see runReferenceGenerationStage.
 */
export class ReferenceQCBlocked extends Error {
  constructor(readonly report: VisualQCReport) {
    super(
      `The reference image failed quality review after one regeneration attempt: ${report.findings
        .map((f) => `${f.issue_types.join(", ") || "unspecified"}${f.reasons.length > 0 ? ` — ${f.reasons.join("; ")}` : ""}`)
        .join("; ") || "unresolved issue"}. Refusing to spend on the beat/thumbnail batch against a reference that doesn't match the intended design.`,
    );
    this.name = "ReferenceQCBlocked";
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
    // The one canonical reference image every beat/thumbnail in this
    // version is conditioned against — see runReferenceGenerationStage.
    reference: `content/${itemId}/${versionId}/reference.jpg`,
    // A real, generated motion video clip for one beat (Content Bot
    // motion-first milestone) — the beat's `image` above becomes this
    // clip's Kling start frame, never overwritten by it.
    videoClip: (index: number) => `content/${itemId}/${versionId}/clip-${index}.mp4`,
    // A plain working file (never a content_assets row — internal
    // pipeline state, same pattern as `alignment` above), holding the real
    // submitted job's serializable handle. Its mere existence is what a
    // process restart checks BEFORE ever submitting a beat's clip again —
    // see runVideoClipGenerationStage's own doc comment for why.
    videoClipJob: (index: number) => `content/${itemId}/${versionId}/clip-${index}.job.json`,
  };
}

/**
 * The single source of truth for how many real provider calls a plan
 * would need in total — checked BEFORE any of them happen, from whichever
 * stage runs first (runReferenceGenerationStage, when the plan has a
 * visual_identity to condition against; runAssetGenerationStage
 * otherwise). A real bug during this design's own testing caught what
 * checking this only inside runAssetGenerationStage would have missed:
 * the reference image is generated by an EARLIER stage, so a cap check
 * that ran only in the later stage would let the reference call (and its
 * possible one regeneration) spend first and only refuse afterward — too
 * late to be a real pre-flight guard for that call specifically.
 *
 * Content Bot motion-first milestone: every beat now needs TWO real calls
 * (its still start frame, then its real Kling video clip), not one —
 * counted here so this cap stays the real total, never silently
 * undercounting the new call type. `MAX_ASSET_CALLS_PER_VERSION` itself is
 * deliberately NOT raised for this — the same "do not silently raise a
 * fixed cap to make a plan fit" discipline as MAX_ITEM_SPEND_USD.
 */
function assertPlannedCallsWithinCap(itemId: string, plan: ContentPlan): void {
  const plannedCalls =
    1 /* voiceover */ +
    1 /* thumbnail */ +
    plan.script.length /* stills (Kling start frames) */ +
    plan.script.length /* real video clips */ +
    (plan.visual_identity ? 1 : 0) /* reference image */;
  if (plannedCalls > MAX_ASSET_CALLS_PER_VERSION) {
    throw new ContentAssetCallCapExceededError(itemId, plannedCalls);
  }
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
  return bytesToStream(new TextEncoder().encode(text));
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
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
 *
 * Creative Quality milestone: rewritten from a fixed 6-word chunk to a
 * shorter, phrase-aware chunk (max 4 words) that also breaks early — once
 * a cue already has at least 2 words — right after a word ending in
 * sentence-final punctuation, so a cue is more likely to land on a real
 * clause boundary instead of splitting mid-clause (a real observed
 * failure: "This camera was pulled from four / thousand meters down.").
 * No new provider — this is a pure function of the same alignment data
 * already returned by the voice provider.
 */
/** Exported for tests only, matching storageKeysFor's own precedent. */
export function buildCaptionVtt(alignment: VoiceWordTiming[], maxWordsPerCue = 4): string {
  if (alignment.length === 0) return "WEBVTT\n";
  const lines = ["WEBVTT", ""];
  let i = 0;
  while (i < alignment.length) {
    let end = i;
    let count = 0;
    while (end < alignment.length && count < maxWordsPerCue) {
      const word = alignment[end]!.word;
      count += 1;
      end += 1;
      if (count >= 2 && /[.!?]$/.test(word)) break;
    }
    const chunk = alignment.slice(i, end);
    const start = chunk[0]!.startSeconds;
    const finish = chunk[chunk.length - 1]!.endSeconds;
    const text = chunk.map((w) => w.word).join(" ");
    lines.push(`${formatVttTimestamp(start)} --> ${formatVttTimestamp(finish)}`, text, "");
    i = end;
  }
  return lines.join("\n");
}

/**
 * Mechanically concatenates the plan's visual_identity (when present) onto
 * a raw image-generation prompt — see ContentPlanSchema's own doc comment
 * for why this is deliberately a pipeline-level mechanical step rather
 * than trusting the model to restate the same description consistently in
 * every beat's own visual_direction prose (a real, observed failure: a
 * creature described three visually incompatible ways across one plan).
 */
/** Exported for tests only, matching storageKeysFor's own precedent. */
export function withVisualIdentity(prompt: string, identity: VisualIdentity | null): string {
  if (!identity) return prompt;
  const traits =
    identity.immutable_traits.length > 0 ? ` Immutable traits that must not change: ${identity.immutable_traits.join(", ")}.` : "";
  return `${prompt} The recurring subject must look exactly like this, consistent with every other shot: ${identity.canonical_description}.${traits}`;
}

/**
 * Defaults to "full" — a plan persisted before this field existed (or any
 * fixture that never set it) has no `subject_prominence` key at all on its
 * beats, and this is the one place that gap is papered over, everywhere
 * it's read. Never inline `beat.subject_prominence` directly elsewhere.
 */
export function beatSubjectProminence(beat: Pick<ScriptBeat, "subject_prominence">): SubjectProminence {
  return beat.subject_prominence ?? "full";
}

/**
 * The real fix for a live failure (Production 4): reference-conditioning
 * a shot whose OWN narrative purpose is to show the recurring subject
 * faint/camouflaged or entirely absent fights the reference image's
 * necessarily-clear presentation, and the clear presentation wins — every
 * "faint"/"absent" beat rendered the subject as solidly as the reference
 * itself. Three branches, matching exactly what CLAUDE.md's design
 * specifies:
 *   - "full": unchanged from before this field existed — the plain
 *     withVisualIdentity() text, nothing added.
 *   - "faint": identity is STILL described (the subject must still look
 *     like itself if you can make it out at all — this is not the same
 *     as "absent") but a second, explicit instruction is appended telling
 *     generation to prioritize reduced visibility over the reference's
 *     normal clarity — the reference IMAGE alone was already not enough
 *     to communicate that on its own.
 *   - "absent": withVisualIdentity() is never called at all — no
 *     canonical_description, no immutable_traits text reaches the prompt,
 *     so nothing textual nudges generation toward inserting the subject.
 *     Paired with referenceImageUrlForProminence below (no reference
 *     image either) for the same shot, this is deliberately belt-and-
 *     suspenders: EITHER signal alone re-introducing the subject would
 *     defeat the point.
 */
export function promptForBeatProminence(basePrompt: string, identity: VisualIdentity | null, prominence: SubjectProminence): string {
  if (prominence === "absent") return basePrompt;
  const withIdentity = withVisualIdentity(basePrompt, identity);
  if (prominence === "full") return withIdentity;
  return (
    `${withIdentity} IMPORTANT: unlike a normal shot of this subject, THIS shot intentionally shows it ` +
    `camouflaged, obscured, or only faintly/partially visible — prioritize that reduced visibility over a ` +
    `clear, solid presentation. Do not render it as prominently or solidly as you would for an ordinary shot.`
  );
}

/** The reference-image half of the same fix — never sent for an "absent" beat, sent normally otherwise. */
export function referenceImageUrlForProminence(referenceImageUrl: string | undefined, prominence: SubjectProminence): string | undefined {
  return prominence === "absent" ? undefined : referenceImageUrl;
}

/**
 * Content Bot motion-first milestone: the real motion prompt sent to the
 * video provider for one beat, built from `starting_state`/`action`/
 * `ending_state` (see ScriptBeatMotionSchema's own doc comment for why
 * `action` — describing what PHYSICALLY HAPPENS, not a static composition
 * — is the field that matters). Falls back to the beat's own
 * `visual_direction` only for a plan persisted before this milestone (an
 * already-open version being resumed after this code deployed) — never a
 * normal-path behavior for a freshly-produced plan, since `action` is a
 * required schema field going forward.
 */
export function beatMotionPrompt(beat: Pick<ScriptBeat, "action" | "starting_state" | "ending_state" | "visual_direction">): string {
  if (!beat.action) return beat.visual_direction;
  const segments = [
    beat.starting_state ? `Starting state: ${beat.starting_state}.` : null,
    `Action: ${beat.action}`,
    beat.ending_state ? `Ending state: ${beat.ending_state}.` : null,
  ].filter((segment): segment is string => Boolean(segment));
  return segments.join(" ");
}

/**
 * The real, whole-second duration a beat's Kling clip should be — Content
 * Bot's own `clip_duration_seconds` when present (the normal case for
 * every plan produced under this milestone). Falls back to the beat's
 * `end_seconds - start_seconds`, clamped into Kling's real 3-15s range,
 * only for a plan predating this field (same narrow backward-compatibility
 * concern as `beatSubjectProminence` above) — never trusted un-clamped,
 * since an old beat's own span could easily fall outside Kling's real
 * supported range.
 */
export function beatClipDurationSeconds(beat: Pick<ScriptBeat, "clip_duration_seconds" | "start_seconds" | "end_seconds">): number {
  if (beat.clip_duration_seconds != null) return beat.clip_duration_seconds;
  const derived = Math.round(beat.end_seconds - beat.start_seconds) || 5;
  return Math.min(15, Math.max(3, derived));
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

/**
 * Stage 0 of the pipeline (CLAUDE.md's Content Bot Creative Quality
 * milestone) — a bounded Creative Strategy call BEFORE any script is
 * written, persisted on the version as `creative_strategy` (a real
 * quality-provenance artifact, not just internal reasoning — see
 * MissionDetail's rendering of it). Resumable exactly like every other
 * stage: a version that already has one is never re-decided.
 */
async function runCreativeStrategyStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  brief: ProductionBrief,
  deps: ContentPipelineDeps,
): Promise<ContentVersion<ContentPlan>> {
  if (version.creative_strategy) return version; // already decided — resumed

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "creative_strategy", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(item.mission_id, "creative_strategy", "Content Bot is deciding the creative strategy.", {
      contentItemId: item.id,
      contentVersionId: version.id,
    });
  }

  try {
    const { strategy, usage } = await planCreativeStrategy({ brief, audience: ctx }, deps.contentBot ?? {});
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

    const updated = (await updateContentVersion(version.id, { creative_strategy: strategy })) as ContentVersion<ContentPlan>;
    await completeStage(stage.id, `Hook mechanic: ${strategy.hook_mechanic}`);
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "creative_strategy_decided",
      detail: `Hook: ${strategy.hook_mechanic} Visual treatment: ${strategy.visual_treatment} Disclosure: ${strategy.disclosure_treatment}`,
    });
    return updated;
  } catch (error) {
    if (error instanceof ContentBotError) {
      await recordTokenCostOnFailure(item, version.id, error.usage);
    }
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Creative strategy failed.");
    }
    throw error;
  }
}

async function runProductionPlanningStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  brief: ProductionBrief,
  deps: ContentPipelineDeps,
): Promise<ContentVersion<ContentPlan>> {
  if (version.plan) {
    // A copied-forward plan — most commonly Retry Production reusing a
    // pre-existing version's plan after a purely technical failure (see
    // retryProductionAfterTechnicalFailure) — must still satisfy every
    // guardrail that exists RIGHT NOW, not just whichever ones existed
    // when it was originally generated. Without this, a plan stored
    // before a guardrail was added (e.g. assertNarrationFitsDuration,
    // added for the real 59s-narration-vs-30s-brief live failure) could
    // be silently reused via Retry Production and sail straight to real
    // asset-generation spend a second time, with nothing ever re-checking
    // it. In the overwhelmingly common case — a plan created after every
    // current guardrail already existed — every one of these checks
    // already passed once when the plan was first generated, so this
    // costs nothing extra to re-confirm. Deliberately no automatic-
    // correction attempt here: a stale plan failing a guardrail added
    // after it was written is a legacy-data edge case, not the fresh-
    // generation path this file's one bounded correction exists for — it
    // blocks for founder review (ContentGuardrailError → "blocked", same
    // as any other guardrail rejection) rather than spending a new Claude
    // call to fix data made before this check existed.
    const plan = version.plan as ContentPlan;
    assertNoNamedIP(plan, brief);
    assertAudienceAppropriate(plan, ctx);
    assertClaimsAreEvidenced(plan, brief);
    assertNarrationFitsDuration(plan);
    return version;
  }

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

  // One real planContentVersion call, real cost recorded unconditionally
  // (exactly as before — a guardrail rejection never drops recorded
  // spend), then every plan-level guardrail. Returns the plan either way
  // (even on a guardrail failure) so the caller can feed it back into the
  // one allowed correction attempt below — a thrown ContentGuardrailError
  // would otherwise discard the very plan text a correction needs to see.
  async function generateAndValidate(
    guardrailCorrection?: { rejectedPlan: ContentPlan; reason: string; code: string },
  ): Promise<{ plan: ContentPlan; guardrailError: ContentGuardrailError | null }> {
    const { plan, usage } = await planContentVersion(
      {
        brief,
        audience: ctx,
        previousPlan,
        revisionNote,
        strategy: (version.creative_strategy as CreativeStrategy | null) ?? undefined,
        guardrailCorrection,
      },
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
    try {
      assertNoNamedIP(plan, brief);
      assertAudienceAppropriate(plan, ctx);
      assertClaimsAreEvidenced(plan, brief);
      assertNarrationFitsDuration(plan);
      return { plan, guardrailError: null };
    } catch (error) {
      if (error instanceof ContentGuardrailError) return { plan, guardrailError: error };
      throw error; // an unexpected error shape — never silently swallowed
    }
  }

  try {
    let { plan, guardrailError } = await generateAndValidate();
    let corrected = false;

    if (guardrailError) {
      // The one bounded automatic correction — real, live bug this fixes:
      // a founder-commissioned plan used generic-but-forbidden "in the
      // style of" phrasing and was blocked before any asset spend, even
      // though the underlying creative concept was fine. Deliberately
      // narrow: never layered on top of a founder-requested revision
      // (revisionNote already represents deliberate human-guided
      // rewriting — conflating the two would blur the audit trail), never
      // more than this one extra call, and structurally impossible after
      // any asset generation has started (this whole function still runs
      // strictly before asset_generation).
      if (revisionNote) {
        throw guardrailError;
      }
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "production_plan_guardrail_correction_attempted",
        detail:
          `First planning attempt failed a guardrail ("${guardrailError.message}") before any asset ` +
          `generation began — making one bounded automatic correction attempt. No provider spend beyond ` +
          `this planning call has occurred.`,
      });

      const correction = await generateAndValidate({ rejectedPlan: plan, reason: guardrailError.message, code: guardrailError.code });
      if (correction.guardrailError) {
        await recordActivity({
          missionId: item.mission_id,
          actor: "system",
          action: "production_plan_auto_correction_failed",
          detail:
            `The automatic correction attempt also failed a guardrail: "${correction.guardrailError.message}". ` +
            `No further automatic retry — this item is blocked for founder review, with both attempts' real ` +
            `cost recorded.`,
        });
        throw correction.guardrailError;
      }
      plan = correction.plan;
      corrected = true;
    }

    const updated = (await updateContentVersion(version.id, { plan })) as ContentVersion<ContentPlan>;
    await completeStage(
      stage.id,
      corrected
        ? `Plan drafted after one automatic correction: "${plan.title}" (${plan.duration_seconds}s, ${plan.script.length} beat(s)).`
        : `Plan drafted: "${plan.title}" (${plan.duration_seconds}s, ${plan.script.length} beat(s)).`,
    );
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: corrected ? "production_plan_auto_corrected" : "production_plan_drafted",
      detail: corrected
        ? `"${plan.title}" — corrected after 1 automatic retry, now passing every guardrail. ${plan.script.length} script beat(s), ${plan.duration_seconds}s target duration.`
        : `"${plan.title}" — ${plan.script.length} script beat(s), ${plan.duration_seconds}s target duration.`,
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

/**
 * A clear, neutral reference-sheet prompt for the one canonical subject
 * image every beat/thumbnail will be conditioned against — deliberately
 * NOT any specific beat's scene (pose, lighting, action), since this
 * image's only job is to show the subject itself clearly and
 * unobstructed, the way a character reference sheet would.
 */
function buildReferenceImagePrompt(identity: VisualIdentity): string {
  const traits = identity.immutable_traits.length > 0 ? ` Immutable traits that must be clearly visible: ${identity.immutable_traits.join(", ")}.` : "";
  return (
    `A clear, well-lit reference image showing a single subject fully and unobstructed against a simple, ` +
    `uncluttered natural backdrop — suitable for use as a visual reference, not a dramatic or action shot. ` +
    `${identity.canonical_description}.${traits} ${identity.continuity_notes}`.trim()
  );
}

/**
 * Generates and quality-checks the ONE canonical reference image a
 * version's beat images and thumbnail will be conditioned against
 * (fal.ai image-to-image continuity — see CLAUDE.md's Content Bot
 * reference-image continuity design). Runs BEFORE asset_generation's
 * beat/thumbnail batch specifically so a bad reference is caught and
 * refused while only its own small cost is at risk, not the whole
 * conditioned batch's (see ReferenceQCBlocked).
 *
 * Resumability (three independent, checksum-verified cases — never
 * trusted implicitly):
 *   1. No reference asset yet → generate it (or reuse a copy-forward from
 *      Retry Production, via the exact same `hasAsset`-style check every
 *      other asset in this pipeline already uses).
 *   2. A reference asset exists but no *matching, passing* verdict does →
 *      run ONLY the QC check, never regenerate the image just because the
 *      process stopped before QC got a chance to run. A verdict is only
 *      ever trusted when its `reference_checksum_sha256` matches the
 *      asset actually present right now — a copied-forward verdict tied
 *      to different bytes (should never happen, but never assumed) falls
 *      through to a real re-check rather than being trusted blindly.
 *   3. A reference asset AND a matching "pass" verdict both exist →
 *      already fully resolved (freshly completed, resumed after a crash,
 *      or validly copied forward by Retry Production) — return
 *      immediately, no new call of any kind.
 *
 * A plan with no visual_identity has nothing to keep consistent — this
 * stage is a deliberate no-op for it, at zero extra cost.
 */
async function runReferenceGenerationStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  deps: ContentPipelineDeps,
): Promise<ContentVersion<ContentPlan>> {
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot generate its reference image.`);
  if (!plan.visual_identity) return version; // nothing to keep consistent — no-op, zero cost

  const storage = deps.storage ?? getStorageProvider();
  const keys = storageKeysFor(item.id, version.id);

  const existingAssets = await listContentAssets(version.id);
  let referenceAsset = existingAssets.find((a) => a.storage_key === keys.reference) ?? null;

  const storedVerdict = version.reference_qc_verdict as ReferenceQcVerdict | null;
  if (
    referenceAsset &&
    storedVerdict &&
    storedVerdict.report.overall_verdict === "pass" &&
    storedVerdict.reference_checksum_sha256 === referenceAsset.checksum_sha256
  ) {
    return version; // already generated AND already validly passed QC — resumed or validly copied forward
  }

  // Checked here too, not only in runAssetGenerationStage — this stage
  // runs FIRST, so without this a plan whose total real call count
  // (reference + thumbnail + stills) exceeds the cap would still spend on
  // the reference itself before ever being refused. See
  // assertPlannedCallsWithinCap's own doc comment.
  assertPlannedCallsWithinCap(item.id, plan);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "reference_generation", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(
      item.mission_id,
      "reference_generation",
      "Content Bot is generating and checking the canonical reference image.",
      { contentItemId: item.id, contentVersionId: version.id },
    );
  }

  async function readAssetBase64(storageKey: string, fallbackContentType: string): Promise<{ base64: string; contentType: string }> {
    const { stream, contentType } = await storage.open(storageKey);
    const bytes = await readAllBytes(stream);
    return { base64: Buffer.from(bytes).toString("base64"), contentType: contentType || fallbackContentType };
  }

  async function checkReference(asset: ContentAsset): Promise<ReferenceQcVerdict> {
    const { base64, contentType } = await readAssetBase64(asset.storage_key, "image/jpeg");
    const { report, usage } = await reviewVisualQuality(
      {
        plan: { visual_identity: plan!.visual_identity, disclosure: plan!.disclosure },
        audience: ctx,
        assets: [
          {
            assetRef: "reference",
            description: `The canonical subject reference: ${plan!.visual_identity!.canonical_description}`,
            contentType,
            base64,
            expectedProminence: "full",
          },
        ],
      },
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
    return { report, reference_checksum_sha256: asset.checksum_sha256 ?? "" };
  }

  try {
    // Step 1: ensure the reference image itself exists — resumable
    // exactly like every other asset in this pipeline (hasAsset-style
    // check before ever calling the provider).
    if (!referenceAsset) {
      await assertStillGenerating(item.id);
      const imageProvider = deps.media?.image ?? getImageProvider();
      const req = {
        idempotencyKey: keys.reference,
        audience: ctx,
        prompt: buildReferenceImagePrompt(plan.visual_identity),
        aspectRatio: plan.aspect_ratio,
      };
      await assertItemBudgetRemaining(item.id, imageProvider.estimateUsd(req));
      const result = await imageProvider.generate(req);
      referenceAsset = await persistMediaResult({
        storage,
        storageKey: keys.reference,
        result,
        kind: "reference_image",
        contentVersionId: version.id,
        contentItemId: item.id,
        missionId: item.mission_id,
        agentId: item.agent_id,
      });
    }

    // Step 2: QC it — resumable INDEPENDENTLY of step 1 (see this
    // function's own doc comment, case 2): a crash between storing the
    // asset and completing this check resumes here without regenerating
    // the image.
    let verdict = await checkReference(referenceAsset);

    if (verdict.report.overall_verdict === "flag") {
      if (version.reference_regeneration_count >= MAX_REFERENCE_REGENERATIONS) {
        await updateContentVersion(version.id, { reference_qc_verdict: verdict });
        const reason = `Reference image rejected by QC and the ${MAX_REFERENCE_REGENERATIONS}-attempt regeneration cap was already reached.`;
        await failStage(stage.id, reason);
        await recordActivity({
          missionId: item.mission_id,
          actor: "system",
          action: "reference_qc_regeneration_cap_reached",
          detail: reason,
        });
        throw new ReferenceQCBlocked(verdict.report);
      }

      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "reference_regeneration_attempted",
        detail:
          `The reference image failed quality review before any beat/thumbnail spend — making one bounded ` +
          `regeneration attempt. Reasons: ${verdict.report.findings.map((f) => f.reasons.join("; ")).join(" | ") || "unspecified"}.`,
      });

      await assertStillGenerating(item.id);
      const imageProvider = deps.media?.image ?? getImageProvider();
      const req = {
        idempotencyKey: `${keys.reference}-retry-1`,
        audience: ctx,
        prompt: buildReferenceImagePrompt(plan.visual_identity),
        aspectRatio: plan.aspect_ratio,
      };
      await assertItemBudgetRemaining(item.id, imageProvider.estimateUsd(req));
      const result = await imageProvider.generate(req);
      // Overwrites the SAME (provider, key) asset in place rather than
      // inserting a second row — the exact pattern Visual QC's own
      // beat-level regeneration already uses (see runVisualQCStage): the
      // real `content_assets_provider_key_unique` constraint means a
      // second insert at this key would fail outright, and this replaces
      // a reference that was never shown to a founder as finished.
      const bytes = await readAllBytes(await result.open());
      const putResult = await storage.put(keys.reference, bytesToStream(bytes), result.contentType);
      await updateContentAsset(referenceAsset.id, {
        content_type: putResult.contentType,
        byte_size: putResult.byteSize,
        checksum_sha256: putResult.checksumSha256,
        generator_provider: result.usage.provider,
        generator_model: result.usage.model,
        provider_asset_id: result.providerAssetId,
      });
      referenceAsset = { ...referenceAsset, checksum_sha256: putResult.checksumSha256, byte_size: putResult.byteSize };
      await recordCost({
        missionId: item.mission_id,
        agentId: item.agent_id,
        contentItemId: item.id,
        contentVersionId: version.id,
        model: result.usage.model,
        provider: result.usage.provider,
        unit: result.usage.unit,
        quantity: result.usage.quantity,
        usdCost: result.usage.usdCost,
      });

      version = (await updateContentVersion(version.id, {
        reference_regeneration_count: version.reference_regeneration_count + 1,
      })) as ContentVersion<ContentPlan>;

      verdict = await checkReference(referenceAsset);

      if (verdict.report.overall_verdict === "flag") {
        await updateContentVersion(version.id, { reference_qc_verdict: verdict });
        const reason = `Reference image still rejected by QC after one regeneration attempt.`;
        await failStage(stage.id, reason);
        await recordActivity({
          missionId: item.mission_id,
          actor: "system",
          action: "reference_qc_unresolved",
          detail: `${reason} Stopping before any beat/thumbnail spend rather than conditioning a batch on a known-bad reference.`,
        });
        throw new ReferenceQCBlocked(verdict.report);
      }
    }

    const updated = (await updateContentVersion(version.id, { reference_qc_verdict: verdict })) as ContentVersion<ContentPlan>;
    await completeStage(
      stage.id,
      verdict.report.overall_verdict === "pass" && version.reference_regeneration_count > 0
        ? "Reference image passed quality review after one regeneration."
        : "Reference image generated and passed quality review.",
    );
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "reference_generated",
      detail: "Canonical reference image generated and passed quality review — ready to condition the beat/thumbnail batch.",
    });
    return updated;
  } catch (error) {
    if (error instanceof ContentBotError) {
      await recordTokenCostOnFailure(item, version.id, error.usage);
    }
    if (!(error instanceof ProductionMovedOn) && !(error instanceof ReferenceQCBlocked)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Reference generation failed.");
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
    assertPlannedCallsWithinCap(item.id, plan);

    const existing = await listContentAssets(version.id);
    const hasAsset = (key: string) => existing.some((a) => a.storage_key === key);

    // Resolved once, reused for every conditioned call below. Only
    // present when the plan has a visual_identity to keep consistent —
    // runReferenceGenerationStage (which already ran before this stage)
    // guarantees that whenever this asset exists, it has already passed
    // its own QC; if it's absent, plan.visual_identity was null and no
    // conditioning is needed at all.
    const referenceAsset = existing.find((a) => a.storage_key === keys.reference);
    const referenceImageUrl = referenceAsset ? await resolvePublicUrl(storage, keys.reference) : undefined;

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
        // The text description is kept even when a reference image is
        // also sent — belt-and-suspenders, not a replacement: the image
        // is the stronger continuity signal, but the text still tells the
        // model what's supposed to be happening in THIS shot specifically.
        prompt: withVisualIdentity(plan.thumbnail_brief.prompt, plan.visual_identity),
        aspectRatio: plan.aspect_ratio,
        referenceImageUrl,
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
      const prominence = beatSubjectProminence(beat);
      const req = {
        idempotencyKey: key,
        audience: ctx,
        prompt: promptForBeatProminence(beat.visual_direction, plan.visual_identity, prominence),
        aspectRatio: plan.aspect_ratio,
        referenceImageUrl: referenceImageUrlForProminence(referenceImageUrl, prominence),
      };
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

/**
 * A real, paid video-generation call can take minutes (a live proof
 * measured ~188s for one 5s clip) — it must never be assumed to complete
 * synchronously inside a single call. Every configured video provider is
 * therefore required to implement the async submit()/poll() contract
 * (AsyncMediaProvider), never just the plain generate() convenience
 * wrapper, for this pipeline's own use. Structural, not a trust-the-caller
 * check — a provider missing either method fails loudly here rather than
 * this stage silently blocking on generate() and risking a real serverless
 * execution-time limit.
 */
function assertAsyncVideoProvider(provider: VideoProvider): asserts provider is VideoProvider & AsyncMediaProvider<VideoRequest> {
  const maybeAsync = provider as Partial<AsyncMediaProvider<VideoRequest>>;
  if (typeof maybeAsync.submit !== "function" || typeof maybeAsync.poll !== "function") {
    throw new Error(
      "The configured video provider does not implement the required async submit()/poll() contract — real video " +
        "generation can take minutes and must never be run as a single blocking call inside this pipeline.",
    );
  }
}

const VIDEO_CLIP_POLL_INTERVAL_MS = 5000;
// Generous but real and bounded — a live Kling proof observed ~188s for
// one 5s clip; this stage polls every pending beat concurrently (see
// below), so this ceiling bounds the SLOWEST single clip, not the sum of
// every beat's generation time.
const VIDEO_CLIP_POLL_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Content Bot motion-first milestone: turns each beat's already-generated
 * still (from runAssetGenerationStage, immediately above — that beat's
 * real Kling `start_image_url`) into a real generated motion video clip.
 * This is now the pipeline's PRIMARY visual path — a static pan/zoom over
 * a still is no longer what a normal production ends with; the per-beat
 * still stays, unremoved, purely as this clip's own start frame (and
 * still separately used for the thumbnail/reference, per CLAUDE.md's
 * "legacy still path" note).
 *
 * Resumability/idempotency (Phase 5): every beat's real submitted job
 * handle is persisted to durable storage the INSTANT submission succeeds,
 * BEFORE any polling — the exact observability/resumability fix proven
 * live against Kling (see klingVideo.ts's own module doc comment),
 * generalized here. A crash-and-retry (Inngest's own bounded one-retry
 * crash recovery) resumes by checking for that persisted handle FIRST and
 * polling the existing job — never resubmitting a clip that may already
 * be live or complete. Every beat with an existing `video_clip` asset is
 * skipped outright (the same `hasAsset` idempotency check every other
 * stage in this file already uses).
 *
 * Cost preflight (Phase 4): the TOTAL planned spend across every pending
 * beat is checked, from real per-beat durations via the provider's own
 * pricing, BEFORE any video generation call — never just a per-call check
 * that could let earlier beats spend before a later one reveals the plan
 * was unaffordable. `MAX_ITEM_SPEND_USD` is never silently raised for this
 * — a plan whose real Kling cost doesn't fit refuses cleanly here.
 *
 * Submission is batched ahead of polling (submit every pending beat first,
 * THEN poll all of them together in rounds) specifically so total real
 * wall-clock time is bounded by the SLOWEST single clip, not their sum —
 * a purely sequential submit→poll→submit→poll chain across, say, 6 beats
 * at ~3 minutes each would risk a real serverless execution-time limit for
 * no reason, when fal.ai's own queue already runs them independently.
 */
async function runVideoClipGenerationStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  deps: ContentPipelineDeps,
): Promise<void> {
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot generate its video clips.`);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "video_clip_generation", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(
      item.mission_id,
      "video_clip_generation",
      "Generating real motion video clips for each beat.",
      { contentItemId: item.id, contentVersionId: version.id },
    );
  }

  const storage = deps.storage ?? getStorageProvider();
  const keys = storageKeysFor(item.id, version.id);
  const orderedBeats = [...plan.script].sort((a, b) => a.index - b.index);

  try {
    const videoProvider = deps.media?.video ?? getVideoProvider();
    assertAsyncVideoProvider(videoProvider);

    // Phase 4 — mandatory, real cost preflight BEFORE any video generation
    // call at all. estimateUsd() is a pure pricing lookup (no network call
    // — see KlingVideoProvider.estimateUsd), so this is free to compute
    // for every beat up front, even before their real start frames exist.
    const totalPlannedSeconds = orderedBeats.reduce((sum, beat) => sum + beatClipDurationSeconds(beat), 0);
    const totalEstimatedUsd = orderedBeats.reduce((sum, beat) => {
      const preflightReq: VideoRequest = {
        idempotencyKey: "preflight",
        audience: ctx,
        prompt: "",
        durationSeconds: beatClipDurationSeconds(beat),
        aspectRatio: plan.aspect_ratio,
        referenceImageUrl: "preflight",
      };
      return sum + videoProvider.estimateUsd(preflightReq);
    }, 0);
    await assertItemBudgetRemaining(item.id, totalEstimatedUsd);
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "video_clip_spend_preflight",
      detail: `Planned ${totalPlannedSeconds}s of real generated video across ${orderedBeats.length} beat(s), estimated $${totalEstimatedUsd.toFixed(2)}.`,
    });

    const existing = await listContentAssets(version.id);
    const hasAsset = (key: string) => existing.some((a) => a.storage_key === key);
    const pendingBeats = orderedBeats.filter((beat) => !hasAsset(keys.videoClip(beat.index)));

    // Submit (or recover) every pending beat's job first.
    const jobs: Array<{ beatIndex: number; jobHandle: string }> = [];
    for (const beat of pendingBeats) {
      await assertStillGenerating(item.id);
      const jobKey = keys.videoClipJob(beat.index);
      const persistedJob = await storage.head(jobKey);
      if (persistedJob) {
        // A production restart must never blindly resubmit a clip that
        // already has a live/completed Kling request — resume polling the
        // exact job already submitted, recovered from durable storage.
        const { jobHandle } = await readJsonFile<{ jobHandle: string }>(storage, jobKey);
        jobs.push({ beatIndex: beat.index, jobHandle });
        continue;
      }

      const startImageUrl = await resolvePublicUrl(storage, keys.image(beat.index));
      const prominence = beatSubjectProminence(beat);
      const req: VideoRequest = {
        idempotencyKey: keys.videoClip(beat.index),
        audience: ctx,
        prompt: promptForBeatProminence(beatMotionPrompt(beat), plan.visual_identity, prominence),
        durationSeconds: beatClipDurationSeconds(beat),
        aspectRatio: plan.aspect_ratio,
        referenceImageUrl: startImageUrl,
      };
      const estimatedUsd = videoProvider.estimateUsd(req);
      await assertItemBudgetRemaining(item.id, estimatedUsd);

      const { jobHandle } = await videoProvider.submit(req);
      // Persisted the INSTANT submission succeeds, before any polling —
      // see this function's own doc comment.
      await storage.put(
        jobKey,
        textStream(JSON.stringify({ jobHandle, submittedAt: new Date().toISOString() })),
        "application/json",
      );
      await recordActivity({
        missionId: item.mission_id,
        actor: "agent:content_bot",
        action: "video_clip_submitted",
        detail: `Beat ${beat.index}: real video clip job submitted (${req.durationSeconds}s, ~$${estimatedUsd.toFixed(2)}).`,
      });
      jobs.push({ beatIndex: beat.index, jobHandle });
    }

    // Poll every pending job together, in rounds, until each beat's clip
    // is done — bounded, never an unbounded loop.
    const startedAt = Date.now();
    const remaining = new Map(jobs.map((j) => [j.beatIndex, j.jobHandle]));
    while (remaining.size > 0) {
      await assertStillGenerating(item.id);
      for (const [beatIndex, jobHandle] of [...remaining]) {
        const outcome = await videoProvider.poll(jobHandle);
        if (outcome.status === "done" && outcome.result) {
          await persistMediaResult({
            storage,
            storageKey: keys.videoClip(beatIndex),
            result: outcome.result,
            kind: "video_clip",
            contentVersionId: version.id,
            contentItemId: item.id,
            missionId: item.mission_id,
            agentId: item.agent_id,
          });
          remaining.delete(beatIndex);
        } else if (outcome.status === "failed") {
          throw new Error(`Beat ${beatIndex}'s real video clip generation failed: ${outcome.detail ?? "unknown error"}`);
        }
      }
      if (remaining.size === 0) break;
      if (Date.now() - startedAt > VIDEO_CLIP_POLL_TIMEOUT_MS) {
        throw new Error(
          `${remaining.size} real video clip job(s) did not complete within ${Math.round(VIDEO_CLIP_POLL_TIMEOUT_MS / 60000)} minutes.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, VIDEO_CLIP_POLL_INTERVAL_MS));
    }

    await completeStage(
      stage.id,
      `Generated ${orderedBeats.length} real motion video clip(s) (${totalPlannedSeconds}s total).`,
    );
    await recordActivity({
      missionId: item.mission_id,
      actor: "agent:content_bot",
      action: "video_clips_generated",
      detail: `${orderedBeats.length} real motion video clip(s) generated (${totalPlannedSeconds}s total, ~$${totalEstimatedUsd.toFixed(2)}).`,
    });
  } catch (error) {
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Video clip generation failed.");
    }
    throw error;
  }
}

/**
 * The mandatory Visual QC stage (CLAUDE.md's Content Bot Creative Quality
 * milestone) — a bounded, multimodal check of every real generated still
 * (thumbnail + per-beat images) against the plan's own intended
 * descriptions and visual identity, run BEFORE assembly. Persists a real
 * `qc_report` artifact on the version either way. At most
 * MAX_QC_REGENERATIONS_PER_VERSION real image regenerations are ever
 * triggered, and only the flagged assets are re-checked afterward — never
 * a loop, never a full re-check. If material problems remain unresolved
 * (either the recheck still fails, or more assets were flagged than the
 * cap allowed to regenerate), this returns a "flag" report and the caller
 * (runContentProductionPipeline) stops for founder review rather than
 * assembling known-bad assets — see VisualQCBlocked.
 */
async function runVisualQCStage(
  item: ContentItem,
  version: ContentVersion<ContentPlan>,
  ctx: AudienceContext,
  deps: ContentPipelineDeps,
): Promise<ContentVersion<ContentPlan>> {
  if (version.qc_report) return version; // already checked — resumed
  const plan = version.plan;
  if (!plan) throw new Error(`Content version ${version.id} has no plan yet — cannot run its visual QC.`);

  await assertStillGenerating(item.id);
  let stage = await getOpenStage(item.mission_id, "visual_qc", { contentVersionId: version.id });
  if (!stage) {
    stage = await startStage(item.mission_id, "visual_qc", "Checking generated visuals for quality problems.", {
      contentItemId: item.id,
      contentVersionId: version.id,
    });
  }

  const storage = deps.storage ?? getStorageProvider();
  const keys = storageKeysFor(item.id, version.id);

  async function readAssetBase64(storageKey: string, fallbackContentType: string): Promise<{ base64: string; contentType: string }> {
    const { stream, contentType } = await storage.open(storageKey);
    const bytes = await readAllBytes(stream);
    return { base64: Buffer.from(bytes).toString("base64"), contentType: contentType || fallbackContentType };
  }

  async function runOneCheck(inputs: VisualQCAssetInput[]): Promise<VisualQCReport> {
    const { report, usage } = await reviewVisualQuality(
      { plan: { visual_identity: plan!.visual_identity, disclosure: plan!.disclosure }, audience: ctx, assets: inputs },
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
    return report;
  }

  try {
    const existingAssets = await listContentAssets(version.id);
    // Same resolution runAssetGenerationStage already did for the initial
    // batch — a QC-triggered regeneration must stay conditioned on the
    // same reference, not silently fall back to unconditioned generation.
    const hasReference = existingAssets.some((a) => a.storage_key === keys.reference);
    const referenceImageUrl = hasReference ? await resolvePublicUrl(storage, keys.reference) : undefined;

    const qcInputs: VisualQCAssetInput[] = [];
    const thumbAsset = existingAssets.find((a) => a.storage_key === keys.thumbnail);
    if (thumbAsset) {
      const { base64, contentType } = await readAssetBase64(thumbAsset.storage_key, "image/jpeg");
      qcInputs.push({ assetRef: "thumbnail", description: plan.thumbnail_brief.prompt, contentType, base64, expectedProminence: "full" });
    }
    for (const beat of plan.script) {
      const asset = existingAssets.find((a) => a.storage_key === keys.image(beat.index));
      if (!asset) continue;
      const { base64, contentType } = await readAssetBase64(asset.storage_key, "image/jpeg");
      qcInputs.push({
        assetRef: `beat_${beat.index}`,
        description: beat.visual_direction,
        contentType,
        base64,
        expectedProminence: beatSubjectProminence(beat),
      });
    }

    if (qcInputs.length === 0) {
      // Nothing visual exists to check — should not happen once asset
      // generation has genuinely completed, but never block on an
      // impossible input.
      const passReport: VisualQCReport = { overall_verdict: "pass", findings: [] };
      const updated = (await updateContentVersion(version.id, { qc_report: passReport })) as ContentVersion<ContentPlan>;
      await completeStage(stage.id, "No visual assets to check.");
      return updated;
    }

    const report = await runOneCheck(qcInputs);
    // findings now holds only genuine problems (see VisualQCReportSchema's
    // own doc comment) — no per-item "pass" verdict to filter out.
    const flagged = report.findings;

    if (flagged.length === 0) {
      const updated = (await updateContentVersion(version.id, { qc_report: report })) as ContentVersion<ContentPlan>;
      await completeStage(stage.id, `All ${qcInputs.length} visual asset(s) passed.`);
      await recordActivity({
        missionId: item.mission_id,
        actor: "agent:content_bot",
        action: "visual_qc_passed",
        detail: `${qcInputs.length} asset(s) checked, no issues found.`,
      });
      return updated;
    }

    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "visual_qc_flagged",
      detail: `${flagged.length} asset(s) flagged: ${flagged
        .map((f) => `${f.asset_ref} (${f.issue_types.join(", ") || "unspecified"})`)
        .join("; ")}`,
    });

    // Bounded regeneration — never more than MAX_QC_REGENERATIONS_PER_VERSION
    // real image-provider calls total for this version, regardless of how
    // many assets were flagged (the founder's explicit "nine bad images
    // cannot create an uncontrolled retry fan-out" requirement).
    const remainingBudget = Math.max(MAX_QC_REGENERATIONS_PER_VERSION - version.qc_regeneration_count, 0);
    const toRegenerate = flagged.slice(0, remainingBudget);
    const skippedForCap = flagged.slice(toRegenerate.length);

    const regeneratedInputs: VisualQCAssetInput[] = [];
    let regenerationCount = version.qc_regeneration_count;

    for (const finding of toRegenerate) {
      await assertStillGenerating(item.id);
      const isThumbnail = finding.asset_ref === "thumbnail";
      const beat = isThumbnail ? null : plan.script.find((b) => `beat_${b.index}` === finding.asset_ref);
      if (!isThumbnail && !beat) continue; // an asset_ref the model invented — nothing real to regenerate

      const imageProvider = deps.media?.image ?? getImageProvider();
      const key = isThumbnail ? keys.thumbnail : keys.image(beat!.index);
      const basePrompt = isThumbnail ? plan.thumbnail_brief.prompt : beat!.visual_direction;
      // Thumbnail always regenerates as "full" (see runAssetGenerationStage's
      // own thumbnail request — unconditionally reference-conditioned);
      // a beat regenerates using its own declared prominence, exactly like
      // its initial generation did.
      const prominence: SubjectProminence = isThumbnail ? "full" : beatSubjectProminence(beat!);
      const reasonNote =
        finding.reasons.length > 0
          ? finding.reasons.join(" ")
          : `flagged for ${finding.issue_types.join(", ") || "a quality issue"}`;
      const prompt = `${promptForBeatProminence(basePrompt, plan.visual_identity, prominence)} A previous attempt at this exact shot was rejected by quality review: ${reasonNote} Produce a corrected image that avoids this problem.`;
      regenerationCount += 1;
      const req = {
        idempotencyKey: `${key}-qc-retry-${regenerationCount}`,
        audience: ctx,
        prompt,
        aspectRatio: plan.aspect_ratio,
        referenceImageUrl: referenceImageUrlForProminence(referenceImageUrl, prominence),
      };
      await assertItemBudgetRemaining(item.id, imageProvider.estimateUsd(req));
      const result = await imageProvider.generate(req);

      // Overwrites the SAME (provider, key) asset in place rather than
      // inserting a second row — the real `content_assets_provider_key_
      // unique` constraint means a second insert at this key would fail
      // outright, and this replaces a flagged asset that was never shown
      // to a founder as finished (the version hasn't reached
      // "awaiting_review" yet). Real cost is still recorded via the
      // ordinary, unaffected insert-only `costs` table regardless — see
      // updateContentAsset's own doc comment.
      const bytes = await readAllBytes(await result.open());
      const putResult = await storage.put(key, bytesToStream(bytes), result.contentType);
      const existingAsset = existingAssets.find((a) => a.storage_key === key);
      if (existingAsset) {
        await updateContentAsset(existingAsset.id, {
          content_type: putResult.contentType,
          byte_size: putResult.byteSize,
          checksum_sha256: putResult.checksumSha256,
          generator_provider: result.usage.provider,
          generator_model: result.usage.model,
          provider_asset_id: result.providerAssetId,
        });
      } else {
        // Shouldn't happen (QC only ever runs after asset_generation has
        // completed) — but never lose a real, already-spent asset.
        await recordContentAsset({
          contentVersionId: version.id,
          kind: isThumbnail ? "thumbnail" : "image",
          storageProvider: putResult.storageProvider,
          storageKey: putResult.storageKey,
          contentType: putResult.contentType,
          byteSize: putResult.byteSize,
          checksumSha256: putResult.checksumSha256,
          generatorProvider: result.usage.provider,
          generatorModel: result.usage.model,
          providerAssetId: result.providerAssetId,
        });
      }
      await recordCost({
        missionId: item.mission_id,
        agentId: item.agent_id,
        contentItemId: item.id,
        contentVersionId: version.id,
        model: result.usage.model,
        usdCost: result.usage.usdCost,
        provider: result.usage.provider,
        unit: result.usage.unit,
        quantity: result.usage.quantity,
      });

      const { base64, contentType } = await readAssetBase64(key, result.contentType);
      regeneratedInputs.push({ assetRef: finding.asset_ref, description: basePrompt, contentType, base64 });
    }

    if (regenerationCount !== version.qc_regeneration_count) {
      version = (await updateContentVersion(version.id, { qc_regeneration_count: regenerationCount })) as ContentVersion<ContentPlan>;
    }

    // Re-check ONLY the regenerated assets — never a full re-check, never a
    // loop. Since findings now holds only genuine problems, an asset that's
    // fixed simply won't appear in the recheck's findings at all — no merge
    // trick needed to "clear" it. The final unresolved set is exactly
    // whatever was never attempted (skippedForCap) plus whatever is still
    // genuinely broken after the one regeneration attempt.
    const stillFlagged = regeneratedInputs.length > 0 ? (await runOneCheck(regeneratedInputs)).findings : [];
    const finalFindings = [...skippedForCap, ...stillFlagged];
    const unresolved = finalFindings.length > 0;
    const finalReport: VisualQCReport = {
      overall_verdict: unresolved ? "flag" : "pass",
      findings: finalFindings,
    };

    const updated = (await updateContentVersion(version.id, { qc_report: finalReport })) as ContentVersion<ContentPlan>;

    if (unresolved) {
      const detail = `Unresolved after ${regeneratedInputs.length} regeneration(s): ${stillFlagged
        .map((f) => f.asset_ref)
        .join(", ") || "(none re-flagged)"}${
        skippedForCap.length > 0
          ? ` — ${skippedForCap.length} asset(s) left unregenerated (regeneration cap reached): ${skippedForCap.map((f) => f.asset_ref).join(", ")}.`
          : "."
      }`;
      await failStage(stage.id, detail);
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "visual_qc_unresolved",
        detail: `${detail} Stopping for founder review rather than assembling known-bad assets.`,
      });
    } else {
      await completeStage(stage.id, `Passed after ${regeneratedInputs.length} regeneration(s).`);
      await recordActivity({
        missionId: item.mission_id,
        actor: "agent:content_bot",
        action: "visual_qc_passed_after_regeneration",
        detail: `${regeneratedInputs.length} asset(s) regenerated and re-checked; all now pass.`,
      });
    }

    return updated;
  } catch (error) {
    if (error instanceof ContentBotError) {
      await recordTokenCostOnFailure(item, version.id, error.usage);
    }
    if (!(error instanceof ProductionMovedOn)) {
      await failStage(stage.id, error instanceof Error ? error.message : "Visual QC failed.");
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
    // Content Bot motion-first milestone: every beat's real generated
    // motion video clip is now the primary timeline asset — never a
    // static pan/zoom over its still (camera_movement/movement_intensity
    // are simply not read here any more; shotstackEdit.ts's buildTimeline
    // also refuses to apply an effect to a video clip regardless, as a
    // structural guarantee, not just because this call site omits it).
    // The clip's real requested length (beatClipDurationSeconds) is used
    // as its rendered timeline length, not the plan's original
    // end_seconds-start_seconds guess — it's what was actually generated.
    const resolvedTimeline = await Promise.all(
      orderedBeats.map(async (beat) => ({
        videoClipStorageKey: await resolvePublicUrl(storage, keys.videoClip(beat.index)),
        startSeconds: beat.start_seconds,
        endSeconds: beat.start_seconds + beatClipDurationSeconds(beat),
        cameraMovement: beat.camera_movement,
        movementIntensity: beat.movement_intensity,
        transitionIn: beat.transition_in,
      })),
    );

    const totalDuration = orderedBeats.length > 0 ? orderedBeats[orderedBeats.length - 1]!.end_seconds : plan.duration_seconds;
    const onScreenText: Array<{ text: string; startSeconds: number; endSeconds: number; style: "badge" | "end_card" }> = [];
    for (const beat of orderedBeats) {
      if (beat.on_screen_text) {
        onScreenText.push({
          text: beat.on_screen_text.text,
          startSeconds: beat.start_seconds,
          endSeconds: beat.end_seconds,
          style: "badge",
        });
      }
    }
    // Disclosure is ALWAYS rendered structurally here — never left to a
    // generated image to render (see ContentPlanSchema.disclosure's doc
    // comment for the real, observed failure this fixes: a garbled,
    // frame-dominating disclosure baked into an image by a text-to-image
    // model). Placement controls prominence, never whether it appears.
    if (plan.disclosure.placement === "persistent_badge") {
      onScreenText.push({ text: plan.disclosure.text, startSeconds: 0, endSeconds: totalDuration, style: "badge" });
    } else if (plan.disclosure.placement === "end_card") {
      const start = Math.max(totalDuration - 3, 0);
      onScreenText.push({ text: plan.disclosure.text, startSeconds: start, endSeconds: totalDuration, style: "end_card" });
    } else {
      const openEnd = Math.min(3, totalDuration);
      const endStart = Math.max(totalDuration - 3, openEnd);
      onScreenText.push({ text: plan.disclosure.text, startSeconds: 0, endSeconds: openEnd, style: "badge" });
      onScreenText.push({ text: plan.disclosure.text, startSeconds: endStart, endSeconds: totalDuration, style: "end_card" });
    }

    const req = {
      idempotencyKey: keys.video,
      audience: ctx,
      timeline: resolvedTimeline,
      voiceoverStorageKey: voiceoverUrl,
      captionStorageKey: captionUrl,
      aspectRatio: plan.aspect_ratio,
      onScreenText,
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
        failure_category: "budget_exhausted",
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
    version = await runCreativeStrategyStage(item, version, ctx, brief, deps);
    version = await runProductionPlanningStage(item, version, ctx, brief, deps);
    version = await runSafetyReviewStage(item, version, ctx, deps);

    const verdict = version.safety_verdict as SafetyVerdict | null;
    if (verdict?.verdict === "block") {
      throw new ContentSafetyBlocked(verdict.reasons);
    }

    version = await runReferenceGenerationStage(item, version, ctx, deps);
    await runAssetGenerationStage(item, version, ctx, deps);
    await runVideoClipGenerationStage(item, version, ctx, deps);
    version = await runVisualQCStage(item, version, ctx, deps);

    const qcReport = version.qc_report as VisualQCReport | null;
    if (qcReport?.overall_verdict === "flag") {
      throw new VisualQCBlocked(qcReport);
    }

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
    const isRefusal =
      error instanceof ContentGuardrailError ||
      error instanceof ContentSafetyBlocked ||
      error instanceof VisualQCBlocked ||
      error instanceof ReferenceQCBlocked;
    // Classified only for a genuine "failed" (technical) settlement — a
    // "blocked" (safety refusal) item never gets a failure_category at
    // all, since it's categorically not the kind of thing Retry Production
    // could ever apply to (see contentFailureClassification.ts).
    const failureCategory = isRefusal ? undefined : classifyProductionFailure(error);

    await updateContentVersion(version.id, {
      status: "failed",
      failure_reason: reason,
      completed_at: new Date().toISOString(),
    });
    const settlement = await transitionContentItemState(item.id, ["generating"], isRefusal ? "blocked" : "failed", {
      failure_reason: reason,
      ...(failureCategory !== undefined ? { failure_category: failureCategory } : {}),
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
