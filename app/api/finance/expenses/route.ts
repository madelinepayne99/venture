import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { logExpense, listAllExpenses } from "@/lib/domain/financeWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export async function GET(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const category = request.nextUrl.searchParams.get("category") ?? undefined;
    const expenses = await listAllExpenses(organization.id, category);
    return NextResponse.json({ expenses });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const founderId = await requireFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const body = await request.json();
    const { category, description, amount, currency, incurredAt } = body ?? {};
    const expense = await logExpense(organization.id, { category, description, amount, currency, incurredAt });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
