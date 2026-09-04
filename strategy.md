# Strategy — the AI-managed pot

**Status: answered, 28 Aug 2026. Nothing reads this file yet — see [pot-design.md](pot-design.md) §5.**

Format: **Q** is the question, **A** is Leo's answer, `> quoted text` is the suggestion that was
offered alongside the question and is kept only as history. Where an answer needed a second pass,
**⚠ Follow-up** states why, and the **A** under it is the resolution.

---

## Rules at a glance

Derived from the answers below; **the sections are authoritative** and this table is an index. Every
`[auto]` row is a parameter the signal scan needs.

| §   | Rule                                     | Value                                                                                                               |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Universe                                 | No constraints                                                                                                      |
| 3.2  | Permanent exclusions                     | None                                                                                                                |
| 3.3  | May buy what the main book already holds | Yes                                                                                                                 |
| 3.4  | Single stocks / funds                    | Both                                                                                                                |
| 4.1  | Minimum position                         | **No minimum** — but refuse a ticket whose first-year costs exceed **2%** of it                        |
| 4.2  | Maximum position                         | 50% of the pot                                                                                                      |
| 4.2a | **One whole share always clears §4.2**   | Fractions are not bought, so if one share exceeds the cap it is still bought — cap resumes once contributions cover it |
| 4.3  | Number of positions                      | No limit                                                                                                            |
| 4.4  | May hold cash                            | Yes, no ceiling                                                                                                     |
| 4.5  | May top up an existing position          | Yes                                                                                                                 |
| 5.1  | Valid sell reasons                       | falsifier tripped · thesis played out · breached a §4 limit                                                      |
| 5.2  | Minimum holding period                   | None                                                                                                                |
| 5.3  | Trim or all-or-nothing                   | Trim                                                                                                                |
| 6.1  | Valuation signal                         | in the **cheapest 10%** of its own **5-year** multiple history (3y/10y/all kept as reference)      |
| 6.2  | Drawdown signal                          | **−15% in 7 days**, or **−25% in 30**                                                                 |
| 6.3  | Results signal                           | the day after results, for anything the pot holds                                                                   |
| 6.4  | Dry-powder signal                        | at**£750** uninvested, then every **£250**                                                            |
| 6.5  | Thesis review                            | sweep them**all, every week**                                                                                 |
| 6.6  | Breaking news                            | both — weekly Sweep*and* a market-reaction proxy the Scan can see                                                |
| 7.1  | Maximum buys per quarter                 | No limit                                                                                                            |
| 7.2  | Local fact-check before execution        | **Mandatory**                                                                                                 |
| 7.3  | Unsourced figures                        | Not permitted                                                                                                       |
| 9.1  | Benchmark                                | pot TWR · main-book TWR ·**S&P 500**                                                                        |
| 9.3  | Experiment reviewed                      | at 24 months                                                                                                        |
| 10   | Broker                                   | unconstrained — so the Tradelog gains a**`Pot` column**                                                    |
| 11.1 | Standing order                           | `^VIX` close ≥ 40 → buy **VUAG**, all available cash, no re-arm, overrides §4; alert if the pot is empty |

**Nothing open.** All 34 questions answered; §6.1 revised 29 Aug 2026 (see below).

Each question was asked with a suggested default drawn from what the existing book actually does.
Those suggestions are kept as `> quoted` history rather than deleted: where an answer departs from
one, the pair records that the departure was deliberate.

Two markers say what an answer becomes:

- **`[auto]`** — becomes a deterministic check in code. Runs free, on data CI already fetches, no
  LLM involved. These are what make the thing timely.
- **`[agent]`** — judgement handed to the LLM in its brief. Cannot be checked mechanically, so it
  has to be written precisely enough that a wrong call is visible afterwards.

---

## 0. The shape of the thing

Cash and decisions run on **separate clocks**. This is the whole design:

| Clock                                                            | Cadence                                  | Costs           |
| ---------------------------------------------------------------- | ---------------------------------------- | --------------- |
| **Funding** — £250 arrives, sits as pot cash             | monthly, calendar                        | nothing         |
| **Signals** — scan for anything worth a look              | continuous, every CI run                 | nothing         |
| **Decision** — research, then a buy/sell instruction      | *only when a signal fires, or you ask* | one LLM session |
| **Review** — re-read open theses against their falsifiers | monthly, calendar                        | one LLM session |

The expensive step is gated behind the free one. A signal scan over `prices.json`, `earnings.json`
and `peBands` is ordinary JavaScript — it can run every fifteen minutes forever and cost nothing.
The LLM only wakes when that scan has something to say. That is how "no API credits" and "timely
and dynamic" stop being in tension.

Cash therefore accumulates until there is a reason to spend it. Sitting on £750 for three months is
a position, not a failure — but the pot's return must be measured **including** that idle cash, or
the comparison against a fully-invested book is rigged.

---

## 1. Purpose

What is this pot *for*? It changes what counts as success.

- **(a) Return** — beat the main book and the index.
- **(b) Idea generation** — surface names you would not have found, which you may then act on at
  size in the main book.
- **(c) Process** — force written theses and scheduled reviews, and see whether that discipline is
  worth importing into the £175k.

> **Suggested: (b) and (c) primary, (a) as the scoreboard.** At £3,000/year against a £175k book,
> even a spectacular result moves your net worth by under 1%. Twelve months in you will have made
> perhaps a dozen decisions — far too few to call skill. The returns cannot matter; the method can.

**A**

Beat or at least on par with the index return, also to explore stocks out of my interest radar or my existing holdings.

I want to scale up of my investment end to end process by having utilitzing AI which learns and inherits my investment philoshophy and style, while getting inputs from the world more timely and efficient than a human does, so to perform better than mine which I believe it should, as I don't have time and resource to do so.

This pot is aimed to be largely managed by AI.

⚠ **Follow-up.** Recorded as decided — return *is* the goal, not just process. One factual caveat so
nothing is misread later: at roughly a dozen decisions a year, a 24-month run gives ~24 of them,
which is far too few to separate skill from luck whichever way it goes. That is not an argument
against the aim; it is an argument for §9.2 carrying real weight, because the process measures will
say something long before the return does.

---

## 2. Philosophy — what makes something a buy

Your book, read back to you as of 27 Aug 2026:

```
55 companies, $174,972          top 5 = 42%   top 10 = 61%
median position 0.9%            largest 10.7% (Google)
29 names under 1% each          = 13.5% of the book combined
median holding age 1.7y         16 names held over 3 years
portfolio yield 0.94%           36 of 55 pay something
US 65% · Japan 8.8% · Old HK 8.5% · China 7.3% · Europe 6.7%
```

That reads as a **barbell**: a high-conviction compounder core (Google, Microsoft, Apple, Nvidia,
ASML) with a long exploratory tail of 29 small positions. Worth naming, because the pot at £250/month
will naturally produce more tail — and you already have plenty.

**Q 2.1** In one paragraph, what makes you buy something? Write it as you would explain it to a
person, not as criteria. `[agent]`

> The pot's whole edge is that this paragraph is specific. "Good companies at fair prices" gives an
> agent licence to justify anything.

**A**

A balance of growth and valuation. I'm very skeptical and I only buy shares that I'm familiar enough with. E.g. I bought NVDA long time ago when ChatGPT was first introduced to the world. I knew it would be revolutionary as I tried it myself and I knew the next would be the computing power, chips, etc and therefore I kept buying and holding without influenced by my emotions.

I also like to discover investment opportunities from day to day first handed observations. E.g. I bought M&S because I noticed they were trying to ditch their old-school impressions and pushing many new innovative food products as I went there shopping from time to time.

I'm inspired by Peter Lynch very much and Warren Buffet of course.

I'm a qualified CPA myself and I look at annual reports. I'm not a fan of technical analysis and I prefer looking at the fundamentals and buy for long term.

**Q 2.2** Name two things you own that you are *proud* of buying, and why — and one you regret.
`[agent]`

> Worth more than any list of rules. It shows the agent what a good decision looked like in your
> hands, including one that went wrong for reasons you can articulate.

**A**

NVDA as explained above.

2800.HK actually although I didn't buy much. I think HSI in general is very biased towards mainland shares and very often the earning quality is questioned by public.

However in terms of Valuation it was dropped to a point the valuation is so cheap and therefore I tried to analyse it objectively and therefore it's outperforming now.

I regret buying 7532.T, blinded by the tourist rebound without looking at the fundamentals, valuation, forward prospectus and yen depreciation carefully.

**Q 2.3** Which of these are you actually willing to own? `[agent]`

- Loss-making companies with a credible path to profit?
- Businesses you cannot value on earnings (pre-revenue, crypto, commodities)?
- Turnarounds — something cheap *because* it is broken?
- Cyclicals bought at trough earnings?

> Your book says yes to some already (IBIT/GBTC hold an asset that pays nothing; PLTR at 150× is
> priced on a future).

**A**

Loss making companies but very carefully as it's hard to value it.

I also hold some gold and crypto ETF purely to diversify by holding a few % of alternative investments in my portfolio.

**Q 2.4** Is valuation a **filter** (never pay above X) or an **input** (pay up for quality)? `[agent]`

> Your tooling implies filter — the entire trough-P/E and "P/E paid" apparatus exists to ask "is
> this dear against its own history?". But you hold Nvidia at 1,480% and Palantir at ~150×, which
> is the behaviour of someone treating it as an input. Worth resolving, because the agent will
> otherwise pick whichever reading suits its argument.

**A**

It's definitely a filter to me.

Earning quality to me is the margin %, the consistency of that and the growth, it's further than just looking at P/E.

**Extended 1 September 2026**, after reading Vlad Djukanovic on profit margins (`pot/reading.md`).

A margin is profit over **sales**, and I do not invest in sales — I invest capital. Two shops on
the same street settle it: the fruit stall keeps 5 cents on the dollar and the antique shop keeps
50, and the margin does not tell you which is the better business. Turnover does.

So earnings quality is **margin, plus what the capital behind it earns, plus how hard the assets
are worked**:

- **ROIC** — operating profit after tax over capital employed. What actually compounds.
- **Gross profit ÷ total assets** — the measure the academic work supports. The research everyone
  cites for "look at gross margins" used *total assets* as the denominator, not sales; swapping it
  is a misreading, and gross and net margins have the same predictive power anyway.
- **Asset turnover** — revenue over total assets. The fruit stall versus the antique shop.

And treat a **high margin as a question, not a comfort**. Margins decay: an elevated one invites
competition, so it wants an explanation of why it should persist rather than being scored as a
pass on its own.

All three are on every holding's Valuation panel where the filings support them, and blank where
they do not — a bank has no meaningful current-liability split, so it gets no ROIC rather than an
invented one. Absent is an answer; 38 of 59 holdings carry them.

None of this displaces the filter. Valuation still screens things out. This says what has to be
true of the business *before* the multiple is worth arguing about.

---

## 3. Universe

**Q 3.1** Where may the pot buy? `[auto]`

> **Suggested: anywhere your chosen broker offers, in USD/GBP/EUR/HKD/JPY.** Your book is already
> global and the tooling handles all five currencies.

**A**

No constraints, for now I will execute it myself until it's ready to be fully automated technically.

**Q 3.2** Anything permanently excluded — sectors, countries, structures? `[auto]`

> Ethical exclusions, or things you simply refuse to hold. Cheap to enforce, impossible to
> retrofit honestly once the agent has already recommended one.

**A** — No.

**Q 3.3** May the pot buy something already in the main book? `[auto]`

> **Suggested: yes, but it must argue for it fresh.** Owning it already is not a thesis, and the
> pot's position is tracked separately regardless. Note the risk: the more the pots overlap, the
> less the comparison tells you.

**A** — Yes.

**Q 3.4** Single stocks only, or funds too? `[auto]`

> **Suggested: single stocks only.** An index fund in the pot is a bet on nothing in particular and
> makes the experiment unreadable — if you want index exposure you already hold VOO and VUSA.

**A** — Both yes.

---

## 4. Sizing and cash

At £250/month the pot receives about **$4,000/year**. Your book's median position is **0.9%**,
about **$1,600**. So the pot can honestly fund roughly **two to three positions a year** at your
normal size — or a dozen at a size that means nothing.

**Q 4.1** Minimum position size, so the pot does not spray. `[auto]`

> **Suggested: £400 minimum**, which means saving up for two months before a first purchase. This
> is the rule that stops the pot becoming a thirtieth sub-1% holding.

**A**

No min., I prefer the pot to spray actually, unless there are implications of transaction fees e.g. custody fees when buying OTC shares.

⚠ **Follow-up.** Noted and taken as decided — but two consequences worth seeing before it is coded.
At £250/month, spraying means tickets of roughly **£50–80**. Your main book already carries **29
names under 1% each**, 13.5% of it combined, so the pot would produce more of the thing you have
most of. And your own caveat needs a number: OTC ADR **custody fees run ~$0.01–0.05 per share per
year**, which on a £60 ticket can be 1–3% annually — enough to decide the outcome by itself. The
codeable version of your answer is probably *"no fixed minimum, but refuse a ticket whose first-year
costs exceed X% of it."* What is X?

Follow-up ANS: 2%, and I want to avoid some situations like when buying a small amount of an income generating OTC share while custody fee is a fixed amount and eating its dividends, and at the end it defeats the purpose and gains.

**Q 4.2** Maximum position, as a share of the pot. `[auto]`

> **Suggested: 35%.** Early on the pot is small and any first position is 100% of it — so this
> should bind on *contributed capital to date*, not on current pot value.

**A** — 50%.

**Q 4.2a** Whole shares against the §4.2 cap. `[auto]`

> Leo does not buy fractional shares, so a position is `floor(allocation ÷ price)` and a name whose
> single share costs more than the allocation rounds to **zero** — the proposal is not expensive,
> it is unplaceable. At the current £125 half-allocation that ruled out INTU (~£246/share) and
> NVDA (~£170), INTU being the name the Deep dive has proposed most often.
>
> **Suggested: one whole share always clears §4.2.** The precedent is §11.1.e, which lets a
> standing order outrank the position limits because otherwise *"the rule quietly stops working in
> exactly the conditions it exists for"*. The same applies here: a cap meant to limit
> concentration instead silently deletes candidates, and it deletes them by share price rather
> than by any judgement about the business.
>
> This is bounded, not open-ended. §4.2 binds on **contributed capital to date**, not on current
> pot value, so the breach shrinks with every contribution: one INTU share is 98% of £250 today,
> 49% at £500, 33% at £750. Both names clear the cap after the **second** contribution. The pot
> being small enough for one share to dominate it is the condition §4.2's own rationale
> anticipated — *"early on the pot is small and any first position is 100% of it."*

**A** — Yes, buy the minimum one share.

**Bounds, as coded.** One share, never more, when the cap would otherwise round the order to zero.
It must still fit available cash — the pot does not borrow. And P1 must state the resulting
concentration and how many contributions bring it back under §4.2, so a temporary 98% position is
a disclosed choice rather than an arithmetic accident.
**Q 4.3** How many positions should the pot hold at once? `[auto]`

> **Suggested: 4–8.** Below four it is a coin flip; above eight, £3k/year cannot maintain it.

**A** — No limit.

**Q 4.4** Is the pot allowed to hold cash deliberately, and up to what point? `[auto]`

> **Suggested: yes, unlimited, but the agent must say so explicitly** — "no action, holding £X"
> is a valid and recorded output. Forcing money out monthly is exactly how you buy the least-bad
> idea available rather than a good one. Balancing rule below in 6.4.

**A** — Yes.

**Q 4.5** May the pot top up an existing pot position rather than open a new one? `[agent]`

> **Suggested: yes, and it should count as a distinct decision** with its own thesis — averaging
> down into a broken thesis is the single most common way a small pot dies.

**A** — Yes.

---

## 5. Selling

**Q 5.1** What are the *only* valid reasons to sell? `[agent]`

> **Suggested, and I would keep this tight:**
>
> 1. A falsifier from the original thesis has tripped.
> 2. The thesis has played out — the target the thesis named has been reached.
> 3. The position breached a hard limit in section 4.
>
> Note what is missing: "it went down", "it went up a lot", and rebalancing. With ~12 decisions a
> year, churn is the enemy.

**A**

* A falsifier from the original thesis has tripped.
* The thesis has played out — the target the thesis named has been reached.
* The position breached a hard limit in section 4.
* Personally I seldom sell.

**Q 5.2** Minimum holding period before a sell may even be considered? `[auto]`

> **Suggested: 6 months, waived if a falsifier trips.** Your CAGR column already refuses to
> annualise under a year for the same reason — short holds produce noise, not signal.

**A** — No min.

**Q 5.3** Trim, or all-or-nothing? `[agent]`

> **Suggested: all-or-nothing.** At £400–1,000 a position, a partial sale is not worth the
> accounting or the thinking.

**A** — Trim.

---

## 6. Signals — what wakes the agent

One vocabulary, settled 28 Aug 2026. The **Scan** is the lane; a **signal** is what it emits;
`signals.js`, `signals.json` and `npm run signals` are the code. These had drifted into three
names for one mechanism — "triggers" here, "Scan" in [pot-design.md](pot-design.md), "signals" in
the code — which was confusing enough to have to be asked about.

Not everything the Scan emits is a signal, and the differences matter:

| | What it is |
|---|---|
| **signal** | something worth a look. Wakes an agent; decides nothing |
| **instruction** | a standing order (§11) firing. No agent in the loop at all |
| **annotation** | `oneOff`, `epsStale` — a qualification riding on a signal, not one itself |
| **quiet** | a rule that ran and found nothing. Not the same as one that could not run |

This is the timeliness you asked for. Each is a cheap check over data CI already has. Tick the ones
you want; they become the signal scan.

**Q 6.1** Valuation `[auto]` — a name trades near the cheap end of *its own* history.

> Now computable for 60 tickers: `peBands` holds every fiscal year's cheapest, dearest and average
> multiple. **Suggested: fire when the current multiple is within 15% of the ticker's lowest band
> low.** This is the signal your last two weeks of work accidentally built.

**A (threshold)** — fire when the current multiple is within 15% of the ticker's lowest band

⚠ **Revised 29 Aug 2026, on Leo's objection.** A minimum reaching back a decade is precise and
unusable: Apple's cheapest week was 8.9× in April 2013 — true, and about a company selling into a
market that no longer exists. A floor nobody expects to see again cannot say whether today is cheap.

**A (revised)** — **the cheapest 10% of its own five-year distribution.** Two changes, both his:

- **Five years, not all time.** Long enough to hold a cycle, short enough that the business is
  recognisable. **3y, 10y and all-time are still computed and kept** in `peHistory` as reference —
  the long view is the right context for *"has this ever been hated?"*, just the wrong yardstick
  for *"should I buy it this week"*.
- **A percentile, not a distance to the minimum.** A minimum is one observation, often one panicked
  week; a percentile uses every week in the window. NVDA at the **0th percentile** — cheaper than
  any week in five years — says more than a trough from 2011. AAPL at the **87th** says it is dear
  by its own recent standards, which an all-time low of 8.9× actively hides.

The minimum still travels with the signal, because *how cheap it has actually got* is worth knowing
once the better question has been asked. It is context now, not the trigger.

**Q 6.2** Drawdown `[auto]` — a watchlist or held name falls hard, fast.

> **Suggested: −15% in 7 days, or −25% in 30.** Both columns already exist in the table.

**A** — −15% in 7 days, or −25% in 30

**Q 6.3** Results `[auto]` — a pot holding reports.

> The calendar already knows: `earnings.json` plus the HKEXnews filings. **Suggested: fire the day
> after results for anything the pot holds** — that is when a thesis is confirmed or broken, and
> it is the highest-value moment to look.

**A** — fire the day after results for anything the pot holds

**Q 6.4** Dry powder `[auto]` — cash has piled up with nothing done.

> **Suggested: fire at £750 uninvested, and again every £250 after.** A nudge, not an order —
> "hold" remains a valid answer under 4.4.

**A** — fire at £750 uninvested, and again every £250 after.

**Q 6.5** Review due `[auto]` — a thesis has reached its own review date.

> Every proposal names one. This is the signal that closes the feedback loop; without it the pot
> is a pick generator.

**A** — Every week.

⚠ **Follow-up.** Reading this two ways. The question was *"should a thesis reaching its own review
date wake the agent?"* — a yes/no. "Every week" sounds instead like **review everything weekly**,
regardless of the dates proposals set for themselves. That is a different and stronger rule, and it
changes §8.4: if everything is reviewed weekly anyway, a per-proposal review date is decoration.
It also moves the Review lane from monthly to weekly, which is four times the sessions. Which did
you mean — fire on the date each thesis names, or sweep them all every week?

Sweep them all every week.

**Q 6.6** Anything else that should wake it?

> Candidates: a holding's dividend cut, a 52-week high, an insider/buyback disclosure, a currency
> move past some level. Each costs a few lines *if* the data is already local — anything needing a
> new feed is a bigger job.

**A** — Ground breaking news e.g. another tariff war declared by Trump.

⚠ **Follow-up.** This one cannot be `[auto]` — there is no local data that knows a tariff war was
declared, so no deterministic check can detect it. It belongs to the **Sweep** lane, which reads
the world. Two honest options: leave it to the weekly Sweep and accept up to seven days' latency,
or add a cheap proxy the Scan *can* see — `^VIX` jumping, or an index gapping — which catches the
market's reaction rather than the news itself. The proxy is usually same-day; the Sweep explains
what happened. Which do you want, or both?

Both.

---

## 7. Guardrails

**Q 7.1** Maximum buys per quarter? `[auto]`

> **Suggested: 2.** Event-driven means more chances to act, and acting is not the same as
> deciding. A hard cap forces the agent to rank rather than accumulate.

**A** — No limit.

**Q 7.2** Must every proposal be checked against local data before you execute? `[auto]`

> **Suggested: yes, and this is the guard I would least want to give up.** Any name the agent
> proposes gets added to `watchlist.json`; the next CI run fetches its real fundamentals from
> Yahoo within the hour. If the agent's stated P/E, yield or growth disagrees with what comes
> back, the proposal is void. You own an independent fact-checker — use it.

**A** — Yes.

**Q 7.3** May the agent act on anything it cannot show you a source for? `[agent]`

> **Suggested: no.** Every figure in a proposal carries a link or a local file reference. This is
> the same rule the rest of the repo already lives by: a number that is not trustworthy is worse
> than no number.

**A** — No.

---

## 8. What a proposal must contain

The contract. An instruction missing any of these is not executable.

> **Suggested — and 3, 4 and 5 are the ones that make this worth doing at all:**
>
> 1. **Order** — ticker, exchange, buy/sell, amount in £, order type.
> 2. **Thesis** — three sentences. Why this, why now, what the market is missing.
> 3. **Falsifier** — what specific, observable thing would prove this wrong. Not "the price falls".
>    Something like "FY27 gross margin below 40%" or "the Q3 order book shrinks again".
> 4. **Review date** — when to look, regardless of price.
> 5. **The numbers as of today** — price, multiple, whatever the thesis rests on, each sourced. So
>    that in two years you can tell what was known from what was hindsight.
> 6. **The case against** — the strongest argument for not buying, stated by the agent itself.

**A (add/remove)**

1. **Order** — ticker, exchange, buy/sell, amount in £, order type.
2. **Thesis** — three sentences. Why this, why now, what the market is missing.
3. **Falsifier** — what specific, observable thing would prove this wrong. Not "the price falls".
   Something like "FY27 gross margin below 40%" or "the Q3 order book shrinks again".
4. **Review date** — when to look, regardless of price.
5. **The numbers as of today** — price, multiple, whatever the thesis rests on, each sourced. So
   that in two years you can tell what was known from what was hindsight.
6. **The case against** — the strongest argument for not buying, stated by the agent itself.

---

## 9. Scoring

**Q 9.1** The comparison, over the pot's own window — three ways, not two: `[auto]`

> **Pot TWR · your main book's TWR · a passive index.** Two is a trap: if the pot beats you but
> both lose to VWRP, that is the finding, and you would want to know it. Time-weighted, because
> monthly contributions make money-weighted returns meaningless here.

**A (which index)** — Pot TWR · your main book's TWR · S&P 500.

**Q 9.2** Beyond return, what is worth counting? `[agent]`

> **Suggested: thesis outcomes.** How many falsifiers tripped, and did you act when they did. Over
> a dozen decisions this is far more informative than the return, and it is the number that tells
> you whether the *process* is worth importing into the main book.

**A** — How much thinking the agent did.

⚠ **Follow-up.** Needs one more turn of the screw before it can be counted. "How much thinking"
could mean session length or tokens spent — cheap to record, but it measures effort, not judgement,
and an agent can burn tokens going nowhere. The version worth having is probably **how good the
case-against was**: did the agent name the risk that actually materialised? That is scoreable at
review time, in hindsight, against the falsifier it wrote. Which did you mean?

the judgement is also measured by return

**Q 9.3** When do you call the experiment, and on what basis? `[agent]`

> **Suggested: review at 24 months, no earlier.** Deciding at 12 is reading noise. Worth writing
> down now, while nothing is at stake, what would make you stop — otherwise a bad run becomes
> "give it more time" and a good one becomes proof.

**A** — Review at 24 months.

---

## 10. Decisions outside the questionnaire

Three things the plan depends on that are not rules:

- **Broker.** Suggested **T212**: commission-free, fractional, and it holds only 7 of your 335
  trades, so it is nearly a clean slate to isolate. On IBKR, £400 tickets lose ~1% round-trip to
  commission and FX — enough to swamp the result.
- **Wrapper.** If ISA allowance remains, run the pot inside it. The experiment then generates no
  CGT admin at all, which is the thread you parked earlier.
- **Contamination.** You will read a thesis and act on it in the main book. That is fine, probably
  good — but note it when it happens, or "parallel" quietly stops being true.

**A** — No broker constraint as I'm executing.

⚠ **Follow-up.** Fine, but it settles an open question elsewhere by ruling one option out. The pot's
trades were going to be identified *either* by a dedicated broker account *or* by an explicit tag.
With no broker constraint, a trade on IB could belong to either pot, so **the Tradelog needs a new
column** — call it `Pot`, blank for the human book. Without it the two cannot be told apart, and
D4 (tracking the pot separately) has nothing to stand on.

Yes no problem I will create that.

ISA qualified shares prefered of course, but not necessarily.

---

## 11. Standing orders

Hard rules that fire with **no LLM judgement at all**. The Scan detects the condition and emits an
*instruction*, not a candidate — a rule already decided gains nothing from being argued with.

Different from a §6 signal, which only wakes the agent to go and think.

### 11.1 VIX ≥ 40 → buy the S&P 500

> **The rule as stated:** when `^VIX` closes at or above 40, buy the S&P 500.

Backtested before writing it down — full detail and caveats in
[pot-design.md](pot-design.md) §6. In short: `^VIX` has closed ≥ 40 on **208 days since 1990**, but
**Q 125** of those were 2008 alone . Fired per qualifying day, this rule would have emptied the pot
inside a single drawdown. With a re-arm it becomes 10 fires in 37 years — one every 3.7 years,
8 of them higher a year later, median +25%.

So the threshold is not the rule. These five parameters are the rule, and none is answered yet:

**Q 11.1.a** Re-arm. After firing, what has to happen before it may fire again?

⚠ **Follow-up.** Taken as answered, but the three answers here combine into something bigger than
any of them says on its own, and it is worth seeing before it is coded.

No re-arm **+** "no limits" on size **+** "alert me to decide if I should put more into the pot"
means: the first close at 40 spends every pound the pot has, and then **every subsequent day above
40 asks you for more money.** Run against 2008 that is one purchase followed by **124 consecutive
prompts** to add cash, spread over six months, while the S&P fell a further 21% from the first buy.
2020 gives 32 prompts, 2025 gives 3.

That may be exactly what you want — averaging into a crash is a real strategy, and you did say you
seldom sell. But it turns a £250/month experiment into an open-ended call on your savings, decided
125 times under pressure. If that is the intent, say so and it stands. If not, the usual fixes are
a cap on total VIX-triggered spend per episode, a modest re-arm (one close below 30 lets it fire a
few times per episode rather than daily), or rate-limiting the *alert* to weekly while VIX stays
above 40 — which keeps the behaviour and drops 125 prompts to 26.

**A** — *unanswered*

> **Suggested: ten consecutive closes below 25.** That is the definition the backtest used, and it
> is what turns 208 firing days into 10.

**A** — Nothing.

**Q 11.1.b** Size. How much does it buy?

> All available pot cash? A fixed £? A fraction? Note the interaction: at one fire every 3.7 years,
> whatever is not spent here waits years for another chance.

**A** — No limits.

**Q 11.1.c** Instrument. Which S&P 500 line?

> You hold **VOO** (USD) and **VUSA.L** (GBP). §10 says no broker constraint, so this is a free
> choice — but it must be *one* named ticker, or the instruction is not executable.

**A** — VUAG.

**Q 11.1.d** No cash. If the pot holds nothing when it fires — skip, or queue until the next £250?

> A queued order can arrive weeks after the panic it was meant to buy. Skipping is honest; queueing
> is optimistic. Either is fine, but the file has to say which.

**A** — Alert me to let me decide if I should put more into the pot.

**Q 11.1.e** Precedence. Does it override §4?

> §4.2 caps a position at 50% of the pot. A VIX buy with all available cash will breach that early
> on. **Suggested: yes, standing orders outrank position limits** — otherwise the rule quietly
> stops working in exactly the conditions it exists for.

**A** — Yes.

### 11.2 Others

**A (add any)** — *unanswered*
