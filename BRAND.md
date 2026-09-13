# Venture HQ — Brand Guidelines

Venture HQ is a private AI business-management application for Ellis Scott
and Maddie. It should feel like a premium strategy and management game —
but every mission, agent action, source, file, cost, and result shown must
be genuine. This document did not exist when this milestone began (the
repository was empty); it is written now to keep the aesthetic consistent
as more agents and screens are added.

## Tone

- **Founders' desk, not admin panel.** The interface is where Ellis and
  Maddie run their venture — warm, confident, a little bit "war room for a
  small business," never a generic B2B SaaS dashboard of gray cards and
  blue buttons.
- **Honest, not hyped.** Copy should read like a sharp operator's notes,
  not marketing copy. Hedge forward-looking claims. Never imply a
  guaranteed outcome anywhere in the UI, including microcopy and empty
  states.

## What this is not

- **Not the Four Horsemen.** No war/famine/death/conquest framing, no
  medieval or militaristic iconography, no trading-floor visual language
  (candlesticks, tickers, "positions"). A predecessor project
  (`project-horseman`) used this theme for a financial-market engine —
  Venture HQ is a deliberate departure from it, not a continuation.
- **Not a spreadsheet.** Avoid dense data-grid aesthetics as the primary
  surface. Structured data (the ledger, evidence lists) can be tabular, but
  the overall frame should feel designed, not exported.

## Palette

Bright, warm, premium — parchment and brass rather than slate and blue.

| Token | Hex | Use |
|---|---|---|
| `hq-cream` | `#FBF6EC` | Page background |
| `hq-parchment` | `#F3E9D2` | Card backgrounds, subtle fills |
| `hq-brass` | `#C89B3C` | Primary accent, calls to action |
| `hq-brassDark` | `#9C7A2E` | Accent hover/active |
| `hq-teal` | `#0E5C57` | Secondary accent, active/in-progress states |
| `hq-tealDark` | `#0A3F3C` | Headings, emphasis |
| `hq-ink` | `#20262B` | Primary text |
| `hq-slate` | `#5B6670` | Secondary text |

Status colors follow the same warmth: success is a genuine green
(`#1E7A4C`), danger a warm rust (`#B3462C`), never harsh pure red/green.

## Typography

- Display/headings: a serif (Georgia/Cambria) — gives the "founders' desk"
  a sense of permanence and craft, and a considered, non-generic feel.
- Body: system sans-serif stack, for readability in dense reports.

## Voice rules for agent-authored content

Every agent report (Scout's included) must:
- Separate verified facts from the agent's own inferences, visibly.
- Cite sources with dates where a claim depends on external evidence.
- Never state demand, revenue, sales, or profit as guaranteed or certain.
- Say plainly when evidence is weak or missing, rather than smoothing over it.

## Extending this document

As Inventor, Creator, Inspector, Merchant, and the platform specialists are
built, extend this file rather than starting a new one — the goal is one
consistent headquarters, not a different look per agent.
