import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { submitGoalConsolidation } from "@/lib/domain/foundersDeskWorkflow";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const deliverable = await submitGoalConsolidation(founderId, id);
    return NextResponse.json({ deliverable }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
