# Venture HQ — Pricing & Margin Review (for Ellis & Maddie to approve)

**Mission 12, Priority 1.** This refreshes and formalizes the pricing
research already done in Mission 8 (see
`docs/venture-hq-commercial-mvp-progress.md`'s own "Real plan catalog"
section) against this app's **current, real, measured** cost data —
queried directly from the real `costs`/`ledger_entries` tables, not
re-estimated — plus one real gap the original pass didn't account for:
Stripe's own processing fee. Nothing here is published or charged to a
real customer; every plan still ships with `is_published: false`.

**What we need from you:** approve, adjust, or reject the four prices
below. Nothing changes until you do — there is no code path that reads
this document automatically.

## 1. Real, measured cost data (not estimated)

Queried directly from this app's own real `costs` table:

| Agent | Real calls recorded | Avg real cost | Max real cost (single call) |
|---|---|---|---|
| Scout | 18 | $0.28 | $0.38 |
| Business Analyst | 4 | $0.12 | $0.14 |
| Content Bot (individual provider calls) | 162 | $0.04 | $0.56 |

| Metric | Real value |
|---|---|
| Real content items with recorded spend | 11 |
| Avg real spend per content item (all provider calls combined) | $0.65 |
| Max real spend on a single content item | $3.86 |
| Total real spend recorded across this app's entire history | $12.73 |

These are genuine Anthropic/fal.ai/ElevenLabs/Shotstack calls made during
development and testing — not simulated. They're also the ceiling-vs-
typical comparison that matters: the max figures above are real calls
that happened to run long or need more provider calls, not this app's
actual enforced ceiling (see §2).

## 2. The real, enforced ceilings (what we must price against)

Pricing has to survive the **worst case a real customer could legitimately
hit within their allowance**, not the typical case — these are the real,
code-enforced caps, not estimates:

- **Scout, per mission:** up to `MAX_RESEARCH_PASSES` (2) real research
  passes, each capped at `MAX_TOKENS` (10,000) output tokens with
  thinking disabled. Documented worst case: **~$1.00/mission**
  (`docs/venture-hq-commercial-mvp-progress.md`'s own "Local verification"
  section). Real measured average: **$0.28/pass** — the ceiling is rarely
  approached.
- **Content Bot, per production:** `MAX_ITEM_SPEND_USD` is a real,
  enforced, **cumulative** cap of **$8.00** across every version/revision
  of one content item (`lib/domain/contentProduction.ts`) — a founder
  can request up to `MAX_VERSIONS_PER_ITEM` (5) revisions, but the whole
  item can never exceed $8.00 in real provider spend regardless. Real
  measured average: **$0.65/item** — well under the cap.
- **Business Analyst, per request:** `MAX_ITERATIONS` (4) × `MAX_TOKENS`
  (8,000 output tokens). Real measured average: **$0.12**, max **$0.14**
  — the smallest of the three agents' real cost footprint.

## 3. The real plan catalog, current prices (unchanged since Mission 8, not yet approved)

| Plan | Price/mo | AI budget/mo | Video allowance/mo | Paid agents |
|---|---|---|---|---|
| Free Playground | £0 | $0 | 0 | No |
| Starter | £19 | $10 | 0 | Yes |
| Business | £49 | $20 | 2 | Yes |
| Growth | £99 | $45 | 5 | Yes |

$0 for Free is real and enforced, not a display restriction —
`reserveBudget`'s atomic gate refuses any paid AI call once an
organization's monthly limit resolves to $0 (see
`lib/domain/budgetWorkflow.ts`).

## 4. Worst-case margin, now including Stripe's real processing fee

**FX assumption (not a live rate — must be checked against the real rate
at the time Stripe is actually connected):** £1 ≈ $1.27.

**Stripe fee assumption:** this codebase does not yet model Stripe's
processing fee anywhere (confirmed — searched the whole repository, zero
matches). Stripe UK's standard online card rate is approximately
**1.5% + 20p** for UK-issued cards and **2.5%+ 20p** for international
cards (real published starting rates — **not fetched from your specific
Stripe account, which may differ**; confirm your real rate in the
Stripe Dashboard once connected, since volume discounts and currency
may change it). The table below uses the UK domestic rate as the
optimistic case and the international rate as the conservative case,
since a UK-based tool will likely see a mix of both.

| Plan | Price (GBP→USD) | Max real AI cost | Stripe fee (UK 1.5%+20p) | Stripe fee (intl 2.5%+20p) | Margin (UK fee) | Margin (intl fee) |
|---|---|---|---|---|---|---|
| Starter | £19 → $24.13 | $10.00 | ~$0.62 | ~$0.86 | **56.0%** | **55.0%** |
| Business | £49 → $62.23 | $20 + (2×$8) = $36.00 | ~$1.19 | ~$1.81 | **40.2%** | **39.2%** |
| Growth | £99 → $125.73 | $45 + (5×$8) = $85.00 | ~$2.14 | ~$3.40 | **30.7%** | **29.7%** |

These are **worst-case, full-allowance-utilization** margins — the real
floor if every customer maxed out their real AI budget and video
allowance every single month, which real measured usage above suggests
is not the typical case (actual customers are far more likely to land
closer to the $0.28–$0.65 real averages than the $8.00 enforced ceiling).
The Stripe fee's effect is modest at this price point (1–2 percentage
points) but real, and compounds with payout/currency-conversion fees
this review does not model (ask your Stripe representative, or check
Dashboard → Settings → Fees once connected, for the exact real figure
on GBP payouts from USD-ish-costed spend, if that distinction applies to
your account's settlement currency).

## 5. What this review recommends

1. **The four current prices (£19/£49/£99, Free at £0) are financially
   sound at worst-case utilization**, even accounting for the previously
   un-modeled Stripe fee — margins stay positive (30–56%) even if every
   customer maxes out their allowance every month, which real measured
   data says is unlikely. No change recommended to the prices
   themselves.
2. **The FX rate (£1≈$1.27) must be re-checked against the real rate
   at the time Stripe products/prices are actually created** — a real
   rate move of a few cents doesn't change the recommendation, but
   should be confirmed, not assumed, before final prices are locked in
   Stripe (see `docs/billing/stripe-setup-guide.md` for exactly where
   that happens).
3. **Consider asking Stripe (once connected) for your account's real
   fee rate** rather than relying on this review's published starting
   rates — large or high-volume accounts sometimes negotiate lower
   rates, which would only improve the margins above.
4. This review does not model currency-conversion fees on payout, VAT/
   sales tax obligations, or chargeback/dispute costs — all real,
   standard costs of running a subscription business that aren't yet
   relevant until real transactions exist, but worth asking your
   accountant/Stripe about before launch.

## 6. Decision needed

Please confirm one of:

- [ ] **Approve as-is** — Free £0 / Starter £19 / Business £49 / Growth £99,
      no changes.
- [ ] **Approve with changes** — specify which price(s) to adjust.
- [ ] **Need more information before deciding** — specify what.

Once approved, the actual mechanism to publish these prices is covered in
`docs/billing/stripe-setup-guide.md` (§4, "Set real prices and publish") —
nothing changes in the running app until that step is deliberately done.
