import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getFounderChecklist, addItemToChecklist } from "@/lib/domain/operationsWorkflow";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const checklist = await getFounderChecklist(id, founderId);
    return NextResponse.json({ checklist });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

// Add a new item to an existing checklist — this is the "updatable" half
// of the brief's acceptance test, alongside toggling an item done (see
// [id]/items/[itemId]/route.ts).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json();
    const checklist = await addItemToChecklist(id, founderId, body?.label);
    return NextResponse.json({ checklist }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
