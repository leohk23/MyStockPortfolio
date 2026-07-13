# AGENTS.md — working notes for AI agents / new sessions

Orientation for anyone (human or agent) picking this repo up cold. Read this before
changing code. Also read `README.md` (user-facing) and the header comment in each JS file.

## What this is

A **static** stock-portfolio dashboard on GitHub Pages. No server, no runtime deps.
Live at <https://leohk23.github.io/MyStockPortfolio/>. The repo is **public** — treat
everything committed as world-readable.

## Data flow

```
Tradelog.xlsx          (gitignored, local only — ONLY the Tradelog tab is read)
   meta.json           per-instrument facts: yahoo, group, geography, currency (committed)
      │  node extract-portfolio.js   (needs the xlsx dev-dep; user runs it)
      ▼
holdings.json          positions, cost basis, geography, group, full trade log  (committed)
      │  node fetch-prices.js        (GitHub Actions, hourly; dependency-free)
      ▼
prices.json            quotes, FX rates, portfolio NAV series      (committed)
history.json           daily + weekly closes, long NAV + benchmarks (committed, ~2MB)
      │
      ▼
index.html + portfolio.js   all arithmetic in the browser
```

- **prices.json** loads on every page view (small). **history.json** is **lazy-loaded**
  only for a stock, benchmark, or 2Y/5Y/All range — keep it that way.
- Committing prices.json/history.json re-triggers the Pages build, so the site follows
  the hourly refresh automatically.

## Files

| File | Role | Runs where |
|------|------|-----------|
| `extract-portfolio.js` | Reads the Tradelog tab + `meta.json` → `holdings.json`. Sums qty/cost/realized from the Tradelog; pulls yahoo/group/geography from `meta.json`. | User's machine only (`npm run extract`) |
| `meta.json` | Per-instrument facts not in the Tradelog: `yahoo`, `group` (consolidation key), `geography`, `currency`, and optional PE inputs `eps`/`specialEps`/`specialEpsLabel` (see below). Keyed by Tradelog symbol. Edit when opening a new instrument. | Committed |
| `fetch-prices.js` | Yahoo Finance → `prices.json` + `history.json`. Also best-effort fetches trailing EPS (crumb-authenticated, unlike the rest of this file). **No dependencies** (uses global `fetch`). | GitHub Actions hourly + local |
| `portfolio.js` | Pure aggregation shared by page and tests. `build(holdings, rates, quotes, dimension)`. | Browser (`window.portfolioLib`) + node |
| `index.html` | Dark-only UI: totals, chart, sortable/groupable table. | Browser |
| `publish.js` | `npm run publish`: extract → commit holdings.json → rebase → push. | User's machine |
| `.github/workflows/prices.yml` | Hourly cron; runs selftests, fetches, commits. | GitHub |

## How to run / test

```sh
npm install          # dev-deps: xlsx (extract), jsdom (only for manual page tests)
npm test             # selftests: fetch-prices, portfolio, extract-portfolio
node fetch-prices.js --selftest    # movement math, NAV fill/backfill, alignedCloses
node portfolio.js  --selftest      # grouping, weighting, since-last-trade, dimensions
node extract-portfolio.js --selftest   # yahoo-symbol mapping, group-name cleaning
```

Every non-trivial JS file has an `assert`-based `--selftest`. **Add to it when you change
logic.** The page has no automated test in-repo; exercise it with jsdom ad hoc if changing
`index.html` (see git history for the pattern), then eyeball the rendered SVG.

## Invariants — do not break these

1. **Public repo.** Tradelog comments are intentionally exported beside expanded trades at
   the owner's explicit request, so treat them as world-readable. Never export other account
   detail. `*.xlsx` is gitignored; keep it so.
2. **Currency.** Everything is computed in **USD**, then divided for the display toggle.
   `rateFor(code, rates)` handles `GBp`/`Gbpence` = GBP/100. A holding's declared `currency`
   is its **purchase** currency; the live price's currency comes from Yahoo (`meta.currency`)
   and can differ (e.g. CSUK: cost in GBP, quote in GBp). Convert both to USD to compare.
3. **Movements are fractions**, not whole percents (0.25 = +25%) everywhere in the JSON.
   The page multiplies by 100 for display. (A past bug shipped -59% as -5900%.)
4. **One y-axis per chart, ever.** Two different scales → index both to % (see the benchmark
   overlay) or use separate charts. Never dual-axis.
5. **Chart colors are validated.** Series use `--series-port/spx/hsi`, validated against the
   dark surface with the dataviz skill's `validate_palette.js`. Re-validate if you change them.
6. **NAV / history are proxies.** They value *today's* share counts at past prices with
   *today's* FX. Not true time-weighted return. Two exceptions replay the Tradelog (both still
   today's-FX, realized/dividends excluded): stock **Gain/Loss** (balance qty + average cost),
   and the portfolio **Performance** view (`portfolio.js` `cohortMV`+`twr`) — a genuine
   time-weighted return with cash flows removed, split into Total / Existing / New-buys cohorts.
7. Portfolio **All** starts at the earliest recorded trade. Individual Price **All** keeps
   full available price history; Gain/Loss **All** starts at that instrument's first trade.
8. **Yield is online-only.** `fetch-prices.js` sums Yahoo dividend events over `range=1y`
   and divides by current price. Never use the workbook dividend field for table yield.
9. **PE is single-instrument only, computed in native currency.** `pe` = price ÷ trailing
   EPS; `specialPe` = price ÷ a stock-tailored earnings figure. Both are `null` on a
   multi-leg Company/Geography row (see Grouping below) — there's no well-defined "PE of a
   basket" without earnings-weighting, so don't invent one. EPS itself, from either source,
   must be in the same currency as the Yahoo-quoted price (e.g. pence for a `GBp` quote) —
   PE is a ratio, so mixing currencies silently produces a meaningless number, not an error.

## PE / valuation hint

Two optional `meta.json` fields per instrument drive the PE columns:

- `eps` — manual trailing EPS override, used only when Yahoo's auto-fetch (below) has no
  data for that symbol. Native quote currency.
- `specialEps` / `specialEpsLabel` — a stock- or industry-appropriate earnings figure that
  isn't plain trailing EPS (FFO/share for a REIT, adjusted/core EPS for a bank, a normalized
  multi-year average for a cyclical, ...) and a short label shown in the column's tooltip.
  Native quote currency. Omit both to leave Special PE identical to the normal PE.

## Trough-multiple valuation (the "is it cheap?" hint)

Ported from the workbook's Portfolio!BA:BM block. The idea: record the cheapest the market
ever valued this business, then ask what that multiple would be worth on *today's* earnings.

`meta.json` inputs (all manual — a 5-year low is a judgement, not a lookup):

- `lowPrice` / `lowEps` — the recorded low and the trailing EPS *at that time*.
- `lowDate` — when (tooltip only).
- `lowGrowth` / `growth` — growth rate then and now, as fractions (`0.227` = 22.7%). Optional;
  only needed for the growth-adjusted (PEG) figure.

Derived in `portfolio.js` `build()`:

| Column | Formula |
|---|---|
| **PE Low** | `lowPrice / lowEps` |
| **Implied** | `PE Low × current EPS` — the price at its cheapest-ever multiple, on today's earnings |
| **vs Low** | `(price − Implied) / Implied` — the premium you pay over that baseline |
| *PEG-implied* (tooltip) | `(PE Low / (lowGrowth×100)) × growth × 100 × current EPS` |

**PE Low is a ratio, so it is currency- and ADR-agnostic** — a low recorded off a US ADR
gives the same multiple as the Tokyo ordinary (5332/7532/8001 rely on this). Implied comes out
in the quote's own currency because EPS is native; no FX belongs in any of it.

**vs Low inverts the table's colour convention**: below the trough multiple is good news, so
negative reads green. Single-instrument rows only, same rule as PE.

⚠️ This is *context, not a signal*. A stock can be dear against its own history and still be
a fine business; a trough multiple is one data point from one bad moment, and `lowEps` ages —
a company that has since grown into its earnings will look permanently expensive against it.
Re-record the low when the story changes.

`fetch-prices.js` best-effort fetches trailing EPS from Yahoo's `v7/finance/quote` for every
holding in one batched request. That endpoint (unlike `v8/finance/chart`) requires a
crumb+cookie handshake (`getCrumb()`) — Yahoo's anti-scraping measure, not something this repo
controls, so it can start failing without a code change on our side. A failure there is always
silent and non-fatal (logs `skip eps: ...` and moves on): PE columns just fall back to
`meta.json`'s manual `eps`, or show `–` if neither source has a number. Check the Action's log
line (`ok   eps for N/M tickers`) if PE looks stale.

## Grouping (the "one line per company" feature)

`holdings.json` carries `group` (from `meta.json`, e.g. VOO + VUSA.L → "S&P 500") and
`geography` per instrument. `portfolio.js` `build(...)` buckets by a `dimension`:
`'company'` (default), `'geography'`, or `'instrument'`. Multi-instrument company rows expand
to show their legs; instrument rows expand to show every adjusted trade with balance and average
cost. Clicking a row charts it. The stock chart has Price/Gain-Loss views.
Clicking a Company or Geography row charts that row's aggregate NAV; the metric toggle is
reserved for individual Stock/leg charts. Exception: a single-instrument Company row behaves
like its underlying Stock and keeps Price/Gain-Loss because NAV adds no distinct shape.

## Yahoo symbol mapping

Each `meta.json` entry carries its `yahoo` symbol directly — no derivation, no `OVERRIDES`
map. `extract-portfolio.js` verifies every *new* symbol (one not yet in `prices.json`)
against Yahoo and refuses to write if it returns no price, so a typo fails the extract
instead of silently dropping the row (`portfolio.js` skips holdings with no quote). Normal
runs make zero network calls. All 56 are currently verified.

## Workbook tabs (for the user trimming the xlsx)

`extract-portfolio.js` now reads **only the Tradelog tab**, and only its cached cell values.

**Portfolio is no longer a dependency of the app.** Its Currency column used to be an
`INDEX/MATCH` into Portfolio, which quietly made Portfolio load-bearing; that column is now
hardcoded (401 cells). The only Tradelog formulas still pointing at Portfolio are **MktVal**
and **YEVal** (cols 20–21), which the extractor never reads. Portfolio is now purely the
owner's own Excel reporting — delete it and only those two columns break.

**Forex is still live.** Tradelog Price/Commission formulas use named ranges from it
(`=5315/rngUSDJPY`). Extraction reads *cached* values, so a broken formula fails quietly
rather than loudly — the app would happily consume a `#REF`. Keep Forex.

Tab name `Tradelog` must not be renamed. Per-instrument display facts
(yahoo/group/geography) live in `meta.json`.

**Split column = the units→shares multiplier.** Tradelog `Stock split/Bonus shares` scales
raw Qty up and raw Price down. A wrong value here is silent: it keeps total cost correct
while misstating both share count and per-share price. (7532 was logged with `2` when the
true split was `5`, so the app showed 200 shares instead of 500.) Cross-check quantities
against the broker when a position looks off.

## Gotchas

- `fetch-prices.js` must stay dependency-free — CI installs nothing. Don't `require` a package.
- Index symbols (`^GSPC`, `^HSI`) need the caret URL-encoded (`%5E`); `fetchTicker` does this.
- The hourly bot commits to `main`, so local pushes need `git pull --rebase` first
  (`publish.js` does it). On conflict in prices.json/history.json, the bot's/your newer
  generated file wins — regenerate rather than hand-merge.
- Windows shell here is PowerShell; a Bash tool exists too. `.xlsx` reads need `xlsx` installed
  (`npm install`), which is dev-only and absent in CI by design.
