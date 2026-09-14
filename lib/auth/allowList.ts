import "server-only";
import { getFounderByEmail } from "@/lib/db/repositories";

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
