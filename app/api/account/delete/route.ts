import { NextResponse } from "next/server";
import { requireFounderId } from "@/lib/api/session";
import { toApiErrorResponse } from "@/lib/api/errors";
import { deleteFounderAccount } from "@/lib/domain/accountWorkflow";

// Real account deletion (Mission 10) — irreversible, so it requires the
// exact server-checked confirmation phrase (deleteFounderAccount itself
// enforces this; never trust a client-side confirmation dialog alone).
// Deleting the real auth_user row (inside deleteFounderAccount) cascades
// away every real session for this founder — this request's own session
// included — so the browser is effectively signed out the moment this
// succeeds; there is nothing further to revoke here.
export async function POST(request: Request) {
  try {
    const founderId = await requireFounderId();
    const body = await request.json().catch(() => ({}));
    const result = await deleteFounderAccount(founderId, body.confirmationText ?? "");
    return NextResponse.json(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
