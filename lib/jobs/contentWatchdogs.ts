import "server-only";
import { inngest, CONTENT_REVISION_REQUESTED_EVENT } from "@/lib/inngest/client";
import {
  listStaleGeneratingItems,
  listStaleRevisionRequestedItems,
  listApprovalsForContentItem,
  transitionContentItemState,
  updateContentVersion,
  getOpenVersion,
  failStage,
  recordActivity,
} from "@/lib/db/repositories";

// Mirrors stuckMissionWatchdog.ts's reasoning exactly, applied to content
// items: if an item has been "planning"/"generating" this long with no
// progress, the job that was supposed to be working on it is presumed
// crashed or lost. Rather than leaving it invisible in limbo forever
// (there's no founder-actionable UI for "generating"), this reaps it into
// an honestly-labeled "failed" state a founder can see and act on.
const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * The actual reaping logic, separate from the Inngest function definition
 * below so it's directly unit-testable without Inngest's runtime — the
 * same split used for stuckMissionWatchdog.ts's reapStaleResearchingMissions.
 */
export async function reapStaleGeneratingItems(now: Date = new Date()): Promise<{ reaped: number }> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const stale = await listStaleGeneratingItems(cutoff);

  let reaped = 0;
  for (const { item, stage } of stale) {
    const reason =
      "Production timed out — no progress for over 10 minutes, which usually means the background job crashed or was lost. The item was not silently left in limbo; a founder can send this mission back for another production attempt.";
    const settlement = await transitionContentItemState(item.id, [item.state], "failed", {
      failure_reason: reason,
    });
    if (!settlement.ok) continue; // it moved on (e.g. cancelled) between the query and this write — leave it alone

    const openVersion = await getOpenVersion(item.id);
    if (openVersion) {
      await updateContentVersion(openVersion.id, {
        status: "failed",
        failure_reason: reason,
        completed_at: now.toISOString(),
      });
    }

    await failStage(stage.id, "Reaped by the stuck-content watchdog after 10 minutes with no progress.");
    await recordActivity({
      missionId: item.mission_id,
      actor: "system",
      action: "production_failed",
      detail: "Reaped by the stuck-content watchdog — no progress for over 10 minutes.",
    });
    reaped += 1;
  }

  return { reaped };
}

export const contentWatchdog = inngest.createFunction(
  { id: "content-watchdog", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    return step.run("reap-stale-content-items", () => reapStaleGeneratingItems());
  },
);

// A content item that just settled into "revision_requested" should have
// its dispatch land near-instantly (see contentWorkflow.ts's
// requestContentRevision). Sitting here past this threshold means that
// send genuinely failed — no real production work was lost, the item just
// needs the same event sent again. Mirrors
// stuckMissionWatchdog.ts's followupDispatchWatchdog exactly.
const REVISION_STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * The actual self-healing logic, separate from the Inngest function
 * definition below for the same unit-testability reason as
 * reapStaleGeneratingItems. Re-sending is safe and idempotent: the
 * deterministic event id (content-revision-<itemId>-<approvalId>, the
 * same one the original send used) means Inngest itself dedupes a genuine
 * duplicate, and the atomic revision_requested -> generating transition in
 * runContentProductionPipeline means even a duplicate delivery can only
 * ever start that revision's production once.
 */
export async function resendStaleRevisionDispatches(now: Date = new Date()): Promise<{ resent: number }> {
  const cutoff = new Date(now.getTime() - REVISION_STALE_AFTER_MS);
  const stale = await listStaleRevisionRequestedItems(cutoff);

  let resent = 0;
  for (const item of stale) {
    const approvals = await listApprovalsForContentItem(item.id);
    const revisionApproval = approvals.filter((a) => a.decision === "request_revision").at(-1);
    if (!revisionApproval) continue; // should be structurally unreachable — nothing to resend without the approval that caused this

    try {
      await inngest.send({
        id: `content-revision-${item.id}-${revisionApproval.id}`,
        name: CONTENT_REVISION_REQUESTED_EVENT,
        data: { contentItemId: item.id, missionId: item.mission_id, approvalId: revisionApproval.id },
      });
      await recordActivity({
        missionId: item.mission_id,
        actor: "system",
        action: "revision_dispatch_resent",
        detail:
          "Re-sent the revision dispatch event after the item sat in revision_requested longer than expected — the original send likely failed.",
      });
      resent += 1;
    } catch {
      // Still failing — leave it for the next sweep rather than letting
      // one item's send failure abort the rest of this run's.
    }
  }

  return { resent };
}

export const revisionDispatchWatchdog = inngest.createFunction(
  { id: "revision-dispatch-watchdog", triggers: [{ cron: "*/1 * * * *" }] },
  async ({ step }) => {
    return step.run("resend-stale-revision-dispatches", () => resendStaleRevisionDispatches());
  },
);
