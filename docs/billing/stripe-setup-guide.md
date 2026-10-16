# Venture HQ — Connecting a Real Stripe Test-Mode Account

**Mission 12, Priority 2.** Exact, step-by-step instructions for Ellis
or Maddie to connect a real Stripe test-mode account so genuine
end-to-end billing testing (and, later, real pricing) becomes possible.
No credentials are included here, and nothing in this document activates
live payments — every step below stays in Stripe's test mode unless you
explicitly flip Stripe's own "Test mode" toggle off, which this guide
never asks you to do.

## What was verified before writing this guide

This app's real Stripe integration code
(`lib/billing/stripe.ts`, `lib/domain/billingWorkflow.ts`,
`app/api/billing/*`) was re-checked against Stripe's own live
documentation during this mission (fetched directly, October 2026):

- **API version**: pinned at `2026-09-30.endive` in `lib/billing/stripe.ts`
  — confirmed to be Stripe's own current example version across every
  language's code sample on their live "Upgrade your integration" page.
  No change needed.
- **SDK version**: `stripe": "^23.0.0"` in `package.json` — confirmed to
  match the exact version Stripe's own current official sample app
  (`docs.stripe.com/billing/quickstart`) pins in its own `package.json`.
  No change needed.
- **Checkout Session / Billing Portal / webhook signature verification
  code shapes** — confirmed to match Stripe's current official sample
  code exactly (`checkout.sessions.create({ mode: "subscription", ... })`,
  `billingPortal.sessions.create({ customer, return_url })`,
  `webhooks.constructEvent(rawBody, signature, secret)`). No change
  needed.
- **One real fix made this mission**: the webhook handler was using
  `invoice.payment_succeeded` (an older event Stripe's current docs no
  longer point integrators toward) instead of the currently-recommended
  `invoice.paid`, and wasn't correctly handling the newer nested
  `invoice.parent.subscription_details.subscription` field shape. Both
  fixed and tested — see `docs/venture-hq-commercial-mvp-progress.md`'s
  Mission 12 entry for the full detail.
- **Two real missing behaviors found and fixed this mission**: a
  self-service plan change made through the Billing Portal never synced
  locally, and nothing ever recovered an organization from a failed
  payment back to active. Both fixed — same progress-doc entry.

## Step 1 — Create the Stripe account (if you don't have one)

1. Go to [dashboard.stripe.com/register](https://dashboard.stripe.com/register)
   and create an account for the real business entity Venture HQ will
   operate under.
2. You do **not** need to complete Stripe's business-verification/
   activation flow to use test mode — test mode works immediately on a
   new, unverified account. Only complete activation when you're ready
   for real, live payments (a separate, later decision this mission
   doesn't ask you to make).

## Step 2 — Confirm you're in Test mode

Every step below must be done with Stripe's **Test mode** toggle (top-left
of the Dashboard) switched **on**. Test-mode data, API keys, and webhook
events are completely separate from live-mode ones — nothing you do in
test mode can charge a real card or appear in live reporting.

## Step 3 — Create the real test-mode products and prices

For each of the three paid plans (Starter, Business, Growth — Free never
needs a Stripe price, since it's never purchased), in the Dashboard:

1. Go to **Product catalog** → **Add product**.
2. Name it to match this app's own plan name exactly (e.g. "Venture HQ
   — Starter") so it's recognizable in the Dashboard later — the actual
   linkage back to this app's database doesn't depend on the name, only
   on the price id you copy in step 4.
3. Set pricing: **Recurring**, **Monthly**, and the price **you (Ellis
   and Maddie) approve** in `docs/billing/pricing-approval.md` — do not
   create these prices until that document is approved; the Dashboard
   price you create becomes the real, billed amount.
4. After saving, Stripe shows the product's real **Price ID**
   (`price_...`). Copy it — you'll need it in Step 4.
5. Repeat for Business and Growth.

## Step 4 — Set each plan's real Price ID in this app's database

This app's `subscription_plans` table has no admin UI for this
(deliberate — see `CLAUDE.md`'s own note that a plan's price is set once
a real account exists, not through any in-app API). Set each plan's real
`stripe_price_id` with a direct, one-time SQL update against your real
database:

```sql
UPDATE subscription_plans SET stripe_price_id = 'price_...' WHERE id = 'starter';
UPDATE subscription_plans SET stripe_price_id = 'price_...' WHERE id = 'business';
UPDATE subscription_plans SET stripe_price_id = 'price_...' WHERE id = 'growth';
```

Run this against your real Neon/Postgres connection string (`psql
"$DATABASE_URL" -c "..."`, or any Postgres client). `free` and `founder`
intentionally stay `NULL` forever — neither is ever purchased through
Stripe.

## Step 5 — Get your real test-mode API keys

1. In the Dashboard (test mode still on), go to **Developers** →
   **API keys**.
2. Copy the **Secret key** (`sk_test_...`) — this app's own code never
   checks which kind of key it was given (`sk_test_` vs `sk_live_`), so
   **the only thing keeping this app in test mode is which key you paste
   here** — never paste a `sk_live_` key until you've deliberately
   decided to accept real payments.
3. Set it as `STRIPE_SECRET_KEY` in your real `.env.local` (never commit
   this file — it's already gitignored).

## Step 6 — Set up the webhook endpoint

**For local/staging testing (recommended first):**

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) if you
   haven't already.
2. Run `stripe login` once.
3. Run `stripe listen --forward-to localhost:3000/api/billing/webhook`
   (or your staging domain's equivalent). This prints a real webhook
   signing secret (`whsec_...`) valid for this listening session.
4. Set that value as `STRIPE_WEBHOOK_SECRET` in `.env.local`.
5. Keep `stripe listen` running in a terminal while you test — it
   forwards real test-mode events to your local server.

**For a real staging/production deployment** (once one exists — see
`docs/deployment/staging-setup.md`):

1. In the Dashboard, go to **Developers** → **Webhooks** → **Add
   endpoint**.
2. Endpoint URL: `https://<your-staging-domain>/api/billing/webhook`.
3. Select these events (the exact set this app's code currently handles
   — adding more is harmless, since `processBillingWebhookEvent`'s
   `default: break` safely ignores anything it doesn't act on):
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`
4. After creating the endpoint, Stripe shows its own real signing secret
   — set that as `STRIPE_WEBHOOK_SECRET` in that deployment's real
   environment variables (never in a committed file).

## Step 7 — Verify the connection, end to end, in test mode

1. Restart the dev server so it picks up the new env vars.
2. Sign in as a founder with a real organization.
3. Visit `/pricing`, click "Subscribe" on a plan with a real
   `stripe_price_id` set.
4. You should be redirected to a real Stripe-hosted Checkout page (test
   mode — the page itself says "This account is in test mode" or
   similar).
5. Use one of Stripe's [real published test
   cards](https://docs.stripe.com/testing#cards) (e.g. `4242 4242 4242
   4242`, any future expiry, any CVC) to complete checkout.
6. You should be redirected back to `/?billing=success`, and — within a
   few seconds, once the webhook event arrives — the organization's real
   `organization_subscriptions` row should show the real plan and
   `status: "active"`. Confirm via Settings → "Plan & billing" in Focus
   View, or a direct `SELECT * FROM organization_subscriptions WHERE
   organization_id = '...'`.
7. From Settings, click "Manage billing" — this opens a real Stripe
   Billing Portal session (test mode) where you can test a real
   cancellation, a real plan change, and a real payment-method update,
   all of which this app's webhook handler now correctly syncs (see
   "What was verified" above).

## Step 8 — Use Stripe Test Clocks to simulate time-based scenarios

Stripe's own test clocks (Dashboard → **Developers** → **Test clocks**,
or `stripe.testHelpers.testClocks.*` via the API) let you advance a test
customer's simulated clock forward without waiting a real month — the
real, Stripe-recommended way to test:

- A real monthly **renewal** (advance the clock past the current period
  end; Stripe fires a real `invoice.paid` event, which this app's fixed
  handler now correctly keeps the subscription `active`).
- A real **failed payment and recovery** — attach [a test card that
  always fails](https://docs.stripe.com/testing#declined-payments),
  advance the clock to trigger a renewal charge (fires
  `invoice.payment_failed`, confirm the organization's status becomes
  `past_due` and paid-agent access is refused), then update to a working
  test card and advance again (fires `invoice.paid`, confirm the
  organization recovers to `active`).
- A real **downgrade synced from the Billing Portal** — change plans in
  the test customer's Billing Portal session, confirm the organization's
  real `plan_id` updates locally (this is the exact scenario Mission 12
  found broken and fixed — worth specifically re-verifying here).

## Never do these without an explicit, separate founder decision

- Never paste a `sk_live_` key anywhere in this app.
- Never flip Stripe's Dashboard out of test mode for this integration
  until you've decided to accept real payments.
- Never set `is_published: true` on a plan until the pricing in
  `docs/billing/pricing-approval.md` is actually approved.
- Never set `ALLOW_NEW_CUSTOMER_SIGNUP=true` in any real deployment's
  environment until you've separately decided to open registration —
  unrelated to Stripe, but worth repeating here since a staging
  environment with both flipped on would accept real strangers' test
  subscriptions.
