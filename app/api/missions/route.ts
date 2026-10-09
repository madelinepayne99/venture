import { NextRequest, NextResponse } from "next/server";
import {
  listMissionsForOrganization,
  listLeadAssignmentsForOrganization,
  listContentItemsForMissions,
  listAgentTaskWorldSignalsForOrganization,
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
    // Missions, leadAssignments, and agentTaskSignals are all real,
    // organization-owned data (Master Development Mission 6, Section 8 —
    // "Scout missions ... must not leak across organizations" — and the
    // same reasoning extended to what drives the shared 3D office scene).
    // This is a pure data-scoping change: components/founders-desk/world/*
    // is completely untouched — Astra's own design — it just now only
    // ever receives one real organization's own real assignments/signals,
    // in the exact same shape as before.
    const [missions, leadAssignments, agentTaskSignals] = await Promise.all([
      listMissionsForOrganization(organization.id),
      listLeadAssignmentsForOrganization(organization.id),
      listAgentTaskWorldSignalsForOrganization(organization.id),
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
