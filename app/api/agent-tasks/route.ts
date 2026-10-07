import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createFounderTask, listFounderTasks } from "@/lib/domain/executiveAssistantWorkflow";

// Executive Assistant's one real capability: internal founder tasks.
// Founder-gated the same way every other mutating/viewing route is —
// founderId always comes from the verified session, never the body.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const tasks = await listFounderTasks(founderId);
    return NextResponse.json({ tasks });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const { title, detail, dueAt } = body ?? {};
    const task = await createFounderTask(founderId, { title, detail, dueAt });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
