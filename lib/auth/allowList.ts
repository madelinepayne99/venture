import "server-only";
import { getFounderByEmail, createFounder } from "@/lib/db/repositories";

export interface FounderIdentity {
  founderId: string;
  founderName: string;
}

/**
 * The allow-list IS the founders table — there is no separate list to
 * keep in sync, and no public sign-up path exists anywhere in this app.
 * Kept independent of auth.ts's NextAuth config so it's directly testable
 * without constructing the full Auth.js/adapter wiring.
 */
export async function isAllowedFounderEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const founder = await getFounderByEmail(email);
  return Boolean(founder);
}

export async function resolveFounderIdentity(
  email: string | null | undefined,
): Promise<FounderIdentity | null> {
  if (!email) return null;
  const founder = await getFounderByEmail(email);
  if (!founder) return null;
  return { founderId: founder.id, founderName: founder.name };
}

/**
 * Real self-service account creation (Mission 8, Sections 11-12) — the
 * actual mechanism behind "a new user can securely create an account."
 * Only ever called from auth.ts's signIn callback, and only when
 * ALLOW_NEW_CUSTOMER_SIGNUP is explicitly "true" (default: off, so this
 * function existing changes nothing about who can sign in until a
 * founder deliberately flips that switch — see auth.ts's own doc
 * comment). Creates a real `founders` row for a real, verified,
 * previously-unknown email — never an organization (that's a separate,
 * customer-driven onboarding step; see app/api/organizations/route.ts).
 *
 * Idempotent and safe under genuine concurrency: `founders.email` has a
 * real unique DB constraint, so two genuinely simultaneous first-sign-ins
 * for the same brand-new email can't both insert — the loser re-reads
 * the winner's row instead of erroring. Ellis and Maddie's own existing
 * founders rows are never touched here: this function only ever runs
 * for an email `getFounderByEmail` doesn't already recognize.
 */
export async function ensureFounderAccount(
  email: string,
  displayName: string,
): Promise<FounderIdentity> {
  const existing = await getFounderByEmail(email);
  if (existing) return { founderId: existing.id, founderName: existing.name };

  try {
    const founder = await createFounder({ name: displayName || email, email });
    return { founderId: founder.id, founderName: founder.name };
  } catch {
    // Lost a genuine concurrent race to the real unique constraint on
    // founders.email — the winning insert already created the real row;
    // use it rather than treating this as a failure.
    const winner = await getFounderByEmail(email);
    if (winner) return { founderId: winner.id, founderName: winner.name };
    throw new Error(`Could not create or find a founder account for ${email}.`);
  }
}
