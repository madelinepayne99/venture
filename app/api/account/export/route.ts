import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { exportFounderData } from "@/lib/domain/accountWorkflow";

// Real, scoped self-service data export (Mission 10) — only the real
// signed-in founder's own data, resolved server-side from the session,
// never from a request parameter. Returned as a downloadable JSON file
// rather than rendered inline.
export async function GET() {
  try {
    const founderId = await requireFounderId();
    const data = await exportFounderData(founderId);
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="venture-hq-account-export-${founderId}.json"`,
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
