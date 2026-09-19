import "server-only";
import type { Mission, MissionStage, MissionState, ScoutVerdict, WorkspaceType } from "@/lib/db/types";
import type { ScoutReport } from "@/lib/agents/scout/schema";
import type { ScoutFollowupContext } from "@/lib/agents/scout/prompt";
import {
  createMission,
  getMission,
  getProject,
  transitionMissionState,
  recordApproval,
  recordActivity,
  startStage,
  getOpenStage,
  completeStage,
  failStage,
  assignAgent,
  hasAssignment,
  getAgentByKey,
  recordEvidence,
  recordDeliverable,
  listDeliverables,
  recordCost,
  listContentItemsForMissions,
  transitionContentItemState,
} from "@/lib/db/repositories";
import { validateMissionInput, type MissionInput } from "@/lib/domain/missionValidation";
import { assertTransition, isCancellable, MissionConcurrencyError } from "@/lib/domain/missionStates";
import { isContentItemCancellable } from "@/lib/domain/contentItemStates";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { inngest, MISSION_APPROVED_EVENT, MISSION_FOLLOWUP_NEEDED_EVENT } from "@/lib/inngest/client";

// The one and only cap on automatic Scout research: a mission whose first
// pass comes back "investigate_further" gets exactly one automatic,
// targeted follow-up pass — never more. Deliberately a version-controlled
// constant, not an env var: REQUIRE_FOUNDER_APPROVAL is a safety/consent
// toggle a deployment might legitimately flip; this is a cost/quality
// tuning knob that should go through code review, not a silent env change.
// Enforced in three independent layers (see nextStateForVerdict, the
// awaiting_evidence branch of runScoutPipeline, and the Inngest
// concurrency key on scoutResearchJob.ts) — never trust a single code
// path with real, uncapped model spend.
export const MAX_RESEARCH_PASSES = 2;

export class MissionValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "MissionValidationError";
  }
}

/**
 * A content item's "publishing" state deliberately has no "cancelled" edge
 * (see contentItemStates.ts — once bytes are genuinely moving toward a
 * platform, "cancelled" would be a lie). This is unreachable in C1 (no
 * publish route exists yet — see CLAUDE.md's Content Bot milestone, C1
 * ends at "ready_to_publish"), but the guard is real and forward-looking:
 * a mission must never be cancellable out from under a content item that's
 * actively publishing, whatever the mission's own state allows.
 */
export class MissionCancellationBlockedError extends Error {
  constructor(missionId: string) {
    super(`Mission ${missionId} cannot be cancelled while its content item is actively publishing.`);
    this.name = "MissionCancellationBlockedError";
  }
}

function approvalGateEnabled(): boolean {
  return process.env.REQUIRE_FOUNDER_APPROVAL !== "false";
}

/** Create a mission from the founders' desk and move it to the first real gate. */
export async function createAndSubmitMission(
  input: MissionInput & { founderId: string; projectId: string | null },
): Promise<Mission> {
  const validation = validateMissionInput(input);
  if (!validation.valid) {
    throw new MissionValidationError(validation.errors);
  }

  const mission = await createMission({
    founderId: input.founderId,
    projectId: input.projectId,
    title: input.title.trim(),
    brief: input.brief.trim(),
  });

  assertTransition(mission.state, "awaiting_founder_approval");
  const submission = await transitionMissionState(mission.id, [mission.state], "awaiting_founder_approval");
  if (!submission.ok) {
    throw new MissionConcurrencyError(
      mission.id,
      [mission.state],
      "awaiting_founder_approval",
      submission.mission.state,
    );
  }
  await recordActivity({
    missionId: mission.id,
    actor: `founder:${input.founderId}`,
    action: "submitted_for_approval",
  });

  if (!approvalGateEnabled()) {
    await recordActivity({
      missionId: mission.id,
      actor: "system",
      action: "approval_gate_disabled",
      detail: "REQUIRE_FOUNDER_APPROVAL=false — auto-approving on the founder's behalf.",
    });
    return approveMission(mission.id, input.founderId, { auto: true });
  }

  return submission.mission;
}

/**
 * The founders' approval gate. Nothing consequential runs before this.
 *
 * Idempotent by design: a mission can only ever be dispatched once, but a
 * second *observed* approval/dispatch attempt — a double-click, two tabs, a
 * retried request, a duplicate webhook — must not error, must not touch the
 * ledger or dispatch Scout again, and must not depend on exact timing to
 * behave correctly. Two paths both resolve to the same outcome:
 *  - The read at the top already shows "queued": someone else's approval
 *    already completed before this call even started. Return the mission
 *    as-is — no transition attempted, nothing re-recorded, nothing re-sent.
 *  - The read still shows the pre-approval state, but the atomic transition
 *    below loses a genuine race (another request's write landed first). If
 *    the mission's real state is now "queued", that's the same successful
 *    outcome this call was trying to reach — return it. Only a state that
 *    isn't "queued" (e.g. cancelled out from under us) is a genuine
 *    conflict, which still throws MissionConcurrencyError.
 * Either way, Scout is dispatched and the ledger is charged at most once
 * per mission — see the bounded regression test in missionWorkflow.test.ts
 * covering exactly the "observed already queued" case (the one that
 * originally surfaced as "Cannot move a mission from queued to queued").
 *
 * This function returns as soon as the mission is queued and the research
 * job has been dispatched — it does NOT wait for Scout to finish. The
 * actual research runs in a durable Inngest function (see
 * lib/jobs/scoutResearchJob.ts), which is what lets this call return
 * immediately instead of blocking the HTTP request for the duration of a
 * real research pass.
 */
export async function approveMission(
  missionId: string,
  founderId: string,
  opts: { auto?: boolean } = {},
): Promise<Mission> {
  const mission = await getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);

  // Idempotent no-op: this mission was already approved and dispatched by
  // an earlier call (a delayed retry, a duplicate webhook, or a stale
  // double-click landing after the first request already completed). The
  // real approval, ledger charge, and dispatch already happened exactly
  // once; re-running any of that here would be the actual bug, and
  // `assertTransition` has no legal "queued" -> "queued" move to even
  // attempt, so it would just throw a confusing IllegalMissionTransitionError
  // instead of recognizing this as success.
  if (mission.state === "queued") {
    return mission;
  }

  assertTransition(mission.state, "queued");
  const transition = await transitionMissionState(missionId, [mission.state], "queued");
  if (!transition.ok) {
    // The mission moved on between our read and our write. If it's now
    // "queued", a genuinely concurrent approval won that race and already
    // did everything this call would have done — same idempotent no-op as
    // above, not an error. Any other actual state (e.g. cancelled out from
    // under us) is still a real conflict worth surfacing.
    if (transition.mission.state === "queued") {
      return transition.mission;
    }
    throw new MissionConcurrencyError(missionId, [mission.state], "queued", transition.mission.state);
  }

  await recordApproval({
    missionId,
    founderId,
    decision: "approved",
    note: opts.auto ? "auto-approved (approval gate disabled)" : undefined,
  });
  await recordActivity({
    missionId,
    actor: opts.auto ? "system" : `founder:${founderId}`,
    action: "mission_approved",
  });

  // A deterministic event id means Inngest itself de-duplicates a literal
  // retried/duplicate send for the same mission — on top of (not instead
  // of) the atomic transition above and the function's own concurrency
  // key (see scoutResearchJob.ts), which together are what actually
  // prevent duplicate research runs and duplicate ledger charges.
  await inngest.send({
    id: `mission-approved-${missionId}`,
    name: MISSION_APPROVED_EVENT,
    data: { missionId },
  });

  return transition.mission;
}

/**
 * Cancel a mission. Same atomic-transition guarantee as approval: if the
 * mission has already moved past a cancellable state (or another request
 * already cancelled it), this throws rather than silently no-op-ing or
 * double-recording the cancellation.
 */
export async function cancelMission(missionId: string, founderId: string, note?: string): Promise<Mission> {
  const mission = await getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);
  if (!isCancellable(mission.state)) {
    throw new Error(`Mission ${missionId} cannot be cancelled from state "${mission.state}".`);
  }

  const contentItems = await listContentItemsForMissions([missionId]);
  if (contentItems.some((item) => item.state === "publishing")) {
    throw new MissionCancellationBlockedError(missionId);
  }

  const transition = await transitionMissionState(missionId, [mission.state], "cancelled");
  if (!transition.ok) {
    throw new MissionConcurrencyError(missionId, [mission.state], "cancelled", transition.mission.state);
  }

  await recordApproval({ missionId, founderId, decision: "cancelled", note });
  await recordActivity({
    missionId,
    actor: `founder:${founderId}`,
    action: "mission_cancelled",
    detail: note,
  });

  // Cascade to any still-active content item — without this, Content Bot's
  // pipeline (which only ever checks content_items.state, never
  // missions.state, for its own reality re-checks) would have no way to
  // learn the founder cancelled and would keep spending on real provider
  // calls. Best-effort: a content item that's already terminal is left
  // alone, and one that's genuinely "publishing" can't exist here since the
  // MissionCancellationBlockedError check above already refused this call.
  for (const item of contentItems) {
    if (!isContentItemCancellable(item.state)) continue;
    const itemTransition = await transitionContentItemState(item.id, [item.state], "cancelled", {
      failure_reason: "The mission was cancelled while production was still in flight.",
    });
    if (itemTransition.ok) {
      await recordActivity({
        missionId,
        actor: `founder:${founderId}`,
        action: "production_cancelled",
        detail: "Cancelled along with the mission.",
      });
    }
  }

  return transition.mission;
}

/**
 * Layer 1 of the research-pass cap: once a mission has already had
 * MAX_RESEARCH_PASSES real passes, "investigate_further" can no longer
 * route to "awaiting_evidence" (which is what triggers another automatic
 * pass) — it routes straight to "ready_for_founders_review" instead. The
 * mission's real final_status/verdict is still recorded as
 * "investigate_further" by the caller (never silently upgraded to look
 * resolved); this only decides which *state* it settles into. A founder
 * remains the only path forward from there, same as any other
 * ready_for_founders_review mission — see MissionDetail.tsx for how that
 * genuine distinction is surfaced without a separate mission state.
 */
function nextStateForVerdict(verdict: ScoutVerdict, passCount: number): MissionState {
  switch (verdict) {
    case "ready_for_founders_review":
      return "ready_for_founders_review";
    case "reject":
      return "rejected";
    case "investigate_further":
      return passCount >= MAX_RESEARCH_PASSES ? "ready_for_founders_review" : "awaiting_evidence";
  }
}

/**
 * A mission's workspace is derived from its project, not stored on the
 * mission itself — a mission with no project (or whose project somehow no
 * longer exists) defaults to "commerce", the workspace type that existed
 * before workspaces did. This is the only place that resolution happens,
 * so Scout is never dispatched without knowing which report shape to use.
 */
async function resolveWorkspaceType(mission: Mission): Promise<WorkspaceType> {
  if (!mission.project_id) return "commerce";
  const project = await getProject(mission.project_id);
  return project?.workspace_type ?? "commerce";
}

/**
 * Runs Scout's research and settles the mission. Called from the Inngest
 * job (lib/jobs/scoutResearchJob.ts), not directly from an HTTP request —
 * see approveMission, which only dispatches the event.
 *
 * Resumable by design: a durable-execution retry can call this again for
 * a mission that's already "researching" (its own earlier attempt got far
 * enough to make that transition but didn't finish, e.g. the process was
 * killed mid-run). In that case this resumes into the existing stage/
 * assignment rows instead of duplicating them, and calls Scout again —
 * Inngest's retry count is kept low (see scoutResearchJob.ts) specifically
 * because this is a real, accepted tradeoff: a retried run may incur
 * additional real API cost, documented rather than hidden.
 */
export async function runScoutPipeline(missionId: string): Promise<Mission> {
  let mission = await getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);

  const scout = await getAgentByKey("scout");
  if (!scout) throw new Error("Scout agent is not registered — seed data is missing.");

  let stage: MissionStage;

  if (mission.state === "queued") {
    assertTransition(mission.state, "researching");
    const started = await transitionMissionState(missionId, [mission.state], "researching", {
      research_pass_count: 1,
    });
    if (!started.ok) {
      throw new MissionConcurrencyError(missionId, [mission.state], "researching", started.mission.state);
    }
    mission = started.mission;
    await recordActivity({ missionId, actor: "system", action: "research_started" });
    await assignAgent(missionId, scout.id, "lead");
    stage = await startStage(missionId, "scout_research", "Scout is researching the opportunity.");
  } else if (mission.state === "awaiting_evidence") {
    // Layer 2 of the research-pass cap: a hard backstop against real spend,
    // independent of nextStateForVerdict (layer 1). Should be structurally
    // unreachable — nextStateForVerdict never routes a mission back into
    // "awaiting_evidence" once it's already had MAX_RESEARCH_PASSES real
    // passes — but this is exactly the kind of thing not to trust a single
    // code path with (see guardrails.ts's guarantee-language check for the
    // same "the prompt already says this, check it in code too" instinct).
    if (mission.research_pass_count >= MAX_RESEARCH_PASSES) {
      await recordActivity({
        missionId,
        actor: "system",
        action: "followup_skipped_pass_cap",
        detail: `Mission already had ${mission.research_pass_count} research pass(es) (cap: ${MAX_RESEARCH_PASSES}) — refusing to dispatch another automated pass.`,
      });
      return mission;
    }
    assertTransition(mission.state, "researching");
    const started = await transitionMissionState(missionId, [mission.state], "researching", {
      research_pass_count: mission.research_pass_count + 1,
    });
    if (!started.ok) {
      throw new MissionConcurrencyError(missionId, [mission.state], "researching", started.mission.state);
    }
    mission = started.mission;
    await recordActivity({
      missionId,
      actor: "system",
      action: "followup_research_started",
      detail: `Pass ${mission.research_pass_count} of ${MAX_RESEARCH_PASSES} — targeted follow-up to resolve the evidence gaps from pass 1.`,
    });
    if (!(await hasAssignment(missionId, scout.id))) {
      await assignAgent(missionId, scout.id, "lead");
    }
    stage = await startStage(
      missionId,
      "scout_followup_research",
      "Scout is doing a targeted follow-up pass to resolve the evidence gaps from pass 1.",
    );
  } else if (mission.state === "researching") {
    // Resuming after a crash mid-run. research_pass_count already tells us
    // definitively which pass was in flight (set atomically by whichever
    // branch above started it), so the correct stage name to resume into
    // is derived from it rather than assumed — a crashed pass 2 must
    // resume into "scout_followup_research", not duplicate "scout_research".
    const stageName = mission.research_pass_count >= 2 ? "scout_followup_research" : "scout_research";
    const existingStage = await getOpenStage(missionId, stageName);
    stage =
      existingStage ??
      (await startStage(missionId, stageName, "Resumed after an earlier attempt did not finish."));
    if (!(await hasAssignment(missionId, scout.id))) {
      await assignAgent(missionId, scout.id, "lead");
    }
  } else {
    // The mission moved on (most likely cancelled) before this run ever
    // got to start real work — nothing to do, and nothing was spent.
    await recordActivity({
      missionId,
      actor: "system",
      action: "research_skipped",
      detail: `Mission was "${mission.state}", not queued, awaiting_evidence, or researching, when the research job ran — skipped.`,
    });
    return mission;
  }

  try {
    const workspaceType = await resolveWorkspaceType(mission);
    const isFollowupPass = mission.research_pass_count >= 2;

    let followupContext: ScoutFollowupContext | undefined;
    if (isFollowupPass) {
      const priorReport = (
        await listDeliverables(missionId)
      ).find((d) => d.kind === "scout_research_report")?.content as ScoutReport | undefined;
      if (!priorReport) {
        throw new Error(
          `Mission ${missionId} is on research pass ${mission.research_pass_count} but has no original scout_research_report deliverable to build a follow-up from.`,
        );
      }
      followupContext = {
        passNumber: mission.research_pass_count,
        maxPasses: MAX_RESEARCH_PASSES,
        priorVerdictRationale: priorReport.verdict_rationale,
        unresolvedQuestions: priorReport.unresolved_questions,
        priorVerifiedFacts: priorReport.verified_facts,
        priorSources: priorReport.sources.map((s) => ({ url: s.url, title: s.title })),
      };
    }

    const outcome = await runScoutResearch(mission, { workspaceType, followupContext });

    // Re-check reality right before settling — the mission may have been
    // cancelled (or otherwise moved) while that call was in flight. The
    // WHERE clause inside transitionMissionState is what actually performs
    // this check; there is no separate read-then-write gap for a race to
    // land in.
    const nextState = nextStateForVerdict(outcome.report.verdict, mission.research_pass_count);
    const settlement = await transitionMissionState(mission.id, ["researching"], nextState, {
      interpreted_mission: outcome.report.interpreted_mission,
      final_status: outcome.report.verdict,
    });

    // The API cost was genuinely incurred either way — record it
    // regardless of whether the mission was still around to receive the
    // verdict.
    await recordCost({
      missionId: mission.id,
      agentId: scout.id,
      model: outcome.usage.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      usdCost: outcome.usage.usdCost,
    });

    if (!settlement.ok) {
      // The mission is no longer "researching" — almost certainly cancelled
      // by a founder while Scout was still working. Its current state is
      // the founder's decision; it must never be revived or overwritten
      // with a verdict it never asked to receive. The report itself is
      // discarded (not stored as evidence/deliverables) so nothing about
      // the mission's visible content looks like it kept progressing.
      await completeStage(
        stage.id,
        `Research completed, but the mission was already "${settlement.mission.state}" — verdict discarded, cost still recorded.`,
      );
      await recordActivity({
        missionId: mission.id,
        actor: "system",
        action: "research_discarded_after_state_change",
        detail: `Mission was "${settlement.mission.state}" by the time Scout's research finished; its verdict (${outcome.report.verdict}) was not applied, but the ${outcome.usage.usdCost.toFixed(4)} USD cost was recorded.`,
      });
      return settlement.mission;
    }

    for (const item of outcome.evidence) {
      await recordEvidence({ missionId: mission.id, ...item });
    }

    // Pass 1's report keeps its original kind forever — never overwritten,
    // never reused for pass 2. Pass 2 gets its own distinct kind, so both
    // are preserved as separate rows a founder can review side by side
    // (see missionDetail.ts / MissionDetail.tsx).
    await recordDeliverable({
      missionId: mission.id,
      agentId: scout.id,
      kind: isFollowupPass ? "scout_followup_report" : "scout_research_report",
      content: outcome.report,
    });

    await completeStage(stage.id, `Pass ${mission.research_pass_count} verdict: ${outcome.report.verdict}`);
    await recordActivity({
      missionId: mission.id,
      actor: "agent:scout",
      action: "research_completed",
      detail: `Pass ${mission.research_pass_count} verdict: ${outcome.report.verdict}`,
    });

    if (settlement.mission.state === "awaiting_evidence") {
      // Automatic dispatch of the one allowed follow-up pass — mirrors
      // approveMission's "send the event, don't wait" pattern exactly.
      // A failure here must never undo or corrupt the settlement above,
      // which already committed successfully — see the self-healing
      // watchdog (stuckMissionWatchdog.ts) for how a failed send here
      // gets retried rather than leaving the mission stranded.
      try {
        await inngest.send({
          id: `mission-followup-${mission.id}`,
          name: MISSION_FOLLOWUP_NEEDED_EVENT,
          data: { missionId: mission.id },
        });
      } catch (sendError) {
        await recordActivity({
          missionId: mission.id,
          actor: "system",
          action: "followup_dispatch_failed",
          detail: `Could not send the automatic follow-up dispatch event: ${
            sendError instanceof Error ? sendError.message : "unknown error"
          }. The mission remains correctly settled at "awaiting_evidence" — the self-healing watchdog will retry the dispatch.`,
        });
      }
    }

    return settlement.mission;
  } catch (error) {
    // Pricing/cost-calculation problems must never prevent settlement —
    // preserve the original failure reason regardless of whether we can
    // also price the tokens that were spent.
    const usage = error instanceof ScoutResearchError ? error.usage : null;
    if (usage && usage.inputTokens + usage.outputTokens > 0) {
      let usdCost: number | null;
      try {
        usdCost = calculateUsdCost(usage.model, {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        });
      } catch (pricingError) {
        console.error(
          `Could not price ${usage.inputTokens} in / ${usage.outputTokens} out tokens for model "${usage.model}" — recording the token usage with no dollar amount rather than inventing one.`,
          pricingError,
        );
        usdCost = null;
      }
      await recordCost({
        missionId: mission.id,
        agentId: scout.id,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        usdCost,
      });
    }

    const reason = error instanceof Error ? error.message : "Unknown error during research.";
    const settlement = await transitionMissionState(mission.id, ["researching"], "failed", {
      failure_reason: reason,
    });

    if (!settlement.ok) {
      // Same non-overwrite guarantee as the success path: if the mission
      // moved on (e.g. cancelled) while research was failing in the
      // background, leave it exactly where the founder put it.
      await failStage(
        stage.id,
        `${reason} (mission was already "${settlement.mission.state}" — left unchanged)`,
      );
      await recordActivity({
        missionId: mission.id,
        actor: "system",
        action: "research_discarded_after_state_change",
        detail: `Research failed (${reason}), but the mission was already "${settlement.mission.state}" — its state was not overwritten.`,
      });
      return settlement.mission;
    }

    await failStage(stage.id, reason);
    await recordActivity({
      missionId: mission.id,
      actor: "system",
      action: "research_failed",
      detail: reason,
    });
    return settlement.mission;
  }
}
