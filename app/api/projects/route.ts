import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/db/repositories";
import { createWorkspace } from "@/lib/domain/projectWorkflow";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function GET() {
  try {
    await requireFounderId();
    return NextResponse.json({ projects: await listProjects() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

// Founder-only, same as every mutating route (requireFounderId + the
// founder-session gate in middleware.ts). This is the ONLY way a workspace
// gets created — there is no auto-create and no update endpoint, so an
// existing workspace's type is never chosen or changed on a founder's
// behalf.
export async function POST(request: NextRequest) {
  try {
    await requireFounderId();
    const body = await request.json();
    const { name, workspaceType } = body ?? {};

    const project = await createWorkspace({ name, workspaceType });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
