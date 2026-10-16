# Venture HQ — Privacy Policy (DRAFT)

**Status: draft for founder review and qualified legal/data-protection
review. Not published.**

> This document describes what Venture HQ's actual, built codebase
> actually collects and does with data, verified against the real
> code — not an assumed or aspirational description. Bracketed values
> are real decisions or facts that must be supplied, not invented here.

---

## 1. Who controls your data

[DATA CONTROLLER NAME AND CONTACT REQUIRED — the legal entity
responsible for this data, once confirmed. See the Terms of Service
draft's own note on this.]

## 2. What we actually collect

This list is drawn directly from Venture HQ's real database schema
(`lib/db/schema.ts`) and real sign-in flow (`auth.ts`), not assumed:

- **Identity**: the name and email your GitHub account resolves at
  sign-in (`auth_user`, `founders` tables). We do not collect a
  password — Venture HQ has no password-based sign-in.
- **Organization data**: the business/project name and the
  "new venture or existing business" answer you provide when creating
  an organization (`organizations` table).
- **Work you assign**: mission briefs, research questions, content
  briefs, and any founder notes you submit to an AI employee
  (`missions`, `content_items`, `business_analyst_reports` tables).
- **Work your AI employees produce**: research reports, generated
  video/audio/image assets, checklists, and expense records
  (`deliverables`, `content_assets`, `checklists`, `expenses` tables).
- **Usage and billing**: real AI token/provider usage and real dollar
  costs (`costs`, `ledger_entries` tables), and, once a real Stripe
  subscription exists, your Stripe customer and subscription identifiers
  (`organization_subscriptions` table) — never your card details
  directly; those are held by Stripe, not by Venture HQ.
- **Session data**: a real database-backed session token
  (`auth_session` table), set as an HTTP-only cookie.

We do not collect: your physical address, your card number (Stripe
handles this directly), or any data from a GitHub repository you don't
explicitly connect (Venture HQ's GitHub OAuth only reads your name and
verified email — see `auth.ts`'s real `GitHub` provider configuration,
which requests no additional scopes).

## 3. Why we collect it (real legal bases)

[REQUIRES REVIEW — under UK/EU GDPR, each category above needs a
stated legal basis: likely "contract" (providing the service you
signed up for) for account/organization/work data, and "legitimate
interest" or "consent" for anything beyond that. A qualified
data-protection reviewer should confirm the correct basis per category,
per the actual processing described above.]

## 4. Who we share it with (real, current third-party processors)

Venture HQ's real, built integrations — confirmed directly against
`.env.example` and the registered provider code, not assumed:

| Processor | What it receives | Purpose |
|---|---|---|
| GitHub (via Auth.js) | Your GitHub OAuth identity | Sign-in |
| Anthropic | Mission briefs, research questions you submit | Scout, Content Bot, Business Analyst's real AI processing |
| fal.ai | Content Bot's real image/video generation prompts | Real image/video asset generation |
| ElevenLabs | Content Bot's real narration script text | Real voice/audio generation |
| Shotstack | Real generated video assets | Real video assembly |
| Stripe | Billing contact information, subscription details | Real subscription billing (test mode only as of this draft) |
| [DATABASE HOST — e.g. Neon] | All of the above, at rest | Database hosting |
| [DEPLOYMENT HOST — e.g. Vercel, once deployed] | Application traffic | Hosting the application itself |

We do not sell your data to any third party, and we do not use your
mission briefs or content to train any AI model beyond what each listed
processor's own standard API terms describe (a qualified reviewer
should confirm the current data-training terms for Anthropic/fal.ai/
ElevenLabs/Shotstack's API products specifically, since this changes
over time).

## 5. How long we keep it

[DECISION NEEDED — no data-retention policy has been set in the
product. Every real table in this app is currently insert-only/
non-deleting by design (see `lib/db/schema.ts`'s own comments on this),
which means data is not currently automatically deleted. A real
retention policy and deletion mechanism should be decided and built
before this policy can honestly describe one.]

## 6. Your rights

Depending on your jurisdiction, you may have the right to access,
correct, delete, or export your personal data, and to object to or
restrict certain processing. [REQUIRES BUILDING: Venture HQ does not
yet have a self-service data export or account deletion feature — see
this document's own companion audit,
`docs/legal/launch-legal-audit.md`, for what's missing.] Until a
self-service mechanism exists, requests should be directed to
[CONTACT DETAILS REQUIRED].

## 7. Children

Venture HQ is a business-management tool and is not directed at or
intended for use by children. [DECISION NEEDED: minimum age
requirement, consistent with the product's own content-safety
guardrails for Content Bot, which already includes an "audience
appropriate" check for kids/teen content Content Bot might be asked to
produce for a customer's own audience — that is a product safety
feature, not the same thing as who may hold a Venture HQ account.]

## 8. Cookies

See the separate Cookie Notice (`docs/legal/cookie-notice.md`) for the
real, current list of cookies this app actually sets.

## 9. International transfers

[REQUIRES REVIEW — depends on where the data controller, database host,
and each processor listed in Section 4 actually process data, and what
jurisdiction your customers are in. A qualified reviewer must confirm
whether Standard Contractual Clauses or another transfer mechanism is
needed.]

## 10. Changes to this policy

[DECISION NEEDED: notice mechanism, same open question as the Terms of
Service draft.]

## 11. Contact / Data Protection Officer

[CONTACT DETAILS REQUIRED. If UK ICO registration is required once this
product processes real customer data at scale, that registration and a
real DPO contact (if one is legally required for this scale of
business) must be confirmed by a qualified reviewer — do not state an
ICO registration number or DPO contact that hasn't actually been
obtained.]

---

*This document was drafted as part of Venture HQ's pre-launch legal
audit (Mission 9), built directly from the real database schema and
real integrations in this codebase. It is not legal advice and must not
be published until reviewed by a qualified data-protection professional
and completed with the founders' real decisions above.*
