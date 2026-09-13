import { NextRequest, NextResponse } from "next/server";
import { cancelMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { founderId, note } = body ?? {};

    if (typeof founderId !== "string" || !founderId) {
      return NextResponse.json({ error: "founderId is required." }, { status: 400 });
    }

    const mission = await cancelMission(id, founderId, typeof note === "string" ? note : undefined);
    return NextResponse.json({ mission });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
