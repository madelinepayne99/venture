import { NextRequest, NextResponse } from "next/server";
import {
  listMissions,
  listLeadAssignments,
  listContentItemsForMissions,
  listAgentTaskWorldSignals,
  getDefaultProject,
} from "@/lib/db/repositories";
import { createAndSubmitMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function GET() {
  try {
    await requireFounderId();
    // agentTaskSignals (Milestone 7) rides on this same, already-polled
    // endpoint rather than a second polling loop — it's the one real
    // signal driving the Operations Wing agents' positions in the shared
    // 3D office, exactly like leadAssignments/contentItems already drive
    // Scout's/Content Bot's. Not actually mission data, but reusing the
    // existing poll keeps "Office View and Focus View share the same
    // underlying data" a single fetch, not two.
    const [missions, leadAssignments, agentTaskSignals] = await Promise.all([
      listMissions(),
      listLeadAssignments(),
      listAgentTaskWorldSignals(),
    ]);
    const contentItems = await listContentItemsForMissions(missions.map((m) => m.id));
    return NextResponse.json({ missions, leadAssignments, contentItems, agentTaskSignals });
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
