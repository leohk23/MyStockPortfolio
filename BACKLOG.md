# Backlog

Known work not yet done. Each entry says what is wrong, what it would take, and — where it matters — why it has not been done yet. Delete an entry when it ships; this file is only useful if it stays true.

## Numbers that can mislead

### The Total row's period % is not your return
The `1D … YTD` cells in the total row are the **value-weighted average price move** of the holdings, not a time-weighted return. YTD reads **11.32%** where the actual TWR is **4.44%** — the weighting uses today's values against moves earned on different (often smaller) positions, so money added during the year is credited with a full period's gain.
The number is not meaningless — it answers "how did the things I own move?" — but nothing on the page says so, and the natural reading is "this is how I did".
Options: a tooltip that states plainly what it measures; swapping it for the real TWR (already computed for the KPI strip, but only YTD); or blanking the cells. Needs a decision on which question the row should answer, which is why it is still here.

### Period columns collapse for newly listed names
`pctFrom` ([fetch-prices.js](fetch-prices.js)) takes the first bar at or after the cutoff, so a stock with less history than the period returns "since listing" under a period label. SPCX (listed 12 Jun 2026) shows **1Y and YTD both −20.46%** — the same number, neither of which is a year or a year-to-date.
The obvious fix — return null unless a bar predates the cutoff — is **wrong**: the chart request is `range=1y`, so even mature names start within a day or two of the 1Y cutoff and every ticker would blank. It needs a tolerance (how far after the cutoff a first bar may sit and still count), and that threshold is a judgement call nobody has made yet.

## Smaller

### The watchlist lists one company twice
Xiaomi appears as both `XIACY` and `1810.HK`. The portfolio table de-duplicates on `group`; `buildWatchlist` does not. Either apply the same grouping or accept it as deliberate (the two lines do trade differently).
The Calendar view makes it more visible: the held Xiaomi line and the watched one sit on the same day as two entries. `calendarRows()` collapses legs within a row but cannot pair "XIAOMI CORPORATION" (the holding's `group`) with "Xiaomi" (the watchlist's `name`) — a watchlist `group` key, matching `meta.json`'s, would fix both places at once.

### Fallback quarters have no operating income
Quarters filled from `quoteSummary` ([fetch-prices.js](fetch-prices.js), `fallbackQuarters`) carry revenue and net income only — Yahoo's `incomeStatementHistoryQuarterly` returns `operatingIncome` as absent and several other fields as a placeholder zero. So Op income and Op margin are blank on those rows for every Japanese name.
Not fixable from this endpoint. It would need a different source, and a blank cell is the correct rendering of "we do not know" in the meantime.

### Point-in-time report dates for HK, beyond the latest period
`npm run hkdates` now records each HK name's **latest** annual and interim announcement date from webb-database.com, and `check-interim` uses the interim lag instead of a flat 60-day window. What it does **not** give is history: the reporting-speed table carries one row per company, and the per-company pages carry no results dates at all.
So `REPORT_LAG_DAYS = 90` in [fetch-prices.js](fetch-prices.js) is still a flat guess everywhere, including in `troughPe`, where a wrong date means a low is priced against earnings the market could not yet see. Real per-year dates for HK names would need the SQL dump at [github.com/renavondata/webbsite](https://github.com/renavondata/webbsite) — a bigger job than an HTML fetch, and worth sizing before starting.
Actual HK lags for reference: **annual 57–89 days** (mean 78, against our assumed 90), **interim 43–60 days**.

### Five tickers' 1D baseline still disagrees with the intraday feed
Fixing `prevSessionClose` (it used to skip the newest *completed* session whenever Yahoo left today's daily bar null) took the disagreement between the 1D column and the intraday baseline from **21 tickers down to 5**, and those five are ≤2pp. They split into two causes, and neither source is right in both:
- **2800.HK, SPOL.L, 3067.HK** — Yahoo's *daily* series is missing the previous session entirely (a null bar), so our baseline falls back one session too far. The intraday feed's `chartPreviousClose` is right here.
- **V, R1VL.L** — the daily series is complete and correct, and the intraday feed's `chartPreviousClose` disagrees with it (360.65 against a daily close of 361.32). Our baseline is right here.
The 1D chart deliberately shows the quote's 1D rather than deriving its own from the bars, so there is only ever one 1D number on the page. Resolving the underlying five would mean deciding per-ticker which feed to believe, which needs a third source.

### CLP's interim row is anomalous
webb-database reports 0002.HK's latest interim as period end **2026-01-31**, announced 2026-08-06, a 187-day lag — against a December year end, where the half-year should be 30 June. `check-interim` rejects it via `LAG_SANE` and falls back to the flat window, so nothing downstream is wrong. But it is unexplained: either a quirk in the source or something real about CLP's reporting that is worth understanding before relying on that row.

## Deliberate shortcuts already marked in the code

These are `ponytail:` comments, not bugs — each names its own ceiling and upgrade path.

| Where | Shortcut | Upgrade when |
|---|---|---|
| [fetch-prices.js](fetch-prices.js) `sleep()` | Fixed 300ms between requests | Yahoo starts returning 429s |
| [fetch-prices.js](fetch-prices.js) `REPORT_LAG_DAYS` | Flat 90-day lag from fiscal year end to "published" | A few weeks' slack starts mattering; real filed dates would go in `earnings.json` |
| [fetch-prices.js](fetch-prices.js) `normaliseEps` | Rebasing through net income also absorbs buybacks (AAPL reads ~8% cheap at its low over four years) | A trustworthy split feed exists — Yahoo's is not one (it reports a 6:1 for BYD it never applied to prices) |

## Waiting on the calendar, not on work

`interim.json` is still empty. Nothing is overdue: the HK Main Board issuers' H1 results (period ending 30 Jun 2026) may be announced up to **30 Aug 2026**, and M&S's H1 ends 30 Sep. Run `npm run interim` — it derives the list from the store, so it will say when something is actually due.
