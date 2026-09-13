import { NextResponse } from "next/server";
import { listLedgerEntries, ledgerTotalUsd } from "@/lib/db/repositories";

export async function GET() {
  return NextResponse.json({
    entries: listLedgerEntries(),
    totalUsd: ledgerTotalUsd(),
  });
}
