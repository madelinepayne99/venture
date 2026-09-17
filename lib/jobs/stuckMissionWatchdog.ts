import "server-only";
import { inngest, MISSION_FOLLOWUP_NEEDED_EVENT } from "@/lib/inngest/client";
import { MAX_RESEARCH_PASSES } from "@/lib/domain/missionWorkflow";
import {
  listStaleResearchingMissions,
  listStaleAwaitingEvidenceMissions,
  transitionMissionState,
  failStage,
  recordActivity,
} from "@/lib/db/repositories";

// If a mission has been "researching" for this long with no progress, the
// job that was supposed to be working on it is presumed crashed or lost
// (e.g. it died between retries, or its event never reached Inngest at
// all). Rather than leaving the mission invisible in limbo forever, this
// reaps it into an honestly-labeled "failed" state a founder can see and
// act on (a new mission can always be created).
const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * The actual reaping logic, separate from the Inngest function definition
 * below so it's directly unit-testable without Inngest's runtime — the
 * same split used for scoutResearchJob.ts / runScoutPipeline.
 */
export async function reapStaleResearchingMissions(now: Date = new Date()): Promise<{ reaped: number }> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const stale = await listStaleResearchingMissions(cutoff);

  let reaped = 0;
  for (const { mission, stage } of stale) {
    const settlement = await transitionMissionState(mission.id, ["researching"], "failed", {
      failure_reason:
        "Research timed out — no progress for over 10 minutes, which usually means the background job crashed or was lost. The mission was not silently left in limbo; a new mission can be created to retry.",
    });
    if (!settlement.ok) continue; // it moved on (e.g. cancelled) between the query and this write — leave it alone

    await failStage(stage.id, "Reaped by the stuck-mission watchdog after 10 minutes with no progress.");
    await recordActivity({
      missionId: mission.id,
      actor: "system",
      action: "research_failed",
      detail: "Reaped by the stuck-mission watchdog — no progress for over 10 minutes.",
    });
    reaped += 1;
  }

  return { reaped };
}

export const stuckMissionWatchdog = inngest.createFunction(
  { id: "stuck-mission-watchdog", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    return step.run("reap-stale-missions", () => reapStaleResearchingMissions());
  },
);

// A mission that just settled into "awaiting_evidence" should have its one
// automatic follow-up pass dispatched near-instantly (see runScoutPipeline's
// success path). Sitting here past this threshold means that dispatch send
// genuinely failed (see the followup_dispatch_failed activity entry it
// records) — no real research work was lost, the mission just needs the
// same event sent again. Much shorter than STALE_AFTER_MS above on purpose:
// a healthy dispatch is fast, so there's no reason to wait 10 minutes to
// notice one didn't happen.
const AWAITING_EVIDENCE_STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * The actual self-healing logic, separate from the Inngest function
 * definition below for the same unit-testability reason as
 * reapStaleResearchingMissions. Re-sending is safe and idempotent: the
 * deterministic event id (mission-followup-<missionId>, the same one the
 * original send used) means Inngest itself dedupes a genuine duplicate,
 * and the atomic awaiting_evidence -> researching transition in
 * runScoutPipeline means even a duplicate delivery can only ever start
 * pass 2 once — never a second real Scout call, never a second charge.
 */
export async function resendStaleFollowupDispatches(now: Date = new Date()): Promise<{ resent: number }> {
  const cutoff = new Date(now.getTime() - AWAITING_EVIDENCE_STALE_AFTER_MS);
  const stale = await listStaleAwaitingEvidenceMissions(cutoff);

  let resent = 0;
  for (const mission of stale) {
    // Belt-and-suspenders: a mission at the pass cap should never legally
    // be sitting in "awaiting_evidence" in the first place (see
    // nextStateForVerdict), but this watchdog must never be the thing that
    // dispatches a pass beyond the cap if that invariant is ever violated.
    if (mission.research_pass_count >= MAX_RESEARCH_PASSES) continue;

    try {
      await inngest.send({
        id: `mission-followup-${mission.id}`,
        name: MISSION_FOLLOWUP_NEEDED_EVENT,
        data: { missionId: mission.id },
      });
      await recordActivity({
        missionId: mission.id,
        actor: "system",
        action: "followup_dispatch_resent",
        detail:
          "Re-sent the follow-up dispatch event after the mission sat in awaiting_evidence longer than expected — the original send likely failed.",
      });
      resent += 1;
    } catch {
      // Still failing — leave it for the next sweep rather than letting
      // one mission's send failure abort the rest of this run's.
    }
  }

  return { resent };
}

export const followupDispatchWatchdog = inngest.createFunction(
  { id: "followup-dispatch-watchdog", triggers: [{ cron: "*/1 * * * *" }] },
  async ({ step }) => {
    return step.run("resend-stale-followup-dispatches", () => resendStaleFollowupDispatches());
  },
);
