import { NextResponse } from "next/server";
import { getContentItemDetail } from "@/lib/api/contentItemDetail";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const { id } = await params;
    const detail = await getContentItemDetail(id, organization.id);
    if (!detail) {
      return NextResponse.json({ error: `Content item ${id} not found.` }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
