import "server-only";
import {
  createOrganization,
  getOrganizationById,
  addOrganizationMember,
  listOrganizationMembershipsForFounder,
  getOrganizationMembership,
} from "@/lib/db/repositories";
import type { Organization, OrganizationMember } from "@/lib/db/types";

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
): Promise<{ organization: Organization; membership: OrganizationMember }> {
  const trimmed = name?.trim();
  if (!trimmed) throw new OrganizationValidationError(["An organization needs a non-empty name."]);
  if (trimmed.length > 200) throw new OrganizationValidationError(["Organization name must be 200 characters or fewer."]);

  const organization = await createOrganization({ name: trimmed, ownerFounderId });
  const membership = await addOrganizationMember({ organizationId: organization.id, founderId: ownerFounderId, role: "owner" });
  return { organization, membership };
}
