import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getAgentDeliverable, listAgentDeliverableReviews } from "@/lib/db/repositories";
import { FoundersDeskNotFoundError } from "@/lib/domain/foundersDeskWorkflow";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFounderId();
    const { id } = await params;
    const deliverable = await getAgentDeliverable(id);
    if (!deliverable) throw new FoundersDeskNotFoundError(`Deliverable ${id} not found.`);
    const reviews = await listAgentDeliverableReviews(id);
    return NextResponse.json({ deliverable, reviews });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
