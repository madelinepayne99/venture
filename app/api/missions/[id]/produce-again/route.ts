import { NextResponse } from "next/server";
import { produceAgainFromMission } from "@/lib/domain/contentWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

/**
 * "Produce Again" — starts a genuinely new, independent Content Item
 * production from a mission whose Scout research already exists (see
 * contentWorkflow.ts's produceAgainFromMission doc comment). Deliberately
 * its own route, never a mode flag on /commission-pilot, so a mission's
 * first production and every subsequent one stay structurally distinct in
 * the real audit trail. Same authorization boundary as every other
 * mutating route: requireFounderId() resolves the real, verified session —
 * never a client-supplied id — and middleware.ts already refuses any
 * unauthenticated request before this handler ever runs.
 *
 * `idempotencyKey` must be supplied by the caller (a fresh UUID generated
 * once per Produce Again attempt, held across any retry of that same
 * attempt) — it becomes the new content item's own id, so a genuine
 * double-submit is detected and replayed idempotently rather than creating
 * a duplicate production.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json();
    const contentItem = await produceAgainFromMission(id, founderId, {
      targetPlatform: body.targetPlatform,
      audience: body.audience,
      contentType: body.contentType,
      selectedEvidenceIds: Array.isArray(body.selectedEvidenceIds) ? body.selectedEvidenceIds : [],
      concept: typeof body.concept === "string" ? body.concept : "",
      creativeDirection: typeof body.creativeDirection === "string" ? body.creativeDirection : "",
      doNotImitate: Array.isArray(body.doNotImitate) ? body.doNotImitate : undefined,
      founderNotes: typeof body.founderNotes === "string" ? body.founderNotes : null,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
    });
    return NextResponse.json({ contentItem }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
