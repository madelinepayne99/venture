import { NextResponse } from "next/server";
import { commissionPilotAnyway } from "@/lib/domain/contentWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

/**
 * The founder-controlled override — "Scout advises, founders decide" (see
 * contentWorkflow.ts's commissionPilotAnyway doc comment). Deliberately a
 * separate route from approve-production, never a mode flag on it, so the
 * two paths' authorization/eligibility/audit trails stay structurally
 * distinct rather than merged behind one endpoint. Authorization is the
 * same boundary every mutating route already uses: requireFounderId()
 * resolves the real, verified session — never a client-supplied id — and
 * middleware.ts already refuses any unauthenticated request before this
 * handler ever runs.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json();
    const contentItem = await commissionPilotAnyway(id, founderId, {
      targetPlatform: body.targetPlatform,
      audience: body.audience,
      contentType: body.contentType,
      selectedEvidenceIds: Array.isArray(body.selectedEvidenceIds) ? body.selectedEvidenceIds : [],
      concept: typeof body.concept === "string" ? body.concept : "",
      creativeDirection: typeof body.creativeDirection === "string" ? body.creativeDirection : "",
      doNotImitate: Array.isArray(body.doNotImitate) ? body.doNotImitate : undefined,
      founderNotes: typeof body.founderNotes === "string" ? body.founderNotes : null,
    });
    return NextResponse.json({ contentItem }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
