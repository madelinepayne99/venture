import "server-only";
import {
  createOrganization,
  getOrganizationById,
  addOrganizationMember,
  listOrganizationMembershipsForFounder,
  getOrganizationMembership,
  createOrganizationSubscription,
} from "@/lib/db/repositories";
import type { Organization, OrganizationMember, OrganizationMemberRole, VentureStage } from "@/lib/db/types";
import { ventureStageValues } from "@/lib/db/schema";

const VENTURE_STAGE_VALUES: readonly VentureStage[] = ventureStageValues;

/**
 * The real tenant-boundary enforcement layer (Master Development Mission
 * 6, Phase E). `founders` stays what it always was — a real,
 * GitHub-authenticated person allowed to sign in (see CLAUDE.md's
 * Authentication section) — this module is what actually scopes their
 * access to one real business at a time.
 *
 * `requireOrganizationMembership` is the one real primitive every other
 * tenant-scoped domain function must call before touching organization-
 * owned data — never trust a client-supplied organizationId as proof of
 * anything (see CLAUDE.md's own standing rule for founderId, extended
 * here to organizationId). A route resolves the ACTING organization via
 * `getActiveOrganizationForFounder` (server-side, from the real
 * membership table, never from a request body/query param) and only
 * ever operates within it.
 */

export class OrganizationNotFoundError extends Error {
  constructor(message = "No organization found.") {
    super(message);
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationMembershipError extends Error {
  constructor(
    readonly organizationId: string,
    readonly founderId: string,
  ) {
    super(`Founder ${founderId} is not a member of organization ${organizationId}.`);
    this.name = "OrganizationMembershipError";
  }
}

export class OrganizationValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "OrganizationValidationError";
  }
}

/**
 * A genuine member of the organization, but not one authorized for the
 * specific action attempted — distinct from `OrganizationMembershipError`
 * (not a member at all) so a route can tell "you're not even in this
 * organization" from "you're in it, but not allowed to do this" without
 * parsing a message string. Deliberately never reveals which roles WOULD
 * have been allowed in the thrown message — that's for the caller (which
 * already knows what it asked for) to decide whether to surface.
 */
export class OrganizationPermissionError extends Error {
  constructor(
    readonly organizationId: string,
    readonly founderId: string,
    readonly role: OrganizationMemberRole,
  ) {
    super(`Founder ${founderId}'s role ("${role}") in organization ${organizationId} does not permit this action.`);
    this.name = "OrganizationPermissionError";
  }
}

/**
 * Throws unless `founderId` is a genuine, persisted member of
 * `organizationId` — the real server-side check. Returns the real
 * membership row (carrying its real `role`) so a caller can make a
 * further permission decision (e.g. "owner" required for a sensitive
 * action) without a second query.
 */
export async function requireOrganizationMembership(
  founderId: string,
  organizationId: string,
): Promise<OrganizationMember> {
  const membership = await getOrganizationMembership(organizationId, founderId);
  if (!membership) throw new OrganizationMembershipError(organizationId, founderId);
  return membership;
}

/**
 * Real role enforcement (Master Development Mission 6, Section 9 —
 * "Organisation Owner / Administrator / Member"). Checks genuine
 * membership first (so a non-member gets the correct
 * `OrganizationMembershipError`, never a confusing permission error for
 * an organization they're not even in), then the real persisted `role`
 * against an explicit allow-list the caller names — there is no implicit
 * "admin can do everything a member can plus more" ladder encoded here;
 * every call site states exactly which roles it accepts, so the
 * allow-list is visible at the point of use, not buried in a hierarchy
 * that has to be reverse-engineered later.
 */
export async function requireOrganizationRole(
  founderId: string,
  organizationId: string,
  allowedRoles: readonly OrganizationMemberRole[],
): Promise<OrganizationMember> {
  const membership = await requireOrganizationMembership(founderId, organizationId);
  if (!allowedRoles.includes(membership.role)) {
    throw new OrganizationPermissionError(organizationId, founderId, membership.role);
  }
  return membership;
}

/**
 * The one real, supported "which organization is this request for"
 * resolution for this phase of the mission — a signed-in founder's
 * earliest real membership (stable and deterministic; see
 * listOrganizationMembershipsForFounder's own doc comment). There is no
 * organization-switcher UI yet (see the progress doc's own "what Phase E
 * does not yet cover"), so every route that needs "the active
 * organization" calls this rather than accepting one from the client —
 * the real tenant-isolation property this phase exists to establish:
 * a founder's own request can never name a different organization to
 * act within, because nothing ever asks it to.
 */
export async function getActiveOrganizationForFounder(founderId: string): Promise<Organization> {
  const memberships = await listOrganizationMembershipsForFounder(founderId);
  if (memberships.length === 0) {
    throw new OrganizationNotFoundError(`Founder ${founderId} does not belong to any organization yet.`);
  }
  // Prefer a real "owner" membership over any other role, so a founder
  // who is both an owner of their own organization and (in the future) a
  // mere member of someone else's lands in their own by default.
  const preferred = memberships.find((m) => m.role === "owner") ?? memberships[0]!;
  const organization = await getOrganizationById(preferred.organization_id);
  if (!organization) {
    // A real data-integrity problem (a membership row with no organization
    // behind it) — fail loudly rather than silently treating the founder
    // as organization-less.
    throw new OrganizationNotFoundError(`Organization ${preferred.organization_id} referenced by a real membership no longer exists.`);
  }
  return organization;
}

/**
 * For system/background-job code that has a real mission (or any other
 * row with a nullable `organization_id`) but no acting founder to resolve
 * one through — `runScoutPipeline`/`runContentProductionPipeline`, which
 * the Inngest jobs trigger directly, are the real callers. The column is
 * only nullable at the schema level for safe-backfill reasons (see
 * schema.ts); every real row has a real value in practice, so a missing
 * one here means a genuine data-integrity problem, not a legitimate
 * "unowned" state — this fails loudly rather than silently skipping cost
 * attribution.
 */
export function requireOrganizationId(organizationId: string | null, context: string): string {
  if (!organizationId) {
    throw new Error(`${context} has no organization_id — a real data-integrity problem, not an expected state.`);
  }
  return organizationId;
}

/**
 * Real organization creation — used by this phase's own security-
 * negative tests (two genuinely separate fictional businesses) and by
 * a future onboarding flow (Phase I, not built yet). The creating
 * founder becomes a real "owner" member immediately, atomically with
 * the organization's own creation (two inserts, not a gap where the
 * organization exists with no members at all).
 */
export async function createOrganizationWithOwner(
  ownerFounderId: string,
  name: string,
  ventureStage?: VentureStage | null,
): Promise<{ organization: Organization; membership: OrganizationMember }> {
  const trimmed = name?.trim();
  if (!trimmed) throw new OrganizationValidationError(["An organization needs a non-empty name."]);
  if (trimmed.length > 200) throw new OrganizationValidationError(["Organization name must be 200 characters or fewer."]);
  if (ventureStage != null && !VENTURE_STAGE_VALUES.includes(ventureStage)) {
    throw new OrganizationValidationError([`"${ventureStage}" is not a real venture stage.`]);
  }

  const organization = await createOrganization({ name: trimmed, ownerFounderId, ventureStage: ventureStage ?? null });
  const membership = await addOrganizationMember({ organizationId: organization.id, founderId: ownerFounderId, role: "owner" });
  // Every real organization gets a real subscription row from the
  // moment it exists — "free" by default (Mission 8, Sections 14-15).
  // This is the actual mechanism behind "a newly created free
  // organization cannot consume paid AI usage": budgetWorkflow.ts
  // resolves this organization's real monthly AI budget from this real
  // plan, not a flat default. Created here, atomically alongside the
  // organization and its owner membership, rather than relying on any
  // backfill — the exact discipline the cross-tenant membership bug
  // (see ensureDefaultOrganization's own doc comment) argued for.
  await createOrganizationSubscription({ organizationId: organization.id, planId: "free" });
  return { organization, membership };
}
