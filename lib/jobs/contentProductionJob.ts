import "server-only";
import { NonRetriableError } from "inngest";
import {
  inngest,
  CONTENT_PRODUCTION_REQUESTED_EVENT,
  CONTENT_REVISION_REQUESTED_EVENT,
} from "@/lib/inngest/client";
import { runContentProductionPipeline } from "@/lib/domain/contentWorkflow";

/**
 * The durable counterpart to "await Content Bot inside the HTTP request" —
 * approveForProduction (and, in Phase 6, requestContentRevision) only send
 * an event and return; this function is what actually runs Content Bot's
 * five-stage pipeline, outside any HTTP request's time limit. Mirrors
 * scoutResearchJob.ts's shape exactly, including why the retry count is
 * low: `concurrency` limits execution to one run at a time per content
 * item ID, so two triggers for the same item can never run
 * runContentProductionPipeline concurrently, and `retries: 1` exists only
 * for true crash recovery (the process dying mid-run) — runContentProductionPipeline
 * is written to be resumable for exactly that case. Ordinary
 * application-level failures (a refusal, a provider error, a guardrail
 * rejection) are NOT retried by Inngest at all — the pipeline already
 * catches those itself and settles the item to "failed"/"blocked" without
 * throwing, so there is nothing for Inngest to retry. A retried run may
 * incur additional real provider cost — an accepted, bounded (capped at
 * one retry) tradeoff, same as Scout's.
 *
 * Two triggers, one function: CONTENT_PRODUCTION_REQUESTED_EVENT starts the
 * first version, CONTENT_REVISION_REQUESTED_EVENT starts a revision — both
 * call the same runContentProductionPipeline, which already branches on
 * the item's real current state ("planning" vs "revision_requested" vs
 * "generating"-resume) rather than on which event fired it.
 */
export const contentProductionJob = inngest.createFunction(
  {
    id: "content-production",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.contentItemId" },
    triggers: [{ event: CONTENT_PRODUCTION_REQUESTED_EVENT }, { event: CONTENT_REVISION_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const { contentItemId } = event.data as { contentItemId: string };

    await step.run("run-content-production-pipeline", async () => {
      try {
        return await runContentProductionPipeline(contentItemId);
      } catch (error) {
        throw new NonRetriableError(
          error instanceof Error ? error.message : "Content production job failed unexpectedly.",
          { cause: error },
        );
      }
    });
  },
);
