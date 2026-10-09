import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { recruitEmployee } from "@/lib/domain/employeeWorkflow";
import { getActiveOrganizationForFounder, requireOrganizationRole } from "@/lib/domain/organizationWorkflow";

// Employee recruitment is a real organization-settings action (Master
// Development Mission 6, Section 9's own explicit example) — restricted
// to owner/admin, not every member.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    await requireOrganizationRole(founderId, organization.id, ["owner", "admin"]);
    const { key } = await params;
    await recruitEmployee(organization.id, key);
    return NextResponse.json({ recruited: true, organizationId: organization.id, agentKey: key });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
