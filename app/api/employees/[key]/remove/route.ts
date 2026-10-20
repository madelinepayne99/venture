import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { removeEmployee } from "@/lib/domain/employeeWorkflow";
import { getActiveOrganizationForFounder, requireOrganizationRole } from "@/lib/domain/organizationWorkflow";

// Same real permission gate as recruit — removing an employee is the
// same class of organization-settings action.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    await requireOrganizationRole(founderId, organization.id, ["owner", "admin"]);
    const { key } = await params;
    await removeEmployee(organization.id, key);
    return NextResponse.json({ recruited: false, organizationId: organization.id, agentKey: key });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
