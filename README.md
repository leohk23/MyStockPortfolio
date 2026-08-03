# My Stock Portfolio

Static portfolio dashboard on GitHub Pages. No server, no runtime dependencies.

[https://leohk23.github.io/MyStockPortfolio/](https://leohk23.github.io/MyStockPortfolio/)

A personal decision tool with one reader. The goal is **substance over surface**: it exists to answer "buy, hold or sell?", so the effort goes into figures that can be trusted and audited — not into the interface. Numbers show their workings (where a low came from, which currency it was filed in) and show `–` rather than a guess. UI work earns its place when it stops you reading the data, and stops there.

## How it fits together

```
Tradelog.xlsx                 (gitignored — never leaves your machine; only the Tradelog tab is read)
   meta.json                  per-instrument facts: yahoo symbol, group, geography (committed)
   watchlist.json             stocks you watch but don't own (committed; never hits your totals)
        │  npm run extract     you run this after trading
        ▼
   holdings.json              positions, cost basis, full trade log   (committed)
        │  fetch-prices.js     GitHub Actions, every 15 min on weekdays
        ▼
   prices.json                quotes, FX rates, portfolio NAV series  (committed)
   history.json               per-stock daily closes + benchmarks     (committed)
        │
        ▼
   index.html + portfolio.js  arithmetic in the browser
```

Committing the price files re-triggers the Pages build, so the live site follows each scheduled refresh on its own. Pages and the workflow's write permission are already configured. `history.json` is loaded by the page only when you click a stock, a benchmark, or a 2Y/5Y/All range, so the first paint stays light.

## What the dashboard shows

- **Totals + a NAV chart** with 1M/3M/6M/12M/2Y/5Y/All ranges and a hover crosshair. Portfolio "All" begins at the first recorded trade; individual stocks retain their full available price history.
- **Value / Performance toggle** on the portfolio chart. *Value* is the NAV proxy (below). *Performance* is **time-weighted return** — deposits and withdrawals stripped out, so it's investment performance rather than money added. It splits into multi-select cohorts: **Total**, **Existing** (holdings from before this year, held flat) and **New buys** (this year's purchases), letting you see how much of the year came from old holdings vs new picks. Today's FX; dividends and realized gains excluded.
- **Benchmark toggle** — overlay the portfolio against **S&P 500** and **HSI**, all rebased to 0% at the start of the range (indexed, single axis — never dual).
- **Group by Stock / Company / Geography** — the table re-buckets live. "Company" is the workbook's `Grouping1`; a multi-instrument row (e.g. BYD = HK line + ADR) shows a chevron at the end of its name to expand. In Stock view, the chevron expands the full split-adjusted trade history with running balance and average cost. Multi-instrument Company rows and Geography totals chart aggregate NAV; a one-stock Company row keeps the individual Price/Gain-Loss views.
- **Click any row** to filter the chart to that stock, switch between **Price / Gain/Loss**, and see your **buy/sell trades plotted** on the line (▲ buy, ▼ sell). Gain/Loss replays the Tradelog quantity and average cost; realized gains are excluded.
- **Sortable columns** (the Watchlist table sorts too, on its own independent state — sorting one table never disturbs the other), a **USD / GBP / HKD** display toggle, current and realized gain/loss, and a current **Price** column per position. **1D** is the move since the previous session's close, sitting beside the 7D/1M/3M/6M/1Y/YTD periods. **Since** = the price move since your last trade on that position (current price vs. that trade's price, both in USD). **Yield TTM** comes from Yahoo's trailing-12-month dividend events divided by current price; the workbook dividend field is not exported or used. **Income TTM** multiplies those online dividends per share by today's position quantity.
- **PE and Special PE** (single-instrument rows only). **PE** is price ÷ trailing 12-month EPS, fetched from Yahoo automatically where available. **Special PE** lets you swap in whatever earnings figure actually fits that stock or its industry — FFO/share for a REIT, adjusted EPS for a bank, a normalized multi-year average for a cyclical — by setting `specialEps` (and an optional `specialEpsLabel` shown as a tooltip) in `meta.json`. Leave it unset and Special PE just mirrors the normal PE. Both show `–` when there's no earnings figure from any source, or on a multi-instrument Company/Geography row.
- **PE Low / Low date / Implied / vs Low** — the "is it cheap?" columns, derived online with **nothing to maintain**. Point-in-time: each weekly close is divided by the latest annual EPS *already published* by that date (fiscal end + 90 days, every market's statutory deadline); the cheapest ratio in history is the trough multiple. Neither form of hindsight is allowed — not an old low over *today's* EPS (NVDA's 2022 low on its 2026 earnings would look absurdly cheap), and not a low over its own year's EPS, which wasn't public until months after the low.

  - **PE Low** — the cheapest multiple the market ever paid for its published earnings.
  - **Low date** — when that happened.
  - **Implied** — `PE Low × current EPS`: what the price would be at that cheapest-ever
    multiple, on today's earnings. Hover it for the low price and EPS behind the number.
  - **vs Low** — how far above (red) or below (green) that baseline you're paying. Colour is
    deliberately inverted from the rest of the table: cheap is the good news here.

  Annual EPS is cached in `earnings.json` (refreshed weekly, not every run — earnings only print 4×/year), but the trough is recomputed every run, so a **new low shows up on the next refresh**. Limited to ~4 fiscal years because that's all the earnings history Yahoo gives away.

  ⚠️ This is **context, not a signal**. A trough multiple is one data point from one bad moment. A company that has genuinely grown into its earnings will read as permanently expensive against a low set in 2022 — NVDA at +380% isn't a sell, it's telling you its 2022 trough earnings bear little relation to today's business.

- **Click a stock for the deep dive** — filed annual and quarterly financials, with a trailing-twelve-month row. Where Yahoo omits a quarter a company did report, it is reconstructed as *the audited fiscal year minus the three filed quarters* and labelled **`derived`**; a TTM containing one reads **`part-derived`** rather than `filed`. Only revenue and income are reconstructed that way — never EPS, which would need that quarter's own share base (BYD's shares roughly doubled mid-FY2025, so an imputed per-share figure would be fiction). Without this a single missing quarter silently removed the whole TTM row.
- **Price freshness.** Every figure here is the **regular-session** price, deliberately — value, gain, PE, 1D and the whole NAV history are built on regular closes, so folding an after-hours print into the price would move every derived number against a history that never had one. The risk that leaves is a price that is quietly *wrong*: a company reports after the bell, drops 8%, and the row still shows yesterday's close. So the extended-hours move is shown **beside** the price, never inside it — `308.91 USD −8.2%` means the last close was 308.91 and it has since traded 8.2% lower. Hovering any price gives the last-traded time and the full detail.

  Practically this is US-only: Hong Kong, Tokyo, London and Paris have no extended-hours feed, so those rows never carry the marker and their freshness is the last-traded time in the tooltip. Moves are shown **at any size**, so a blank cell means exactly one thing — no extended-hours data for that listing, never "it moved but we hid it".

For an architecture/agent-oriented reference see [AGENTS.md](AGENTS.md).

## The Tradelog is the source of truth

`extract-portfolio.js` reads **only the Tradelog tab** and writes `holdings.json`. Every number — current quantity, average cost, realized gain, cost basis — is summed from the Tradelog, the same way the workbook's old Portfolio-tab formulas did. That tab (and all its reporting columns) no longer feeds the web app, so you can stop maintaining it for reporting.

- **Tradelog** — every trade per symbol: split-adjusted quantity, running balance, average cost, realized gain, `Platform` (broker), and the comment shown in expandable trade history. Comments are deliberately published at the owner's request; the repo and site are public.

The facts that *aren't* in the Tradelog live in **`meta.json`** (committed), one entry per instrument keyed by its Tradelog symbol:

```json
"GOOG": { "ticker": "GOOG", "yahoo": "GOOG", "group": "Google", "geography": "US", "currency": "USD" }
```

- `yahoo` — the Yahoo Finance symbol (verified to return a price).
- `group` — the consolidation key: instruments sharing a `group` collapse into one row (BYD's HK line + its ADR), reproducing the workbook's old *Other Summary* pivot.
- `geography` — the Geography grouping view.
- `currency` — the currency the **purchase price** was recorded in. The *current* price's currency comes from Yahoo, so London tickers in pence and Tokyo tickers in yen need no per-ticker special case.
- `eps` / `specialEps` / `specialEpsLabel` — optional, drive the PE columns. See [AGENTS.md](AGENTS.md#pe--valuation-hint).

### Two things the app does differently from the spreadsheet

- **Pence lines are converted properly.** The workbook computes `Total Cost (USD)` for `Gbpence` instruments (SPOL, MKS) by dividing pence by 100 and applying an FX rate of **1.0** — treating pounds as dollars, understating those positions by the GBP/USD rate. The `GBP` rows right beside them apply 1.34 correctly.
- **The NAV chart is a proxy.** It values *today's* holdings at past prices using *today's* FX. It answers "what would this basket have been worth then", not "what was my account worth". Buys, sells, and FX drift are not replayed. The individual-stock Gain/Loss view does replay Tradelog quantity and average cost, but still uses today's FX.

## After you trade

Record the trade in the Tradelog tab, save the workbook, then:

```sh
npm install         # once, for the xlsx reader (dev-only)
git checkout main   # publish commits to the CURRENT branch — see below
npm run publish     # extract -> commit holdings.json -> pull --rebase -> push
```

That is the whole routine. The scheduled Action re-prices and redeploys from there; nothing else needs running.

⚠️ **Be on `main` first.** `npm run publish` commits to whichever branch is checked out. Land it on a feature branch and the live site never sees it — the site serves `main` only. Recover with `git checkout main && git cherry-pick <commit>`.

Sanity-check the run: it prints `wrote holdings.json: N instruments`, and the new trade should appear with the right date, quantity and average cost. Dates are read as calendar days from the workbook — if one looks a day off, that is a bug, not rounding (see `ymdLocal` in `extract-portfolio.js`).

## Adding a holding

1. Record the trade in the Tradelog as usual.
2. Add a `meta.json` entry keyed by that Tradelog symbol, with `ticker`, `yahoo`, `group`, `geography`, and `currency`.

`npm run extract` guards both ways a new holding can silently disappear:

- **Missing metadata** — refuses to write if a position is open in the Tradelog but has no `meta.json` entry.
- **Bad Yahoo symbol** — for any symbol not already in `prices.json`, it pings Yahoo and refuses to write unless the symbol returns a price. (Only *new* symbols hit the network; a normal run makes zero requests.)

So a typo in `yahoo` fails the extract with a clear message instead of dropping the row from the live site.

## Changing the watchlist

`watchlist.json` (stocks you're weighing but don't own) is hand-maintained, so **`npm run extract` plays no part** — that reads the Tradelog only. Entries are `{ "yahoo": …, "name": …, "geography": … }`.

```sh
npm run fetch   # only when ADDING a name — it needs a quote before it can appear
git add watchlist.json prices.json history.json
git commit -m "watchlist" && git push
```

Removing a name, renaming it, or editing `geography` needs no fetch — commit and push. When **adding**, the name stays invisible until `prices.json` has its quote, so either run `npm run fetch` yourself or push and let the scheduled Action pick it up on its next run.

⚠️ **A mistyped `yahoo` symbol fails silently here.** Unlike `meta.json`, the watchlist has no guard — the row is simply filtered out, with no error. After adding a name, check it actually shows up in the Watchlist view. Keep `geography` filled in too: the table shows the ticker beside the name now, but the search box still matches on it.

## Local

```sh
npm start           # serve at localhost:3000
npm run fetch       # refresh prices.json by hand
npm test            # self-check the maths (needs `npm install`)
```

⚠️ Public repo: your holdings, cost basis, trade history, and Tradelog comments are public. Pages on a private repo requires GitHub Pro.


