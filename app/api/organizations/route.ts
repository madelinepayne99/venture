import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import { getOrganizationById, listOrganizationMembershipsForFounder } from "@/lib/db/repositories";
import type { Organization, OrganizationMember, VentureStage } from "@/lib/db/types";

const VALID_VENTURE_STAGES: VentureStage[] = ["new_venture", "existing_business"];

// Mission 8, Sections 11-12: the real, UI-reachable organization-creation
// endpoint — `createOrganizationWithOwner` has existed since Mission 6
// but, until now, was only ever called from tests and server-side seed
// code (see CLAUDE.md's own "zero UI exposure" note). This is the actual
// mechanism behind onboarding's "create your own private organization"
// step, and the same mechanism Focus View's Settings "Create workspace
// vs create organization" distinction relies on — a workspace
// (projects.workspace_type) is a business line inside one organization;
// this creates a whole new, separately-owned, separately-isolated
// organization.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const memberships = await listOrganizationMembershipsForFounder(founderId);
    const organizations = await Promise.all(
      memberships.map(async (m: OrganizationMember) => ({
        organization: await getOrganizationById(m.organization_id),
        role: m.role,
      })),
    );
    return NextResponse.json({
      organizations: organizations.filter(
        (o: { organization: Organization | undefined; role: string }) => o.organization,
      ),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json().catch(() => ({}));
    const { name, ventureStage } = body ?? {};

    const normalizedStage: VentureStage | null =
      typeof ventureStage === "string" && VALID_VENTURE_STAGES.includes(ventureStage as VentureStage)
        ? (ventureStage as VentureStage)
        : null;

    const { organization } = await createOrganizationWithOwner(founderId, name, normalizedStage);

    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
