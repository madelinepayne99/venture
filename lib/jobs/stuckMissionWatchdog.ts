import "server-only";
import { inngest } from "@/lib/inngest/client";
import {
  listStaleResearchingMissions,
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
