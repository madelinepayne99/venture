import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createFounderChecklist, listFounderChecklists } from "@/lib/domain/operationsWorkflow";

// Operations Agent's one real capability: checklists. Founder-gated the
// same way every other mutating/viewing route is — founderId always comes
// from the verified session, never the body.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const checklists = await listFounderChecklists(founderId);
    return NextResponse.json({ checklists });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const { title, items } = body ?? {};
    const checklist = await createFounderChecklist(founderId, { title, items });
    return NextResponse.json({ checklist }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
