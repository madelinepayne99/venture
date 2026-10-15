# Venture HQ — Terms of Service (DRAFT)

**Status: draft for founder review and qualified legal review. Not
published. Not legally binding until reviewed, completed, and
published.**

> Every bracketed value below (`[LIKE THIS]`) is a real decision the
> founders must make or a fact a qualified professional must confirm —
> none of it has been invented. This draft reflects what Venture HQ
> actually does today, as built, not an aspirational or assumed feature
> set.

---

## 1. Who these terms are between

These Terms of Service ("Terms") are an agreement between
[LEGAL ENTITY NAME — e.g. "Venture HQ Ltd", a company registered in
England and Wales under company number [COMPANY REGISTRATION NUMBER],
registered office at [REGISTERED ADDRESS]] ("we", "us", "our") and the
person or business creating an account ("you", "your organization").

**No legal entity has been formed or confirmed for this purpose.** Do
not publish this document with real registration details until a
founder has confirmed the actual legal entity, its registered address,
and its registration number with the relevant authority (e.g.
Companies House, if incorporating in the UK).

## 2. What Venture HQ is

Venture HQ is a software platform that lets you recruit AI employees
(software agents) into your own private organization and assign them
real, genuine work: researching business opportunities, producing
short-form video content, answering research questions, tracking
internal tasks, and recording expenses and budgets. Every mission,
report, cost, and result shown in the product reflects genuine work
actually performed — Venture HQ does not simulate or fabricate activity
to make the product appear more active than it is.

Venture HQ does not currently: publish or post content to any
third-party platform on your behalf, list or sell products on any
marketplace, process payments to or from your customers, or act as your
registered agent for any regulatory purpose.

## 3. Accounts and eligibility

You create an account by signing in with GitHub. [DECISION NEEDED: at
what point does self-service account creation become generally
available? As of this draft, it is disabled by default
(`ALLOW_NEW_CUSTOMER_SIGNUP`) and enabled only for the founders' own
testing.] You must provide accurate information and are responsible for
all activity under your account and organization. You must be legally
capable of entering into a binding contract in your jurisdiction.

## 4. Your organization and your data

Each organization you create is private to you and the people you
invite. We do not share one organization's missions, finances, employee
roster, content, or billing information with another organization. [A
qualified reviewer should confirm this Terms language matches the real,
current technical isolation guarantees — see
`docs/venture-hq-commercial-mvp-progress.md`'s tenant-isolation
sections for the actual, tested mechanism this claim describes.]

You own the content and briefs you submit to Venture HQ's AI employees,
and you own the outputs they genuinely produce for your organization,
subject to [DECISION NEEDED: any IP terms around underlying AI model
outputs — this varies by the model/provider actually used and should be
reviewed against Anthropic's, fal.ai's, ElevenLabs', and Shotstack's own
current terms of service, since Venture HQ is built on top of their real
APIs].

## 5. Subscriptions, billing, and cancellation

Paid plans are billed monthly via Stripe. [AS OF THIS DRAFT: no real
Stripe account is connected and no live prices have been published —
see `docs/venture-hq-commercial-mvp-progress.md`'s billing milestone.
Do not publish a price in this document until the founders have
approved a real, final price for each plan.]

You may cancel at any time through your billing settings; cancellation
takes effect at the end of your current billing period, and you keep
access to your plan's features until then. [DECISION NEEDED: refund
policy. No refund policy has been approved by the founders — do not
state one here until they decide. A common default (pro-rated refund /
no refund / refund within N days) should be a deliberate founder
decision, not assumed.]

We may suspend or limit AI execution for your organization if your
subscription payment fails or is cancelled — this reflects the real,
enforced behavior of the product (a cancelled or past-due subscription
genuinely loses access to paid AI employees and reverts to the real
$0 free-plan AI budget), not a hypothetical.

## 6. Acceptable use

You agree not to use Venture HQ to: generate content that infringes a
third party's intellectual property (the product's own Content Bot
guardrails already attempt to prevent named-IP reproduction, but this
is not a substitute for your own compliance); generate content
targeting real private individuals without consent; attempt to access
another organization's data; or attempt to circumvent AI spending
limits or paid-plan entitlements.

## 7. No guaranteed outcomes

Venture HQ's AI employees — including Scout's research and Business
Analyst's reports — provide genuine, evidence-based analysis, but never
guarantee business outcomes, revenue, or demand. This reflects the
product's own built-in guardrails (see
`lib/agents/*/guardrails.ts`), which actively reject any report
containing guaranteed-outcome language, and this Terms section should
say the same thing a customer will actually see in the product.

## 8. Limitation of liability

[REQUIRES QUALIFIED LEGAL REVIEW — standard limitation-of-liability
language varies significantly by jurisdiction and must be drafted or
reviewed by a qualified lawyer, particularly regarding consumer
protection law if any customers are individuals rather than businesses.]

## 9. Changes to these terms

We may update these Terms. [DECISION NEEDED: notice period before a
material change takes effect, and how customers will be notified —
email requires a confirmed email collection/consent mechanism, which
does not currently exist beyond the GitHub-resolved account email.]

## 10. Contact

[CONTACT DETAILS REQUIRED — a real support/legal contact email or
address must be added before publication. Do not invent one.]

## 11. Governing law

[REQUIRES A FOUNDER DECISION, then QUALIFIED LEGAL REVIEW — which
jurisdiction's law governs this agreement.]

---

*This document was drafted as part of Venture HQ's pre-launch legal
audit (Mission 9). It is a structural starting point reflecting the
product's real, current functionality — it is not legal advice, and
must not be published or relied upon until reviewed by a qualified
lawyer and completed with the founders' real business details and
decisions.*
