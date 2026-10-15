# Venture HQ — Cookie Notice (DRAFT)

**Status: draft for founder review. Not published.**

> The cookies listed below were confirmed directly from this
> application's own real HTTP responses during this session's live
> verification work (Auth.js's real session cookies, observed in real
> `Set-Cookie` headers) — not assumed from Auth.js's documentation
> alone. If the authentication library or its configuration changes,
> this list must be re-verified against the real running app, not
> updated from memory.

## Cookies Venture HQ sets

Venture HQ uses only the cookies strictly necessary to keep you signed
in. It does not use any analytics, advertising, or third-party tracking
cookies.

| Cookie | Set by | Purpose | Type |
|---|---|---|---|
| `authjs.session-token` | Auth.js (Venture HQ's own sign-in system) | Identifies your signed-in session — the actual mechanism that keeps you logged in between page loads. HTTP-only (not readable by any page script). | Strictly necessary |
| `authjs.csrf-token` | Auth.js | Protects the sign-in flow itself against cross-site request forgery. HTTP-only. | Strictly necessary |
| `authjs.callback-url` | Auth.js | Remembers where to return you after completing GitHub sign-in. HTTP-only. | Strictly necessary |

[IF DEPLOYED BEHIND A CDN OR HOSTING PROVIDER — e.g. Vercel — that
provider may set its own additional cookies for load balancing or edge
routing. Confirm and list any such cookies against the real deployed
environment before publishing; none exist in local development, which
is all that has been verified as of this draft.]

Because every cookie above is "strictly necessary" for the service to
function (you could not stay signed in without them), UK PECR/EU ePrivacy
rules do not require a cookie-consent banner for these specific cookies
— [REQUIRES CONFIRMATION from a qualified reviewer once the real
deployment environment and any additional third-party cookies (e.g. from
Stripe's own hosted Checkout or Billing Portal pages, which are Stripe's
domain, not this app's) are known].

## Cookies set by third parties you interact with directly

If you use a real Stripe Checkout or Stripe Billing Portal session (see
the Terms of Service), Stripe's own pages — not this application — may
set their own cookies under Stripe's domain, governed by Stripe's own
cookie policy, not this one.

## Local browser storage

Some parts of the interface (e.g. your last-chosen Focus View tab)
remember your preference using your browser's own local storage, not a
cookie — this data never leaves your browser and is never sent to
Venture HQ's servers.

## Changes to this notice

[DECISION NEEDED: same notice-of-change question as the other two
draft documents.]

## Contact

[CONTACT DETAILS REQUIRED.]

---

*This document was drafted as part of Venture HQ's pre-launch legal
audit (Mission 9), verified against the real cookies this application
actually sets in a live session. It is not legal advice and must not be
published until reviewed by a qualified professional.*
