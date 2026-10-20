import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { setCategoryBudget } from "@/lib/domain/financeWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { listBudgets } from "@/lib/db/repositories";

export async function GET() {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const budgets = await listBudgets(organization.id);
    return NextResponse.json({ budgets });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const body = await request.json();
    const { category, amount, currency, period } = body ?? {};
    const budget = await setCategoryBudget(organization.id, { category, amount, currency, period });
    return NextResponse.json({ budget }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
