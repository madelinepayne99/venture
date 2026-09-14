import "server-only";
import { auth } from "@/auth";
import { UnauthenticatedError } from "@/lib/api/authErrors";

export { UnauthenticatedError };

/**
 * The only way a route handler should learn who the acting founder is.
 * Never accept a founderId from a request body — middleware.ts already
 * blocks unauthenticated requests to every /api/** route, but this is the
 * function that actually resolves the verified identity to act as, and it
 * throws rather than falling back to anything client-supplied.
 */
export async function requireFounderId(): Promise<string> {
  const session = await auth();
  if (!session?.founderId) {
    throw new UnauthenticatedError();
  }
  return session.founderId;
}
