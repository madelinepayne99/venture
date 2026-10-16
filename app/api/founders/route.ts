import { NextResponse } from "next/server";
import { listFoundersForOrganization } from "@/lib/db/repositories";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

// Mission 10: fixed a real cross-tenant PII leak found live — this
// route used to return EVERY founder in the entire system (every real
// name, and every real email where one was set) to any authenticated
// founder, regardless of organization. Now scoped to the calling
// founder's own real organization membership only.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    return NextResponse.json({ founders: await listFoundersForOrganization(organization.id) });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
