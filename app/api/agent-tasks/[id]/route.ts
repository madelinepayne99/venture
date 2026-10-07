import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { completeFounderTask, cancelFounderTask } from "@/lib/domain/executiveAssistantWorkflow";

// One route, action in the body — same shape as
// /api/content-items/[id]/decision for the same reason: a small, closed
// set of real state transitions, not a generic field-patch endpoint.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json();
    const action = body?.action;

    if (action === "complete") {
      const task = await completeFounderTask(founderId, id);
      return NextResponse.json({ task });
    }
    if (action === "cancel") {
      const task = await cancelFounderTask(founderId, id);
      return NextResponse.json({ task });
    }
    return NextResponse.json({ error: 'action must be "complete" or "cancel".' }, { status: 400 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
