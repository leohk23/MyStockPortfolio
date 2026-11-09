# DASHBOARD.md — the dashboard's machinery

How the dashboard's data is extracted, fetched, built and shown, and the war stories behind each piece. Moved out of
`AGENTS.md` on 8 Nov 2026 (D117), because every pot lane carries that file on every model call and none of this
is needed to read the data, only to change the code that makes it. `AGENTS.md` still applies in full: its goal,
its invariants, and the sections on what each figure means. **Read this before changing the extract, the price
bot, `portfolio.js`, the workflows or the page.**

## Files

| File                             | Role                                                                                                                                                                                                                                                         | Runs where                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `extract-portfolio.js`         | Reads the Tradelog tab +`meta.json` → `holdings.json`. Sums qty/cost/realized from the Tradelog; pulls yahoo/group/geography from `meta.json`.                                                                                                        | User's machine only (`npm run extract`) |
| `meta.json`                    | Per-instrument facts not in the Tradelog:`yahoo`, `group` (consolidation key), `geography`, `currency`, and optional PE inputs `eps`/`specialEps`/`specialEpsLabel` (see below). Keyed by Tradelog symbol. Edit when opening a new instrument. | Committed                                 |
| `fetch-prices.js`              | Yahoo Finance →`prices.json` + `history.json`. Also best-effort fetches trailing EPS (crumb-authenticated, unlike the rest of this file). **No dependencies** (uses global `fetch`).                                                            | GitHub Actions (15 min, Mon-Fri) + local  |
| `watchlist.json`               | Stocks watched but**not owned** — `yahoo`, `name`, `geography` (+ the same optional `eps`/`specialEps` overrides `meta.json` takes). Hand-edited. See "Watchlist" in AGENTS.md.                                                                  | Committed                                 |
| `guidance.json`                | Manual company-issued guidance for operating-company holdings/watchlist names. Literal display values + period, issue date, official source and material assumptions;`_coverage` records names checked with no matching quantitative guidance.             | Committed                                 |
| `backfill-earnings.js`         | `npm run backfill`: tops `earnings.json` up with fiscal years Yahoo cannot reach (see "Deeper financial history" in AGENTS.md). **Manual, one-off — never in CI.**                                                                                       | User's machine only                       |
| `gilt-quote.js` | A gilt's live London Stock Exchange quote by ISIN, through onvista.de: the mid of the book, the coupon, maturity and issuer. Used by the price bot and by the extract, which also writes a new gilt's `meta.json` entry from it (see "Gilts" below). Dependency-free. | GitHub Actions + local |
| `backfill-gilts.js` + `gilt-history.json` | `npm run backfill-gilts`: a gilt's daily closes from before the price bot started storing mids, from onvista.de (see "Gilts" below). **Manual, one-off — never in CI.** The bot only reads the committed file. | User's machine only |
| `portfolio.js`                 | Pure aggregation shared by page and tests.`build(holdings, rates, quotes, dimension)`, `valuation`, `buildWatchlist`, `fillMissingQuarters`. Anything selftestable lives here rather than in the page.                                                        | Browser (`window.portfolioLib`) + node  |
| `index.html`                   | Dark-only UI: totals, chart, sortable/groupable table.                                                                                                                                                                                                       | Browser                                   |
| `push-alerts.js` + `sw.js` | Phone alerts (D86): after each price fetch, a holding (book or pot) moving ±5% on the day sends one Web Push notification; `sw.js` shows it on the phone. Secrets `VAPID_PRIVATE_KEY` and `PUSH_SUBSCRIPTION`; memory in `alerts-state.json`. The bell button on the page produces the subscription. Dependency-free. | GitHub Actions (prices.yml) + browser |
| `publish.js`                   | `npm run publish`: extract → commit holdings.json → rebase → push.                                                                                                                                                                                      | User's machine                            |
| `.github/workflows/prices.yml` | Run every 15 min on weekdays by an **outside scheduler** calling `workflow_dispatch` (GitHub's own cron delivers only ~1 run in 6 hours and stays as a backup), and on every push; runs selftests, fetches, sends phone alerts, commits. Weekdays only — every exchange in the book is shut at weekends. Public repo, so the runs are free.                                                                                                                                                                                                               | GitHub                                    |
| `.github/workflows/pot-sweep.yml` | The Mon/Wed/Fri second-run Sweep on Claude, so it needs no laptop (D111). Started by the outside scheduler, since GitHub's cron runs hours late (D118). Gates on D108's three hours, then calls `pot-lane.yml`. `workflow_dispatch` takes `mode`: run, force or check. | GitHub |
| `.github/workflows/pot-review.yml` + `pot/review-due.js` | The Review on Claude, nightly when due (D114), started by the outside scheduler (D118). `review-due.js` decides for both machines: booked dates, a pot holding's results, two days. `workflow_dispatch` takes `mode`: run, force or check. | GitHub + local |
| `.github/workflows/pot-lane.yml` | One pot lane on Claude, called by the two above. Runs `pot/run-lane.ps1` on a Windows runner with no push credential; a second job checks the patch against the lane allowlist and the token, then pushes. Secret `CLAUDE_CODE_OAUTH_TOKEN`. | GitHub |
| `.github/workflows/pot-alert.yml` + `pot/sell-alert.js`, `pot/proposal-alert.js` | A Review's `broken`, `played-out` or `breach` becomes a GitHub issue assigned to Leo, which GitHub emails (D114), and so does each new proposal, with its whole text, once the cycle has stamped it (D119). On a push that changes a Review or a proposal, and called after the cloud Review. `-f test=sale` or `-f test=proposal` opens a test issue. | GitHub |

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

`extract-portfolio.js` refuses to write without the passphrase, so a missing `.holdings-key` can never publish positions in the clear. First-time setup: `tools/set-holdings-key.ps1`.

**It now runs itself** (14 Oct 2026). The workbook is Leo's live master on OneDrive, `Master Cashflow_CC_v0.5.xlsm`, kept synced to the laptop; its path is in the gitignored `.tradelog-path`, and the extractor reads that file's Tradelog tab (without `.tradelog-path` it falls back to a `Tradelog.xlsx` in the repo; the old copies were removed on 14 Oct 2026). Task Scheduler's **`MyStockPortfolio tradelog watch`** runs `publish-on-change.js` every 15 minutes while Leo is logged in: when the workbook's modified time or size has moved since the last successful publish (`.tradelog-published`), and the save has been still for two minutes (so a file still syncing down is never read half-written), it runs `npm run publish`. A failure is logged to `publish-on-change.log` and retried on the next run, and it never publishes off `main`. **It waits while a pot cycle runs** (`pot/.daily-lock` names a live process): a commit landing inside a lane looks like the lane tampering with git, and D91 discards the whole run (D92). The same goes for any commit you make by hand, so check for that lock before committing while a cycle may be running. So an edit made in Excel Online or on the phone reaches the site once the laptop has synced it. Running `npm run publish` by hand still works and is harmless. **A new instrument's `meta.json` entry is written by the extract** (`resolveMeta`, 26 Oct 2026): from the watchlist where the name is on it, otherwise the Tradelog symbol on the exchange its trade currency implies (pence `.L`, HKD a 4-digit `.HK`, JPY `.T`, ...). It is accepted only if exactly one listing is quoted in the trade's currency within 40% of the price last paid; Frankfurt and Vienna count only when no home-exchange listing fits. The entry carries an `auto` note saying how it was found, never the price paid (`meta.json` is public). Anything ambiguous is refused as before, and the log says why. A dry run over the book found 46 right, 0 wrong. **A gilt recorded by its ISIN is filled too** (`resolveGilt`, 28 Oct 2026): see "Gilts" below.

Do not hand-edit `holdings.json`, and do not reconstruct trades by hand — the workbook is the source of truth and `extract-portfolio.js` is the only thing that reads it.

- **Check the branch first.** `publish.js` commits to the current branch. Off `main`, the live site never sees it (Pages serves `main`). Fix: `git checkout main && git cherry-pick <sha>`.
- **The workbook is local-only** (on OneDrive, synced to the laptop), so this cannot run in a cloud session — there is no workbook there. Everything else can.
- **Writing to the workbook is the owner's job.** It is an Excel Table with ~5k formulas, external links and a data connection; SheetJS round-trips drop all three. If a row must be added, give the owner the input-column values (C,D,E,F,G,H,I,P,X — the rest are formulas) rather than writing the file. Excel COM works but is flaky here (locale/link quirks).
- Verify after: `wrote holdings.json: N instruments`, then the new trade's date, quantity and average cost, and that `Bal Qty` closed out if it was a full exit. Dates are calendar days read straight off the workbook (`ymdLocal`) — a date one day out is a bug, not rounding.

## Preview-first workflow

New UI and content work goes to `preview/index.html` and is pushed to `main`, which makes it reviewable at `/MyStockPortfolio/preview/`. Keep `index.html` unchanged until the owner asks to promote it. `npm run promote` copies the reviewed preview over the live page; do not run it by inference. Root data files are shared by both pages, so a pilot-only dataset must remain unused by `index.html` until promotion.

## Ex-dividend date (`fetchExDiv` / `exDivToFetch`)

Shown as a chip in the deep dive — accented when it's in the future (own by then to collect), muted "Last ex-div" when it's the past cycle. Payers only.

A company's panel also has a **Dividends** box under Financials (Leo, 2 Nov 2026), kept out of Valuation because what a share pays is a different question from what it is worth. It shows the trailing yield, what was paid a share and how many payments, the ex-dividend date, and what the position has paid you when unlocked. A dash there means none on Yahoo's record, not none paid: the record is incomplete for the over-the-counter Japanese receipts (NTDOY, CCOEY, TKOMY), so the box says so in words. Funds and gilts keep their income in the facts box instead.

Unlike the next-results date (which is **free**, batched into the v7/quote call), the ex-div date is **not** in that response — its `exDividendDate` is empty and its `dividendDate` is the pay date, stale and missing outside the US. It lives in `quoteSummary?modules=calendarEvents`, which is **per-ticker and crumb-gated** — the same endpoint the EPS handshake and PE columns depend on.

So it is **cached in prices.json** (`quote.exDiv` + `quote.exDivChecked`) and `exDivToFetch` only looks when there's a reason: no cached date, or the cached one has passed (the next may now be announced). A payer with a future date is left alone. And a per-ticker `exDivChecked` caps a still-unannounced payer to **one look a day**, or an annual HK/EU name would refetch every run for the months its last ex-div sits in the past — the same trap the earnings due-window solves. Steady state is **0 lookups a run**. Hammering that gated endpoint 40×/run for a date few of these holdings pay on could 401 the whole EPS/trough pipeline; that's the reason for all the caution.

ETFs 404 on `calendarEvents` (VOO, EWJ, …). `fetchExDiv` treats 404 as a definitive "no date" (cached, so it backs off) rather than a transient error (retried) — otherwise every ETF payer would retry daily forever.

## Grouping (the "one line per company" feature)

`holdings.json` carries `group` (from `meta.json`, e.g. VOO + VUSA.L → "S&P 500") and `geography` per instrument. `portfolio.js` `build(...)` buckets by a `dimension`: `'company'` (default), `'geography'`, `'sector'`, or `'instrument'`. Sector reads `quote.sector` (Yahoo `assetProfile`); a fund has no single sector and sits under **Funds**. Multi-instrument company rows expand to show their legs; instrument rows expand to show every adjusted trade with balance and average cost. Clicking a row charts it. The stock chart has Price/Gain-Loss views. Clicking a Company or Geography row charts that row's aggregate NAV; the metric toggle is reserved for individual Stock/leg charts. Exception: a single-instrument Company row behaves like its underlying Stock and keeps Price/Gain-Loss because NAV adds no distinct shape.

**Cohort views.** The table follows the chart: Performance with **New** on and **Existing** off cuts it to this year's purchases (`portfolio.js` `newBuys`), and **Existing** on and **New** off to the shares held before it (`existingShares`), each then through the ordinary `build()`, in any grouping. New with Existing is the whole book again, so that shows everything; selecting a stock does not undo the cut, and a group selected from the cut table charts its full legs, whose own cohort lines do the splitting. The two cuts add up to every share held, and sales this year come out of the older shares first.

Existing is at the 31 Dec average cost and keeps all realized gains; its gain is since purchase, not this year. Its line holds the 31 Dec shares all year as if left alone, so the table is smaller than the line wherever an old holding was trimmed this year; elsewhere the two agree exactly. New is at what was paid this year, so Shares, Cost, Value, Gain, Held and CAGR are those shares' own, and its value equals the New line's endpoint; it never shows more shares than are held.

Received is "–" for any row with a cut leg, because IBKR records income per holding, not per lot; an Existing row bought nothing this year keeps it. The tiles and Mix stay whole-portfolio. It needs the trades, so locked there is no cut.

## Dividends and total return

The performance lines count income (Leo, 8 Oct 2026). A price-only return understates exactly the holdings bought for income, and a gilt's coupon is most of its return.

- **What counts:** each dividend, **net of withholding tax**, reinvested on its **ex-date**, on the shares held the day before (a buy on the ex-date misses it). `cohortMV` returns the day's `income` and `twr` counts it as return. Accumulating funds pay nothing out, so they are excluded by construction: their income is already in the price.
- **Where it comes from:** Yahoo's dividend events, on the weekly full-history call the job already makes (`events=div,split`), put on today's share basis exactly as the closes are (`perShareOnBasis`). Gilt coupons come from their schedule (`giltCoupons`: ex 7 business days before the coupon, paid gross). `history.json divs` holds `{ wht, ex: [[date, gross per share]] }` per series, **unioned with the previous run's**, so a failed fetch cannot drop history.
- **Withholding** (`whtOf`): by market, then issuer exceptions. Leo approved the rates, and they were checked against a year of what IBKR actually deducted: US 15.0%, Japan and its ADRs 15.32%, France 25.0% (statutory; the 12.8% treaty rate needs forms 5000/5001), Korea 22.0%, BYD's ADR 10.0%, Hong Kong and Irish funds 0%, Garmin 0% (paid from Swiss capital reserves). A market not in the table has no rate: its dividends count gross, `wht` is null and the job logs it. Not UK tax: that depends on the wrapper.
- **Benchmarks on the same footing** (`BENCH_INCOME`): the S&P 500 through VOO and the Hang Seng through the Tracker Fund (2800.HK), each with its distributions net. A price index against a total-return portfolio would hand the portfolio the index's own yield every year. Checked on 8 Oct: VOO net read +14.8% YTD, between the S&P price index (+14.0%) and Yahoo's gross total-return index (+15.0%).
- **Published both ways:** `twrIncome` / `long.twrIncome` and `performance.income` are total return, and both pages read them (promoted 8 Oct 2026). The price-only `twr`, `long.twr` and `performance` fields are still published, and the page falls back to them only if a total-return field is missing.
- **Known gap:** Yahoo's dividend record is incomplete for the over-the-counter Japanese receipts (NTDOY, CCOEY, TKOMY: the last one to two years missing). It matched IBKR's actual payments for the other 23 IBKR holdings. The performance lines still use Yahoo's per-share figures, so they miss these few payments (about a quarter of a percent of the book); the income received below does not.

**Income received** (the table's Received column and the Income received tile) is what each position has paid since it was bought, net of withholding, in USD at today's FX (`incomeReceived` in portfolio.js):

- **Actual, for IBKR shares:** `ibkr-dividends.js` (`npm run dividends`, run first by `npm run publish`) reads IBKR's Flex Web Service, a year per request, with the token and query id in `.ibkr-flex`. Every dividend, the tax IBKR withheld from it, payments in lieu and a bond's interest go into `.ibkr-dividends.json`. Both files are gitignored and denied to lanes, and the token never leaves the laptop. `extract-portfolio.js` matches the rows to holdings (`matchReceipts`: exact symbol, then without suffix or leading zeros, then shared ISIN, which is how LVMH's "MOHd" line joins MC) and seals them into `holdings.json` as `received`.
- **IBKR's record starts on 29 Mar 2024**, the first activity of the account behind the token. The 2022-23 IBKR trades were on an earlier account, and Flex answers 1003 "Statement is not available" before it, and for today, since it serves completed days only. A holding with IBKR shares but no rows was paid nothing inside the record. **A refusal never shrinks the record:** the newest window ends on the last weekday (Flex has no statement for a weekend day), a window IBKR refuses that is already on record keeps its rows, and an account refused outright ("Too many failed attempts") keeps its previous record. On Sunday 25 Oct 2026 a Saturday end date dropped six months of the current account and five holdings lost their dividends in `holdings.json`.
- **Calculated, for everything else:** shares at T212, TD and SC, and IBKR shares before 29 Mar 2024. Each ex-date's dividend net of withholding (`history.json divs`) on the shares held the day before; never for a payment IBKR's record already holds.
- `fetch-prices.js` computes it per holding and publishes it **sealed** as `prices.json received` (`{ actual, estimated, ttm: { actual, estimated } }`, USD; `ttm` is the last 12 months, by IBKR payment date and by ex-date for the rest), like the NAV. The page opens it with the passphrase; locked, the column is "–". The Income 12M tile shows `ttm` and what it yields on today's value; the table's Received column stays since bought.

## Gilts: priced from the London Stock Exchange's order book, by ISIN, not Yahoo

Yahoo lists no individual gilts (no `.L` code resolves, and its search finds none), and the DMO's site blocks scripts. A gilt is recorded in the Tradelog under its **ISIN**, so its `meta.json` key is the ISIN, and the holding carries **`isin`**, which marks it as a gilt; `yahoo` is then only its key (`UKT31.L`, `UKT36.L`). `isin` and `lse` (the exchange code, where known) are public fields (`vault.js` `PUBLIC_FIELDS`): identifiers, like `yahoo`.

**A new gilt needs nothing by hand** (`resolveGilt`, 28 Oct 2026). The extract looks the ISIN up on onvista and fills the entry only if: the issuer is the UK government; the trade was in pounds; and the London price is within 40% of the price paid per £100. The 40% check catches a Qty entered as the nominal. The ticker is `UKT` plus the maturity year, and the group is `UK Gilts`. A second gilt maturing in the same year is refused rather than numbered. The exchange's own code can no longer be looked up, so it is not guessed. Both the ticker and `yahoo` can be renamed by hand: the bot finds a renamed gilt's stored closes and backfill under its old key by ISIN (`byIsin`), and everything else keyed by `yahoo` is rebuilt each run. T31 (named after its exchange code, `lse`) became **UKT31** that way on 30 Oct 2026, so every gilt follows the one convention the extract writes.

**In the Tradelog:** Qty = **nominal ÷ 100**, Price = the **clean price per £100** from the contract note, currency GBP. Every gilt price is quoted per £100 nominal, so Qty × Price is what was paid. Accrued interest goes in the comment, never in Price or Commission: it is not cost, and the next coupon repays it.

- **The price is the exchange's book, read through onvista.de** (`gilt-quote.js`, shared by the bot and the extract). The bot read the exchange's own instrument endpoint by code until it began refusing scripts with 403 on **22 Oct 2026**. Every run after that logged `stale T31.L` and still succeeded, so T31 sat at that evening's price for six days and nothing flagged it. onvista carries every gilt by ISIN with the London Stock Exchange as a venue, delayed 15 minutes. Its bid and offer are the exchange's book: T31's spread reads 0.30 there, as it did on the exchange.
  - `price` is the **mid** of bid and offer. The last trade is used only when the book is one-sided.
  - A close is filed under the day the book was struck, not the day of the run, so a 06:30 run's reading of last night's book goes to last night.
  - The response is checked before it is used: the ISIN must match, the venue must be London in GBP per £100, and the price must be plausible. A changed shape throws, and the last price and closes are kept.
  - Undocumented, the same risk class as HKEXnews.
  - Do not get round the exchange's refusal by sending a browser's headers: it is refusing scripts on purpose.
- `quote.bond` carries the coupon (onvista's, for a fixed coupon; null for an index-linked gilt, whose price is real and whose coupon onvista gives already uplifted), maturity, ISIN, bid, offer and **`ytm`**, the gross redemption yield the DMO quotes. `divYield` is the running yield, coupon ÷ clean price. `type: 'BOND'` keeps it out of every Yahoo-only lookup, and the Sector view files it under Bonds.
- **Its price history exists only in `prices.json`.** The bot reads no history endpoint, so each run stores the mid in `quote.lseCloses` (the name predates onvista) under the London date it was struck (weekdays only), and the last run of a day leaves that day's close. The daily and weekly series are built from it. Not the exchange's `lastclose`: that is the last trade, often at the bid or offer, and against a mid it shows the spread as a move. Never drop the field or rebuild `prices.json` without it. A failed fetch keeps the last quote and its closes (stale, and `at` says so) rather than losing the history.
- **Before the first stored mid, the closes come from `gilt-history.json`** (25 Oct 2026). The exchange has no history endpoint, but onvista.de carries each gilt by ISIN with the London Stock Exchange as a venue, back to issue: T31 has 671 days from 29 Feb 2024. `backfill-gilts.js` fetches it **once, by hand** (`npm run backfill-gilts`; in a cloud session, with `NODE_USE_ENV_PROXY=1`), and the bot only reads the committed file: onvista's history stays off the scheduled path, though its live quote has been on it since 28 Oct. Its close is the day's **last trade**, not the mid: on T31's first 12 stored days it sat 0.055 below the mid on average, against a typical daily move of 0.16. Hence:
  - The script refuses a gilt whose overlapping days miss the stored mids by more than 0.5 (a wrong instrument or unit misses by points), or that has fewer than 5 days to compare.
  - `withBackfill` uses the backfill only for days **before** the first `lseCloses` day; the mids always win, and the backfill never enters `lseCloses`. 1D stays mid against mid.
  - The daily series is cut to the last year (`lastYear`), the window Yahoo's daily call covers: `alignedCloses` takes the union of every ticker's days, so a 2024 start would stretch every daily series with nulls. 2Y/5Y/All read the weekly, built from every close.
  - `quote.backfill = { source, basis, from, until }` tells the page where the last trades end; the price chart's note and the deep panel say so.
  - `giltSeries` builds the moves, the daily series and that label, for a fresh fetch and for a failed one alike: a run where the exchange refuses keeps the last price, and its moves still reach back through the backfill.
  - Re-run it after buying a new gilt (it needs the gilt's ISIN in `prices.json` and at least 5 stored mids first, so a week after it is added).
- A period longer than the stored history shows "–" (`sinceStored`), never a move from the first close. Weekly bars are bucketed with the same `weekEnd` as Yahoo's (`weeklyFromDaily`).
- `extract-portfolio.js` verifies a new gilt the way the bot will price it, by ISIN through `gilt-quote.js`, instead of against Yahoo.
- **A bond fund's yield to maturity** is its issuer's figure, never computed here: `ishares` in `meta.json` (the fund page's `id/slug`; the id alone is refused) makes `fetchIsharesYtm` read the "Weighted Average YTM" iShares embeds in the page, into `quote.fundYtm` with its as-of date. Once a day, carried between, the last figure kept on failure. iShares sits behind bot protection that admits a browser's headers; a script's are refused.
- **The Valuation box is hidden for anything that is not a single company** (Leo, 8 Oct): a gilt, a fund, a trust or an index (`quote.bond`, or `quote.type` not EQUITY). Every row there is a company's (EPS, five-year low, normalized basis), so for these it would be all "–". What does apply sits in the facts box: a gilt's yield, and for an equity fund the **P/E of its holdings**, Yahoo's trailing figure, shown only when positive and the fund holds companies (Yahoo gives the gold trust a negative EPS and SPOL -200).
- Ceilings: the yield ignores the ex-dividend window (the 7 business days before a coupon) and settlement ignores bank holidays, a basis point or so.

## Funds: what the deep panel shows instead of financials

A tracker has no earnings, so the Financials box used to dead-end on "not an operating company".
It now renders `fundFacts()`: fee, income policy, payout count, yield and category.

- **`quotes[t].divCount`** — how many distributions in the trailing year, free from the chart call
  that already asks `events=div,split` for `divTTM`. Payout frequency needs no extra request.
  Deliberately a **count of what the fund did**, not a schedule read off a prospectus.
- **`quotes[t].fund`** = `{ expense, category, family, name, checked }` from `quoteSummary`'s
  `fundProfile` + `quoteType`. Non-equities only, gated on `FUND_STALE_DAYS = 90` — an expense
  ratio never moves — and carried forward between sweeps like `exDiv`.

**Yahoo reports a MISSING expense ratio as 0.000%.** VUSA.L and WDEF.PA both come back zero and
neither is free (Vanguard's S&P 500 UCITS charges 0.07%). A zero is therefore dropped, not
published — the same placeholder-zero trap as the quarterly fallback's operating income. 12 of 16
funds have a fee on file; the rest correctly show "–".

Accumulating vs distributing, in order of evidence quality (`incomePolicy()`):
1. `divCount > 0` → **Distributing**. A payment settles it.
2. Name matches `Acc` / `(Acc)` / `accumulating` → **Accumulating**. The issuer's own word beats
   inferring a policy from silence, which is why the fund's `longName` is stored at all.
3. Category or name is commodity/crypto → **No income**. IAU, IBIT and GBTC hold assets that pay
   nothing, so there is neither a distribution nor anything to accumulate; calling them
   "accumulating" would imply income exists.
4. Otherwise → **"No distributions in the last year"**, unlabelled. Not the same as proving
   accumulation.

Not a table column: the fee would be blank on 43 of 59 rows. If a scannable comparison is ever
wanted, the watchlist table is the place, not the holdings table.

## Yahoo symbol mapping

Each `meta.json` entry carries its `yahoo` symbol directly — no derivation, no `OVERRIDES` map. A new holding's entry is filled by the extract when one listing passes its checks (see "After the owner updates the Tradelog"). `extract-portfolio.js` verifies every *new* symbol (one not yet in `prices.json`) against Yahoo and refuses to write if it returns no price, so a typo fails the extract instead of silently dropping the row (`portfolio.js` skips holdings with no quote). Normal runs make zero network calls. All 56 are currently verified.

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

## The old external link (resolved 14 Oct 2026)

**Resolved:** the live master, `Master Cashflow_CC_v0.5.xlsm`, has no external-link formulas in the columns the extractor reads (0 cells checked), so an edit made in Excel Online computes normally. Kept for the reasoning, and because the `parseTrade` guard below still matters.

The old `Tradelog.xlsx` was a renamed copy of the Master Cashflow workbook, and the copy left behind an **external link** to the original on OneDrive:

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
