import { NextRequest, NextResponse } from "next/server";
import {
  listMissionsForOrganization,
  listLeadAssignments,
  listContentItemsForMissions,
  listAgentTaskWorldSignals,
  getDefaultProject,
} from "@/lib/db/repositories";
import { createAndSubmitMission } from "@/lib/domain/missionWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    // Missions themselves are real, organization-owned customer data
    // (Master Development Mission 6, Section 8 — "Scout missions ... must
    // not leak across organizations") and are scoped here. leadAssignments
    // and agentTaskSignals stay deliberately global for now — they drive
    // the one shared 3D office scene (Astra's own design, untouched by
    // this work), which this phase does not yet make per-organization;
    // see the progress doc's own "what Phase E does not yet cover" for
    // why that's a real, named, not-yet-closed gap rather than an
    // oversight.
    const [missions, leadAssignments, agentTaskSignals] = await Promise.all([
      listMissionsForOrganization(organization.id),
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
    const organization = await getActiveOrganizationForFounder(founderId);
    const body = await request.json();
    const { title, brief, projectId } = body ?? {};

    const resolvedProjectId =
      typeof projectId === "string" && projectId ? projectId : (await getDefaultProject(organization.id))?.id ?? null;

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
