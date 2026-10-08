import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requestResearch, listFounderResearchReports } from "@/lib/domain/businessAnalystWorkflow";

// Business Analyst's one real capability: standalone sourced research.
// This call can genuinely take tens of seconds (a real web-search-backed
// model call) — see businessAnalystWorkflow.ts's doc comment for why this
// is synchronous rather than durable/background for this first slice.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const reports = await listFounderResearchReports(founderId);
    return NextResponse.json({ reports });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const report = await requestResearch(founderId, body?.query);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
