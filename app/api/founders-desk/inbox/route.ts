import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listFoundersDeskInbox } from "@/lib/domain/foundersDeskWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const items = await listFoundersDeskInbox(organization.id);
    return NextResponse.json({ items });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
