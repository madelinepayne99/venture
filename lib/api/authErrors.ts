// Deliberately its own file with zero dependency on next-auth/auth.ts:
// next-auth internally imports "next/server", which only resolves inside
// a real Next.js build/runtime — not under plain Vitest. Any test that
// only needs to recognize this error type (e.g. toApiErrorResponse's
// mapping) must be able to import it without transitively pulling in the
// whole Auth.js config.
export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "UnauthenticatedError";
  }
}
