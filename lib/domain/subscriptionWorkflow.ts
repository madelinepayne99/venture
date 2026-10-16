import "server-only";
import {
  getOrganizationSubscription,
  getSubscriptionPlan,
  listSubscriptionPlans,
  countContentItemsStartedThisMonth,
} from "@/lib/db/repositories";
import type { OrganizationSubscription, SubscriptionPlan } from "@/lib/db/types";

/**
 * Real organization-level subscription entitlements (Mission 8, Sections
 * 14-15) — the server-side layer every paid action must actually check,
 * never just something the UI hides. Reuses the exact same real
 * organization_subscriptions/subscription_plans rows every route and
 * domain function reads — there is no second, UI-only notion of "what
 * plan am I on."
 */

// The three real agents with genuine, billed AI execution — the actual
// list this module checks a plan's includes_paid_agents against.
// Executive Assistant, Finance, Operations, and Chief of Staff's own
// delegation UI have no paid execution of their own and stay available
// on every plan, including free (see employeeWorkflow.ts's call site).
export const PAID_AGENT_KEYS = new Set(["scout", "content_bot", "business_analyst"]);

// A subscription in any of these states genuinely grants its plan's real
// entitlements. Everything else (canceled, past_due, incomplete) does
// not — a cancelled subscription, an expired/ended trial, or a failed
// payment must never continue unlocking paid AI work just because the
// organization_subscriptions row hasn't been deleted.
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

export class SubscriptionNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization ${organizationId} has no real subscription row — this should never happen for a real organization (see createOrganizationWithOwner).`);
    this.name = "SubscriptionNotFoundError";
  }
}

export class PlanDoesNotIncludePaidAgentsError extends Error {
  constructor(
    readonly organizationId: string,
    readonly planId: string,
    readonly agentKey: string,
  ) {
    super(
      `This organization's current plan ("${planId}") does not include ${agentKey} — a real paid AI employee. Upgrade to a paid plan to recruit it.`,
    );
    this.name = "PlanDoesNotIncludePaidAgentsError";
  }
}

export class SubscriptionNotEntitledError extends Error {
  constructor(
    readonly organizationId: string,
    readonly status: string,
  ) {
    super(
      `This organization's subscription is "${status}" — not currently entitled to paid AI employees. A cancelled subscription, an ended trial, or a failed payment must be resolved first.`,
    );
    this.name = "SubscriptionNotEntitledError";
  }
}

export class VideoAllowanceExceededError extends Error {
  constructor(
    readonly organizationId: string,
    readonly planId: string,
    readonly usedThisMonth: number,
    readonly allowance: number,
  ) {
    super(
      `This organization's plan ("${planId}") allows ${allowance} Content Bot video production(s) per month — ${usedThisMonth} already started this month. Upgrade for a higher allowance, or wait until next month.`,
    );
    this.name = "VideoAllowanceExceededError";
  }
}

export interface ResolvedSubscription {
  subscription: OrganizationSubscription;
  plan: SubscriptionPlan;
  /** Real, current entitlement — status is active/trialing, not just "a row exists." */
  isEntitled: boolean;
}

/** The real, current plan + subscription for an organization — never assumed, always read from the real row created at organization-creation time. */
export async function resolveOrganizationSubscription(organizationId: string): Promise<ResolvedSubscription> {
  const subscription = await getOrganizationSubscription(organizationId);
  if (!subscription) throw new SubscriptionNotFoundError(organizationId);
  const plan = await getSubscriptionPlan(subscription.plan_id);
  if (!plan) {
    throw new Error(`Subscription references plan "${subscription.plan_id}", which doesn't exist — a real data-integrity problem.`);
  }
  return { subscription, plan, isEntitled: ENTITLED_STATUSES.has(subscription.status) };
}

/**
 * The real "employee access" enforcement (Mission 8's own explicit ask)
 * — called from employeeWorkflow.ts's recruitEmployee, server-side,
 * before a paid agent is ever recruited. Never bypassable by hiding a
 * button in the UI: a direct POST to /api/employees/scout/recruit from
 * an organization on the free plan (or a cancelled/past-due paid plan)
 * is refused here regardless of what the client sent.
 */
export async function assertPlanAllowsAgent(organizationId: string, agentKey: string): Promise<void> {
  if (!PAID_AGENT_KEYS.has(agentKey)) return; // the free/manual agents are available on every plan
  const { subscription, plan, isEntitled } = await resolveOrganizationSubscription(organizationId);
  if (!isEntitled) throw new SubscriptionNotEntitledError(organizationId, subscription.status);
  if (!plan.includes_paid_agents) throw new PlanDoesNotIncludePaidAgentsError(organizationId, plan.id, agentKey);
}

function startOfCurrentMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Content Bot's video allowance — a real, SEPARATE monthly counter from
 * the dollar AI budget (per the founders' own explicit "separately
 * controlled allowances" instruction), since one video production can
 * cost up to MAX_ITEM_SPEND_USD ($8) regardless of plan, disproportionate
 * to a research task. Called before a NEW content item is created
 * (contentWorkflow.ts's approveForProduction / produceAgainFromMission /
 * commissionPilotAnyway) — never before a revision of an EXISTING item,
 * which doesn't start a new production slot.
 */
export async function assertPlanAllowsNewVideoProduction(organizationId: string, now: Date = new Date()): Promise<void> {
  const { subscription, plan, isEntitled } = await resolveOrganizationSubscription(organizationId);
  if (!isEntitled) throw new SubscriptionNotEntitledError(organizationId, subscription.status);
  const usedThisMonth = await countContentItemsStartedThisMonth(organizationId, startOfCurrentMonthIso(now));
  if (usedThisMonth >= plan.monthly_video_allowance) {
    throw new VideoAllowanceExceededError(organizationId, plan.id, usedThisMonth, plan.monthly_video_allowance);
  }
}

/** Real, published-only plan list for the real customer-facing pricing page — a plan with is_published: false (every plan today, pending founder approval) never appears here. */
export async function listPublishedPlans(): Promise<SubscriptionPlan[]> {
  const plans = await listSubscriptionPlans();
  return plans.filter((p) => p.is_published).sort((a, b) => (a.monthly_price_gbp ?? 0) - (b.monthly_price_gbp ?? 0));
}

/** Every real plan, published or not — for founder-facing/internal views (e.g. the dev-only pricing preview, Settings' own plan display) where seeing unpublished provisional plans is expected and safe. */
export async function listAllPlansForFounder(): Promise<SubscriptionPlan[]> {
  const plans = await listSubscriptionPlans();
  return plans.filter((p) => p.id !== "founder").sort((a, b) => (a.monthly_price_gbp ?? 0) - (b.monthly_price_gbp ?? 0));
}
