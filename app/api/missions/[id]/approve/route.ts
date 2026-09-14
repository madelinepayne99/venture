import { NextResponse } from "next/server";
import { approveMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const { id } = await params;
    const mission = await approveMission(id, founderId);
    return NextResponse.json({ mission });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
