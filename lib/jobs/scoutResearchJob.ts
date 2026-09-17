import "server-only";
import { NonRetriableError } from "inngest";
import { inngest, MISSION_APPROVED_EVENT, MISSION_FOLLOWUP_NEEDED_EVENT } from "@/lib/inngest/client";
import { runScoutPipeline } from "@/lib/domain/missionWorkflow";

/**
 * The durable counterpart to the old inline "await Scout inside the HTTP
 * request" behavior. approveMission (lib/domain/missionWorkflow.ts) only
 * sends the `mission/approved` event and returns — this function is what
 * actually calls Scout and settles the mission, running outside any HTTP
 * request's time limit.
 *
 * Retries and idempotency, and why a low retry count is the right choice:
 * - `concurrency` limits execution to one run at a time per mission ID, so
 *   two triggers for the same mission (a duplicate/retried event, or a
 *   second approval that the atomic transition in approveMission didn't
 *   already reject) can never run runScoutPipeline concurrently.
 * - `retries: 1` exists specifically for true crash recovery — the
 *   process dying mid-run, which our own try/catch inside runScoutPipeline
 *   cannot handle because it never gets to run. runScoutPipeline is
 *   written to be resumable for exactly this case (see its doc comment):
 *   found already "researching," it resumes into the existing stage
 *   rather than erroring or duplicating rows.
 * - Ordinary application-level failures (bad JSON from Scout, a refusal,
 *   an API error) are NOT retried by Inngest at all — runScoutPipeline
 *   already catches those itself and settles the mission to "failed"
 *   without throwing, so there's nothing for Inngest to retry. Every
 *   error that DOES escape runScoutPipeline (mission not found, Scout not
 *   registered, or the queued→researching transition losing a race) is a
 *   data/config problem or a lost race, not a transient one — retrying
 *   won't fix it, so those are wrapped as NonRetriableError.
 * - A retried run may incur additional real Anthropic API cost. That's an
 *   accepted, bounded tradeoff (capped at one retry), not an oversight.
 *
 * Two triggers, one function: MISSION_APPROVED_EVENT starts the original
 * pass, MISSION_FOLLOWUP_NEEDED_EVENT starts the one automatic follow-up
 * pass (see missionWorkflow.ts's MAX_RESEARCH_PASSES) — both call the same
 * runScoutPipeline, which already branches on the mission's real current
 * state ("queued" vs "awaiting_evidence" vs "researching"-resume) rather
 * than on which event fired it. Deliberately not a second job file: the
 * concurrency key, retry policy, and NonRetriableError wrapping all need
 * to apply identically to either pass, so reusing the same function is
 * what keeps that guarantee from having to be maintained twice.
 */
export const scoutResearchJob = inngest.createFunction(
  {
    id: "scout-research",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.missionId" },
    triggers: [{ event: MISSION_APPROVED_EVENT }, { event: MISSION_FOLLOWUP_NEEDED_EVENT }],
  },
  async ({ event, step }) => {
    const { missionId } = event.data as { missionId: string };

    await step.run("run-scout-pipeline", async () => {
      try {
        return await runScoutPipeline(missionId);
      } catch (error) {
        throw new NonRetriableError(
          error instanceof Error ? error.message : "Scout research job failed unexpectedly.",
          { cause: error },
        );
      }
    });
  },
);
