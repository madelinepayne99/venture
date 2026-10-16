import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import {
  submitSupportRequest,
  listMySupportRequests,
  isEmailDeliveryConfigured,
  getSupportContactAddress,
} from "@/lib/domain/supportWorkflow";
import { getActiveOrganizationForFounder, OrganizationNotFoundError } from "@/lib/domain/organizationWorkflow";

// Real Help & Support (Mission 10) — a genuine server-persisted ticket,
// scoped to the real signed-in founder. GET returns only their own real
// requests, never another founder's (organization membership is not
// enough to see someone else's support history).
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const requests = await listMySupportRequests(founderId);
    return NextResponse.json({
      requests,
      emailDeliveryConfigured: isEmailDeliveryConfigured(),
      supportContactEmail: getSupportContactAddress(),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json().catch(() => ({}));

    // Organization is optional — a founder with no organization yet
    // (e.g. mid-onboarding) can still genuinely need support.
    let organizationId: string | null = null;
    try {
      const organization = await getActiveOrganizationForFounder(founderId);
      organizationId = organization.id;
    } catch (error) {
      if (!(error instanceof OrganizationNotFoundError)) throw error;
    }

    const created = await submitSupportRequest({
      founderId,
      organizationId,
      subject: body.subject,
      message: body.message,
    });
    return NextResponse.json({ request: created, emailDeliveryConfigured: isEmailDeliveryConfigured() }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
