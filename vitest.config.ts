import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Vitest applies `env` before any test module is loaded (unlike
    // setupFiles, which run after each file's own imports resolve) — some
    // modules (auth.ts) read DATABASE_URL at import time via getRawDb(),
    // so this has to be set here, not just in setup.ts.
    env: {
      DATABASE_URL: "postgresql://venture_local:local_only_dev_password@localhost:5432/venture_test",
      AUTH_SECRET: "test-only-not-a-real-secret",
      // Obviously-fake test-only values (never a real Stripe key) — set
      // so tests/billingWebhookSecurity.test.ts can exercise the real,
      // local HMAC signature-verification logic (stripe.webhooks.
      // constructEvent never makes a network call) without needing a
      // real Stripe account. Mirrors AUTH_SECRET's own "unmistakably
      // fake" convention above.
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key_0000000000000000000000",
      STRIPE_WEBHOOK_SECRET: "whsec_test_not_a_real_secret_0000000000000000",
    },
    // The whole suite shares one Postgres connection pool — running test
    // files in parallel worker processes would each open their own pool
    // against the same database and race on TRUNCATE between files.
    fileParallelism: false,
  },
});
