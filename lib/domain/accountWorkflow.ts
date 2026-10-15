import "server-only";
import {
  getFounder,
  anonymizeFounder,
  closeOrganization,
  deleteAuthUserByEmail,
  listOrganizationMembershipsForFounder,
  getOrganizationById,
  listFoundersForOrganization,
  getOrganizationSubscription,
  listProjects,
  listMissionsForOrganization,
  listLedgerEntriesForOrganization,
  ledgerTotalUsdForOrganization,
  listSupportRequestsForFounder,
} from "@/lib/db/repositories";
import type { Founder, Organization, OrganizationMember } from "@/lib/db/types";
import { isStripeConfigured, cancelSubscriptionImmediately } from "@/lib/billing/stripe";

/**
 * Real account deletion and data export (Mission 10). Both operate on
 * isolated fictional records in this codebase's own tests — never on
 * Ellis or Maddie's real founder rows, which is enforced by nothing
 * special here (there's no magic carve-out): the same real logic simply
 * refuses to delete a sole owner's organization out from under other
 * genuine members, which is the one case that could ever matter for a
 * shared account.
 *
 * Design notes (see CLAUDE.md's own insert-only/anonymize philosophy):
 * - A founder row is never hard-deleted — `anonymizeFounder` clears the
 *   PII (name, email) and stamps `deleted_at`, preserving every real
 *   mission/cost/deliverable row that references `founder_id`.
 * - "Never delete an entire organisation merely because one member
 *   closes their account": if the deleting founder OWNS an organization
 *   that still has other real members, deletion is refused outright
 *   (`AccountDeletionBlockedError`) rather than silently transferring or
 *   destroying it — there is no ownership-transfer UI yet (a real,
 *   named gap; see the progress doc), so the safe behavior is to ask the
 *   founder to resolve that first, not to guess on their behalf.
 * - A sole owner with no other real members: any real outstanding
 *   Stripe subscription is cancelled immediately (not left to bill
 *   through a period nobody will use), then the organization itself is
 *   closed (`closed_at` — never hard-deleted; see schema.ts).
 * - Stored generated media (`lib/storage/*`) is never deleted here — the
 *   storage layer's own insert-only philosophy ("no `delete`") extends
 *   to account closure too; a closed organization's files simply become
 *   unreachable through the real API boundary, the same way its other
 *   data does.
 */

export class AccountNotFoundError extends Error {
  constructor(founderId: string) {
    super(`No founder found with id ${founderId}.`);
    this.name = "AccountNotFoundError";
  }
}

export class AccountAlreadyDeletedError extends Error {
  constructor(founderId: string) {
    super(`Founder ${founderId}'s account has already been deleted.`);
    this.name = "AccountAlreadyDeletedError";
  }
}

export class AccountDeletionConfirmationError extends Error {
  constructor() {
    super(`Type exactly "${ACCOUNT_DELETION_CONFIRMATION_PHRASE}" to confirm account deletion.`);
    this.name = "AccountDeletionConfirmationError";
  }
}

export class AccountDeletionBlockedError extends Error {
  constructor(
    readonly organizationId: string,
    readonly otherMemberCount: number,
  ) {
    super(
      `This organization still has ${otherMemberCount} other real member${otherMemberCount === 1 ? "" : "s"} — transfer ownership or have them leave before you can delete your account. An organization is never deleted just because its owner closes their own account.`,
    );
    this.name = "AccountDeletionBlockedError";
  }
}

// The exact, server-checked confirmation text — required before any real
// deletion happens, regardless of what a client sends. Deliberately a
// fixed, recognizable phrase rather than e.g. the founder's own name
// (which this UI must not require them to type incorrectly-cased or
// re-derive) — easy to get right on purpose, hard to send by accident.
export const ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

export interface AccountDeletionResult {
  founderId: string;
  organizationsClosed: string[];
}

/**
 * The real deletion itself. Requires the exact confirmation phrase
 * (server-side — never trust a client-side confirmation dialog alone,
 * same standing rule as every other irreversible action in this
 * codebase) and refuses outright if the founder solely owns an
 * organization with other real members still in it.
 */
export async function deleteFounderAccount(founderId: string, confirmationText: string): Promise<AccountDeletionResult> {
  if (confirmationText !== ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    throw new AccountDeletionConfirmationError();
  }

  const founder = await getFounder(founderId);
  if (!founder) throw new AccountNotFoundError(founderId);
  if (founder.deleted_at) throw new AccountAlreadyDeletedError(founderId);

  const memberships = await listOrganizationMembershipsForFounder(founderId);
  const organizationsClosed: string[] = [];

  // Checked in full, for every real membership, BEFORE any real mutation
  // happens — so a founder who owns one safe-to-close org and one
  // blocked org never ends up with the first one closed and the second
  // one refused (an inconsistent partial deletion).
  const ownedMemberships = memberships.filter((m) => m.role === "owner");
  const ownedOrgChecks = await Promise.all(
    ownedMemberships.map(async (membership) => {
      const orgFounders = await listFoundersForOrganization(membership.organization_id);
      const otherRealMembers = orgFounders.filter((f) => f.id !== founderId && !f.deleted_at);
      return { membership, otherRealMembers };
    }),
  );
  const blocked = ownedOrgChecks.find((check) => check.otherRealMembers.length > 0);
  if (blocked) {
    throw new AccountDeletionBlockedError(blocked.membership.organization_id, blocked.otherRealMembers.length);
  }

  for (const { membership } of ownedOrgChecks) {
    const subscription = await getOrganizationSubscription(membership.organization_id);
    if (subscription?.stripe_subscription_id && isStripeConfigured()) {
      // A real, deliberate best-effort: if Stripe itself is unreachable
      // or the subscription is already gone there, the organization is
      // still closed below — a transient Stripe error must never trap a
      // founder in "my account won't delete."
      try {
        await cancelSubscriptionImmediately(subscription.stripe_subscription_id);
      } catch (error) {
        console.error(`Could not cancel Stripe subscription ${subscription.stripe_subscription_id} during account deletion:`, error);
      }
    }
    await closeOrganization(membership.organization_id);
    organizationsClosed.push(membership.organization_id);
  }

  await anonymizeFounder(founderId);
  if (founder.email) {
    await deleteAuthUserByEmail(founder.email);
  }

  return { founderId, organizationsClosed };
}

export interface AccountDataExport {
  exportedAt: string;
  founder: { id: string; name: string; email: string | null; createdAt: string };
  organizations: Array<{
    organization: Pick<Organization, "id" | "name" | "venture_stage" | "created_at">;
    role: OrganizationMember["role"];
    projects: Array<{ id: string; name: string; workspaceType: string; createdAt: string }>;
    missions: Array<{
      id: string;
      title: string;
      brief: string;
      state: string;
      finalStatus: string | null;
      createdAt: string;
    }>;
    ledgerEntries: Array<{ id: string; category: string; description: string; amountUsd: number; createdAt: string }>;
    ledgerTotalUsd: number;
  }>;
  supportRequests: Array<{ id: string; subject: string; message: string; status: string; createdAt: string }>;
}

/**
 * A real, scoped data export — only what this founder is genuinely
 * entitled to see: their own profile, every real organization they're a
 * genuine member of (with the same missions/projects/ledger data they
 * could already view live in Focus View for that organization — never
 * more, never another organization's), and their own support history.
 * Deliberately a representative export of primary identity/ownership/
 * financial/support data, not a raw dump of every nested production
 * table (deliverable content, content assets, individual mission
 * stages) — a real, bounded scope, not a gap hidden as completeness.
 */
export async function exportFounderData(founderId: string): Promise<AccountDataExport> {
  const founder = await getFounder(founderId);
  if (!founder) throw new AccountNotFoundError(founderId);

  const memberships = await listOrganizationMembershipsForFounder(founderId);
  const organizations = await Promise.all(
    memberships.map(async (membership) => {
      const organization = await getOrganizationById(membership.organization_id);
      if (!organization) return null;
      const [projects, missions, ledgerEntries, ledgerTotal] = await Promise.all([
        listProjects(organization.id),
        listMissionsForOrganization(organization.id),
        listLedgerEntriesForOrganization(organization.id, 1000),
        ledgerTotalUsdForOrganization(organization.id),
      ]);
      return {
        organization: {
          id: organization.id,
          name: organization.name,
          venture_stage: organization.venture_stage,
          created_at: organization.created_at,
        },
        role: membership.role,
        projects: projects.map((p) => ({ id: p.id, name: p.name, workspaceType: p.workspace_type, createdAt: p.created_at })),
        missions: missions.map((m) => ({
          id: m.id,
          title: m.title,
          brief: m.brief,
          state: m.state,
          finalStatus: m.final_status,
          createdAt: m.created_at,
        })),
        ledgerEntries: ledgerEntries.map((e) => ({
          id: e.id,
          category: e.category,
          description: e.description,
          amountUsd: e.amount_usd,
          createdAt: e.created_at,
        })),
        ledgerTotalUsd: ledgerTotal,
      };
    }),
  );

  const supportRequests = await listSupportRequestsForFounder(founderId);

  return {
    exportedAt: new Date().toISOString(),
    founder: { id: founder.id, name: founder.name, email: founder.email, createdAt: founder.created_at },
    organizations: organizations.filter((o): o is NonNullable<typeof o> => o !== null),
    supportRequests: supportRequests.map((r) => ({
      id: r.id,
      subject: r.subject,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}
