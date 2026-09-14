import { NextResponse } from "next/server";
import { listFounders } from "@/lib/db/repositories";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function GET() {
  try {
    await requireFounderId();
    return NextResponse.json({ founders: await listFounders() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
