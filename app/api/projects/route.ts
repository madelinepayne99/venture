import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/db/repositories";
import { createWorkspace } from "@/lib/domain/projectWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    return NextResponse.json({ projects: await listProjects(organization.id) });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

// Founder-only, same as every mutating route (requireFounderId + the
// founder-session gate in middleware.ts). This is the ONLY way a workspace
// gets created — there is no auto-create and no update endpoint, so an
// existing workspace's type is never chosen or changed on a founder's
// behalf. Organization-scoped since Master Development Mission 6, Phase E
// — resolved server-side from the founder's own real membership.
export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json();
    const { name, workspaceType } = body ?? {};

    const project = await createWorkspace(founderId, { name, workspaceType });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
