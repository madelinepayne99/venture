import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { runDelegatedResearch } from "@/lib/domain/chiefOfStaffWorkflow";

// Master Development Mission 6 — the real fix for the gap found in
// Chief of Staff's own workforce verification: a subtask delegated to
// Business Analyst now actually dispatches Business Analyst's real,
// autonomous research capability (see runDelegatedResearch's own doc
// comment), rather than only ever being closed out as a manual checkbox
// by the founder.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const task = await runDelegatedResearch(founderId, id);
    return NextResponse.json({ task });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
