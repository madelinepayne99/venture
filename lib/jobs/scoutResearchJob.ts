import "server-only";
import { NonRetriableError } from "inngest";
import { inngest, MISSION_APPROVED_EVENT } from "@/lib/inngest/client";
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
 */
export const scoutResearchJob = inngest.createFunction(
  {
    id: "scout-research",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.missionId" },
    triggers: [{ event: MISSION_APPROVED_EVENT }],
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
