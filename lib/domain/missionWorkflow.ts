import "server-only";
import type { Mission, MissionStage, MissionState, ScoutVerdict, WorkspaceType } from "@/lib/db/types";
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
  recordCost,
} from "@/lib/db/repositories";
import { validateMissionInput, type MissionInput } from "@/lib/domain/missionValidation";
import { assertTransition, isCancellable, MissionConcurrencyError } from "@/lib/domain/missionStates";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import { calculateUsdCost } from "@/lib/agents/pricing";
import { inngest, MISSION_APPROVED_EVENT } from "@/lib/inngest/client";

export class MissionValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "MissionValidationError";
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
 * The transition to "queued" is a single atomic conditional update — if two
 * requests both try to approve the same mission (a double-click, two tabs,
 * a retried request), only the first one to reach the database wins; the
 * second sees ok:false and throws instead of ever dispatching Scout a
 * second time.
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

  assertTransition(mission.state, "queued");
  const transition = await transitionMissionState(missionId, [mission.state], "queued");
  if (!transition.ok) {
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
  return transition.mission;
}

function nextStateForVerdict(verdict: ScoutVerdict): MissionState {
  switch (verdict) {
    case "ready_for_founders_review":
      return "ready_for_founders_review";
    case "investigate_further":
      return "awaiting_evidence";
    case "reject":
      return "rejected";
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
    const started = await transitionMissionState(missionId, [mission.state], "researching");
    if (!started.ok) {
      throw new MissionConcurrencyError(missionId, [mission.state], "researching", started.mission.state);
    }
    mission = started.mission;
    await recordActivity({ missionId, actor: "system", action: "research_started" });
    await assignAgent(missionId, scout.id, "lead");
    stage = await startStage(missionId, "scout_research", "Scout is researching the opportunity.");
  } else if (mission.state === "researching") {
    const existingStage = await getOpenStage(missionId, "scout_research");
    stage =
      existingStage ??
      (await startStage(missionId, "scout_research", "Resumed after an earlier attempt did not finish."));
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
      detail: `Mission was "${mission.state}", not queued or researching, when the research job ran — skipped.`,
    });
    return mission;
  }

  try {
    const workspaceType = await resolveWorkspaceType(mission);
    const outcome = await runScoutResearch(mission, { workspaceType });

    // Re-check reality right before settling — the mission may have been
    // cancelled (or otherwise moved) while that call was in flight. The
    // WHERE clause inside transitionMissionState is what actually performs
    // this check; there is no separate read-then-write gap for a race to
    // land in.
    const nextState = nextStateForVerdict(outcome.report.verdict);
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

    await recordDeliverable({
      missionId: mission.id,
      agentId: scout.id,
      kind: "scout_research_report",
      content: outcome.report,
    });

    await completeStage(stage.id, `Verdict: ${outcome.report.verdict}`);
    await recordActivity({
      missionId: mission.id,
      actor: "agent:scout",
      action: "research_completed",
      detail: `Verdict: ${outcome.report.verdict}`,
    });

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
