import { NextResponse } from "next/server";
import { MissionValidationError } from "@/lib/domain/missionWorkflow";
import { ProjectValidationError } from "@/lib/domain/projectWorkflow";
import { IllegalMissionTransitionError, MissionConcurrencyError } from "@/lib/domain/missionStates";
import { UnauthenticatedError } from "@/lib/api/authErrors";

/**
 * Maps known domain errors to HTTP responses. Anything unrecognized is
 * logged server-side and returned as a generic message — never forward a
 * raw error object or stack trace to the client, since that's also how a
 * secret would leak.
 */
export function toApiErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof MissionValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ProjectValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof IllegalMissionTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof MissionConcurrencyError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof Error && error.message.includes("not found")) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Something went wrong handling that request." }, { status: 500 });
}
