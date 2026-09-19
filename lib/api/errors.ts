import { NextResponse } from "next/server";
import { MissionValidationError, MissionCancellationBlockedError } from "@/lib/domain/missionWorkflow";
import { ProjectValidationError } from "@/lib/domain/projectWorkflow";
import { IllegalMissionTransitionError, MissionConcurrencyError } from "@/lib/domain/missionStates";
import { IllegalContentItemTransitionError, ContentItemConcurrencyError } from "@/lib/domain/contentItemStates";
import { ProductionApprovalValidationError, ContentDecisionValidationError } from "@/lib/domain/contentWorkflow";
import { NoProductionRecommendationError } from "@/lib/domain/contentHandoff";
import { ContentVersionCapExceededError } from "@/lib/domain/contentProduction";
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
  if (error instanceof MissionCancellationBlockedError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ProjectValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ProductionApprovalValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ContentDecisionValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NoProductionRecommendationError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ContentVersionCapExceededError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof IllegalMissionTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof MissionConcurrencyError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof IllegalContentItemTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ContentItemConcurrencyError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof Error && error.message.includes("not found")) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Something went wrong handling that request." }, { status: 500 });
}
