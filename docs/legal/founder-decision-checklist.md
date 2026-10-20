# Venture HQ — Founder Decision Checklist (for Ellis & Maddie)

**Mission 12, Priority 5.** Every open decision point across the four
legal drafts in this directory, consolidated into one checklist, plus a
status update on the product gaps Mission 9's original audit
(`launch-legal-audit.md`) flagged. This is not legal advice — it's a
complete list of what *you* need to decide or provide before a qualified
professional can finish reviewing these documents.

## What's changed since the original audit (Mission 9)

Three of the six real product gaps that audit named are now **built**:

- ✅ **Self-service data export** — `GET /api/account/export`, built
  Mission 10.
- ✅ **Self-service account deletion** — `POST /api/account/delete`,
  built Mission 10 (anonymize, never hard-delete — see its own doc
  comment in `lib/domain/accountWorkflow.ts`).
- ✅ **A contact/support surface** — the Focus View "Support" tab and
  `POST /api/support`, built Mission 10.

Three remain genuinely open:

- ⬜ **No consent-recording mechanism** — still no
  `terms_accepted_at`/`privacy_version_accepted` style record in the
  schema. Not needed until these documents are actually published and
  real non-founder customers must accept them.
- ⬜ **No automatic data-retention/deletion job** — consistent with this
  app's insert-only philosophy; still a real, open product decision (see
  §4 below), not an oversight.
- ⬜ **No real legal entity/address/registration number anywhere** —
  unchanged; still correctly left blank rather than invented.

## 1. Business details

- [ ] **Legal entity name** — the real registered business name (or a
      decision to launch as a sole trader/partnership, which is a valid
      choice that still needs a real name for the documents).
- [ ] **Entity structure** — sole trader / partnership / limited company
      / other.
- [ ] **Registration number** (if incorporated).
- [ ] **Registered/business address** for the legal documents.
- [ ] **Governing law / jurisdiction** for the Terms of Service (`docs/legal/terms-of-service.md`
      currently has no jurisdiction clause — a qualified solicitor should
      confirm the right one for your real entity's location).

## 2. Support information

- [ ] **Real support contact email or address** — currently
      `SUPPORT_CONTACT_EMAIL` is unset in every real environment (by
      design — see `.env.example`); every legal draft has a
      `[CONTACT DETAILS REQUIRED]` placeholder because of this. Setting
      this one env var is literally all that's needed to make the
      in-product Support tab show it, once decided.
- [ ] **A real email provider**, if you want support-ticket confirmation
      emails to actually send — currently they deliberately never claim
      to (see `supportWorkflow.ts`'s `isEmailDeliveryConfigured()`).
      Optional: the support form already works correctly without this,
      it just doesn't promise an email.

## 3. Refund policy (currently: none approved, by design)

The Terms of Service and Subscription Terms drafts both deliberately
avoid stating pro-rated, no-refund, or time-limited — none has been
approved, so none is claimed. Decide:

- [ ] **Refund policy shape** — no refunds / pro-rated refunds / a
      time-limited refund window (e.g. "within 14 days") / something
      else.
- [ ] **Cancellation timing** — does cancelling take effect immediately
      or at the end of the current billing period? (The real code
      already supports "at period end" via Stripe's own
      `cancel_at_period_end` — this is a policy decision, not a build
      one.)
- [ ] **Failed-payment retry policy** — how many retries, and what
      happens after they're exhausted (currently: Stripe's own default
      retry behavior applies; `docs/legal/subscription-terms.md` line 63
      has this marked open). Stripe's dashboard (**Settings → Billing →
      Subscriptions and emails → Manage failed payments**) is where this
      is actually configured once a real account exists — see
      `docs/billing/stripe-setup-guide.md`.

## 4. Subscription terms

- [ ] **Billing date** — Stripe's own default (anniversary of signup) or
      a different scheme.
- [ ] **Annual billing option** — offer one, or stay monthly-only for
      now (monthly-only is the current real implementation; annual would
      be new work).
- [ ] **Upgrade timing** — does a plan upgrade apply immediately (with
      proration) or at the next billing cycle? (Stripe supports both;
      this app's current code doesn't yet specify proration behavior
      explicitly in `createCheckoutSession`/the Billing Portal
      configuration — worth confirming Stripe's dashboard default
      matches what you decide here.)
- [ ] **IP/ownership terms for AI-assisted work product** — what a
      customer owns vs. what Venture HQ or underlying model providers
      retain any rights to, for Scout reports / Content Bot productions.

## 5. Data & privacy

- [ ] **Data-retention period** — how long is data kept after an account
      closes? (Currently: indefinitely, anonymized — see
      `lib/domain/accountWorkflow.ts`'s `deleteFounderAccount`. A real
      retention/auto-purge policy is a separate, not-yet-built decision.)
- [ ] **Minimum account-holder age.**
- [ ] **Policy-update notice mechanism** — how customers are told when
      Terms/Privacy Policy/Cookie Notice change (email, in-app banner,
      "last updated" date alone, etc.) and what notice period applies
      before a change takes effect.
- [ ] **UK ICO registration** — ask a qualified data-protection
      professional whether this is required at your real, actual scale.

## 6. Qualified professional review (not optional, not something this session can do)

- [ ] **A solicitor** reviews Terms of Service (limitation of liability,
      governing law) and Subscription Terms (once the refund policy
      above is decided).
- [ ] **A data-protection professional** reviews the Privacy Policy's
      legal-basis claims, international-transfer section, and
      independently re-verifies each real third-party processor's
      current data-handling terms (Anthropic, fal.ai, ElevenLabs,
      Shotstack, Stripe) directly against those providers' own current
      published terms — not assumed from this app's integration code.
- [ ] **UK PECR/ePrivacy cookie-consent confirmation** once a real
      deployment domain/hosting provider is chosen — the current Cookie
      Notice's "no banner needed" conclusion holds only while every real
      cookie stays strictly-necessary (no analytics/marketing cookies
      added).

## What happens after you decide

Once the decisions above are made and professional review is complete:

1. Fill in every `[DECISION NEEDED: ...]` / `[CONTACT DETAILS REQUIRED]`
   placeholder across the four drafts with the real, decided values.
2. Build the one still-missing product piece a real launch needs:
   consent recording (a real `terms_accepted_at` / policy-version-
   accepted record) — not built yet, scoped as a small, well-defined
   follow-up once you know what customers will actually be asked to
   accept.
3. Publish the finished documents and link them from the product (a real
   footer, and a real consent checkbox at sign-up).
4. Only then does `ALLOW_NEW_CUSTOMER_SIGNUP` (and eventually live
   Stripe billing) become a decision this app is actually ready for —
   both stay off until you explicitly decide otherwise.
