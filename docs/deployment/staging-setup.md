# Venture HQ — Secure Staging Deployment Configuration

**Mission 12, Priority 4.** A real, ready-to-use configuration for a
**staging** deployment — isolated from any future production
deployment, with public sign-up disabled by default, suitable for the
first genuine GitHub OAuth round-trip and real Stripe test-mode
checkout this sandbox has never been able to attempt (see `CLAUDE.md`'s
own "Local verification vs. a real deployment" section for why). **This
document does not deploy anything** — it's the prepared configuration
and the exact steps a founder runs when ready. Nothing here should be
executed without Ellis's or Maddie's explicit go-ahead, per Mission 12's
own standing instruction.

## Why staging is a separate, real decision from production

A staging environment is **real infrastructure** — a real Vercel
project, a real (if separate) database, a real GitHub OAuth App, real
(test-mode) Stripe webhooks hitting a real public URL. It is not
"deploying to production," but it is still a genuine external commitment
this sandbox cannot make on its own. Treat every step below as something
a founder runs, not something this session executes unattended.

## 1. What makes this configuration "staging," not "production"

| | Staging | Future production |
|---|---|---|
| `ALLOW_NEW_CUSTOMER_SIGNUP` | unset (disabled) | a deliberate, separate founder decision, made later |
| Stripe key | `sk_test_...` only, forever on staging | `sk_live_...` only after real pricing approval + legal review |
| GitHub OAuth App | its own staging-only app, staging callback URL | its own separate production app |
| Database | a separate Neon project/branch from production | its own, never shared with staging |
| Domain | a staging-only subdomain, not publicly linked | the real public domain |
| Purpose | GitHub OAuth + Stripe test-mode verification only | serving real customers |

**Never reuse a production GitHub OAuth App's credentials or a
production database for staging.** A staging environment exists
specifically so a real mistake there (an expired test, a bad webhook
replay, a founder testing account deletion) can never touch real
customer data, because there is no real customer data anywhere near it.

## 2. Pre-flight: confirm these stay off

Before creating anything, confirm (and keep confirming at every step)
that staging's real environment variables never set:

- `ALLOW_NEW_CUSTOMER_SIGNUP=true` — staging is for founders testing the
  app, not a public sign-up surface. If a specific test genuinely needs
  self-service sign-up exercised, set it temporarily, test, then unset
  it immediately afterward — never leave it on.
- `STRIPE_SECRET_KEY` starting with `sk_live_` — test keys only, always,
  on staging. There is no legitimate reason for a live key to ever exist
  in a staging environment's variables.
- `REQUIRE_FOUNDER_APPROVAL=false` — the approval gate stays on
  everywhere real AI spend could occur, staging included.

## 3. Create the staging database

1. Create a **new, separate** Neon project (or a separate branch of an
   existing one, if Neon's branching model is preferred — either way,
   it must not be the same database production will eventually use).
2. Get its connection string → this becomes staging's `DATABASE_URL`.
3. Run migrations against it: `DATABASE_URL="<staging-url>" npx
   drizzle-kit migrate`.
4. Do **not** copy any real founder/customer data into it. Let it seed
   fresh (the app's own `seed()` in `lib/db/client.ts` runs
   automatically on first real request) — Ellis and Maddie's real
   founder rows are created the same idempotent way they always are.

## 4. Create a staging-only GitHub OAuth App

1. [github.com/settings/developers](https://github.com/settings/developers)
   → **New OAuth App**.
2. Application name: something that clearly says "staging" (e.g.
   "Venture HQ — Staging") so it's never confused with a future
   production app.
3. Homepage URL: the staging domain (step 6).
4. **Authorization callback URL**:
   `https://<staging-domain>/api/auth/callback/github` — must match
   exactly, including the path; Auth.js's GitHub provider rejects a
   mismatch.
5. Generate a Client Secret. These become staging's `AUTH_GITHUB_ID` /
   `AUTH_GITHUB_SECRET` — distinct from any future production app's
   credentials.
6. This is also the **first real opportunity to exercise the actual
   GitHub sign-in round-trip** — the one real gap named in every prior
   milestone's "Local verification vs. a real deployment" section, since
   this sandbox has never been able to attempt it.

## 5. Create a staging Inngest app (optional but recommended)

Without this, Scout/Content Bot's durable background jobs simply never
run on staging (no local Inngest Dev Server exists in a deployed
environment the way it does locally) — meaning missions would get stuck
at `queued`/`researching` forever. To actually test Scout or Content Bot
on staging:

1. Create an Inngest Cloud app (free tier is sufficient for staging).
2. Get its `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`.
3. Point its webhook at `https://<staging-domain>/api/inngest`.

## 6. Deploy to Vercel

1. Create a **new** Vercel project connected to this repository's
   `claude/commercial-mvp-polish` branch (or whichever branch staging
   should track — not necessarily `main`/production's branch).
2. Set the Vercel project's own custom domain to a staging-only
   subdomain (e.g. `staging-venture-hq.vercel.app` or a real staging
   subdomain of a domain you control) — deliberately not the eventual
   production domain.
3. Set every environment variable from `.env.example`, using this
   document's staging-specific values above for the ones called out, and
   the project's own real values (Anthropic, fal.ai, ElevenLabs,
   Shotstack, support email) for the rest, scoped to this one Vercel
   project only.
4. Set `AUTH_SECRET` to a real, freshly-generated value (`npx auth
   secret`) — never reuse `tests/setup.ts`'s obviously-fake test value,
   and never reuse a value across staging and any future production
   environment.
5. **Real, known gap to plan for**: `CONTENT_STORAGE_PROVIDER=local_disk`
   (this app's only implemented storage provider) does not persist on
   Vercel's serverless filesystem between invocations (documented in
   `CLAUDE.md`'s Content Bot milestone, §0b) — a real object-store
   `StorageProvider` (e.g. Vercel Blob) behind the same
   `lib/storage/registry.ts` interface is required before Content Bot's
   generated media can be meaningfully tested on staging. Scout and
   billing can be fully tested on staging without this; Content Bot's
   generated-asset streaming cannot, yet.
6. Choose a plan tier with headroom for this app's real background-job
   and cron durations (`CLAUDE.md`'s own deployment notes recommend
   Vercel Pro over Hobby for this reason, even for staging — Hobby's
   function-duration and cron-granularity limits are tighter than this
   app wants).

## 7. Connect Stripe to staging

Follow `docs/billing/stripe-setup-guide.md` in full, using staging's own
real domain for the webhook endpoint URL in that guide's Step 6. Staging
is in fact the **right** place to do this app's first genuine end-to-end
Stripe test-mode verification — it's real infrastructure, but still
entirely test-mode, so nothing there is riskier than it already
documents.

## 8. Post-deployment verification checklist

Once staging is live, verify (all in Stripe test mode, no real charges):

- [ ] GitHub sign-in completes for a real founder — the actual round-trip
      this sandbox could never attempt.
- [ ] `ALLOW_NEW_CUSTOMER_SIGNUP` is confirmed unset (an unrecognized
      email is refused sign-in, not auto-provisioned).
- [ ] A real mission created → approved → Scout genuinely researches it
      via the real Inngest job (not stuck at `queued`).
- [ ] A real Stripe test-mode checkout completes, the organization's
      subscription updates to the real plan.
- [ ] A real test-mode webhook (renewal, failed payment, portal
      downgrade) is simulated via a Stripe Test Clock and correctly
      reflected locally (see `docs/billing/stripe-setup-guide.md` §8).
- [ ] No real customer or founder data exists anywhere on staging beyond
      what the founders themselves created while testing.

## 9. Tearing down or resetting staging

Staging data is disposable by design. To reset it: truncate the staging
database's tables (the same `resetDbForTests()`-style approach the test
suite uses, run manually against the staging `DATABASE_URL` — never the
production one) or simply delete and recreate the Neon project. Never
run a reset against any database whose connection string you haven't
personally confirmed is staging's own.
