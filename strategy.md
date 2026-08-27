# Strategy — the AI-managed pot

**Status: DRAFT QUESTIONNAIRE. Nothing reads this file yet.**

Fill in the `→` lines. Every question carries a suggested default, drawn from what your existing
book actually does, so you are editing rather than writing from scratch — "default is fine" is a
complete answer. Delete the commentary once you have answered; what survives becomes the rules an
agent is held to.

Two markers tell you what an answer becomes:

- **`[auto]`** — becomes a deterministic check in code. Runs free, on data CI already fetches, no
  LLM involved. These are what make the thing timely.
- **`[agent]`** — judgement handed to the LLM in its brief. Cannot be checked mechanically, so it
  has to be written precisely enough that a wrong call is visible afterwards.

---

## 0. The shape of the thing

Cash and decisions run on **separate clocks**. This is the whole design:

| Clock | Cadence | Costs |
|---|---|---|
| **Funding** — £250 arrives, sits as pot cash | monthly, calendar | nothing |
| **Signals** — scan for anything worth a look | continuous, every CI run | nothing |
| **Decision** — research, then a buy/sell instruction | *only when a signal fires, or you ask* | one LLM session |
| **Review** — re-read open theses against their falsifiers | monthly, calendar | one LLM session |

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

→ **ANSWER:**

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

**2.1** In one paragraph, what makes you buy something? Write it as you would explain it to a
person, not as criteria. `[agent]`

> The pot's whole edge is that this paragraph is specific. "Good companies at fair prices" gives an
> agent licence to justify anything.

→ **ANSWER:**

**2.2** Name two things you own that you are *proud* of buying, and why — and one you regret.
`[agent]`

> Worth more than any list of rules. It shows the agent what a good decision looked like in your
> hands, including one that went wrong for reasons you can articulate.

→ **ANSWER:**

**2.3** Which of these are you actually willing to own? `[agent]`

- Loss-making companies with a credible path to profit?
- Businesses you cannot value on earnings (pre-revenue, crypto, commodities)?
- Turnarounds — something cheap *because* it is broken?
- Cyclicals bought at trough earnings?

> Your book says yes to some already (IBIT/GBTC hold an asset that pays nothing; PLTR at 150× is
> priced on a future).

→ **ANSWER:**

**2.4** Is valuation a **filter** (never pay above X) or an **input** (pay up for quality)? `[agent]`

> Your tooling implies filter — the entire trough-P/E and "P/E paid" apparatus exists to ask "is
> this dear against its own history?". But you hold Nvidia at 1,480% and Palantir at ~150×, which
> is the behaviour of someone treating it as an input. Worth resolving, because the agent will
> otherwise pick whichever reading suits its argument.

→ **ANSWER:**

---

## 3. Universe

**3.1** Where may the pot buy? `[auto]`

> **Suggested: anywhere your chosen broker offers, in USD/GBP/EUR/HKD/JPY.** Your book is already
> global and the tooling handles all five currencies.

→ **ANSWER:**

**3.2** Anything permanently excluded — sectors, countries, structures? `[auto]`

> Ethical exclusions, or things you simply refuse to hold. Cheap to enforce, impossible to
> retrofit honestly once the agent has already recommended one.

→ **ANSWER:**

**3.3** May the pot buy something already in the main book? `[auto]`

> **Suggested: yes, but it must argue for it fresh.** Owning it already is not a thesis, and the
> pot's position is tracked separately regardless. Note the risk: the more the pots overlap, the
> less the comparison tells you.

→ **ANSWER:**

**3.4** Single stocks only, or funds too? `[auto]`

> **Suggested: single stocks only.** An index fund in the pot is a bet on nothing in particular and
> makes the experiment unreadable — if you want index exposure you already hold VOO and VUSA.

→ **ANSWER:**

---

## 4. Sizing and cash

At £250/month the pot receives about **$4,000/year**. Your book's median position is **0.9%**,
about **$1,600**. So the pot can honestly fund roughly **two to three positions a year** at your
normal size — or a dozen at a size that means nothing.

**4.1** Minimum position size, so the pot does not spray. `[auto]`

> **Suggested: £400 minimum**, which means saving up for two months before a first purchase. This
> is the rule that stops the pot becoming a thirtieth sub-1% holding.

→ **ANSWER:**

**4.2** Maximum position, as a share of the pot. `[auto]`

> **Suggested: 35%.** Early on the pot is small and any first position is 100% of it — so this
> should bind on *contributed capital to date*, not on current pot value.

→ **ANSWER:**

**4.3** How many positions should the pot hold at once? `[auto]`

> **Suggested: 4–8.** Below four it is a coin flip; above eight, £3k/year cannot maintain it.

→ **ANSWER:**

**4.4** Is the pot allowed to hold cash deliberately, and up to what point? `[auto]`

> **Suggested: yes, unlimited, but the agent must say so explicitly** — "no action, holding £X"
> is a valid and recorded output. Forcing money out monthly is exactly how you buy the least-bad
> idea available rather than a good one. Balancing rule below in 6.4.

→ **ANSWER:**

**4.5** May the pot top up an existing pot position rather than open a new one? `[agent]`

> **Suggested: yes, and it should count as a distinct decision** with its own thesis — averaging
> down into a broken thesis is the single most common way a small pot dies.

→ **ANSWER:**

---

## 5. Selling

**5.1** What are the *only* valid reasons to sell? `[agent]`

> **Suggested, and I would keep this tight:**
> 1. A falsifier from the original thesis has tripped.
> 2. The thesis has played out — the target the thesis named has been reached.
> 3. The position breached a hard limit in section 4.
>
> Note what is missing: "it went down", "it went up a lot", and rebalancing. With ~12 decisions a
> year, churn is the enemy.

→ **ANSWER:**

**5.2** Minimum holding period before a sell may even be considered? `[auto]`

> **Suggested: 6 months, waived if a falsifier trips.** Your CAGR column already refuses to
> annualise under a year for the same reason — short holds produce noise, not signal.

→ **ANSWER:**

**5.3** Trim, or all-or-nothing? `[agent]`

> **Suggested: all-or-nothing.** At £400–1,000 a position, a partial sale is not worth the
> accounting or the thinking.

→ **ANSWER:**

---

## 6. Triggers — what wakes the agent

This is the timeliness you asked for. Each is a cheap check over data CI already has. Tick the ones
you want; they become the signal scan.

**6.1 Valuation** `[auto]` — a name trades near the cheap end of *its own* history.

> Now computable for 60 tickers: `peBands` holds every fiscal year's cheapest, dearest and average
> multiple. **Suggested: fire when the current multiple is within 15% of the ticker's lowest band
> low.** This is the trigger your last two weeks of work accidentally built.

→ **ANSWER (threshold):**

**6.2 Drawdown** `[auto]` — a watchlist or held name falls hard, fast.

> **Suggested: −15% in 7 days, or −25% in 30.** Both columns already exist in the table.

→ **ANSWER:**

**6.3 Results** `[auto]` — a pot holding reports.

> The calendar already knows: `earnings.json` plus the HKEXnews filings. **Suggested: fire the day
> after results for anything the pot holds** — that is when a thesis is confirmed or broken, and
> it is the highest-value moment to look.

→ **ANSWER:**

**6.4 Dry powder** `[auto]` — cash has piled up with nothing done.

> **Suggested: fire at £750 uninvested, and again every £250 after.** A nudge, not an order —
> "hold" remains a valid answer under 4.4.

→ **ANSWER:**

**6.5 Review due** `[auto]` — a thesis has reached its own review date.

> Every proposal names one. This is the trigger that closes the feedback loop; without it the pot
> is a pick generator.

→ **ANSWER:**

**6.6** Anything else that should wake it?

> Candidates: a holding's dividend cut, a 52-week high, an insider/buyback disclosure, a currency
> move past some level. Each costs a few lines *if* the data is already local — anything needing a
> new feed is a bigger job.

→ **ANSWER:**

---

## 7. Guardrails

**7.1** Maximum buys per quarter? `[auto]`

> **Suggested: 2.** Event-driven means more chances to act, and acting is not the same as
> deciding. A hard cap forces the agent to rank rather than accumulate.

→ **ANSWER:**

**7.2** Must every proposal be checked against local data before you execute? `[auto]`

> **Suggested: yes, and this is the guard I would least want to give up.** Any name the agent
> proposes gets added to `watchlist.json`; the next CI run fetches its real fundamentals from
> Yahoo within the hour. If the agent's stated P/E, yield or growth disagrees with what comes
> back, the proposal is void. You own an independent fact-checker — use it.

→ **ANSWER:**

**7.3** May the agent act on anything it cannot show you a source for? `[agent]`

> **Suggested: no.** Every figure in a proposal carries a link or a local file reference. This is
> the same rule the rest of the repo already lives by: a number that is not trustworthy is worse
> than no number.

→ **ANSWER:**

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

→ **ANSWER (add/remove):**

---

## 9. Scoring

**9.1** The comparison, over the pot's own window — three ways, not two: `[auto]`

> **Pot TWR · your main book's TWR · a passive index.** Two is a trap: if the pot beats you but
> both lose to VWRP, that is the finding, and you would want to know it. Time-weighted, because
> monthly contributions make money-weighted returns meaningless here.

→ **ANSWER (which index):**

**9.2** Beyond return, what is worth counting? `[agent]`

> **Suggested: thesis outcomes.** How many falsifiers tripped, and did you act when they did. Over
> a dozen decisions this is far more informative than the return, and it is the number that tells
> you whether the *process* is worth importing into the main book.

→ **ANSWER:**

**9.3** When do you call the experiment, and on what basis? `[agent]`

> **Suggested: review at 24 months, no earlier.** Deciding at 12 is reading noise. Worth writing
> down now, while nothing is at stake, what would make you stop — otherwise a bad run becomes
> "give it more time" and a good one becomes proof.

→ **ANSWER:**

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

→ **ANSWERS:**
