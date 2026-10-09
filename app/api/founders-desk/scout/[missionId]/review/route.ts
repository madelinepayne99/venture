import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { reviewScoutMission, FoundersDeskValidationError } from "@/lib/domain/foundersDeskWorkflow";

export async function POST(request: NextRequest, { params }: { params: Promise<{ missionId: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { missionId } = await params;
    const body = await request.json();
    const { decision, note } = body ?? {};
    if (decision !== "approve" && decision !== "reject" && decision !== "revise") {
      throw new FoundersDeskValidationError('decision must be "approve", "reject", or "revise".');
    }
    const result = await reviewScoutMission(missionId, founderId, decision, typeof note === "string" ? note : undefined);
    return NextResponse.json(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
