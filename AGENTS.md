# AGENTS.md — working notes for AI agents / new sessions

Orientation for anyone (human or agent) picking this repo up cold. Read this before changing code. Also read `README.md` (user-facing) and the header comment in each JS file.

## What this is

A **static** stock-portfolio dashboard on GitHub Pages. No server, no runtime deps. Live at [https://leohk23.github.io/MyStockPortfolio/](https://leohk23.github.io/MyStockPortfolio/). The repo is **public** — treat everything committed as world-readable.

**One user, one reader: the owner.** This is a personal decision tool, not a product. Nobody needs to be impressed or onboarded by it.

## Goal: substance over surface

**Content beats UI. Every time.** The dashboard exists to answer "should I buy, hold or sell this?" — so effort belongs in the numbers, not the chrome. When the two compete, the numbers win.

What that means in practice:

- **A number that isn't trustworthy is worse than no number**, because it gets acted on. Most of the hard-won work in this repo is defending against *silently wrong* figures — see the war stories below (currency mismatches, unrestated splits, cached fetch failures, `#REF!` leaking in). Read them before touching the pipeline; every one was a plausible-looking number that was flat wrong.
- **Show the workings.** Prefer a figure whose derivation is visible (a low date, an EPS series, a reporting currency) over a polished one you have to trust blindly.
- **Say "–", never guess.** Missing data is a fact worth displaying. Interpolating, defaulting to zero, or FX-converting a filed figure invents information.
- **New signal > new styling.** Given a choice, add a metric that changes a decision.
- **UI work is justified when it blocks reading the data** — a table that overflows the screen, a column that can't be found, a chart that misleads. That is content work wearing a CSS hat. Polish beyond that point is not the goal.
- **Correctness is not "surface".** Input validation, FX handling and the guards that throw on bad workbook cells are content work. Never trade those away for brevity.

Corollary: don't gold-plate. No design systems, no component frameworks, no build step. Plain HTML/CSS/JS that a future session can read top-to-bottom is the point — the repo has no dependencies at runtime and should stay that way.

## Data flow

```
Tradelog.xlsx          (gitignored, local only — ONLY the Tradelog tab is read)
   meta.json           per-instrument facts: yahoo, group, geography, currency (committed)
   watchlist.json      stocks watched but NOT owned — same pipeline, zero effect on totals
      │  node extract-portfolio.js   (needs the xlsx dev-dep; user runs it)
      ▼
holdings.json          positions, cost basis, geography, group, full trade log  (committed)
      │  node fetch-prices.js        (GitHub Actions, every 15 min Mon-Fri; dependency-free)
      ▼
prices.json            quotes, FX rates, portfolio value series (replayed) (committed)
history.json           daily + weekly closes, long NAV + benchmarks (committed, ~2MB)
      │
      ▼
index.html + portfolio.js   all arithmetic in the browser
```

- **prices.json** loads on every page view (small). **history.json** is **lazy-loaded** only for a stock, benchmark, or 2Y/5Y/All range — keep it that way.
- Committing prices.json/history.json re-triggers the Pages build, so the site follows each scheduled refresh automatically.

## Files

| File                             | Role                                                                                                                                                                                                                                                         | Runs where                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `extract-portfolio.js`         | Reads the Tradelog tab +`meta.json` → `holdings.json`. Sums qty/cost/realized from the Tradelog; pulls yahoo/group/geography from `meta.json`.                                                                                                        | User's machine only (`npm run extract`) |
| `meta.json`                    | Per-instrument facts not in the Tradelog:`yahoo`, `group` (consolidation key), `geography`, `currency`, and optional PE inputs `eps`/`specialEps`/`specialEpsLabel` (see below). Keyed by Tradelog symbol. Edit when opening a new instrument. | Committed                                 |
| `fetch-prices.js`              | Yahoo Finance →`prices.json` + `history.json`. Also best-effort fetches trailing EPS (crumb-authenticated, unlike the rest of this file). **No dependencies** (uses global `fetch`).                                                            | GitHub Actions (15 min, Mon-Fri) + local  |
| `watchlist.json`               | Stocks watched but**not owned** — `yahoo`, `name`, `geography` (+ the same optional `eps`/`specialEps` overrides `meta.json` takes). Hand-edited. See "Watchlist" below.                                                                  | Committed                                 |
| `guidance.json`                | Manual company-issued guidance for operating-company holdings/watchlist names. Literal display values + period, issue date, official source and material assumptions;`_coverage` records names checked with no matching quantitative guidance.             | Committed                                 |
| `backfill-earnings.js`         | `npm run backfill`: tops `earnings.json` up with fiscal years Yahoo cannot reach (see "Deeper financial history" below). **Manual, one-off — never in CI.**                                                                                       | User's machine only                       |
| `portfolio.js`                 | Pure aggregation shared by page and tests.`build(holdings, rates, quotes, dimension)`, `valuation`, `buildWatchlist`, `fillMissingQuarters`. Anything selftestable lives here rather than in the page.                                                        | Browser (`window.portfolioLib`) + node  |
| `index.html`                   | Dark-only UI: totals, chart, sortable/groupable table.                                                                                                                                                                                                       | Browser                                   |
| `publish.js`                   | `npm run publish`: extract → commit holdings.json → rebase → push.                                                                                                                                                                                      | User's machine                            |
| `.github/workflows/prices.yml` | `*/15 * * * 1-5` cron; runs selftests, fetches, commits. Weekdays only — every exchange in the book is shut at weekends. Public repo, so the runs are free.                                                                                                                                                                                                               | GitHub                                    |

## How to run / test

```sh
npm install          # dev-deps: xlsx (extract), jsdom (only for manual page tests)
npm test             # selftests: fetch-prices, portfolio, extract-portfolio, backfill-earnings
node fetch-prices.js --selftest    # movement math incl. 1d, NAV fill/backfill, alignedCloses,
                                   #   trough PE, quote parsing (EPS, session freshness)
node portfolio.js  --selftest      # grouping, weighting, since-last-trade, dimensions,
                                   #   valuation, watchlist, fillMissingQuarters
node extract-portfolio.js --selftest   # yahoo-symbol mapping, group-name cleaning
```

Every non-trivial JS file has an `assert`-based `--selftest`. **Add to it when you change logic.** The page has no automated test in-repo; exercise it with jsdom ad hoc if changing `index.html` (see git history for the pattern), then eyeball the rendered SVG.

## After the owner updates the Tradelog

The whole routine, on the owner's machine, on `main`:

```sh
npm run publish     # extract -> commit holdings.json -> pull --rebase -> push
```

Do not hand-edit `holdings.json`, and do not reconstruct trades by hand — the workbook is the source of truth and `extract-portfolio.js` is the only thing that reads it.

- **Check the branch first.** `publish.js` commits to the current branch. Off `main`, the live site never sees it (Pages serves `main`). Fix: `git checkout main && git cherry-pick <sha>`.
- **`Tradelog.xlsx` is local-only** (gitignored), so this cannot run in a cloud session — there is no workbook there. Everything else can.
- **Writing to the workbook is the owner's job.** It is an Excel Table with ~5k formulas, external links and a data connection; SheetJS round-trips drop all three. If a row must be added, give the owner the input-column values (C,D,E,F,G,H,I,P,X — the rest are formulas) rather than writing the file. Excel COM works but is flaky here (locale/link quirks).
- Verify after: `wrote holdings.json: N instruments`, then the new trade's date, quantity and average cost, and that `Bal Qty` closed out if it was a full exit. Dates are calendar days read straight off the workbook (`ymdLocal`) — a date one day out is a bug, not rounding.

## Preview-first workflow

New UI and content work goes to `preview/index.html` and is pushed to `main`, which makes it reviewable at `/MyStockPortfolio/preview/`. Keep `index.html` unchanged until the owner asks to promote it. `npm run promote` copies the reviewed preview over the live page; do not run it by inference. Root data files are shared by both pages, so a pilot-only dataset must remain unused by `index.html` until promotion.

## Invariants — do not break these

1. **Public repo.** Tradelog comments are intentionally exported beside expanded trades at the owner's explicit request, so treat them as world-readable. Never export other account detail. `*.xlsx` is gitignored; keep it so.
2. **Currency.** Everything is computed in **USD**, then divided for the display toggle. `rateFor(code, rates)` handles `GBp`/`Gbpence` = GBP/100. A holding's declared `currency` is its **purchase** currency; the live price's currency comes from Yahoo (`meta.currency`) and can differ (e.g. CSUK: cost in GBP, quote in GBp). Convert both to USD to compare.
3. **Movements are fractions**, not whole percents (0.25 = +25%) everywhere in the JSON. The page multiplies by 100 for display. (A past bug shipped -59% as -5900%.)
4. **One y-axis per chart, ever.** Two different scales → index both to % (see the benchmark overlay) or use separate charts. Never dual-axis.
5. **Chart colors are validated.** Series use `--series-port/spx/hsi`, validated against the dark surface with the dataviz skill's `validate_palette.js`. Re-validate if you change them.
6. **Every series replays the Tradelog. Nothing back-projects today's shares.** All of them still use *today's* FX for every past day, and exclude dividends/realized gains.

   - **Value** (portfolio and group) = `cohortMV` market value: what you actually held, priced
     at past closes. The line starts at your first purchase and steps up when you buy, and its
     endpoint equals the table's Value. It carries **no % headline** — a value line mixes
     deposits with growth, so a percentage on it would call paying money in a "gain".
   - **Performance** = `cohortMV` + `twr`: time-weighted return, cash flows removed, split into
     Total / Existing / New-buys cohorts.
   - **Benchmarks** = the same TWR versus price indices. It must never be the value series
     rebased to a percentage: that counts deposits as gains and would beat any index by simply
     paying money in.
   - **Stock Gain/Loss** = `gainHistory` (balance qty + average cost).

   The old proxy held today's share count constant across history. It was deleted (with `basketHistory`) because it lied: on 2019-12-20 it valued the S&P group at **$5,723** when the real figure was **$593**, having back-projected 25 VUSA.L shares bought in 2025. It also claimed the portfolio was worth $146,641 a year ago when it was worth $122,993. Do not reintroduce it: a chart of asset value has to be asset value.
7. Portfolio **All** starts at the earliest recorded trade. Individual Price **All** keeps full available price history; Gain/Loss **All** starts at that instrument's first trade.
8. **Yield is online-only.** `fetch-prices.js` sums Yahoo dividend events over `range=1y` and divides by current price. Never use the workbook dividend field for table yield.
9. **PE is single-instrument only, computed in native currency.** `pe` = price ÷ trailing EPS; `specialPe` = price ÷ a stock-tailored earnings figure. Both are `null` on a multi-leg Company/Geography row (see Grouping below) — there's no well-defined "PE of a basket" without earnings-weighting, so don't invent one. EPS itself, from either source, must be in the same currency as the Yahoo-quoted price (e.g. pence for a `GBp` quote) — PE is a ratio, so mixing currencies silently produces a meaningless number, not an error.

10. **The price is always the REGULAR session.** The chart call never asks for pre/post data, and must not start: value, gain, PE, the `1d` column and the whole NAV history are built on regular closes, so substituting an extended-hours print would move every derived figure against a history that never had one. An after-hours move is recorded **beside** the price (`quote.ext`) and only ever displayed as a flag — never folded into `price`.

## Price freshness

`prices.json`'s top-level `updated` is when the **fetch ran**, not when a stock **traded**: on a Sunday it reads Sunday while every price is Friday's close. Two per-quote fields settle it, both captured from the `v7/quote` batch call already made every run for EPS — **no extra requests**:

- `at` — `regularMarketTime`, epoch seconds. The moment the displayed price was struck. Present for every quote.
- `ext` — `{ kind: 'post'|'pre', price, at, pct }`, the extended-hours print. **Only recorded when its timestamp is later than `at`.** That one rule covers pre- and post-market alike and discards the stale figures Yahoo keeps returning after a session ends, without depending on `marketState` semantics (which is why `marketState` is deliberately *not* used).

`pct` is a **fraction** — Yahoo sends whole percents (`-8` for −8%) and they are divided by 100 on the way in, per invariant 3. Getting this wrong ships −800%.

Neither field is ever carried forward from the previous run. A stale `ext` would keep warning about a swing long since absorbed into a new regular session; a missing one means "no data", which the page renders as no marker rather than as "flat".

**Coverage is US-only in practice.** A live run captured `at` for 71/71 quotes but `ext` for 34 — every one of them US/ADR, none from Hong Kong, Tokyo, London, Paris or Korea, which have no extended-hours feed. It self-heals across a weekend: Friday's post-market print stays valid until Monday's regular session prints, at which point `at` advances past it and the later-than rule drops it automatically.

**Every move is shown, at any size — do not reintroduce a display threshold.** An earlier version hid moves under 0.5%, which made a blank cell mean *either* "barely moved" *or* "no extended-hours feed at all" (21 and 37 rows respectively on the run measured). Those are very different states, and the second is precisely what this is here to tell you. The threshold was also the only size filter on any movement column — 1D through YTD all render whatever they are — and 0.5% was an invented constant sitting near the median move (0.32%). Blank now means one thing: no extended-hours data for that listing. The feared clutter did not materialise: 28 of 56 rows carry a marker, small and dimmed, and the non-US rows are cleanly empty.

## PE / valuation hint

Two optional `meta.json` fields per instrument drive the PE columns:

- `eps` — checked manual trailing EPS override. It takes precedence over Yahoo when present; use it only for a known bad/missing Yahoo figure. Native quote currency.
- `specialEps` / `specialEpsLabel` — a stock- or industry-appropriate earnings figure that isn't plain trailing EPS (FFO/share for a REIT, adjusted/core EPS for a bank, a normalized multi-year average for a cyclical, ...) and a short label shown in the column's tooltip. Native quote currency. Omit both to leave Special PE identical to the normal PE.

## Trough-multiple valuation (the "is it cheap?" hint)

The idea (ported from the workbook's old Portfolio!BA:BM block, now fully derived online): find the cheapest the market ever valued this business, then ask what that multiple would be worth on *today's* earnings. **Nothing here is hand-maintained.**

**How the trough is found** (`fetch-prices.js` `troughPe`): **point-in-time** — each weekly close is divided by the latest annual EPS **already published** by that date (fiscal end + `REPORT_LAG_DAYS` = 90, covering every market's statutory deadline); the cheapest ratio across history is `peLow`. Both kinds of hindsight are excluded by construction: an old low over *today's* EPS (NVDA's 2022 low on its 2026 earnings reads absurdly cheap), and a low over its own fiscal year's EPS — reported months *after* the low. That second one was the previous model, and it printed Trip.com's Apr-2025 low as a 7.7× trough on FY2025 earnings nobody would see until Feb 2026; on what investors could actually see (FY2024) it was ~14.9×. Closes before the first published year are skipped; a published loss voids the multiple until the next profitable year prints.

**Why ~4 years:** Yahoo's `fundamentals-timeseries` caps `annualDilutedEPS` at 4 points (quarterly gives ~5, trailing ~11). 4 fiscal years is the real ceiling on free earnings history — don't label it "5y".

| Column             | Formula                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **PE Low**   | `min over weekly closes of (close / latest annual EPS published by that date)`          |
| **Low date** | the week that low printed                                                                 |
| **Implied**  | `PE Low × current EPS` — the price at its cheapest-ever multiple, on today's earnings |
| **vs Low**   | `(price − Implied) / Implied` — the premium you pay over that baseline                |

**`earnings.json` (committed) caches the annual EPS.** Earnings are reported 4×/year, so fetching them every run for 56 tickers is 56 wasted requests every 15 minutes against the one endpoint Yahoo rate-limits hardest. `fetch-prices.js` refreshes it only when it ages out (`EARNINGS_MAX_AGE_DAYS`) or a new holding appears. **The trough itself is still recomputed every run** from the stored EPS plus fresh weekly closes — free, and a new low is picked up on the next run after it prints.

⚠️ A ticker Yahoo has no fundamentals for must be stored as `[]`, not left absent — `earningsStale` treats a missing key as "new holding" and would refetch all 56 every run.

**PE Low is a ratio, so it is currency- and ADR-agnostic.** Implied comes out in the quote's own currency because EPS is native; no FX belongs in any of it. EPS arrives in Yahoo's major unit, so `epsInQuoteUnits` scales it for pence tickers before dividing — the same GBp trap.

`meta.json` `lowPrice`/`lowEps` still work as a **fallback** for symbols with no Yahoo earnings history, and `lowGrowth`/`growth` still drive the optional PEG tooltip. Neither is required.

**vs Low inverts the table's colour convention**: below the trough multiple is good news, so negative reads green. Single-instrument rows only, same rule as PE.

⚠️ This is *context, not a signal*. A trough multiple is one data point from one bad moment, and a company that has since grown into its earnings will look permanently expensive against it. NVDA at +380% is not a sell — it says its 2022 trough EPS bears little relation to today's business. Most trustworthy where the business hasn't structurally changed.

`fetch-prices.js` best-effort fetches trailing EPS from Yahoo's `v7/finance/quote` for every holding in one batched request. That endpoint (unlike `v8/finance/chart`) requires a crumb+cookie handshake (`getCrumb()`) — Yahoo's anti-scraping measure, not something this repo controls, so it can start failing without a code change on our side. A failure there is always silent and non-fatal (logs `skip eps: ...` and moves on): PE columns use a checked `meta.json` manual override first, then Yahoo/current carried data, or show `–`. Check the Action's log line (`ok eps for N/M tickers`) if PE looks stale.

## Watchlist (stocks not held)

`watchlist.json` lists names to analyse before buying. They ride the **same pipeline** — quotes, weekly history, trough P/E, annual financials — because `fetch-prices.js` unions them into its ticker list. There is no second fetch path, and `npm run backfill` picks them up too (it just walks `earnings.json`).

**The rule: a watched stock must never touch the portfolio maths.** Totals, TWR, cohorts and `navHistory()` all iterate `holdings`. A stock you are only *thinking* about must not be able to move a number that reports how you are actually doing. Hence:

- `watchlist.json` is a **separate file** — never merged into `holdings.json`.
- The tempting shortcut (a holding with `qty: 0`) is **wrong**: it would thread a phantom position through every one of those calculations.
- In `fetch-prices.js`, watchlist symbols join exactly one list — `histTickers`, so they get closes to chart and to price the trough against. `navHistory()` and the TWR input stay strictly `priced` (= holdings). Keep it that way.
- On the page, `WATCH` is separate from `STATE`, and a name already held is dropped from it (once you own it, the holdings table is the truth).

### After the owner edits `watchlist.json`

Hand-maintained, not derived — so **`npm run extract` has nothing to do with it** (that reads the Tradelog only). Entries are `{ yahoo, name, geography }`.

```sh
npm run fetch    # only when ADDING a name — it needs a quote before it can render
git add watchlist.json prices.json history.json && git commit -m "watchlist" && git push
```

- **Removing/renaming a name, or editing `geography`** — just commit and push; the page reads `watchlist.json` directly.
- **Adding a name** — it stays invisible until `prices.json` carries its quote. Either run `npm run fetch` first, or push and let the scheduled Action fill it in on its next run.
- **A wrong `yahoo` symbol fails silently.** `fetch-prices.js` and `buildWatchlist()` both filter on `quotes[w.yahoo]`, so a typo just doesn't appear — no error, no placeholder. Unlike `meta.json`, which `extract-portfolio.js` guards by pinging Yahoo, **there is no guard here**. Always confirm a newly added name actually renders in the Watchlist view.
- **Keep `geography` filled in** even though the table now shows the ticker beside the name: the search box still matches on `name`, `yahoo` and `geography`.

`valuation()` in `portfolio.js` is shared by `build()` and `buildWatchlist()` — valuation is a property of the *stock*, not of owning it, so both paths run one formula and cannot drift. A selftest asserts a holding and a watchlist entry on the same quote agree.

**Known gaps** (honest `–`, not guesses):

- **Korean tickers have no trailing EPS from Yahoo** (`005930.KS`, `000660.KS` return `epsTrailingTwelveMonths: undefined`), so P/E and Implied are blank for them. P/E Low still works (it is built from *annual* EPS), as do the chart and the financials table. The escape hatch, if ever wanted, is the `eps` override the entry already accepts — but that is manual maintenance, which this repo deliberately avoids.
- **The trough is thin for a company with loss years.** `troughPe()` only prices a close when the latest published EPS is positive, so a name like GME — whose earlier years are unusable — has its "cheapest ever" drawn from very few points, and can read *below* its own trough (P/E 16x vs P/E Low 26x). Treat vs Low on such names with suspicion.

Each watched name adds ~30KB to `history.json` (lazy-loaded, so it costs nothing on first paint). Fine for a dozen; reconsider at 30+.

## Ex-dividend date (`fetchExDiv` / `exDivToFetch`)

Shown as a chip in the deep dive — accented when it's in the future (own by then to collect), muted "Last ex-div" when it's the past cycle. Payers only.

Unlike the next-results date (which is **free**, batched into the v7/quote call), the ex-div date is **not** in that response — its `exDividendDate` is empty and its `dividendDate` is the pay date, stale and missing outside the US. It lives in `quoteSummary?modules=calendarEvents`, which is **per-ticker and crumb-gated** — the same endpoint the EPS handshake and PE columns depend on.

So it is **cached in prices.json** (`quote.exDiv` + `quote.exDivChecked`) and `exDivToFetch` only looks when there's a reason: no cached date, or the cached one has passed (the next may now be announced). A payer with a future date is left alone. And a per-ticker `exDivChecked` caps a still-unannounced payer to **one look a day**, or an annual HK/EU name would refetch every run for the months its last ex-div sits in the past — the same trap the earnings due-window solves. Steady state is **0 lookups a run**. Hammering that gated endpoint 40×/run for a date few of these holdings pay on could 401 the whole EPS/trough pipeline; that's the reason for all the caution.

ETFs 404 on `calendarEvents` (VOO, EWJ, …). `fetchExDiv` treats 404 as a definitive "no date" (cached, so it backs off) rather than a transient error (retried) — otherwise every ETF payer would retry daily forever.

## Official company guidance

`guidance.json` is deliberately separate from Yahoo's filed annual history. Guidance is forward-looking, quarterly or annual, and each company guides different measures, so the page shows a clearly labelled estimate row in the financials table, with blanks for accounts the company did not guide. Every entry must carry its period, issue date, official investor-relations URL and any material assumption. Never annualise, FX-convert or fill a metric the company did not guide. The one explicit exception is NVIDIA's labelled `runRatePe`: it derives the aligned income/margin/EPS accounts, moves its annualised P/E into the valuation box, and excludes un-guided other income/expense. Update entries by hand after results; there is no generic scraper because companies publish incompatible measures and formats. Keep `_coverage.checked` and `noMatchingGuidance` current so a blank row means "official sources checked, no matching quantitative guidance" rather than "forgotten".

**Latest reported quarter (for the guidance comparison).** Guidance is usually a *quarter*, but the reported rows are full fiscal years — so a guided quarter had nothing at matching granularity to read against. `fetch-prices.js` now also pulls the `quarterly*` twins of the annual accounts (`QUARTERLY_FIELDS`) and stores them as `quarters` on the earnings entry; the panel renders the **latest reported quarter** as one row directly above the guidance row, with sub-lines that are change vs the **same quarter a year earlier** (date-matched ±50d, seasonality-free — never vs the previous quarter). Two deliberate constraints: the row is taken from quarters that carry a top line (Yahoo hands back a just-reported quarter as an EPS stub days before the rest — NFLX Q2), and this rides the **same** fundamentals request (one longer `type=` list, zero extra gated calls). Currently gated to an example allowlist — `QUARTERLY_TICKERS` = {NVDA, NFLX, META} — to prove the comparison before widening; to roll out, drop the guard and fetch quarters for every operating company. Bumping to `EARNINGS_V` 6 forced the one refetch that populated it.

**A missing quarter is reconstructed, not left as a hole.** Yahoo drops a quarter outright for some filers — BYD's Sep '25 is simply absent while the quarters either side are filed. That costs more than one row: the remaining quarters no longer span a year, so the TTM guard (four quarter-ends inside 250–290 days) rightly refuses to total them and the trailing row disappears entirely. Left unguarded it would have summed Mar '25 + Jun '25 + Dec '25 + Mar '26 — double-counting a first quarter and omitting the third.

`portfolio.js` `fillMissingQuarters(quarters, years)` fills a fiscal year that is complete except for **one** quarter: the audited annual **minus** the three filed quarters *is* that quarter, exactly. Two holes are not determinable from one equation, so it declines rather than guesses.

**Flows only** — `rev`, `opinc`, `ni`, `nic`, `norm` accumulate over the year and subtract cleanly. **Never EPS or a share count**: those need the quarter's own share base, and a bonus issue or buyback inside the year makes an imputed per-share figure fiction (BYD's diluted shares roughly doubled during FY2025 — EPS 9.22 → 3.58 on net income down only 19%). A blank EPS is the honest output. Derived quarters carry `derivedQuarter: true`; the page labels the row `derived` and tags a TTM containing one **`part-derived`** rather than `filed`.

Validated against an outside figure: the same code reconstructs Apple's missing Dec '24 quarter at **$124.3B revenue**, its actual reported FQ1 2025. Ten tickers currently gain a quarter — for most it predates the four displayed and only deepens the year-ago comparisons.

## When annual figures get fetched

The scheduled job does **not** re-ask Yahoo for fundamentals. `earningsToFetch` picks tickers three ways:

1. **No entry at all** → fetch. A new holding, or one whose last fetch errored and was deliberately not cached (a transient 429 must never be stored as "this company has no earnings").
2. **Awaiting results** (`dueForResults`) → one look a day. A company is due when its *next* fiscal year ended 30–210 days ago and still hasn't landed. Nothing else is asked, because nothing else can have changed — a December year-end has nothing new to say in July. Today that is typically **1 ticker out of 63**.
3. **The monthly sweep** (`EARNINGS_SWEEP_DAYS = 30`) → everything.

The 30–210 day window is bounded at **both** ends deliberately. Before it, nobody has filed. After it, the answer isn't coming — NW0.DE has been missing FY2025 for months and must not burn a request a day forever.

**Don't delete the sweep.** "Annual figures never change" is false: Yahoo *restates* them. It revised ASML's FY2025 diluted EPS from 26.26 to 24.71 after publication — and 26.26 was the wrong one (it implies 366M shares; ASML has ~389M). The due-window logic would never re-ask a company that already reported, so the sweep is the only thing that catches this. A month is the compromise: restatements are rare, new fiscal years arrive within a day via (2).

`store.updated` timestamps **the last sweep only** — a targeted fetch must not touch it, or the sweep would never come due again. `checked` is per ticker and stamps every fetch, which is what rate-limits (2).

## Yahoo's 4-point cap is PER FIELD, and the windows don't line up

The single nastiest thing about the fundamentals endpoint. Each `type=` you ask for gets its own ~4-point window, and they are **not aligned**:

```
MC.PA    annualTotalRevenue    2022 2023 2024 2025
         annualDilutedEPS      2021 2022 2023 2024      <- no 2025
2638.HK  annualTotalRevenue    2021 2022 2023 2024      <- no 2025
         annualDilutedEPS      2022 2023 2024 2025
```

So **never filter fiscal years on one field's presence.** `fetchAnnualEps` used to key years on EPS, which silently discarded LVMH's FY2025 for six months after it was published — Yahoo had sent the revenue and the net income all along. Six companies were stuck on FY2024 before this was spotted. Every row Yahoo returns is now kept, and consumers filter for what they need (the panel takes years with revenue; `troughPe()` prices closes only off published positive EPS).

`backfill-earnings.js` has the matching rule: a fiscal year you already hold is **not necessarily complete**. It patches missing `rev`/`nic` into an existing year rather than skipping it as "already have" (that is how 2638.HK FY2025 gets its top line).

`mergeEarnings` merges **field by field** for the same reason. A fresh value wins wherever Yahoo sent one (so restatements propagate), but a field Yahoo *omitted* is kept from the store. That is the only thing protecting backfilled data: Yahoo will return a year carrying EPS alone, and replacing the year wholesale would silently delete the revenue the backfill put there.

**A fund is not an operating company, and Yahoo will hand back "revenue" for one anyway** — SPOL.L (an iShares ETF) reports 22.9M of fund income. The test that separates them is *no EPS in **any** year*: a real company has EPS somewhere, even a loss-making one, while a Korean ticker missing only the TRAILING figure still has annual EPS. Do not use "has revenue".

## Deeper financial history (`backfill-earnings.js`)

The deep-dive panel's revenue / net-income table comes from `earnings.json`. Yahoo **hard-caps annual fundamentals at 4 fiscal years** — a 15-year window returns the same four, on both the timeseries and quoteSummary endpoints. It is not a widenable parameter. Don't spend time trying; it has been probed.

`earnings.json` is the store of record and `mergeEarnings()` keeps banked years forever, so history **accretes**: the scheduled job merges Yahoo's 4 on top and older years persist. That gets the 5th and 6th year over time, but could not produce them on day one — hence the backfill.

**Two sources, tried deepest first.**

1. **SEC EDGAR** (`data.sec.gov`) — the filings themselves. Free, no key, documented, stable, and ~9–19 fiscal years deep. **US filers only**, but that includes 20-F filers (BABA, TSM, ASML all report under `us-gaap`). Requires a real contact in the User-Agent.
2. **stockanalysis.com** — 5 fiscal years, but covers HK/Tokyo/Paris/London. No public API; the numbers come from the page's internal SvelteKit `__data.json`, an undocumented index-pointer payload that can change shape on any of their deploys.

Whichever reconciles first wins **outright** — years are never mixed across sources, so a fiscal year can't sit on a different definition from the one before it.

**EDGAR's trap: a raw concept mixes annual, quarterly and per-segment rows that share an `end` date.** AAPL's `2020-09-26` appears as both 274.5B (the year) and 64.7B (a quarter); taking the wrong one is a silent 4x error. Annual rows are the ones on form `10-K`/`20-F` with `fp: FY` whose `start..end` spans ~365 days. Later filings restate earlier ones, so the newest filing of a year wins.

**Why the scrape is safe.** stockanalysis is exactly what this file says not to trust, so it is used the only way it safely can be: **once, by hand, result committed**. It never runs in CI. If it breaks, it breaks on a laptop and the live pipeline is untouched.

**The source proves itself, per ticker.** Yahoo's 4 years overlap the source's 5, so every overlapping year must reproduce Yahoo *exactly* on revenue and bottom line, or the ticker is skipped whole. This matters because field names vary by market — US pages carry `netIncome`, Hong Kong pages carry both `netinc` (group total) and `netinccmn` (after minorities). Rather than hard-code a guess, every candidate field is tried and only one that reproduces Yahoo is accepted: **the check picks the field**, so a schema change cannot silently pick a wrong one.

**Backfills `rev` + `nic` only — never `eps`/`ni`.** A year carrying only `rev`/`nic` has no EPS information, so `troughPe()` treats it as transparent — P/E Low keeps its meaning instead of shifting when this runs. Verified: after a backfill, 0 of 42 `peLow` values moved.

**No gaps, ever** (`unbrokenRun`). A filer switches XBRL tags mid-history — Google files `Revenues` for its older years and `RevenueFromContractWithCustomer...` for its newer ones — so a single validated tag has holes, and the tag covering only the old years can't be validated at all (no overlap with Yahoo's four = no proof). What survives is 2017 sitting next to 2021 with nothing between. Only the **unbroken run back from the newest year** is kept; anything stranded behind a gap is dropped. That is why TSLA and GOOG stay at 5 years while AAPL gets 9.

**Coverage is deliberately partial** — 18 of 50 at 6+ years, 15 at 5, 17 at 4. The rest are refused, not guessed:

- **Refused (no reconcile)** — V, BRK-B, IBKR, TSM, MC.PA, RMS.PA, 0001.HK, 0006.HK. Yahoo's `nic` subtracts preferred dividends and minorities; where a source has no "to common" line its net income won't match (Visa: 327M of preferred dividends). Splicing it in would put one year on a different definition from the next and make the margin trend a lie. **Four years of one definition beats five of two.**
- **Not covered** — Frankfurt/Xetra (`.DE`, `.F`), Korea (`.KS`), and OTC ADRs (XIACY, CCOEY, KWHIY, TKOMY), which have quote pages but no financials.

**`NW0.DE` (CSG N.V.) has fabricated fundamentals and should not be trusted.** Yahoo's `nic ÷ eps` is *exactly* 1,000,000,000 for every year — a placeholder share count — and it shows revenue collapsing 24.9B → 1.7B for a €13 stock. It is stuck on FY2024, and no free source covers Xetra, so it cannot be repaired. It is the one holding whose financials panel is knowingly wrong.

Re-run `npm run backfill` after adding a holding; it is incremental and skips tickers that are already complete.

## Grouping (the "one line per company" feature)

`holdings.json` carries `group` (from `meta.json`, e.g. VOO + VUSA.L → "S&P 500") and `geography` per instrument. `portfolio.js` `build(...)` buckets by a `dimension`: `'company'` (default), `'geography'`, or `'instrument'`. Multi-instrument company rows expand to show their legs; instrument rows expand to show every adjusted trade with balance and average cost. Clicking a row charts it. The stock chart has Price/Gain-Loss views. Clicking a Company or Geography row charts that row's aggregate NAV; the metric toggle is reserved for individual Stock/leg charts. Exception: a single-instrument Company row behaves like its underlying Stock and keeps Price/Gain-Loss because NAV adds no distinct shape.

## One company, one dataset (`primary`)

A depositary receipt is not where a company files. `meta.json` (and `watchlist.json`) may carry
**`primary`** — the Yahoo symbol of the home listing that is the single source of truth for that
company's **fundamentals and results date**. Nine are declared: `NTDOY`/`NTO.F` → `7974.T`,
`XIACY` → `1810.HK`, `TSM` → `2330.TW`, `KWHIY` → `7012.T`, `CCOEY` → `9697.T`, `TKOMY` → `8766.T`,
`6288.HK` → `9983.T`, `BYDDY` → `1211.HK`.

Why it is needed: **Yahoo keeps a separate dataset per listing and they disagree.** Different year
windows (NTDOY had FY2022 where 7974.T did not; NTDOY was missing FY2025 EPS entirely), per-share
figures on different bases, and a results date on one side only (no date for the Capcom or Uniqlo
receipts, while 9697.T and 9983.T both carry one — 9983.T's confirmed).

How it works:
- `fetch-prices.js` builds `fundTickers = tickers + primaries`. The extra home listings are fetched
  for **fundamentals and the batch quote's calendar fields only** — they never reach `fetchTicker`,
  `history.json` or the NAV. You do not own 2330.TW, and a price series for it would be a position
  the portfolio never had.
- `quotes[t].earnings` resolves through the home listing, falling back to the receipt's own date.
  `quotes[t].primary` records where it came from so the UI can attribute it.
- `seedFromReceipt()` folds the receipt's stored history **into** the home listing's entry, rebasing
  EPS by `adrShares`. This runs on every run, outside the fetch branch, so declaring a `primary`
  can never *lose* a period — which is the whole point. **It is gated**: revenue and net income are
  company-level and basis-independent, so they must agree on every overlapping year, and the
  reporting currencies must match. No overlap, a mismatch, or a currency difference means nothing is
  merged — a wrong `adrShares` would otherwise write a fabricated EPS into the source of truth.
- The deep panel reads `store.eps[leg.primary || leg.yahoo]`. A primary entry is already on the
  company's own basis, so `onUnderlying()` is **not** applied to it; that call remains the fallback
  for a receipt with no primary declared.

**Not in scope: `quotes[t].eps` and the P/E columns.** Those are priced against *that listing's own
price* and must stay per-listing. Note Xiaomi currently reads 16.8× on `XIACY` against 14.1× on
`1810.HK`, because `XIACY` carries a manual `eps` override in `meta.json` that the HK line does not.
Moving or deleting that override is a config decision, not a code one.

## Results calendar (the Calendar view)

`quotes[t].earnings = { date, estimate? }` comes from the same batch `v7/finance/quote` call as the
price — no extra request. Two Yahoo fields feed it and they mean different things: **`earningsTimestamp`
is the date the company last reported on** once it has reported, while **`earningsTimestampStart`
carries the projected next one**. `parseQuotes` takes the nearest FUTURE of the two; a past date is
dropped rather than shown as upcoming. A date is `estimate: true` unless it *is* `earningsTimestamp`
and Yahoo hasn't flagged it — `isEarningsDateEstimate` describes only that field and reads false on
plenty of obvious guesses (BLK, TSLA and IBKR all return exactly +91 days from the last report).

The Calendar view (`renderCalendar`) lists one row per **company**, held and watched together: an ADR
and its local line report the same results, so the legs are collapsed and the earliest date any listing
carries wins. Where the date came from a home listing (see `primary` above) the row shows
`XIACY → 1810.HK` rather than implying the receipt filed it. Funds and indices are excluded via `quotes[t].type` (written only for non-equities —
Yahoo hands ETFs an `eps`, so nothing else on the quote separates them). Companies with no published
date are named in a line under the table rather than dropped.

Coverage is 44 of 58 companies (14 confirmed, 30 projected): Yahoo projects a next-results date for
US and Japanese filers but rarely for Hong Kong, Paris or London listings. Dates refresh with the
prices — every 15 minutes on weekdays — and are never carried forward from a previous run.

## Yahoo symbol mapping

Each `meta.json` entry carries its `yahoo` symbol directly — no derivation, no `OVERRIDES` map. `extract-portfolio.js` verifies every *new* symbol (one not yet in `prices.json`) against Yahoo and refuses to write if it returns no price, so a typo fails the extract instead of silently dropping the row (`portfolio.js` skips holdings with no quote). Normal runs make zero network calls. All 56 are currently verified.

## Workbook tabs (for the user trimming the xlsx)

`extract-portfolio.js` now reads **only the Tradelog tab**, and only its cached cell values.

**Portfolio is no longer a dependency of the app.** Its Currency column used to be an `INDEX/MATCH` into Portfolio, which quietly made Portfolio load-bearing; that column is now hardcoded (401 cells). The only Tradelog formulas still pointing at Portfolio are **MktVal** and **YEVal** (cols 20–21), which the extractor never reads. Portfolio is now purely the owner's own Excel reporting — delete it and only those two columns break.

**Forex is still live.** Tradelog Price/Commission formulas use named ranges from it (`=5315/rngUSDJPY`). Extraction reads *cached* values, so a broken formula fails quietly rather than loudly — the app would happily consume a `#REF`. Keep Forex.

Tab name `Tradelog` must not be renamed. Per-instrument display facts (yahoo/group/geography) live in `meta.json`.

**Split column = the units→shares multiplier.** Tradelog `Stock split/Bonus shares` scales raw Qty up and raw Price down. A wrong value here is silent: it keeps total cost correct while misstating both share count and per-share price. (7532 was logged with `2` when the true split was `5`, so the app showed 200 shares instead of 500.) Cross-check quantities against the broker when a position looks off.

## Gotchas

- `fetch-prices.js` must stay dependency-free — CI installs nothing. Don't `require` a package.
- Index symbols (`^GSPC`, `^HSI`) need the caret URL-encoded (`%5E`); `fetchTicker` does this.
- The price bot commits to `main` on every scheduled run, so local pushes need `git pull --rebase` first (`publish.js` does it). On conflict in prices.json/history.json, the bot's/your newer generated file wins — regenerate rather than hand-merge.
- Windows shell here is PowerShell; a Bash tool exists too. `.xlsx` reads need `xlsx` installed (`npm install`), which is dev-only and absent in CI by design.

## Tradelog.xlsx external link (a live fragility)

`Tradelog.xlsx` is a renamed copy of the Master Cashflow workbook, and the copy left behind an **external link** to the original on OneDrive:

```
https://d.docs.live.net/.../Master Cashflow_CC_v0.4.xlsx
```

Two columns the extractor reads still resolve through it, in every row:

- **Adj Qty** — `[1]!Table1[[Qty]] × [1]!Table1[[Stock split]]` → every trade's quantity
- **Gain/(Loss)** — realized gain

Both reference only Tradelog's *own* columns (`Table1` is defined locally, `ref="C1:Y402"`), so the `[1]!` prefix is a pure copy artifact. It works today only because `xlsx` reads Excel's **cached** values — if Excel ever recalculates with the link unresolved, Adj Qty becomes `#REF!`.

`parseTrade` now **throws** on any non-finite numeric cell rather than letting `Math.abs("#REF!")` publish `NaN` quantities. Do not weaken that check.

**To make the workbook self-contained** (then Master Cashflow can be deleted anywhere): retype the two columns without the prefix — `=[@Qty]*[@[Stock split/ Bonus shares]]` and `=IF([@Side]="SELL",-([@[Adjusted Price w Commisions]]-[@[Average Purchase Price]])*[@[Adjusted Qty]],0)` — then Data → Edit Links → Break Link.

## Japanese rows: the price hides in the formula

The workbook's data provider (`_FV`) has no Tokyo coverage, so it prices the Japanese holdings off their **US ADR**. Those three Tradelog rows therefore record a USD price with `Currency = "USD"`, even though the trade happened in yen on the Tokyo line:

```
5332  Price = 3976/rngUSDJPY      -> the trade was ¥3,976
7532  Price = 5315/rngUSDJPY      -> ¥5,315
8001  Price = 2075.5/rngUSDJPY    -> ¥2,075.5
```

**This cannot be "fixed" in the workbook** — Excel's own reporting depends on the ADR price. So `extract-portfolio.js` recovers the real figure instead (`LOCAL_PRICE` / `localPriceScale`): the yen price is the formula's numerator, and every USD-derived figure on the row (adjusted price, average cost, realized gain) rescales by the same factor. Quantities never rescale.

⚠️ The scale is derived from the **cell itself** (`numerator ÷ cached value`), NOT from the Forex tab, because `rngUSDJPY` is a **live** rate (`=_FV(...,"Price")`) — Excel recomputes the USD value on every refresh. Reading the rate separately would drift out of step with the cached value; deriving it from the cell is exact whatever the rate was when the file was last saved.

`meta.json` `currency` for these three must be **JPY**, to agree with the recovered trade currency. Verified against IBKR: 5332 ¥3,979.18 avg, 8001 ¥2,077.16 — the app now matches.

Side effect, and a good one: cost basis now converts at Yahoo's live JPY rate like every other foreign holding, instead of being pinned to the workbook's FX snapshot.


