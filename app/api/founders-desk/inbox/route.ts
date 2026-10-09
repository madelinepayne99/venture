import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listFoundersDeskInbox } from "@/lib/domain/foundersDeskWorkflow";

export async function GET() {
  try {
    await requireFounderId();
    const items = await listFoundersDeskInbox();
    return NextResponse.json({ items });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
