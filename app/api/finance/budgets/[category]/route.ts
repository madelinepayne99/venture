import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getBudgetStatus } from "@/lib/domain/financeWorkflow";
import type { BudgetPeriod } from "@/lib/db/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  try {
    await requireFounderId();
    const { category } = await params;
    const period = (request.nextUrl.searchParams.get("period") as BudgetPeriod | null) ?? "monthly";
    const status = await getBudgetStatus(decodeURIComponent(category), period);
    return NextResponse.json({ status });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
