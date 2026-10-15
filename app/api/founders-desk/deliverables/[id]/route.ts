import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listAgentDeliverableReviews } from "@/lib/db/repositories";
import { getOwnedAgentDeliverable } from "@/lib/domain/foundersDeskWorkflow";

// Mission 11 security audit: fixed a real, critical cross-tenant leak —
// this route previously called requireFounderId() but discarded its
// result, then fetched the deliverable from the globally unscoped
// getAgentDeliverable() with no ownership check at all. Any authenticated
// founder could read any organization's deliverable content and review
// history by id. Now routed through getOwnedAgentDeliverable, which
// verifies the deliverable belongs to the requesting founder's own real
// organization before returning anything.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const deliverable = await getOwnedAgentDeliverable(id, founderId);
    const reviews = await listAgentDeliverableReviews(id);
    return NextResponse.json({ deliverable, reviews });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
