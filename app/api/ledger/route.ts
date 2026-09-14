import { NextResponse } from "next/server";
import { listLedgerEntries, ledgerTotalUsd } from "@/lib/db/repositories";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

export async function GET() {
  try {
    await requireFounderId();
    const [entries, totalUsd] = await Promise.all([listLedgerEntries(), ledgerTotalUsd()]);
    return NextResponse.json({ entries, totalUsd });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
