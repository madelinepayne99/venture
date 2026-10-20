# Venture HQ — Subscription & Cancellation Terms (DRAFT)

**Status: draft for founder review. Not published. No real prices are
approved yet — see `docs/venture-hq-commercial-mvp-progress.md`'s
pricing milestone.**

This document describes the real, built billing mechanics — what
actually happens in the product, verified against the real code in
`lib/domain/billingWorkflow.ts` and `lib/domain/subscriptionWorkflow.ts`
— plus the open decisions that remain before it can be published
alongside real prices.

## 1. Plans

Venture HQ offers four real plan tiers today (Free Playground, Starter,
Business, Growth), each with a real, enforced monthly AI research
budget and a real, separate Content Bot video-production allowance.
**No plan's price has been approved for public display yet** — every
plan is currently marked `is_published: false` in the real product and
must stay that way until the founders explicitly approve specific,
final prices (not the current provisional £19/£49/£99 figures, which
are hypotheses pending approval per the founders' own instruction).

## 2. What "subscribing" actually does

When you subscribe to a paid plan, Venture HQ redirects you to a real
Stripe Checkout session. Once Stripe confirms the real payment (via a
real, signature-verified webhook — see the technical security section
of `docs/venture-hq-commercial-mvp-progress.md`), your organization's
real AI budget and video allowance are updated immediately to match
your new plan. This is enforced server-side; it is not possible to gain
a higher plan's allowance without a real, verified Stripe payment
event.

## 3. Billing cycle

Plans bill monthly. [DECISION NEEDED: exact billing date — Stripe's own
default is the date you first subscribed; confirm this is the intended
behavior before publishing.] [DECISION NEEDED: whether an annual option
will exist — not built as of this draft.]

## 4. Cancellation

You can cancel at any time via the real Stripe Billing Portal
(reachable from Settings → Plan & billing → Manage billing, once you
have a real paid subscription). Cancellation takes effect at the end of
your current billing period — you keep your plan's real access until
then (this is the real behavior Stripe's own `cancel_at_period_end`
mechanism provides, and what this app's webhook handler honors).

Once your subscription genuinely ends, your organization automatically
reverts to the real Free plan — a real $0 AI budget and no paid-agent
access, the same real mechanism a brand-new free organization gets.
**This is enforced in the product today** — see
`tests/billingWebhookSecurity.test.ts`'s own real, passing test of
exactly this behavior.

## 5. Failed payments

If a real payment fails, your organization's subscription status moves
to "past due," and paid AI employee access is suspended (the same real
mechanism a cancelled subscription triggers) until the payment is
resolved. [DECISION NEEDED: how many retry attempts, and what
communication (email) is sent — Stripe has its own configurable dunning
behavior; the founders should decide how much of that to rely on versus
build custom handling for.]

## 6. Refunds

[NO REFUND POLICY HAS BEEN APPROVED. Do not publish this section with
any stated policy — pro-rated, no-refund, or time-limited — until the
founders make and document this decision explicitly. This is
explicitly called out, not omitted by oversight.]

## 7. Content Bot video allowance

Each paid plan includes a real, limited number of Content Bot video
productions per calendar month, separate from your plan's dollar AI
budget (because one video production can cost meaningfully more than a
research task). An exhausted video allowance does not consume your
dollar budget and does not roll over to the next month. [DECISION
NEEDED: should unused video allowance roll over, or should there be a
way to purchase additional one-off video credits? Not built as of this
draft — a real, deliberate product decision, not an oversight.]

## 8. Changes to your plan

You may change plans at any time; [DECISION NEEDED: whether an upgrade
takes effect immediately with a prorated charge, or at the next billing
cycle — Stripe supports both, and this app's webhook handler should be
reviewed against whichever behavior the founders choose].

---

*This document was drafted as part of Venture HQ's pre-launch legal
audit (Mission 9). It is not legal advice and must not be published
until reviewed by a qualified professional and completed with the
founders' real pricing and policy decisions.*
