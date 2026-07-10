# AGENTS.md — working notes for AI agents / new sessions

Orientation for anyone (human or agent) picking this repo up cold. Read this before
changing code. Also read `README.md` (user-facing) and the header comment in each JS file.

## What this is

A **static** stock-portfolio dashboard on GitHub Pages. No server, no runtime deps.
Live at <https://leohk23.github.io/MyStockPortfolio/>. The repo is **public** — treat
everything committed as world-readable.

## Data flow

```
Master Cashflow.xlsx   (gitignored, local only — the user's master workbook)
      │  node extract-portfolio.js   (needs the xlsx dev-dep; user runs it)
      ▼
holdings.json          positions, cost basis, geography, group, full trade log  (committed)
      │  node fetch-prices.js        (GitHub Actions, hourly; dependency-free)
      ▼
prices.json            quotes, FX rates, portfolio NAV series      (committed)
history.json           per-instrument daily closes + benchmarks    (committed, ~150KB)
      │
      ▼
index.html + portfolio.js   all arithmetic in the browser
```

- **prices.json** loads on every page view (small). **history.json** is **lazy-loaded**
  only when the user selects a stock or toggles a benchmark — keep it that way.
- Committing prices.json/history.json re-triggers the Pages build, so the site follows
  the hourly refresh automatically.

## Files

| File | Role | Runs where |
|------|------|-----------|
| `extract-portfolio.js` | Reads the workbook → `holdings.json`. Maps tickers to Yahoo symbols; consolidates by `Grouping1`. | User's machine only (`npm run extract`) |
| `fetch-prices.js` | Yahoo Finance → `prices.json` + `history.json`. **No dependencies** (uses global `fetch`). | GitHub Actions hourly + local |
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

1. **Public repo.** Never export the workbook's `Comments` column (trade rationale) or add
   anything sensitive to holdings.json. `*.xlsx` is gitignored; keep it so.
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
   *today's* FX. Not true time-weighted return. The caveat is shown on the page; keep it.

## Grouping (the "one line per company" feature)

`holdings.json` carries `group` (workbook `Grouping1`, e.g. VOO + VUSA.L → "S&P 500") and
`geography` per instrument. `portfolio.js` `build(...)` buckets by a `dimension`:
`'company'` (default), `'geography'`, or `'instrument'`. Multi-instrument rows expand
(chevron at end of name) to show their legs. Clicking a row charts it.

## Yahoo symbol mapping

`extract-portfolio.js` derives Yahoo symbols from the workbook's `Exchange.Ticker` prefix,
with an `OVERRIDES` map for the ones that lie (e.g. `NTO` is Frankfurt `NTO.F`, not OTC).
**If you add a holding and its chart/price is missing, add an override and verify it returns
a price from Yahoo before committing.** All 55 are currently verified.

## Workbook tabs (for the user trimming the xlsx)

`extract-portfolio.js` reads only **Portfolio** and **Tradelog**. Via formulas, Portfolio
also depends on **Index** and Tradelog on **Forex**, and Index pulls the yearly tabs
(2017–2026) + **Pay** + **Lifetime Plan**. Tabs safe to delete (nothing references them):
Monitor_WW, Cognos_Office_Connection_Cache, Other Summary, Tax, Dental, Misc, By Country,
Sheet14, Nov 18. Tab names `Portfolio`/`Tradelog` must not be renamed.

## Gotchas

- `fetch-prices.js` must stay dependency-free — CI installs nothing. Don't `require` a package.
- Index symbols (`^GSPC`, `^HSI`) need the caret URL-encoded (`%5E`); `fetchTicker` does this.
- The hourly bot commits to `main`, so local pushes need `git pull --rebase` first
  (`publish.js` does it). On conflict in prices.json/history.json, the bot's/your newer
  generated file wins — regenerate rather than hand-merge.
- Windows shell here is PowerShell; a Bash tool exists too. `.xlsx` reads need `xlsx` installed
  (`npm install`), which is dev-only and absent in CI by design.
