import { NextRequest, NextResponse } from "next/server";
import { listMissions, getDefaultProject } from "@/lib/db/repositories";
import { createAndSubmitMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function GET() {
  return NextResponse.json({ missions: listMissions() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, brief, founderId, projectId } = body ?? {};

    if (typeof founderId !== "string" || !founderId) {
      return NextResponse.json({ error: "founderId is required." }, { status: 400 });
    }

    const resolvedProjectId =
      typeof projectId === "string" && projectId ? projectId : getDefaultProject()?.id ?? null;

    const mission = await createAndSubmitMission({
      founderId,
      projectId: resolvedProjectId,
      title,
      brief,
    });

    return NextResponse.json({ mission }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
