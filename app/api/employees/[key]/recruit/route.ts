import { NextRequest, NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { recruitEmployee } from "@/lib/domain/employeeWorkflow";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    await requireFounderId();
    const { key } = await params;
    const agent = await recruitEmployee(key);
    return NextResponse.json({ agent });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
