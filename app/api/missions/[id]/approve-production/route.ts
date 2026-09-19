import { NextResponse } from "next/server";
import { approveForProduction } from "@/lib/domain/contentWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json();
    const contentItem = await approveForProduction(id, founderId, {
      targetPlatform: body.targetPlatform,
      audience: body.audience,
      contentType: body.contentType,
      selectedEvidenceIds: Array.isArray(body.selectedEvidenceIds) ? body.selectedEvidenceIds : [],
      founderNotes: typeof body.founderNotes === "string" ? body.founderNotes : null,
    });
    return NextResponse.json({ contentItem }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
