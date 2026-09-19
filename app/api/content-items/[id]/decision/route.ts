import { NextResponse } from "next/server";
import {
  approveContentVersion,
  rejectContentItem,
  requestContentRevision,
  ContentDecisionValidationError,
} from "@/lib/domain/contentWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

/**
 * One route for all three founder review decisions (Approve / Reject /
 * Send back with notes) — see CLAUDE.md's Content Bot milestone, §11: they
 * share one precondition (the posted contentVersionId must still be the
 * item's latest), enforced identically by each domain function this
 * dispatches to.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json();
    const { decision, contentVersionId, note } = body ?? {};

    if (typeof contentVersionId !== "string" || !contentVersionId) {
      throw new ContentDecisionValidationError("contentVersionId is required.");
    }

    switch (decision) {
      case "approve": {
        const item = await approveContentVersion(id, founderId, { contentVersionId });
        return NextResponse.json({ item });
      }
      case "reject": {
        const item = await rejectContentItem(id, founderId, {
          contentVersionId,
          note: typeof note === "string" ? note : null,
        });
        return NextResponse.json({ item });
      }
      case "revise": {
        const item = await requestContentRevision(id, founderId, {
          contentVersionId,
          note: typeof note === "string" ? note : "",
        });
        return NextResponse.json({ item });
      }
      default:
        throw new ContentDecisionValidationError(
          `decision must be "approve", "reject", or "revise" — got "${decision}".`,
        );
    }
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
