import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createGoalWithDelegatedSubtasks, listFounderGoals } from "@/lib/domain/chiefOfStaffWorkflow";

// Chief of Staff's one real capability: breaking a goal into subtasks
// delegated to the other active Operations Wing agents (never Scout or
// Content Bot — see chiefOfStaffWorkflow.ts's DELEGATABLE_AGENT_KEYS).
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const goals = await listFounderGoals(founderId);
    return NextResponse.json({ goals });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const { title, subtasks } = body ?? {};
    const goal = await createGoalWithDelegatedSubtasks(founderId, { title, subtasks });
    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
