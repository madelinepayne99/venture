import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listEmployeeDirectory } from "@/lib/domain/employeeWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

// The Employee Directory (Commercial MVP milestone; organization-scoped
// since Master Development Mission 6, Phase E) — all 10 real registry
// entries, merged with the real, live `agents` catalog row (or null for
// the 3 not-yet-built future employees) and this founder's own real
// organization's recruitment status. The organization is always resolved
// server-side from the founder's own real membership — never accepted
// from the client.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const employees = await listEmployeeDirectory(organization.id);
    return NextResponse.json({ employees, organization });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
