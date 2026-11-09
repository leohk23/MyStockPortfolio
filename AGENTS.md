# AGENTS.md — working notes for AI agents / new sessions

Orientation for anyone (human or agent) picking this repo up cold. Read this before changing code. Also read `README.md` (user-facing) and the header comment in each JS file.

**Changing the dashboard's code (the extract, the price bot, `portfolio.js`, the workflows or the page)? Read [DASHBOARD.md](DASHBOARD.md) as well.** It holds the file table, the publish routine, and the machinery and war stories behind gilts, dividends, funds and the workbook. It is a separate file because every pot lane carries this one on every model call (D117), so new material goes there unless a lane needs it to read the data.

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

## Two numbering schemes, and which § means which

This project has two, and using the bare symbol for either is ambiguous:

- **`strategy.md`'s own sections.** §3 Universe, §4 Sizing, §5 Selling, §6 Signals, §7 Guardrails,
  §8 What a proposal must contain. Written plainly: **§5.1**, **§6.1**, **§7.2**.
- **The six sections of a proposal**, the contract §8 defines. Written with a **P**: **P1** Order,
  **P2** Thesis, **P3** Falsifier, **P4** Review date, **P5** Numbers as of today, **P6** The case
  against.

So "§5.1" is the sell rule and "P5" is a proposal's numbers table. They were both being written
"§5" and the reader had to guess from context.

## Writing style for anything Leo reads

Applies to briefs, proposals, sweeps, summaries, commit messages, console output, tooltips —
anything with a human reader.

- **Do not chain facts together with interpuncts.** `14 agent runs · 71m44s wall · 1,763,288
  fresh input tokens · £0` is a list pretending to be a sentence: it reads as one dense run-on
  and nothing in it is emphasised. Use commas, or put the facts on separate lines, or use a
  table when there are more than about four. `14 agent runs, 71m44s wall, 1,763,288 fresh input
  tokens, £0` says the same thing and can be read at a glance.
- The same goes for stacking em-dashes, slashes and pipes as separators. One separator doing one
  job per sentence.
- A table is not a decoration. Where the content really is a record with fields, write a table
  and let the header name the fields, rather than repeating labels inline on every row.

## Ponytail mode

Use **Ponytail lite** by default for coding work in this repository. It may be turned off at the owner's request. Never enable `full` or `ultra` in this repository.

## Data flow

```
Master Cashflow_CC_v0.5.xlsm  (Leo's OneDrive workbook, synced to the laptop; path in the gitignored .tradelog-path — ONLY the Tradelog tab is read)
   meta.json           per-instrument facts: yahoo, group, geography, currency (committed)
   watchlist.json      stocks watched but NOT owned — same pipeline, zero effect on totals
      │  node extract-portfolio.js   (needs the xlsx dev-dep; user runs it)
      ▼
holdings.json          positions, cost basis, geography, group, full trade log  (committed)
      │  node fetch-prices.js        (GitHub Actions: every 15 min Mon-Fri from an outside trigger, and on every push; dependency-free)
      ▼
prices.json            quotes, FX rates, portfolio value series (replayed) (committed)
history.json           daily + weekly closes, long NAV + benchmarks (committed, ~2MB)
      │
      ▼
index.html + portfolio.js   all arithmetic in the browser
```

- **prices.json** loads on every page view (small). **history.json** is **lazy-loaded** only for a stock, benchmark, or 2Y/5Y/All range — keep it that way.
- **world-history.json** is the World tab's 43 country ETFs as weekly closes, written by `fetchCountry` from the same fetch that finds each fund's all-time high, and loaded only when a World row is clicked. Kept out of history.json, which the default Performance chart now loads on every visit.
- Committing prices.json/history.json re-triggers the Pages build, so the site follows each scheduled refresh automatically.

## The AI pot (early development)

A second, AI-managed pot runs in parallel to the human book, funded £250/month. Two documents
govern it, and both are required reading before touching anything under `pot/`, `signals.js`, or
the macro data:

- **[strategy.md](strategy.md)** — the rules. What may be bought, sized how, sold when, which
  triggers fire. The "Rules at a glance" table is the spec `signals.js` is written against, so a
  threshold changes there first and in the code second.
- **[pot-design.md](pot-design.md)** — the system, and a decision log carrying the reasons.

⚠️ **Update `pot-design.md` in the same change, never afterwards.** While this is still early, a
decision made and not written down is one that gets silently re-made differently a week later. That
file has already caught two contradictions in its own design — an AGREED rule saying a standing
order *needs* re-arm logic against a DECIDED one taking none, and "three lanes" against a fourth
lane that had quietly appeared. Neither would have been visible if the design had lived in
someone's head. A pot change is finished when: the new **DECIDED/AGREED** row is in §1, whatever it
settles is struck through under **OPEN**, whatever it overturns is marked **superseded** rather
than deleted, and **§5 What is built** reflects reality. Superseded entries keep their reasoning,
because the reasoning is the part worth having later.

Three LLM lanes and a scan, in short. They run in **this order** and the order is a dependency, not
a preference — the Review judges what is already held before the Sweep goes looking for anything
new, and the Deep dive reads both (pot-design §2):

| Lane | Cost | What it may produce |
|---|---|---|
| **Scan** — `npm run signals` | free, no LLM, no network | signals, and standing-order instructions |
| **Review** — `pot/brief-review.md` | one agent session, on GitHub when its dates say so (D114) | a verdict on each open thesis, never a new name; the dates it next looks |
| **Sweep** — `pot/brief-sweep.md` | one agent session | watchlist candidates, never orders |
| **Deep dive** — `pot/brief-deepdive.md` | two sessions: one model drafts, the other examines (D95) | executable proposals, on tickers it picks from the Sweep's candidates and the Scan's signals together (D14) |

### When it runs

**[pot-design.md §4.2](pot-design.md#42-the-llm-lanes--one-scheduled-cycle) is the source of truth for
when the pot runs, and holds every Claude lane setting in one table. Go there before changing any
timing or lane setting.** In short: Task Scheduler runs [`pot/run-daily.ps1`](pot/run-daily.ps1) on
weekdays at 06:30, 12:45 and 21:15 and at weekends at 09:00, UK local. A cycle does the book, the
Scan, then whichever lanes are due, in order, then the report. The Review also runs on GitHub on the
nights `pot/review-due.js` finds it due (D114), and the Mon/Wed/Fri second-run Sweep runs there too
(D111). The day's one Deep dive is drafted by one model and examined by the other (D95). The
allowance, not the clock, limits the schedule: read both limit columns of `pot/runs.md` before
adding a slot.

**Two cycles never overlap** (D100): a cycle holds the named mutex `Global\MyStockPortfolio-pot-cycle`, and a second one, such as both entries catching up when the laptop wakes, waits up to 90 minutes for it rather than running alongside. `pot/.daily-lock` is still written by the holder, for the Tradelog watcher. A lane treats a commit landing mid-run as tampering and discards its run (D91, D92), so check for that lock before committing by hand while a cycle may be running.

Do **not** hand-run `pot/run-daily.ps1` to test a change: it spends a real 5% and takes 20–35
minutes. `pot/run-lane.ps1 -Brief … -NoPush` runs one lane, and `--selftest` covers the JS.

**How this file reaches a lane.** Codex loads it automatically, up to `project_doc_max_bytes`
(131,072 in `~/.codex/config.toml`; past that the end is dropped silently — D38). Claude Code now
loads it from the working folder too, a lane and an interactive session alike, so `run-lane.ps1`
no longer passes it (D116: D64's `--append-system-prompt-file` had become a second copy on every
call). There is deliberately no `CLAUDE.md`. The briefs assume it is in context, so if a Claude
Code update stops loading it, restore the flag. The brief itself goes in with the prompt, on stdin, so a
lane never opens it (D115); the prompt's first line must stay `Follow the instructions in <brief>`,
which is how `pot/report.js` tells a lane run from anything else. Everything here is resent on each
of a lane's 30 to 60 model calls, which is why the dashboard's machinery lives in `DASHBOARD.md`
(D117). Both CLIs can skip this file too (`claude --setting-sources user`, Codex
`-c project_doc_max_bytes=0`, probed 8 Nov), if a lane ever needs a context of its own.

**Write lane output as UTF-8 with the file-editing tool, never through a PowerShell redirection, `Set-Content` or `Out-File`.** Windows PowerShell 5.1 re-encodes on the way out: on 14 Sep the deep dive's run report lost every £, € and — to a literal `?` (27 characters) while its three proposals, written the other way, were intact.

`npm run signals` must stay free — plain JavaScript over data CI already fetches. The price
workflow never calls an LLM. The lanes that run in CI, the cloud Sweep (D111) and Review (D114), do so on the
subscription through Claude's long-lived token, so D3 holds; Codex cannot follow, because OpenAI's
guide to a ChatGPT login in CI rules out public repositories.

**`pot/proposals/` holds only what is current** (bought, awaiting Leo, a D93 standing proposal, the newest run); `pot/archive.js` files the rest in `pot/proposals/archive/` at the end of every cycle, by state, and moves a file back if its state returns (D99). A proposal's id is its file name in either folder, so read both when looking one up.

**The second reader's search is open and its decision is not (D106).** What it examines is its own choice, with no checklist (D95). What follows is a rule in `pot/brief-examine.md`: findings graded `holds`, `weakens` or `breaks`, the grades set the outcome, and each section opens with its own `Would I place it` line. A disagreement is settled by type, and a gap in the rules goes once to `pot/questions.md`, which surfaces under "Needs you" until Leo's answer closes it. Its dated calls, each with a forecast, are scored by the Review and tallied by model in `pot/calls.md`.

`npm run pot-report` regenerates `pot/SUMMARY.md` (the entry point), `pot/summaries/*.md` (one dated
report per run), `pot/runs.md` (the cost ledger) and `pot/logs/*.md` (transcripts made readable).
All four are derived and gitignored; every figure in them is read from the Codex session logs, never
from what an agent said about itself. It also writes the two performance pages, `pot/performance.md`
(what the money did, against VUSA.L, D81) and `pot/paper.md` (every call marked as if bought), from
`positions.json`, `prices.json` and `history.json`, and `pot/calls.md` (D106), from the rankings and the reviews.

## Invariants — do not break these

1. **Public repo, sealed positions (D67).** `holdings.json` publishes only `ticker`, `yahoo`, `group`, `geography`, `currency`; quantities, costs, trades (with their comments) sit in its `sealed` field, AES-GCM under Leo's passphrase (`vault.js`). Anything derived from them that carries an AMOUNT is sealed too — `prices.json nav` and `history.json long.nav` — or left out (`signals.json` has no `totalGBP`). Percentage weights and TWR percentages stay public. They are published for the locked view (D84): `prices.json weights` (each holding's share) and `history.json twr` / `long.twr` (the Performance lines), computed by the price bot; `prices.json gains` (each holding's gain %, D85, which with the price reveals the average cost). Per-holding CAGR and trade dates are not. Read holdings with `require('./vault').readHoldings()` and check `.full`; never publish a new amount-bearing field in the clear. The passphrase is `HOLDINGS_KEY` (GitHub secret) or the gitignored `.holdings-key`; the page asks for it and can Skip. `*.xlsx` is gitignored; keep it so. Git history before D67 still holds plain holdings — accepted, not rewritten.
2. **Currency.** Everything is computed in **USD**, then divided for the display toggle. `rateFor(code, rates)` handles `GBp`/`Gbpence` = GBP/100. A holding's declared `currency` is its **purchase** currency; the live price's currency comes from Yahoo (`meta.currency`) and can differ (e.g. CSUK: cost in GBP, quote in GBp). Convert both to USD to compare. **Rates come from the precise side of each pair** (`fxRate`): Yahoo quotes a pair to four decimal places, so `KRWUSD=X` read 0.0008 against 1 / 1,325.4 = 0.000754 and valued every Korean holding 6% high (IDR 80%, JPY 0.36%) until 25 Oct 2026. A currency worth under a dollar is read as 1 / `USD<ccy>=X`, cross-checked against the direct quote.
3. **Movements are fractions**, not whole percents (0.25 = +25%) everywhere in the JSON. The page multiplies by 100 for display. (A past bug shipped -59% as -5900%.)
4. **One y-axis per chart, ever.** Two different scales → index both to % (see the benchmark overlay) or use separate charts. Never dual-axis.
5. **Chart colors are validated.** Series use `--series-port/spx/hsi`, validated against the dark surface with the dataviz skill's `validate_palette.js`. Re-validate if you change them.
6. **Every series replays the Tradelog. Nothing back-projects today's shares.** All of them still use *today's* FX for every past day. **Performance and benchmark lines are total return** (Leo, 8 Oct 2026): dividends net of withholding tax, reinvested on the ex-date, the benchmarks counted the same way (see "Dividends and total return" in DASHBOARD.md). **Value lines exclude dividends**: the cash left the asset.

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

10. **The price is always the REGULAR session.** The chart call never asks for pre/post data, and must not start: value, gain, PE, the `1d` column and the whole NAV history are built on regular closes, so substituting an extended-hours print would move every derived figure against a history that never had one. An after-hours move is recorded **beside** the price (`quote.ext`) and only ever displayed beside it, labelled pre-market or after hours: a mark in the table, and a line under the price in a stock's header (9 Nov). It is never folded into `price`.

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

- `eps` — checked manual trailing EPS override. It takes precedence over Yahoo when present; use it only for a known bad/missing Yahoo figure. Either a number in the native quote currency, or (30 Oct 2026, TKOMY) `{ value, currency, through, basis, source }`: the figure as the company files it, per receipt, in its own currency, which the bot converts at each run's rate (`filedEpsInQuote`) so the P/E does not drift with the exchange rate. `through` is the last quarter it covers; once a later quarter is reported the page tags it **out of date** and the bot's log asks for an update. The page shows `basis` and `source` on the EPS (TTM) row. The bot reads it from `holdings.json`, so run `npm run publish` after editing it (a watchlist entry is read directly).
- `specialEps` / `specialEpsLabel` — a stock- or industry-appropriate earnings figure that isn't plain trailing EPS (FFO/share for a REIT, adjusted/core EPS for a bank, a normalized multi-year average for a cyclical, ...) and a short label shown in the column's tooltip. Native quote currency. Omit both to leave Special PE identical to the normal PE.

**Earnings bases — always say which one a multiple is on.** Filed figures are never overwritten; each
basis sits beside the others in `prices.json`:

| basis | fields | source |
|---|---|---|
| reported | `eps`, `peLow`, `pePctile` | as filed / Yahoo trailing |
| vendor recurring | `normEps`, `peLowRecurring` | Yahoo normalized income — unsourced, restatable |
| own | `normEpsOwn` (`peLowOwn` where arithmetic allows) | filed less cited one-offs in `pot/adjustments.json` |
| research | `researchEps`, `researchEpsPeriods` | four consecutive quarters of issuer-stated adjusted EPS (`normalizedEps`), with sources |

A gross `amount` only feeds arithmetic when sourced as after-tax and attributable to common
shareholders; otherwise it is stored with `arithmetic:false` as evidence (D63). Current-year
adjustments reach `normEpsOwn`, filed-year ones `adjustedYears` — never both (D61). Research low
and percentile are withheld until enough adjusted quarters exist. `signals.js` `oneOffRisk` reads
research → own → vendor and records `epsBasis` (D65).

## Trough-multiple valuation (the "is it cheap?" hint)

The idea (ported from the workbook's old Portfolio!BA:BM block, now fully derived online): find the cheapest the market ever valued this business, then ask what that multiple would be worth on *today's* earnings. **Nothing here is hand-maintained.**

**How the trough is found** (`fetch-prices.js` `troughPe`): **point-in-time** — each weekly close is divided by the latest annual EPS **already published** by that date (fiscal end + `REPORT_LAG_DAYS` = 90, covering every market's statutory deadline); the cheapest ratio across history is `peLow`. Both kinds of hindsight are excluded by construction: an old low over *today's* EPS (NVDA's 2022 low on its 2026 earnings reads absurdly cheap), and a low over its own fiscal year's EPS — reported months *after* the low. That second one was the previous model, and it printed Trip.com's Apr-2025 low as a 7.7× trough on FY2025 earnings nobody would see until Feb 2026; on what investors could actually see (FY2024) it was ~14.9×. Closes before the first published year are skipped; a published loss voids the multiple until the next profitable year prints.

**A split after the latest filed year** (`splitsSinceFiled`). Yahoo restates the price history the day a split takes effect, but every stored EPS stays per old share until the next annual is filed, and `normaliseEps` cannot see it because it anchors on that stale year. Tokio Marine's 15:1 (Oct 2026) read P/E 1.8× and P/E Low 0.94× against ~27× and ~14×. Yahoo's split list alone is not trusted (BYD's phantom 6:1), so the correction applies only when the quote's `sharesOutstanding` confirms it: today's count must equal the anchor year's implied shares times the split ratio. Then the stored EPS and the quote's trailing EPS are rebased **in memory** for every valuation; `earnings.json` keeps the filed figures. It switches itself off when the next annual lands or Yahoo restates. On the split day itself, a 1D move equal to a split ratio voids all of that listing's moves (`halfSplit`): TKOMY's half-applied split read +1,425% and sent a phone alert.

**Declare a split in `meta.json` when you know of one** (`"splits": [{ "date": "2026-10-07", "ratio": 15 }]`). Yahoo's split list cannot be relied on in either direction: it lists a 6:1 for BYD that never happened, and it published TKOMY's real 15:1 on 7 Oct 2026, then withdrew it the next day and served the unadjusted history again. That valued 105 post-split receipts at the pre-split $50 from May, and the New-buys line read +44% instead of −12%. `unsplit` applies a split, Yahoo's or declared, to the daily and weekly closes only where the series still shows its jump (the close before the date over the close after is the ratio, within 30%). A restated series shows no jump, so nothing is ever divided twice, and Yahoo's `previousClose` is put on the same basis for the first week. The Tradelog's Split column is a separate thing: it restates **your trades**, while this restates **the price history**.

**EDGAR's quarterly EPS and splits** (`fetch-filing-dates.js`, 7 Nov 2026). A quarter's value comes from its newest filing, so a split counts as absorbed only when *that* filing postdates it. Testing the first filing instead divided every restated quarter twice, in 21 filers: Netflix's Q4 2025 read 2.333 against 0.56, its P/E low 11.9x against 15.9x, and ServiceNow sat at the 0th percentile against the 10.3rd. Yahoo also lists spin-offs as splits (IBM 1046:1000, EHC 1257:1000, DELL 1973:1000), which EDGAR never restates, so `restatedEvents` decides each event from the quarters filed on both sides of it.

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


## "P/E paid" — the trough, decomposed by year (`peBands`)

The trough answers *how cheap has this ever been*. It cannot answer *is this dear right now, by its own standards* — for that you need the whole distribution, not its minimum. `peBands` (`fetch-prices.js`) gives the financials table one extra column: for each fiscal year, the **cheapest, dearest and average** multiple the market struck inside it.

Ported from the owner's own `388 HKEX.xlsx` "十年" sheet, which prices each year's low/high/average share price against three EPS bases — 歷史 (the prior year's, i.e. what was published), 預期 (the year's own, i.e. hindsight) and 中間 (the mean of the two). **Nine combinations; this repo ships three.** The three *price* points are genuinely different facts. The three *EPS bases* are one fact seen three ways, and only one of them is defensible here: `troughPe` already rejects pricing a year against earnings released months after it (the Trip.com case above), and a second column contradicting that decision would be worse than no column.

**Same machinery as the trough, by construction.** Both call `publishedEps` for the [publication date, EPS] steps and `epsAsOf` to pick the one a buyer could see. So:

> **the lowest `lo` across a ticker's bands IS its `peLow`** — the same closes, the same denominator. Verified as an invariant in the selftest and over the live file (0 breaches across 60 tickers).

Two consequences fall out of that guarantee and must not be "simplified" away:

- **Years since the last filed one get rows too.** 13 of 60 names have their all-time low in the current, unaudited year. Drop those rows and the column's lowest stops matching the `peLow` printed beside it.
- **Those trailing windows have no minimum week count.** Filed years need 26 priced weeks (a stub year is not a range). The roll-forward windows need none — a low struck in the first fortnight of a new fiscal year must still land in a band. A two-week "range" looks odd and is true; the row says `part year` and the tooltip gives the week count.

**It rolls forward a fiscal year at a time, not one trailing window.** "Unfiled" is not always "in progress": Kansai Electric's year to June 2026 has closed and simply has not been filed. One window would have run 60 weeks under a single year's label. Each pass covers exactly one fiscal year; only the last can be short, and only it is tagged `part year` (a complete-but-unreported year is tagged `not filed`).

**The cell is deliberately NOT `price ÷ the EPS on its own row`,** and both the header and every cell's tooltip say so. Results land ~90 days after the year they describe, so for most of FY2025 the market was still pricing FY2024's earnings. A reader who divides by eye and gets a different number is right to; the tooltip tells them why.

**Struck on the listing's own price and its own filed EPS** (`store.eps[t]`, not the `primary`'s) — which is what keeps it correct on a receipt whose statements above are read from the home listing. A P/E is a ratio, so it is currency- and ADR-agnostic; the same reason `peLow` needs no FX.

⚠️ **Weekly closes.** The band is a little narrower than the true intraday range — HKEX's 2024 high reads 376 where the intraday high was 398, and the owner's sheet (daily closes) says 393.8. This is deliberate: it is the same series `peLow` is struck on, and a wider band here would disagree with the headline number on the same page. Cross-checked against the sheet where it matters: HKEX's FY2026-to-date low reads **25.85×** against the sheet's **25.86×**.

## Watchlist (stocks not held)

`watchlist.json` lists names to analyse before buying. They ride the **same pipeline** — quotes, weekly history, trough P/E, annual financials — because `fetch-prices.js` unions them into its ticker list. There is no second fetch path, and `npm run backfill` picks them up too (it just walks `earnings.json`).

**The rule: a watched stock must never touch the portfolio maths.** Totals, TWR, cohorts and `navHistory()` all iterate `holdings`. A stock you are only *thinking* about must not be able to move a number that reports how you are actually doing. Hence:

- `watchlist.json` is a **separate file** — never merged into `holdings.json`.
- The tempting shortcut (a holding with `qty: 0`) is **wrong**: it would thread a phantom position through every one of those calculations.
- In `fetch-prices.js`, watchlist symbols join exactly one list — `histTickers`, so they get closes to chart and to price the trough against. `navHistory()` and the TWR input stay strictly `priced` (= holdings). Keep it that way.
- On the page, `WATCH` is separate from `STATE`, and a name already held is dropped from it (once you own it, the holdings table is the truth).

### After the owner edits `watchlist.json`

Hand-maintained, not derived — so **`npm run extract` has nothing to do with it** (that reads the Tradelog only). Entries are `{ yahoo, name, geography, added }`. **`added`** is the date the name joined, for the table's Added column (sorted newest first): nobody types it. `watchlist-added.js` stamps any entry without one with today's date, and runs before a lane's commit (`run-lane.ps1`) and in `npm run publish`; the entries from before 10 Oct 2026 were dated from git, the first commit each name appears in.

```sh
npm run fetch    # only when ADDING a name — it needs a quote before it can render
git add watchlist.json prices.json history.json && git commit -m "watchlist" && git push
```

- **Removing/renaming a name, or editing `geography`** — just commit and push; the page reads `watchlist.json` directly.
- **Adding a name** — it stays invisible until `prices.json` carries its quote. Either run `npm run fetch` first, or push and let the scheduled Action fill it in on its next run.
- **A wrong `yahoo` symbol fails silently.** `fetch-prices.js` and `buildWatchlist()` both filter on `quotes[w.yahoo]`, so a typo just doesn't appear — no error, no placeholder. Unlike `meta.json`, which `extract-portfolio.js` guards by pinging Yahoo, **there is no guard here**. Always confirm a newly added name actually renders in the Watchlist view.
- **Keep `geography` filled in** even though the table now shows the ticker beside the name: the search box still matches on `name`, `yahoo` and `geography`.
- **Treat every field as untrusted.** The Sweep adds names from web pages and its commits are pushed unread, so a name is rendered through `escapeHTML`, never as raw HTML. Unescaped, a page that steered the lane could run script on the site and read the remembered passphrase.

`valuation()` in `portfolio.js` is shared by `build()` and `buildWatchlist()` — valuation is a property of the *stock*, not of owning it, so both paths run one formula and cannot drift. A selftest asserts a holding and a watchlist entry on the same quote agree.

**Known gaps** (honest `–`, not guesses):

- **Korean tickers have no trailing EPS from Yahoo** (`005930.KS`, `000660.KS` return `epsTrailingTwelveMonths: undefined`), so P/E and Implied are blank for them. P/E Low still works (it is built from *annual* EPS), as do the chart and the financials table. The escape hatch, if ever wanted, is the `eps` override the entry already accepts — but that is manual maintenance, which this repo deliberately avoids.
- **The trough is thin for a company with loss years.** `troughPe()` only prices a close when the latest published EPS is positive, so a name like GME — whose earlier years are unusable — has its "cheapest ever" drawn from very few points, and can read *below* its own trough (P/E 16x vs P/E Low 26x). Treat vs Low on such names with suspicion.

Each watched name adds ~30KB to `history.json` (lazy-loaded, so it costs nothing on first paint). Fine for a dozen; reconsider at 30+.

## Official company guidance

`guidance.json` is deliberately separate from Yahoo's filed annual history. Guidance is forward-looking, quarterly or annual, and each company guides different measures, so the page shows a clearly labelled estimate row in the financials table, with blanks for accounts the company did not guide. Every entry must carry its period, issue date, official investor-relations URL and any material assumption. Never annualise, FX-convert or fill a metric the company did not guide. The one explicit exception is NVIDIA's labelled `runRatePe`: it derives the aligned income/margin/EPS accounts, moves its annualised P/E into the valuation box, and excludes un-guided other income/expense. Update entries by hand after results; there is no generic scraper because companies publish incompatible measures and formats. Keep `_coverage.checked` and `noMatchingGuidance` current so a blank row means "official sources checked, no matching quantitative guidance" rather than "forgotten".

**Latest reported quarter (for the guidance comparison).** Guidance is usually a *quarter*, but the reported rows are full fiscal years — so a guided quarter had nothing at matching granularity to read against. `fetch-prices.js` now also pulls the `quarterly*` twins of the annual accounts (`QUARTERLY_FIELDS`) and stores them as `quarters` on the earnings entry; the panel renders the **latest reported quarter** as one row directly above the guidance row, with sub-lines that are change vs the **same quarter a year earlier** (date-matched ±50d, seasonality-free — never vs the previous quarter). Two deliberate constraints: the row is taken from quarters that carry a top line (Yahoo hands back a just-reported quarter as an EPS stub days before the rest — NFLX Q2), and this rides the **same** fundamentals request (one longer `type=` list, zero extra gated calls). Currently gated to an example allowlist — `QUARTERLY_TICKERS` = {NVDA, NFLX, META} — to prove the comparison before widening; to roll out, drop the guard and fetch quarters for every operating company. Bumping to `EARNINGS_V` 6 forced the one refetch that populated it.

**A missing quarter is reconstructed, not left as a hole.** Yahoo drops a quarter outright for some filers — BYD's Sep '25 is simply absent while the quarters either side are filed. That costs more than one row: the remaining quarters no longer span a year, so the TTM guard (four quarter-ends inside 250–290 days) rightly refuses to total them and the trailing row disappears entirely. Left unguarded it would have summed Mar '25 + Jun '25 + Dec '25 + Mar '26 — double-counting a first quarter and omitting the third.

`portfolio.js` `fillMissingQuarters(quarters, years)` fills a fiscal year that is complete except for **one** quarter: the audited annual **minus** the three filed quarters *is* that quarter, exactly. Two holes are not determinable from one equation, so it declines rather than guesses.

**Flows only** — `rev`, `opinc`, `ni`, `nic`, `norm` accumulate over the year and subtract cleanly. **Never EPS or a share count**: those need the quarter's own share base, and a bonus issue or buyback inside the year makes an imputed per-share figure fiction (BYD's diluted shares roughly doubled during FY2025 — EPS 9.22 → 3.58 on net income down only 19%). A blank EPS is the honest output. Derived quarters carry `derivedQuarter: true`; the page labels the row `derived` and tags a TTM containing one **`part-derived`** rather than `filed`.

Validated against an outside figure: the same code reconstructs Apple's missing Dec '24 quarter at **$124.3B revenue**, its actual reported FQ1 2025. Ten tickers currently gain a quarter — for most it predates the four displayed and only deepens the year-ago comparisons.

**Four quarters' EPS are summed only if they are per the same share** (`portfolio.js` `shareBasisBreak`, 30 Oct 2026). After a split Yahoo restates the annual EPS but can leave a quarter per old share, and a stored quarter can keep an EPS derived from net income Yahoo has since changed. The share count each quarter implies (net income ÷ EPS) shows both: it must agree across the four within 1.5x, and income and EPS must have the same sign. Ordinary drift tops out near 1.4x across the store. Two cases were caught on day one. Konecranes' Sep '26 EPS of 1.50 was per old share beside three quarters per new (3:1), so its normalized P/E read 10.2x against about 16x. Tokio Marine's 8766.T held 115.6 and 111.8 per old share beside 9.2 per new, plus a ¥368bn loss quarter carrying EPS of +42.6; that read 2.0x. The page's TTM row and Normalized P/E, and the bot's `recurringTtmFrom` and `trailingEpsFromQuarters`, all refuse such a window. `seedFromReceipt` now also requires the two listings' EPS to agree after `adrShares`, so a receipt still per old share cannot seed its home listing.

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

**An IFRS property company's "revenue" can net in its revaluations.** Yahoo has Supermarket Income REIT (SUPR.L) at -£150m revenue in FY2023, and even its positive years miss the rent: FY2026 £99.2m, against £122.3m net rental income in the annual report. A negative revenue in any year therefore blanks the whole revenue series and its margins in the financials panel (`revBroken`), with the reason. Net income and EPS stay as filed, but under IFRS they include revaluations, so for a REIT the recurring figure is **EPRA EPS**, recorded as `specialEps` with its source in `specialEpsLabel` (SUPR: 5.7p for FY2026, against IFRS 6.9p). The panel's normalized EPS now ranks a hand-recorded figure exactly as the table's Normalized P/E does: research, then own adjustments, then `specialEps`, then Yahoo's normalized. It has to be updated by hand when the next annual results land.

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

Coverage is ~45 of 58 companies: Yahoo projects a next-results date for US and Japanese filers but
rarely for Hong Kong, Paris or London listings. Dates refresh with the prices — every 15 minutes on
weekdays — and are never carried forward from a previous run.

### Hong Kong: the company's own filing beats Yahoo

`fetch-hk-board.js` (`npm run hkboard`, daily via `.github/workflows/hkboard.yml`) reads **HKEXnews**,
where Main Board Listing Rule 13.43 requires an issuer to announce its results board meeting **at
least 7 clear business days ahead**. That is a date the company has stated, not a projection, so it
outranks Yahoo — `quotes[t].earnings` becomes `{ date, notice }` and the calendar shows a **filed**
tag linking the announcement. It resolves through `primary` too, so `XIACY` picks up `1810.HK`'s.

Three steps, because the exchange splits the fact up: `activestock_sehk_e.json` maps `01113` → the
internal stockId; `titleSearchServlet.do` (`t2code=13150`, "Date of Board Meeting") returns
announcement metadata only; the date itself is in the PDF. `pdfText()` inflates the FlateDecode
streams and takes the string literals — no dependency, and it cannot read a scanned or CID-keyed
font, which is a refusal, not a fallback.

**The parse is the dangerous step**, so the guards are there rather than on the fetch:
- Anchored on the announcing sentence. Every filing also states its **period end**, which is always
  in the past — "the first date in the document" would return the wrong one.
- Publication beats the meeting where the filing gives both: Trip.com approves on the 24th and
  publishes on the 25th, and the 25th is when the figures appear.
- **Stated weekday must match the date.** Free integrity check; a misread day rarely lands right.
- Meeting must fall 0–120 days after its own notice, and must not already have passed.
- Document must mention results — `13150` covers board meetings generally.
- A **"Delay in Results Announcement"** (`t2code=13200`) filed after the notice supersedes it.

Both date orders and both weekday positions occur: `Thursday, 13th August, 2026` (most),
`August 18, 2026 (Tuesday)` (Xiaomi), `Wednesday, June 24, 2026` (Trip.com). PDF marked-content
language tags (`en-US`, `zh-TW`) leak into the text glued mid-word — `en-US13th`, `en-GBHong` — so
`stripLangTags` can use **neither** `\b` anchor and keeps the region case-sensitive.

`titleSearchServlet.do` is undocumented and unversioned — same risk class as stockanalysis.com. Its
failure mode is safe (a changed shape returns zero rows → no date, which is the status quo). The
price loop never calls HKEXnews; it only reads `hk-board.json`, and runs unchanged without it.

Known refusals, both correct: **1211.HK** (partial PDF extraction loses the word "results"; Yahoo
has BYD confirmed anyway) and **6288.HK** (undecodable font; its date comes from `9983.T`).
