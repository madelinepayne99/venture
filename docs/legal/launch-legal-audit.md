# Venture HQ — Pre-Launch Legal & Operational Audit

**Prepared as part of Mission 9 (complete product QA). This is an audit
and a set of draft documents, not legal advice and not a substitute for
qualified professional review.**

## What exists now (drafted this session)

| Document | Status | File |
|---|---|---|
| Terms of Service | Draft, with explicit open decisions marked | `docs/legal/terms-of-service.md` |
| Privacy Policy | Draft, built from the real schema/integrations | `docs/legal/privacy-policy.md` |
| Cookie Notice | Draft, cookies verified against real HTTP responses | `docs/legal/cookie-notice.md` |
| Subscription & cancellation terms | Draft, built from the real billing code | `docs/legal/subscription-terms.md` |

None of these are published, linked from the product, or legally
binding. All four were written by directly inspecting this app's real
schema, real integrations, and real observed behavior (session cookies,
billing webhook handling) rather than generic boilerplate or assumed
features — but every one still contains explicit, marked gaps that
require either a founder decision or a qualified professional's review.

## What's genuinely missing from the PRODUCT (not just the documents)

These are real, functional gaps in the application itself, not just
unwritten policy text:

1. **No self-service data export.** A customer cannot currently
   download their own organization's data (missions, reports, content,
   costs). The Privacy Policy draft names this as a real gap rather than
   describing a feature that doesn't exist.
2. **No self-service account/organization deletion.** There is no real
   "delete my account" or "delete my organization" action anywhere in
   the product. Every table in this schema is currently insert-only by
   design (a deliberate "never fabricate or silently lose data"
   philosophy — see `CLAUDE.md`), which is good for auditability but
   means a real, deliberate deletion mechanism (likely a soft-delete/
   anonymization flow, not a hard DELETE, to preserve financial/audit
   records) needs to be designed, not just enabled.
3. **No contact/support surface in the product.** There's no visible
   support email, contact form, or help page anywhere in the running
   application. Every draft legal document above has a
   `[CONTACT DETAILS REQUIRED]` placeholder because of this.
4. **No consent-recording mechanism.** If/when these documents are
   published and customers must accept them, there's currently no real
   `terms_accepted_at`/`privacy_version_accepted` style record anywhere
   in the schema — CLAUDE.md's own "Authentication" section flags
   exactly this kind of versioned-acceptance record as a future need,
   not built yet.
5. **No data-retention policy or automatic deletion job.** Consistent
   with the schema's insert-only philosophy, nothing currently expires
   or deletes old data automatically.
6. **No real legal entity, address, or registration number anywhere in
   the codebase or these documents** — confirmed by searching the
   repository; none exists, and none has been invented here.

## Decisions only the founders can make

Marked individually with `[DECISION NEEDED: ...]` throughout the four
drafts; the full list, consolidated:

- The real legal entity name, structure, registration number, and
  registered address (if incorporating).
- A real support/contact email or address.
- Final, approved subscription prices (the current £19/£49/£99 figures
  are explicitly provisional).
- A refund policy — none has been approved; the drafts deliberately
  state none rather than assuming a default.
- Minimum account-holder age.
- Data-retention period and whether to build automatic deletion.
- Whether/when self-service account creation (`ALLOW_NEW_CUSTOMER_SIGNUP`)
  moves from founder-testing-only to generally available — this is the
  actual trigger that would make a real Privacy Policy/Terms
  requirement non-optional, since right now the only real customers of
  this product are the founders themselves.

## What requires qualified professional review before publication

- **A solicitor/lawyer** should review the Terms of Service
  (particularly limitation of liability and governing law) and the
  Subscription Terms (particularly refund policy once decided) before
  either is published, especially once real paying, non-founder
  customers are involved.
- **A qualified data-protection professional** should review the
  Privacy Policy's legal-basis claims, international-transfer section,
  and whether UK ICO registration is required at the business's actual
  real scale, plus confirm current data-training/retention terms for
  each real third-party processor (Anthropic, fal.ai, ElevenLabs,
  Shotstack, Stripe) directly against those providers' own current
  terms — these change over time and were not independently verified
  as part of this session beyond what's already documented in this
  app's own `.env.example`/provider-integration code.
- **Confirm UK PECR/ePrivacy cookie-consent requirements** once a real
  deployment domain and hosting provider are chosen — the current
  Cookie Notice draft's "no banner needed" conclusion is conditional on
  every cookie staying strictly-necessary-only, which should be
  re-verified if any analytics or marketing tooling is ever added.

## What this audit deliberately did NOT do

Per this session's own standing instruction ("Do not invent legal
compliance, business registration information or approved refund
policies"): no company name, address, registration number, refund
policy, or compliance claim was invented anywhere in these four
documents. Every such gap is a visible, explicit placeholder, not a
silently-assumed value.

## Recommended next steps, in order

1. Founders decide the real legal entity/structure (or decide to launch
   as a sole trader/partnership initially — a real, valid choice that
   changes what these documents need).
2. Founders set a real support contact.
3. Build the missing product features above (data export, account
   deletion, consent recording) — or explicitly decide to launch
   without them and document that as an accepted, temporary risk.
4. Qualified legal and data-protection review of all four drafts.
5. Only then: publish, link from the product (e.g. a real footer and a
   real sign-up consent checkbox), and record acceptance going forward.
