import { NextResponse } from "next/server";
import { MissionValidationError, MissionCancellationBlockedError } from "@/lib/domain/missionWorkflow";
import { ProjectValidationError } from "@/lib/domain/projectWorkflow";
import { IllegalMissionTransitionError, MissionConcurrencyError } from "@/lib/domain/missionStates";
import { IllegalContentItemTransitionError, ContentItemConcurrencyError } from "@/lib/domain/contentItemStates";
import {
  ProductionApprovalValidationError,
  ContentDecisionValidationError,
  CommissionPilotValidationError,
  ProductionRecommendationAlreadyExistsError,
  InsufficientEvidenceToCommissionError,
  MissionStrandedInProductionError,
  NotRecoverableFailureError,
  ProduceAgainValidationError,
  MissionNotReadyForProductionError,
  ContentAssetNotFoundError,
} from "@/lib/domain/contentWorkflow";
import { NoProductionRecommendationError, FounderCommissionValidationError } from "@/lib/domain/contentHandoff";
import { ProductionGenuinelyStartedError } from "@/lib/domain/missionWorkflow";
import { ContentVersionCapExceededError } from "@/lib/domain/contentProduction";
import { UnauthenticatedError } from "@/lib/api/authErrors";
import {
  AgentTaskValidationError,
  AgentTaskNotFoundError,
  AgentTaskStateError,
} from "@/lib/domain/executiveAssistantWorkflow";
import { FinanceValidationError } from "@/lib/domain/financeWorkflow";
import {
  ChecklistValidationError,
  ChecklistNotFoundError,
  ChecklistItemNotFoundError,
} from "@/lib/domain/operationsWorkflow";
import {
  BusinessAnalystValidationError,
  BusinessAnalystReportNotFoundError,
} from "@/lib/domain/businessAnalystWorkflow";
import {
  ChiefOfStaffValidationError,
  ChiefOfStaffGoalNotFoundError,
  ChiefOfStaffTaskNotFoundError,
  ChiefOfStaffResearchError,
} from "@/lib/domain/chiefOfStaffWorkflow";
import {
  EmployeeNotFoundError,
  EmployeeNotRecruitableError,
  EmployeeHasActiveWorkError,
} from "@/lib/domain/employeeWorkflow";
import {
  FoundersDeskValidationError,
  FoundersDeskNotFoundError,
  FoundersDeskStateError,
} from "@/lib/domain/foundersDeskWorkflow";
import {
  OrganizationNotFoundError,
  OrganizationMembershipError,
  OrganizationValidationError,
  OrganizationPermissionError,
} from "@/lib/domain/organizationWorkflow";
import { BudgetExhaustedError } from "@/lib/domain/budgetWorkflow";

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
  if (error instanceof CommissionPilotValidationError || error instanceof FounderCommissionValidationError) {
    return NextResponse.json({ error: error.message, details: "errors" in error ? error.errors : undefined }, { status: 400 });
  }
  if (error instanceof ProductionRecommendationAlreadyExistsError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof InsufficientEvidenceToCommissionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof MissionStrandedInProductionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ProductionGenuinelyStartedError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ContentVersionCapExceededError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof NotRecoverableFailureError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ProduceAgainValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof MissionNotReadyForProductionError) {
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
  if (error instanceof AgentTaskValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof AgentTaskNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof AgentTaskStateError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof FinanceValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ChecklistValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ChecklistNotFoundError || error instanceof ChecklistItemNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof BusinessAnalystValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof BusinessAnalystReportNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ChiefOfStaffValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ChiefOfStaffGoalNotFoundError || error instanceof ChiefOfStaffTaskNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ChiefOfStaffResearchError) {
    return NextResponse.json({ error: error.message, reportId: error.reportId }, { status: 409 });
  }
  if (error instanceof EmployeeNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof EmployeeNotRecruitableError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof EmployeeHasActiveWorkError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof FoundersDeskValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof FoundersDeskNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof FoundersDeskStateError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof OrganizationNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof OrganizationMembershipError) {
    // Deliberately the same generic message regardless of whether the
    // organization genuinely doesn't exist or the founder just isn't a
    // member of it — never confirm or deny another organization's
    // existence to someone who isn't in it.
    return NextResponse.json({ error: "You do not have access to that organization." }, { status: 403 });
  }
  if (error instanceof OrganizationPermissionError) {
    return NextResponse.json({ error: "Your role in this organization doesn't permit that action." }, { status: 403 });
  }
  if (error instanceof OrganizationValidationError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
  }
  if (error instanceof ContentAssetNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof BudgetExhaustedError) {
    // 429 (Too Many Requests) is the closest standard status for "this
    // organization's own spending limit is already used up this month" —
    // not a 403 (it's not a permissions problem) and not a 402 (no real
    // payment flow exists in this app yet). The real figures (never a
    // vague message alone) let the UI show exactly how exhausted the
    // budget is.
    return NextResponse.json(
      {
        error: error.message,
        limitUsd: error.limitUsd,
        committedUsd: error.committedUsd,
        requestedUsd: error.requestedUsd,
      },
      { status: 429 },
    );
  }
  if (error instanceof Error && error.message.includes("not found")) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Something went wrong handling that request." }, { status: 500 });
}
