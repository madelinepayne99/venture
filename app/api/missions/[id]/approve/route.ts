import { NextRequest, NextResponse } from "next/server";
import { approveMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { founderId } = body ?? {};

    if (typeof founderId !== "string" || !founderId) {
      return NextResponse.json({ error: "founderId is required." }, { status: 400 });
    }

    const mission = await approveMission(id, founderId);
    return NextResponse.json({ mission });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
