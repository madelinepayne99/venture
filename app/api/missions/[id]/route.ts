import { NextResponse } from "next/server";
import { getMissionDetail } from "@/lib/api/missionDetail";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFounderId();
    const { id } = await params;
    const detail = await getMissionDetail(id);
    if (!detail) {
      return NextResponse.json({ error: `Mission ${id} not found.` }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
