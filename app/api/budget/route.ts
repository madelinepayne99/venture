import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { getBudgetStatusForOrganization } from "@/lib/domain/budgetWorkflow";

// Mission 8 Focus View redesign: the first real customer-facing surface
// for `getBudgetStatusForOrganization` (Mission 7 Phase 4 built the real
// atomic enforcement; this is its first UI-facing read). Real figures
// only — committed/limit/remaining/exhausted, never a fabricated or
// estimated number.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const status = await getBudgetStatusForOrganization(organization.id);
    return NextResponse.json(status);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
