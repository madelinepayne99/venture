import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { logExpense, listAllExpenses } from "@/lib/domain/financeWorkflow";

export async function GET(request: NextRequest) {
  try {
    await requireFounderId();
    const category = request.nextUrl.searchParams.get("category") ?? undefined;
    const expenses = await listAllExpenses(category);
    return NextResponse.json({ expenses });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireFounderId();
    const body = await request.json();
    const { category, description, amount, currency, incurredAt } = body ?? {};
    const expense = await logExpense({ category, description, amount, currency, incurredAt });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
