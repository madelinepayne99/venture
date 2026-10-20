import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listEmployeeDirectory } from "@/lib/domain/employeeWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { resolveOrganizationSubscription } from "@/lib/domain/subscriptionWorkflow";

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
    const [employees, { plan, isEntitled }] = await Promise.all([
      listEmployeeDirectory(organization.id),
      resolveOrganizationSubscription(organization.id),
    ]);
    // Mission 12 — lets the UI show a real "requires a paid plan" signal
    // before a founder clicks Recruit on a paid-only employee, rather
    // than only after the real (correct, but surprising) 403 from
    // assertPlanAllowsAgent. A genuinely entitled plan without paid-agent
    // access is already impossible by schema design, but `isEntitled` is
    // checked too so a lapsed/past_due subscription is never shown as
    // allowing paid agents just because its plan_id happens to be one
    // that normally would.
    const includesPaidAgents = isEntitled && plan.includes_paid_agents;
    return NextResponse.json({ employees, organization, includesPaidAgents });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
