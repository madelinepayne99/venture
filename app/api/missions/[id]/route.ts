import { NextResponse } from "next/server";
import { getMissionDetail } from "@/lib/api/missionDetail";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getMissionDetail(id);
  if (!detail) {
    return NextResponse.json({ error: `Mission ${id} not found.` }, { status: 404 });
  }
  return NextResponse.json(detail);
}
