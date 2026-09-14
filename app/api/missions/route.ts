import { NextRequest, NextResponse } from "next/server";
import { listMissions, getDefaultProject } from "@/lib/db/repositories";
import { createAndSubmitMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function GET() {
  try {
    await requireFounderId();
    return NextResponse.json({ missions: await listMissions() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const { title, brief, projectId } = body ?? {};

    const resolvedProjectId =
      typeof projectId === "string" && projectId ? projectId : (await getDefaultProject())?.id ?? null;

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
