import "server-only";
import type { Mission, MissionState, ScoutVerdict } from "@/lib/db/types";
import {
  createMission,
  getMission,
  updateMissionState,
  recordApproval,
  recordActivity,
  startStage,
  completeStage,
  failStage,
  assignAgent,
  getAgentByKey,
  recordEvidence,
  recordDeliverable,
  recordCost,
} from "@/lib/db/repositories";
import { validateMissionInput, type MissionInput } from "@/lib/domain/missionValidation";
import { assertTransition, isCancellable } from "@/lib/domain/missionStates";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import { calculateUsdCost } from "@/lib/agents/pricing";

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

  const mission = createMission({
    founderId: input.founderId,
    projectId: input.projectId,
    title: input.title.trim(),
    brief: input.brief.trim(),
  });

  assertTransition(mission.state, "awaiting_founder_approval");
  const submitted = updateMissionState(mission.id, "awaiting_founder_approval");
  recordActivity({
    missionId: mission.id,
    actor: `founder:${input.founderId}`,
    action: "submitted_for_approval",
  });

  if (!approvalGateEnabled()) {
    recordActivity({
      missionId: mission.id,
      actor: "system",
      action: "approval_gate_disabled",
      detail: "REQUIRE_FOUNDER_APPROVAL=false — auto-approving on the founder's behalf.",
    });
    return approveMission(mission.id, input.founderId, { auto: true });
  }

  return submitted;
}

/** The founders' approval gate. Nothing consequential runs before this. */
export async function approveMission(
  missionId: string,
  founderId: string,
  opts: { auto?: boolean } = {},
): Promise<Mission> {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);

  assertTransition(mission.state, "queued");
  recordApproval({
    missionId,
    founderId,
    decision: "approved",
    note: opts.auto ? "auto-approved (approval gate disabled)" : undefined,
  });
  updateMissionState(missionId, "queued");
  recordActivity({
    missionId,
    actor: opts.auto ? "system" : `founder:${founderId}`,
    action: "mission_approved",
  });

  // Dispatch synchronously (from the caller's perspective, awaited here) —
  // Scout's research is the only work this milestone performs, and
  // founders should see a real result rather than a fabricated
  // "in progress" state that outlives the actual work.
  return runScoutPipeline(missionId);
}

export function cancelMission(missionId: string, founderId: string, note?: string): Mission {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);
  if (!isCancellable(mission.state)) {
    throw new Error(`Mission ${missionId} cannot be cancelled from state "${mission.state}".`);
  }

  assertTransition(mission.state, "cancelled");
  recordApproval({ missionId, founderId, decision: "cancelled", note });
  const cancelled = updateMissionState(missionId, "cancelled");
  recordActivity({
    missionId,
    actor: `founder:${founderId}`,
    action: "mission_cancelled",
    detail: note,
  });
  return cancelled;
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

async function runScoutPipeline(missionId: string): Promise<Mission> {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);

  assertTransition(mission.state, "researching");
  updateMissionState(missionId, "researching");
  recordActivity({ missionId, actor: "system", action: "research_started" });

  const scout = getAgentByKey("scout");
  if (!scout) throw new Error("Scout agent is not registered — seed data is missing.");
  assignAgent(missionId, scout.id, "lead");

  const stage = startStage(missionId, "scout_research", "Scout is researching the opportunity.");

  try {
    const outcome = await runScoutResearch(mission);

    recordCost({
      missionId: mission.id,
      agentId: scout.id,
      model: outcome.usage.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      usdCost: outcome.usage.usdCost,
    });

    for (const item of outcome.evidence) {
      recordEvidence({ missionId: mission.id, ...item });
    }

    recordDeliverable({
      missionId: mission.id,
      agentId: scout.id,
      kind: "scout_research_report",
      content: outcome.report,
    });

    completeStage(stage.id, `Verdict: ${outcome.report.verdict}`);

    const nextState = nextStateForVerdict(outcome.report.verdict);
    assertTransition("researching", nextState);
    const updated = updateMissionState(mission.id, nextState, {
      interpreted_mission: outcome.report.interpreted_mission,
      final_status: outcome.report.verdict,
    });

    recordActivity({
      missionId: mission.id,
      actor: "agent:scout",
      action: "research_completed",
      detail: `Verdict: ${outcome.report.verdict}`,
    });

    return updated;
  } catch (error) {
    if (error instanceof ScoutResearchError && error.usage.inputTokens + error.usage.outputTokens > 0) {
      recordCost({
        missionId: mission.id,
        agentId: scout.id,
        model: error.usage.model,
        inputTokens: error.usage.inputTokens,
        outputTokens: error.usage.outputTokens,
        usdCost: calculateUsdCost(error.usage.model, {
          input_tokens: error.usage.inputTokens,
          output_tokens: error.usage.outputTokens,
        }),
      });
    }

    const reason = error instanceof Error ? error.message : "Unknown error during research.";
    failStage(stage.id, reason);
    assertTransition("researching", "failed");
    const failed = updateMissionState(mission.id, "failed", { failure_reason: reason });
    recordActivity({
      missionId: mission.id,
      actor: "system",
      action: "research_failed",
      detail: reason,
    });
    return failed;
  }
}
