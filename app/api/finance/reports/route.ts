import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { submitFinanceReport } from "@/lib/domain/foundersDeskWorkflow";

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const deliverable = await submitFinanceReport(founderId, body?.category);
    return NextResponse.json({ deliverable }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
