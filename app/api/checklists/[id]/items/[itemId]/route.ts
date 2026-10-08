import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { setItemDone } from "@/lib/domain/operationsWorkflow";

// Toggle one checklist item's done state — the other half of "updatable".
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const founderId = await requireFounderId();
    const { id, itemId } = await params;
    const body = await request.json();
    const isDone = Boolean(body?.isDone);
    const checklist = await setItemDone(id, itemId, founderId, isDone);
    return NextResponse.json({ checklist });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
