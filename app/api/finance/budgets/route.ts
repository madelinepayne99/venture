import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { setCategoryBudget } from "@/lib/domain/financeWorkflow";
import { listBudgets } from "@/lib/db/repositories";

export async function GET() {
  try {
    await requireFounderId();
    const budgets = await listBudgets();
    return NextResponse.json({ budgets });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireFounderId();
    const body = await request.json();
    const { category, amount, currency, period } = body ?? {};
    const budget = await setCategoryBudget({ category, amount, currency, period });
    return NextResponse.json({ budget }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
