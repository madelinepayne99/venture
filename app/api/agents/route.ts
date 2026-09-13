import { NextResponse } from "next/server";
import { listAgents } from "@/lib/db/repositories";

export async function GET() {
  return NextResponse.json({ agents: listAgents() });
}
