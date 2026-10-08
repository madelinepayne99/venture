import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listEmployeeDirectory } from "@/lib/domain/employeeWorkflow";

// The Employee Directory (Commercial MVP milestone) — all 10 real
// registry entries, each merged with its real, live `agents` row (or
// null for the 3 not-yet-built future employees).
export async function GET() {
  try {
    await requireFounderId();
    const employees = await listEmployeeDirectory();
    return NextResponse.json({ employees });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
