import { afterAll } from "vitest";
import { closeDbForTests } from "@/lib/db/client";

process.env.REQUIRE_FOUNDER_APPROVAL = "true";
// Deliberately no ANTHROPIC_API_KEY — tests must never make a real API call.
delete process.env.ANTHROPIC_API_KEY;

// DATABASE_URL and AUTH_SECRET are set in vitest.config.ts's `test.env`
// (before any module loads) rather than here — see the comment there.

afterAll(async () => {
  await closeDbForTests();
});
