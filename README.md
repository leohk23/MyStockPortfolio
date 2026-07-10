# My Stock Portfolio

Static portfolio dashboard on GitHub Pages. No server, no runtime dependencies.

<https://leohk23.github.io/MyStockPortfolio/>

## How it fits together

```
Master Cashflow.xlsx          (gitignored — never leaves your machine)
        │  npm run extract     you run this after trading
        ▼
   holdings.json              positions, cost basis, full trade log   (committed)
        │  fetch-prices.js     GitHub Actions, hourly
        ▼
   prices.json                quotes, FX rates, portfolio NAV series  (committed)
   history.json               per-stock daily closes + benchmarks     (committed)
        │
        ▼
   index.html + portfolio.js  arithmetic in the browser
```

Committing the price files re-triggers the Pages build, so the live site follows the
hourly refresh on its own. Pages and the workflow's write permission are already
configured. `history.json` is loaded by the page only when you click a stock or a
benchmark, so the first paint stays light.

## What the dashboard shows

- **Totals + a NAV chart** with 1M/3M/6M/12M ranges and a hover crosshair.
- **Benchmark toggle** — overlay the portfolio against **S&P 500** and **HSI**, all
  rebased to 0% at the start of the range (indexed, single axis — never dual).
- **Group by Stock / Company / Geography** — the table re-buckets live. "Company" is
  the workbook's `Grouping1`; a multi-instrument row (e.g. BYD = HK line + ADR) shows a
  chevron at the end of its name to expand.
- **Click any row** to filter the chart to that stock, with your **buy/sell trades
  plotted** on its price line (▲ buy, ▼ sell).
- **Sortable columns**, a **USD / GBP / HKD** display toggle, and a current **Price**
  column per position. **Since** = the price move since your last trade on that position
  (current price vs. that trade's price, both in USD).

For an architecture/agent-oriented reference see [AGENTS.md](AGENTS.md).

## The workbook is the source of truth

`extract-portfolio.js` reads two tabs and writes `holdings.json`:

- **Portfolio** — one row per instrument. `Grouping1` is the consolidation key, so
  BYD's HK line and its US ADR collapse into one row (click it to expand). This
  reproduces the workbook's own *Other Summary* pivot.
- **Tradelog** — every trade per symbol, for the "Last trade" column and the buy/sell
  markers on the chart. The `Comments` column is deliberately **not** exported: it holds
  your trade rationale, and this repo is public.

`currency` in the workbook describes the currency the **purchase price** was
recorded in. The current price's currency comes from Yahoo (`meta.currency`), so
London tickers quoting in pence and Tokyo tickers in yen are handled without
per-ticker special cases.

### Two things the app does differently from the spreadsheet

- **Pence lines are converted properly.** The workbook computes `Total Cost (USD)`
  for `Gbpence` instruments (SPOL, MKS) by dividing pence by 100 and applying an FX
  rate of **1.0** — treating pounds as dollars, understating those positions by the
  GBP/USD rate. The `GBP` rows right beside them apply 1.34 correctly.
- **The NAV chart is a proxy.** It values *today's* holdings at past prices using
  *today's* FX. It answers "what would this basket have been worth then", not "what
  was my account worth". Buys, sells, and FX drift are not replayed.

## After you trade

```sh
npm install         # once, for the xlsx reader (dev-only)
npm run extract     # workbook -> holdings.json
git commit -am "positions" && git push
```

The hourly Action picks it up from there.

## Adding a holding

Add it to the workbook. If its Yahoo symbol can't be derived from the
`Exchange.Ticker` prefix, add an entry to `OVERRIDES` in `extract-portfolio.js` and
verify it returns a price before committing.

## Local

```sh
npm start           # serve at localhost:3000
npm run fetch       # refresh prices.json by hand
npm test            # self-check the maths (needs `npm install`)
```

⚠️ Public repo: your holdings and cost basis are public. Pages on a private repo
requires GitHub Pro.
