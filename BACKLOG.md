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

### The watchlist lists one company twice — DELIBERATE, do not "fix"
Xiaomi appears as both `XIACY` and `1810.HK`, and HKEX as both `HKXCY` and `0388.HK`. In each pair the ADR is held and the home listing is watched, so the same company shows twice in the Calendar view, on the same day.
**This is intended.** Holding the receipt while keeping the primary listing on the watchlist is how the home line's own price stays on the page — it appears nowhere else. Asked directly (18 Aug 2026): *"it's okay I just want to see the price of the primary listed ones"*.
So do **not** de-duplicate `buildWatchlist` on `group`, and do **not** drop a watched line when its ADR is bought: either would remove the price it is there to show. If this duplication ever does need to go, the replacement must first surface the primary's price on the holding's own row — `quotes[t].primary` already records which listing that is.

### Fallback quarters have no operating income
Quarters filled from `quoteSummary` ([fetch-prices.js](fetch-prices.js), `fallbackQuarters`) carry revenue and net income only — Yahoo's `incomeStatementHistoryQuarterly` returns `operatingIncome` as absent and several other fields as a placeholder zero. So Op income and Op margin are blank on those rows for every Japanese name.
Not fixable from this endpoint. It would need a different source, and a blank cell is the correct rendering of "we do not know" in the meantime.

### The trough is on a TTM basis for US filers only

`troughPe` and `peBands` now divide by a rolling twelve months built from SEC quarterly filings —
the same basis as the headline P/E, so the two are comparable. That only reaches **US filers**.
Hong Kong, Japan and Europe still use the latest ANNUAL EPS, and where a company has grown since
its year end that reads dear against a TTM headline. Two names currently show a "cheapest ever"
*dearer* than today — **0006.HK** (7.1x current, 12.4x trough) and **0066.HK** (8.9x, 10.2x) —
which is not a market fact, it is the basis mismatch showing through. Fixing it needs a quarterly
EPS source for those markets; HKEXnews carries the interim announcements but only two periods a
year, so a TTM would still be a half-year approximation.

### Point-in-time report dates for HK, beyond the latest period
`npm run hkdates` now records each HK name's **latest** annual and interim announcement date from webb-database.com, and `check-interim` uses the interim lag instead of a flat 60-day window. What it does **not** give is history: the reporting-speed table carries one row per company, and the per-company pages carry no results dates at all.
US filers are now solved: `npm run filings` reads actual 10-K/20-F filing dates from SEC EDGAR into `filing-dates.json`, and `reportedBy()` prefers them. Real lags are **21–47 days**, not 90 — the guess was wrong by two to three times, and it moved 14 of 64 troughs (NVDA 38.50x → 31.71x; MRVL 53.73 → 28.62; ARM 97 → 141, correctly dearer once its pre-IPO years stop being treated as public).

`REPORT_LAG_DAYS = 90` remains the fallback for **non-US filers** — Hong Kong, Japan, Europe — where no equivalent source is wired up. That is where a wrong date still means a low priced against earnings the market could not yet see. Real per-year dates for HK names would need the SQL dump at [github.com/renavondata/webbsite](https://github.com/renavondata/webbsite) — a bigger job than an HTML fetch, and worth sizing before starting.
Actual HK lags for reference: **annual 57–89 days** (mean 78, against our assumed 90), **interim 43–60 days**.

### Five tickers' 1D baseline still disagrees with the intraday feed
Fixing `prevSessionClose` (it used to skip the newest *completed* session whenever Yahoo left today's daily bar null) took the disagreement between the 1D column and the intraday baseline from **21 tickers down to 5**, and those five are ≤2pp. They split into two causes, and neither source is right in both:
- **2800.HK, SPOL.L, 3067.HK** — Yahoo's *daily* series is missing the previous session entirely (a null bar), so our baseline falls back one session too far. The intraday feed's `chartPreviousClose` is right here.
- **V, R1VL.L** — the daily series is complete and correct, and the intraday feed's `chartPreviousClose` disagrees with it (360.65 against a daily close of 361.32). Our baseline is right here.
The 1D chart deliberately shows the quote's 1D rather than deriving its own from the bars, so there is only ever one 1D number on the page. Resolving the underlying five would mean deciding per-ticker which feed to believe, which needs a third source.

### CLP's interim row is anomalous
webb-database reports 0002.HK's latest interim as period end **2026-01-31**, announced 2026-08-06, a 187-day lag — against a December year end, where the half-year should be 30 June. `check-interim` rejects it via `LAG_SANE` and falls back to the flat window, so nothing downstream is wrong. But it is unexplained: either a quirk in the source or something real about CLP's reporting that is worth understanding before relying on that row.

## CI and scheduling

### The 15-minute price refresh is not happening, and no explanation has survived
Leo's stated hard requirement is a 15-minute refresh. The workflow asks for it — `'3,18,33,48 0,1,5-21 * * 1-5'`, 76 firings a weekday — and GitHub delivers a small fraction. Monday 7 Sep produced **2 scheduled firings in 13 hours** against ~44 expected, with a 346-minute gap.
Two explanations were tested and **both are dead**. It is not minute-0 contention: the cron was moved off the hour on 4 Sep and the rate did not change. It is not the push cascade saturating the `prices` concurrency group: 7 Sep had exactly **one** push-triggered run all day and the schedule still fired twice.
What remains is that GitHub simply drops most scheduled firings on this repo, which its own docs permit — `schedule` is best-effort. If that is the answer, no cron shape fixes it and the requirement needs a different mechanism (a `repository_dispatch` pinged from somewhere that does keep time, or accepting a lower rate). Monday 14 Sep is the first full weekday of clean data since the change; decide after it, not before.

## The pot

### Cash conversion and capital measures stop at the US border
`capital.json` comes from SEC `companyfacts`, so `roic`, `gpa`, `turnover` and now `cfo`/`fcf`/`cashConv` exist for US filers only. Coverage is **65% US against 56% non-US**, and the gap is structural rather than incidental: there is no EDGAR for Japan, Hong Kong or most of Europe.
This is why 2325.T's ranking row read "all three capital measures are absent". It was *not* the reason the name was rejected — that was the 30th valuation percentile — but a reader cannot tell those apart at a glance, and every non-US candidate carries the same thin row.
Filling it means a per-market fundamentals source, which is the same shape of job as the HK report-dates entry above and should be sized before starting.

### One model for every lane, and the deep dive is the only one that needs the expensive one
`-Model` is threaded through `run-daily.ps1` to every lane, so a cycle cannot mix models. On `gpt-6-astra` a cycle costs roughly **4x** what it did on `gpt-5.6-sol` — measured like for like on the same lane, 13.8 allowance points per million tokens against 4.1.
The quality that justified astra came **entirely from the deep dive** (the 7 Sep RELX proposal, where it declined to buy). Review is mechanical and the sweep produced nothing distinctive. Splitting — sol for review and sweep, astra for the deep dive — would cut a cycle to about a third with the reasoning intact.
Not done because Leo asked to hold it while cadence changes settle. It needs a per-lane override on the existing parameter, which is small.

### The ledger reports the rate limit that was not binding
`pot/runs.md` carries the **weekly** allowance (`limits.secondary`) and not the 5-hour one (`limits.primary`). On 8 Sep the weekly sat at a comfortable 28% while the 5-hour window hit 100% and killed a cycle mid-run.
Both numbers are in the same `rate_limits` object already parsed in `pot/report.js`. Two lines, and it is the column that would have shown the failure coming.

### The Sweep's thesis hook is still opt-in
Rule 0 in `brief-deepdive.md` forces every proposal to declare which entries in `pot/theses.md` bear on the name, or the word `none`. The Sweep's equivalent is *"say which thesis, if one drove the candidate"* — a suggestion, and the failure it was written to prevent was exactly this kind of silence.
Left deliberate for now: the Sweep ranges over a market rather than one name, so "which theses bear on this" has no single subject. The right fix is probably parked guard #2 below rather than copying Rule 0 across.

### Two guards on the thesis file are parked, and one of them is load-bearing
`pot/theses.md` was designed with two guards that Leo parked while the shape is tested: **(1)** every thesis carries a dated falsifier and the Review lane checks it; **(2)** the Sweep must name what each thesis argues *against*, including inside Leo's own book.
Without them the file can become a confirmation-bias engine — the Sweep goes and finds evidence for a conclusion Leo already holds, which is the failure mode `brief-sweep.md`'s bias section exists to prevent. Guard 2 also turns out to be the natural fix for the entry above.
`brief-deepdive.md` Rule 4 still bites independently: an undated dominant risk halves the order whatever a thesis says.

### 70 names on the watchlist, 7 ever proposed
The Sweep has added **48 names over 27 runs** and the deep dive has ever proposed **7** (GME, INTU, MWA, NVDA, REL.L, RSGN.SW, TW). Until 8 Sep the ranking covered 23 of 70 and said nothing about the other 47.
The ranking rule now requires every watchlist name to be accounted for — ranked, or one line saying why not — so the backlog is at least visible. What has not been decided is what to do about it: whether names that fail the valuation filter repeatedly should age off the list, or whether 70 is simply the size of the funnel. Wait for a run or two under the new rule before choosing.

### The transaction-cost rule has never been exercised
§4.5's fee handling (D25) makes P1 name the broker it costs against, default to **$1 per US ticket**, state the fee as a percentage of the ticket, and say whether another whole share would improve it. No order has been proposed since it landed — the 8 Sep deep dive held cash — so none of it has run once.
The `$1` figure is also an inference from one remark of Leo's about a draft MWA order. Non-US venues are not covered: REL.L, CNR.TO and RSGN.SW are live candidates and their real costs are unknown.

### The recurring P/E is a vendor judgement, and 39% of the time it adjusts nothing — this is now the pot's binding constraint
`pePctileRecurring` and `peLowRecurring` divide price by `recurringEps`, which rebases **`norm`** — Yahoo's *normalised* net income — onto the latest share count. `norm` is not a filed figure. It is Yahoo deciding, with hindsight, what was one-off, and it can be restated.
Measured across `earnings.json`: **479 fiscal years carry net income; in 187 of them (39%) `norm` is within 1% of filed `ni`** — the vendor adjusted nothing at all. So for two years in five, "recurring" and "headline" are the same number wearing different labels, and a name can pass the cheapest-decile filter on an earnings base nobody has cleaned.
LULU is the worked example. FY2026: `ni` and `norm` are both **1,579,183,000 — identical to the dollar**. Yet its Q2 release discloses a **$134.5m tariff refund** adding 5.6pp to operating margin, and $0.86 of the quarter's $2.92 EPS. The deep dive found this by reading the filing and concluded *"neither $12.15 local trailing EPS nor normEps $12.21 is thereby certified clean"* — correctly.
This is why the 8 September run held cash. Of 13 ranked names, **~7 were blocked on unreconciled earnings** (MWA's tariff refunds and tax benefits, TW and WLY's exceptional gains, LULU's refund) against only 2–3 blocked by the thesis rules. The design is not too strict; the earnings base is not trustworthy enough to buy against, and the agent is re-deriving the same adjustments by hand every run.
Fixing it means one-off adjustments the repo can stand behind rather than the vendor's: EDGAR already gives `opinc`, and the cash-flow tags added 8 Sep give `cfo`/`fcf`, so a cash-based cross-check on reported earnings is reachable for US filers without a new source. Non-US names have neither, which is the same wall as the capital-measures entry above.

### The agent's reasoning is encrypted and cannot be recovered — do not retry
A natural instinct when refining the briefs is to go back and read what a specific run was *thinking*. It is not possible, and the attempt costs a session's time.
Codex rollout logs under `~/.codex/sessions/` do contain `Reasoning` records — 16 of them in the 8 Sep deep dive — but every one has `summary: []` and an opaque `encrypted_content` blob. The chain of thought is encrypted for the API's own continuation and there is no local key, no setting and no export that returns it. `reasoning_output_tokens` in the usage record counts them; it does not store them.
What IS complete, committed and shipped to the app: `pot/logs/<stamp>-<lane>.md` carries every command the run executed, every output it saw, and every message it wrote. That is what a brief can actually respond to — a rule can only constrain what the agent writes down, so the transcript is the right artifact to design against anyway.

### More series worth distilling into the repo
The wishlist tally counts how many separate sweeps reached for each series. Cash conversion (19) is now fetched in CI. Still hand-fetched every time: **margin 13, volume/units 13, leverage 9, backlog 8, inventory 7, capital returns 6**.
Most are the same shape of job as cash conversion — two EDGAR tag lists each — and the payoff is larger than it looks: a fetched page enters the agent's context and is resent on every subsequent turn, so a 20k-token filing pulled at turn 5 of 21 costs ~340k tokens where four numbers cost ~1k.

## Deliberate shortcuts already marked in the code

These are `ponytail:` comments, not bugs — each names its own ceiling and upgrade path.

| Where | Shortcut | Upgrade when |
|---|---|---|
| [fetch-prices.js](fetch-prices.js) `sleep()` | Fixed 300ms between requests | Yahoo starts returning 429s |
| [fetch-prices.js](fetch-prices.js) `REPORT_LAG_DAYS` | Flat 90-day lag from fiscal year end to "published" | A few weeks' slack starts mattering; real filed dates would go in `earnings.json` |
| [fetch-prices.js](fetch-prices.js) `normaliseEps` | Rebasing through net income also absorbs buybacks (AAPL reads ~8% cheap at its low over four years) | A trustworthy split feed exists — Yahoo's is not one (it reports a 6:1 for BYD it never applied to prices) |

## Waiting on the calendar, not on work

`interim.json` is still empty. Nothing is overdue: the HK Main Board issuers' H1 results (period ending 30 Jun 2026) may be announced up to **30 Aug 2026**, and M&S's H1 ends 30 Sep. Run `npm run interim` — it derives the list from the store, so it will say when something is actually due.
