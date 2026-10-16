import { NextResponse } from "next/server";
import { listLedgerEntriesForOrganization, ledgerTotalUsdForOrganization } from "@/lib/db/repositories";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

// Mission 10: fixed a second real cross-tenant leak found live — this
// route used to return EVERY organization's real ledger entries and
// total spend to any authenticated founder, regardless of organization.
// Now scoped to the calling founder's own real organization membership
// only, mirroring the founders-route fix in this same investigation.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const [entries, totalUsd] = await Promise.all([
      listLedgerEntriesForOrganization(organization.id),
      ledgerTotalUsdForOrganization(organization.id),
    ]);
    return NextResponse.json({ entries, totalUsd });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
