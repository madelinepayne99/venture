import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getFounderResearchReport } from "@/lib/domain/businessAnalystWorkflow";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const report = await getFounderResearchReport(id, founderId);
    return NextResponse.json({ report });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
