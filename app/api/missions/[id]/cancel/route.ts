import { NextRequest, NextResponse } from "next/server";
import { cancelMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { note } = body ?? {};

    const mission = await cancelMission(id, founderId, typeof note === "string" ? note : undefined);
    return NextResponse.json({ mission });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
