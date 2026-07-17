# AGENTS.md — working notes for AI agents / new sessions

Orientation for anyone (human or agent) picking this repo up cold. Read this before
changing code. Also read `README.md` (user-facing) and the header comment in each JS file.

## What this is

A **static** stock-portfolio dashboard on GitHub Pages. No server, no runtime deps.
Live at <https://leohk23.github.io/MyStockPortfolio/>. The repo is **public** — treat
everything committed as world-readable.

**One user, one reader: the owner.** This is a personal decision tool, not a product.
Nobody needs to be impressed or onboarded by it.

## Goal: substance over surface

**Content beats UI. Every time.** The dashboard exists to answer "should I buy, hold or
sell this?" — so effort belongs in the numbers, not the chrome. When the two compete,
the numbers win.

What that means in practice:

- **A number that isn't trustworthy is worse than no number**, because it gets acted on.
  Most of the hard-won work in this repo is defending against *silently wrong* figures —
  see the war stories below (currency mismatches, unrestated splits, cached fetch
  failures, `#REF!` leaking in). Read them before touching the pipeline; every one was a
  plausible-looking number that was flat wrong.
- **Show the workings.** Prefer a figure whose derivation is visible (a low date, an EPS
  series, a reporting currency) over a polished one you have to trust blindly.
- **Say "–", never guess.** Missing data is a fact worth displaying. Interpolating,
  defaulting to zero, or FX-converting a filed figure invents information.
- **New signal > new styling.** Given a choice, add a metric that changes a decision.
- **UI work is justified when it blocks reading the data** — a table that overflows the
  screen, a column that can't be found, a chart that misleads. That is content work
  wearing a CSS hat. Polish beyond that point is not the goal.
- **Correctness is not "surface".** Input validation, FX handling and the guards that
  throw on bad workbook cells are content work. Never trade those away for brevity.

Corollary: don't gold-plate. No design systems, no component frameworks, no build step.
Plain HTML/CSS/JS that a future session can read top-to-bottom is the point — the repo
has no dependencies at runtime and should stay that way.

## Data flow

```
Tradelog.xlsx          (gitignored, local only — ONLY the Tradelog tab is read)
   meta.json           per-instrument facts: yahoo, group, geography, currency (committed)
   watchlist.json      stocks watched but NOT owned — same pipeline, zero effect on totals
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
| `watchlist.json` | Stocks watched but **not owned** — `yahoo`, `name`, `geography` (+ the same optional `eps`/`specialEps` overrides `meta.json` takes). Hand-edited. See "Watchlist" below. | Committed |
| `backfill-earnings.js` | `npm run backfill`: tops `earnings.json` up with fiscal years Yahoo cannot reach (see "Five years of financials" below). **Manual, one-off — never in CI.** | User's machine only |
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

The idea (ported from the workbook's old Portfolio!BA:BM block, now fully derived online):
find the cheapest the market ever valued this business, then ask what that multiple would be
worth on *today's* earnings. **Nothing here is hand-maintained.**

**How the trough is found** (`fetch-prices.js` `troughPe`): for each of the last ~4 fiscal
years, take the lowest weekly close *within that year* and divide by **that year's own EPS**;
the cheapest of those is `peLow`. Pairing an old low with *today's* EPS would be meaningless —
NVDA's 2022 low over its 2026 earnings reads as absurdly cheap. The low must be measured
against what the business was earning at the time.

**Why ~4 years:** Yahoo's `fundamentals-timeseries` caps `annualDilutedEPS` at 4 points
(quarterly gives ~5, trailing ~11). 4 fiscal years is the real ceiling on free earnings
history — don't label it "5y".

| Column | Formula |
|---|---|
| **PE Low** | `min over fiscal years of (lowest close that year / that year's EPS)` |
| **Low date** | the week that low printed |
| **Implied** | `PE Low × current EPS` — the price at its cheapest-ever multiple, on today's earnings |
| **vs Low** | `(price − Implied) / Implied` — the premium you pay over that baseline |

**`earnings.json` (committed) caches the annual EPS.** Earnings are reported 4×/year, so
fetching them hourly for 56 tickers is 56 wasted requests an hour against the one endpoint
Yahoo rate-limits hardest. `fetch-prices.js` refreshes it only when it ages out
(`EARNINGS_MAX_AGE_DAYS`) or a new holding appears. **The trough itself is still recomputed
every run** from the stored EPS plus fresh weekly closes — free, and a new low is picked up
the hour it prints.

⚠️ A ticker Yahoo has no fundamentals for must be stored as `[]`, not left absent —
`earningsStale` treats a missing key as "new holding" and would refetch all 56 every hour.

**PE Low is a ratio, so it is currency- and ADR-agnostic.** Implied comes out in the quote's
own currency because EPS is native; no FX belongs in any of it. EPS arrives in Yahoo's major
unit, so `epsInQuoteUnits` scales it for pence tickers before dividing — the same GBp trap.

`meta.json` `lowPrice`/`lowEps` still work as a **fallback** for symbols with no Yahoo
earnings history, and `lowGrowth`/`growth` still drive the optional PEG tooltip. Neither is
required.

**vs Low inverts the table's colour convention**: below the trough multiple is good news, so
negative reads green. Single-instrument rows only, same rule as PE.

⚠️ This is *context, not a signal*. A trough multiple is one data point from one bad moment,
and a company that has since grown into its earnings will look permanently expensive against
it. NVDA at +380% is not a sell — it says its 2022 trough EPS bears little relation to today's
business. Most trustworthy where the business hasn't structurally changed.

`fetch-prices.js` best-effort fetches trailing EPS from Yahoo's `v7/finance/quote` for every
holding in one batched request. That endpoint (unlike `v8/finance/chart`) requires a
crumb+cookie handshake (`getCrumb()`) — Yahoo's anti-scraping measure, not something this repo
controls, so it can start failing without a code change on our side. A failure there is always
silent and non-fatal (logs `skip eps: ...` and moves on): PE columns just fall back to
`meta.json`'s manual `eps`, or show `–` if neither source has a number. Check the Action's log
line (`ok   eps for N/M tickers`) if PE looks stale.

## Watchlist (stocks not held)

`watchlist.json` lists names to analyse before buying. They ride the **same pipeline** —
quotes, weekly history, trough P/E, annual financials — because `fetch-prices.js` unions
them into its ticker list. There is no second fetch path, and `npm run backfill` picks them
up too (it just walks `earnings.json`).

**The rule: a watched stock must never touch the portfolio maths.** Totals, TWR, cohorts and
`navHistory()` all iterate `holdings`. A stock you are only *thinking* about must not be able
to move a number that reports how you are actually doing. Hence:

- `watchlist.json` is a **separate file** — never merged into `holdings.json`.
- The tempting shortcut (a holding with `qty: 0`) is **wrong**: it would thread a phantom
  position through every one of those calculations.
- In `fetch-prices.js`, watchlist symbols join exactly one list — `histTickers`, so they get
  closes to chart and to price the trough against. `navHistory()` and the TWR input stay
  strictly `priced` (= holdings). Keep it that way.
- On the page, `WATCH` is separate from `STATE`, and a name already held is dropped from it
  (once you own it, the holdings table is the truth).

`valuation()` in `portfolio.js` is shared by `build()` and `buildWatchlist()` — valuation is a
property of the *stock*, not of owning it, so both paths run one formula and cannot drift. A
selftest asserts a holding and a watchlist entry on the same quote agree.

**Known gaps** (honest `–`, not guesses):

- **Korean tickers have no trailing EPS from Yahoo** (`005930.KS`, `000660.KS` return
  `epsTrailingTwelveMonths: undefined`), so P/E and Implied are blank for them. P/E Low still
  works (it is built from *annual* EPS), as do the chart and the financials table. The escape
  hatch, if ever wanted, is the `eps` override the entry already accepts — but that is manual
  maintenance, which this repo deliberately avoids.
- **The trough is thin for a company with loss years.** `troughPe()` skips any year without
  positive EPS, so a name like GME — whose earlier years are unusable — has its "cheapest
  ever" drawn from very few points, and can read *below* its own trough (P/E 16x vs P/E Low
  26x). Treat vs Low on such names with suspicion.

Each watched name adds ~30KB to `history.json` (lazy-loaded, so it costs nothing on first
paint). Fine for a dozen; reconsider at 30+.

## Yahoo's 4-point cap is PER FIELD, and the windows don't line up

The single nastiest thing about the fundamentals endpoint. Each `type=` you ask for gets its
own ~4-point window, and they are **not aligned**:

```
MC.PA    annualTotalRevenue    2022 2023 2024 2025
         annualDilutedEPS      2021 2022 2023 2024      <- no 2025
2638.HK  annualTotalRevenue    2021 2022 2023 2024      <- no 2025
         annualDilutedEPS      2022 2023 2024 2025
```

So **never filter fiscal years on one field's presence.** `fetchAnnualEps` used to key years on
EPS, which silently discarded LVMH's FY2025 for six months after it was published — Yahoo had
sent the revenue and the net income all along. Six companies were stuck on FY2024 before this
was spotted. Every row Yahoo returns is now kept, and consumers filter for what they need
(the panel takes years with revenue; `troughPe()` takes years with positive EPS).

`backfill-earnings.js` has the matching rule: a fiscal year you already hold is **not
necessarily complete**. It patches missing `rev`/`nic` into an existing year rather than
skipping it as "already have" (that is how 2638.HK FY2025 gets its top line).

**A fund is not an operating company, and Yahoo will hand back "revenue" for one anyway** —
SPOL.L (an iShares ETF) reports 22.9M of fund income. The test that separates them is *no EPS
in **any** year*: a real company has EPS somewhere, even a loss-making one, while a Korean
ticker missing only the TRAILING figure still has annual EPS. Do not use "has revenue".

## Five years of financials (`backfill-earnings.js`)

The deep-dive panel's revenue / net-income table comes from `earnings.json`. Yahoo
**hard-caps annual fundamentals at 4 fiscal years** — a 15-year window returns the same
four, on both the timeseries and quoteSummary endpoints. It is not a widenable parameter.
Don't spend time trying; it has been probed.

`earnings.json` is the store of record and `mergeEarnings()` keeps banked years forever, so
history **accretes**: the hourly job merges Yahoo's 4 on top and older years persist. That
gets the 5th and 6th year over time, but could not produce them on day one — hence the
backfill.

**Source and why it is safe.** stockanalysis.com carries 5 fiscal years free but has no
public API; the numbers come from the page's internal SvelteKit `__data.json`, an
undocumented index-pointer payload that can change shape on any of their deploys. So it is
used the only way it safely can be: **once, by hand, result committed**. It never runs in
CI. If it breaks, it breaks on a laptop and the live pipeline is untouched.

**The source proves itself, per ticker.** Yahoo's 4 years overlap the source's 5, so every
overlapping year must reproduce Yahoo *exactly* on revenue and bottom line, or the ticker is
skipped whole. This matters because field names vary by market — US pages carry `netIncome`,
Hong Kong pages carry both `netinc` (group total) and `netinccmn` (after minorities). Rather
than hard-code a guess, every candidate field is tried and only one that reproduces Yahoo is
accepted: **the check picks the field**, so a schema change cannot silently pick a wrong one.

**Backfills `rev` + `nic` only — never `eps`/`ni`.** `troughPe()` skips any year whose EPS
isn't positive, so P/E Low keeps its documented "cheapest in ~4y" meaning instead of shifting
when this runs. Verified: after a backfill, 0 of 42 `peLow` values moved.

**Coverage is deliberately partial** (~22 of 43 at 5 years). The rest are refused, not
guessed:

- **Refused (no reconcile)** — ASML, MC.PA, V, TSLA, BRK-B, QCOM, RMS.PA, NFLX, TSM, COIN,
  GRMN, 0001.HK. The site's US pages have no "to common" line, so for companies with
  preferred dividends or minorities its `netIncome` ≠ Yahoo's `nic` (Visa: 327M of preferred
  dividends). Splicing it in would put one year on a different definition from the next four
  and make the margin trend a lie. 4 years of one definition beats 5 of two.
- **Not covered** — Frankfurt/Xetra (`.DE`, `.F`), Korea (`.KS`), and OTC ADRs (XIACY, CCOEY,
  KWHIY, TKOMY), which have quote pages but no financials.

**`NW0.DE` (CSG N.V.) has fabricated fundamentals and should not be trusted.** Yahoo's `nic ÷
eps` is *exactly* 1,000,000,000 for every year — a placeholder share count — and it shows
revenue collapsing 24.9B → 1.7B for a €13 stock. It is stuck on FY2024, and no free source
covers Xetra, so it cannot be repaired. It is the one holding whose financials panel is
knowingly wrong.

Re-run `npm run backfill` after adding a holding; it is incremental and skips tickers that
are already complete.

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

## Tradelog.xlsx external link (a live fragility)

`Tradelog.xlsx` is a renamed copy of the Master Cashflow workbook, and the copy left behind an
**external link** to the original on OneDrive:

```
https://d.docs.live.net/.../Master Cashflow_CC_v0.4.xlsx
```

Two columns the extractor reads still resolve through it, in every row:

- **Adj Qty** — `[1]!Table1[[Qty]] × [1]!Table1[[Stock split]]` → every trade's quantity
- **Gain/(Loss)** — realized gain

Both reference only Tradelog's *own* columns (`Table1` is defined locally, `ref="C1:Y402"`), so
the `[1]!` prefix is a pure copy artifact. It works today only because `xlsx` reads Excel's
**cached** values — if Excel ever recalculates with the link unresolved, Adj Qty becomes `#REF!`.

`parseTrade` now **throws** on any non-finite numeric cell rather than letting `Math.abs("#REF!")`
publish `NaN` quantities. Do not weaken that check.

**To make the workbook self-contained** (then Master Cashflow can be deleted anywhere): retype
the two columns without the prefix — `=[@Qty]*[@[Stock split/ Bonus shares]]` and
`=IF([@Side]="SELL",-([@[Adjusted Price w Commisions]]-[@[Average Purchase Price]])*[@[Adjusted Qty]],0)`
— then Data → Edit Links → Break Link.

## Japanese rows: the price hides in the formula

The workbook's data provider (`_FV`) has no Tokyo coverage, so it prices the Japanese holdings
off their **US ADR**. Those three Tradelog rows therefore record a USD price with `Currency =
"USD"`, even though the trade happened in yen on the Tokyo line:

```
5332  Price = 3976/rngUSDJPY      -> the trade was ¥3,976
7532  Price = 5315/rngUSDJPY      -> ¥5,315
8001  Price = 2075.5/rngUSDJPY    -> ¥2,075.5
```

**This cannot be "fixed" in the workbook** — Excel's own reporting depends on the ADR price. So
`extract-portfolio.js` recovers the real figure instead (`LOCAL_PRICE` / `localPriceScale`): the
yen price is the formula's numerator, and every USD-derived figure on the row (adjusted price,
average cost, realized gain) rescales by the same factor. Quantities never rescale.

⚠️ The scale is derived from the **cell itself** (`numerator ÷ cached value`), NOT from the Forex
tab, because `rngUSDJPY` is a **live** rate (`=_FV(...,"Price")`) — Excel recomputes the USD
value on every refresh. Reading the rate separately would drift out of step with the cached
value; deriving it from the cell is exact whatever the rate was when the file was last saved.

`meta.json` `currency` for these three must be **JPY**, to agree with the recovered trade
currency. Verified against IBKR: 5332 ¥3,979.18 avg, 8001 ¥2,077.16 — the app now matches.

Side effect, and a good one: cost basis now converts at Yahoo's live JPY rate like every other
foreign holding, instead of being pinned to the workbook's FX snapshot.
