import { NextResponse } from "next/server";
import { listFounders } from "@/lib/db/repositories";

export async function GET() {
  return NextResponse.json({ founders: listFounders() });
}
