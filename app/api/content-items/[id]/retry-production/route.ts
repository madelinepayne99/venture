import { NextRequest, NextResponse } from "next/server";
import { retryProductionAfterTechnicalFailure } from "@/lib/domain/contentWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

/**
 * "Retry Production" — the founder-triggered resubmit for a "failed"
 * content item whose persisted failure_category is a genuinely recoverable
 * technical/provider problem. Deliberately its own route, not a variant of
 * /decision: a creative revision and a technical retry are different events
 * that must stay distinguishable in Venture HQ, including in the URL a
 * founder's action actually calls. See retryProductionAfterTechnicalFailure
 * for the eligibility check, idempotency guarantee, and audit trail.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;

    const item = await retryProductionAfterTechnicalFailure(id, founderId);
    return NextResponse.json({ item });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
