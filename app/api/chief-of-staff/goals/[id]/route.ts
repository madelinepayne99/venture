import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getFounderGoal } from "@/lib/domain/chiefOfStaffWorkflow";

// A subtask's own completion/cancellation reuses the EXISTING
// /api/agent-tasks/[id] route unchanged — see chiefOfStaffWorkflow.ts's
// doc comment for why that's already correct for a delegated subtask.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const goal = await getFounderGoal(id, founderId);
    return NextResponse.json({ goal });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
