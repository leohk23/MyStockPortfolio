# Deep dive — produce one executable instruction

The only lane permitted to produce an order. One name, researched properly, written so it can be
placed without further thought and audited in two years.

## You choose the name — from both lanes (D14)

If the instruction names a ticker ("…for CHRT.L"), research that one. Otherwise **you pick**, and
you pick from **two sources together**:

1. **`pot/sweeps/`** — the newest Sweep's candidates, and why each was raised.
2. **`signals.json`** — what the free Scan fired on, with any `oneOff` flag.

Reading only one of those is the mistake this brief already made once. An earlier version pointed
at `signals.json` alone and produced a proposal for GME, a name that week's Sweep had never
mentioned — not because the pick was bad, but because half the evidence was invisible to it.

**Up to three proposals**, fewest first: one strong candidate beats three weak ones, and **zero is
a valid answer.** §4.4 says holding cash is a position. If nothing clears Leo's rules this week,
write `pot/proposals/<stamp>-none.md` saying what you looked at and why each failed. That is a
more useful record than a forced buy.

## A pending proposal is not a position — rank as if it did not exist

Older files in `pot/proposals/` are **drafts awaiting Leo's decision, not commitments**, and they
must not change what you propose. If NVDA is the best name on today's evidence, propose NVDA —
even if last week's run said so too, even if an unexecuted NVDA draft is sitting in the same
directory you are writing to. Two runs reaching the same conclusion from the same rules is the
system working; **silently declining to write up your own top-ranked name because a file with a
similar name already exists is the system failing quietly.** A run must be readable on its own.

The 29 August run ranked NVDA first and then refused to write it up, "already covered by the
pending 28-Aug proposal". Nothing in this brief asked for that. It read the directory, inferred a
rule, and the output no longer said what the evidence said.

**What DOES constrain you is `pot/positions.json`** — the cash and the holdings actually bought.
That is the pot's book, and §4.2's 50% cap applies to what it holds. An undecided draft is not in
it. If you want to note that a name has been proposed before, put it in the ranking table as a
remark; never let it downgrade a rank or suppress a proposal.

## Say what the proposal does to Leo's total exposure

`signals.json` → `book` carries where the human book actually sits: `names` and `byCompany` by
weight of market value, `byGeography`, and the GBP total. The pot is tracked separately (D4) and
§3.3 explicitly permits buying what the main book already holds — **owning it already is not a
thesis, and it is not a veto either.** But strategy.md attaches a warning to that permission:
*"the more the pots overlap, the less the comparison tells you."*

So every proposal states, in one line in P6 (the case against), what it does to the combined
position: the name's existing weight in the human book if any, and whether the buy adds to an
exposure that is already large. NVDA has been proposed seven times and sits at ~7.5% of the human
book; nothing in this brief has ever made that visible, and it is exactly the fact a reader needs.

This is a **disclosure, not a gate**. Do not downgrade a rank for overlap. Say it, and let Leo
decide — the same treatment a one-off earnings flag gets.

## Size in whole shares

Leo does not buy fractional shares. So a position is `floor(allocation ÷ price in GBP)` and the
remainder stays in cash. Convert with `prices.json` → `rates`, which are **USD per unit**:
`gbp = price × rates[ccy] ÷ rates.GBP`.

**When that rounds to zero, buy one share anyway — §4.2a.** A name whose single share costs more
than the allocation is not expensive, it is *unplaceable*, and a cap meant to limit concentration
would instead be deleting candidates by share price rather than by any judgement about the
business. §4.2a settles it: one whole share always clears §4.2. The precedent is §11.1.e, where a
standing order outranks the position limits for the same reason — otherwise the rule quietly stops
working in exactly the conditions it exists for.

Bounded, and the bounds are not optional:

- **One share, never more**, when the cap would otherwise round the order to zero. Above that,
  §4.2 applies normally.
- **It must fit available cash** in `pot/positions.json`. The pot does not borrow.
- **P1 states the resulting concentration and how it unwinds.** §4.2 binds on *contributed capital
  to date*, not on current pot value, so the breach shrinks with every £250: one INTU share is 98%
  of £250 today, 49% at £500, 33% at £750 — under the cap from the **second** contribution. Write
  that, so a temporary 98% position is a disclosed choice and not an arithmetic accident.

Always state the whole-share order, the cash deployed and the remainder left idle. TW at ~£79 on a
£125 allocation deploys 63% of it and leaves £46 idle; that is worth saying even when nothing is
breached.

## The falsifier must test what the case against says is the real risk

**P3 answers P6.** Whatever P6 names as the strongest argument for not buying, P3 has to be
checkable against *that*. They are currently allowed to drift apart, and they do.

The 30 August NVDA proposal is the worked example. P6 named the risk exactly — "NVIDIA is
increasingly helping finance and underwrite the ecosystem that buys its products… **if
NVIDIA-supported financing is masking end demand**, earnings and the multiple can contract
together" — and then P3 tested revenue against guidance and gross margin against 73.5% and 70%.
Neither would move in the scenario P6 describes: financed demand still books revenue at full
margin. That is what the illusion looks like from the income statement. The falsifier stayed green
precisely while the risk was building, and would only trip once the financing stopped — by which
time nobody needs a falsifier to notice.

**Why this keeps happening:** guidance is where the crisp numbers live, so every falsifier drifts
towards metrics management has already quantified. A company does not publish guidance on the risk
that its demand is partly its own money.

So: after writing P6, go back to P3 and ask whether either tier would actually move under it. If
not, find a disclosed, dated figure that would. For circular or vendor financing that is a real
list — related-party revenue as a share of segment revenue, receivable days extending against
revenue growth, the equity- and guarantee-commitment balance growing faster than revenue, customer
concentration in the 10-K. All quarterly, all in the filing, all checkable by the Review lane.

**That rule was written from NVDA and breached by the very next proposal in the same way.** The
4 Sep INTU proposal's P6 said an AI agent or a government filing option *"could weaken the
front-end relationship **before revenue shows it** because price and expert attach can temporarily
offset lost users"* — and P3 then tested revenue, operating income and growth. The agent wrote the
sentence that its falsifier would not move, and did not act on it. Prose that asks you to check is
not enough; the four rules below make the check structural.

**Rule 1 — P6 names ONE dominant risk, first, on its own line, with a category.** The categories
are `financial`, `competitive` (a rival or a substitute takes the customer), `secular` (the
product category itself shrinks or is displaced), `accounting` (the numbers may not mean what they
say — circular financing lives here) and `regulatory`. Everything else in P6 is secondary and goes
below it. "P3 answers P6" applies to that one line. A paragraph in which "Mailchimp guided flat"
sits at equal weight with "the product category may cease to exist" has not named a risk.

**Rule 2 — the thesis may not contain the rebuttal to the dominant risk.** INTU's P2 opened with
*"the embedded records, integrations and expert network give its high margin a better chance of
persisting than an AI interface"*. That is the answer to the main objection, asserted as a premise
with nothing cited, and once the thesis has swallowed the objection P6 is written as a residual.
If P2 argues the moat survives the dominant risk, that argument is not a premise — it is the thing
P3 tests. INTU's break should have asked whether attach and margin hold **while** units fall, not
whether revenue misses guidance.

**Rule 3 — for `competitive` and `secular` risks, look outside the company's own filings.** The
NVDA list works because circular financing leaves fingerprints in the same company's statements.
Displacement of a product leaves them elsewhere: the substitute's adoption figures, a regulator's
own programme numbers (the IRS publishes Direct File take-up annually), the company's disclosed
customer counts against its price-driven revenue growth, the wording of its 10-K risk factors from
one year to the next. Name the external source, the metric and its cadence, exactly as you would a
line in a filing. "Guidance is where the crisp numbers live" is a diagnosis of the drift, not
permission for it. A figure that lives outside the filings is still a figure; it is not a reason
to fall back to one that lives inside them and will not move.

**Rule 4 — an unfalsifiable or slow dominant risk sizes the position, mechanically.** If the
earliest observable for the dominant risk is more than two quarters away, or lives entirely
outside any dated source, the order is **half the allocation §4 would otherwise give**, and P1
says so and why. A proposal may argue for the full size against this rule, in P1, with the
argument written out — but the default is the smaller order, not the larger one with a caveat.
This replaces the earlier "say so and count it against the position", which the INTU proposal did
not invoke and nothing made it. An unfalsifiable main risk is a reason to size smaller or wait,
never a reason to test something easier and call it a falsifier.

## A falsifier has two tiers, and the first one has to bite early

A single hard threshold is a switch that only flips once the argument is already lost. The 30
August NVDA proposal said the thesis fails if Q3 GAAP gross margin drops below 70%. But management
had already guided Q4 to roughly 71–72% on memory costs, so 70% was not an early warning at all —
it was a level the company was openly steering towards, and by the time it printed there would be
nothing left to decide.

So write two:

- **Warning** — the earliest observable that says the thesis is under strain. Usually **a miss
  against management's own stated guidance or range**, because that is the first hard evidence
  that exists and the company has already committed to it in public. NVDA's would have been "Q3
  gross margin below the guided 73.5% floor, or a material cut to FY28 growth expectations".
  A warning triggers a re-read at the next review, not a sale.
- **Break** — the observable that says the thesis is wrong and the position should go under §5.1.

Both must be checkable and dated. If you cannot name a warning that could fire before the break,
say so and explain why — a thesis whose only failure mode is catastrophic is worth flagging as
such, not padding with an invented middle tier.

## State what the valuation window actually covers

`peWindow` says "5y". That is a **label**, not a measurement, and for a recently listed company it
can be badly wrong: RSGN.SW's five-year percentile was drawn from 179 weeks beginning in March
2023, of which the first 37 were VT5 Acquisition Company, the SPAC that R&S listed through in
December 2023. A SPAC trades near its cash value, so those weeks are not valuation observations of
this business at all — and they sat in the distribution making today look cheaper than it is.

So whenever you quote a percentile, quote its span with it: `peFrom` and `peWeeks` are on the
quote for exactly this. Write "1.7th percentile of 143 weeks from 2023-12-13", never "1.7th
percentile of its five-year history" when the history is not five years long.

**Under about three years of weeks, the percentile is indicative and you must say so.** An IPO, a
spin-off, a de-SPAC or a re-listing all produce a short window, and a short window has not seen a
cycle. It does not disqualify a candidate — it means the multiple cannot carry much of the
argument, which §2.4 says it should not be carrying anyway.

If you find a ticker whose price history plainly predates the current business and is not in
`HISTORY_FROM` in `fetch-prices.js`, say so in §5. That is a data-quality finding worth more
than the proposal it turned up in.

## The multiple is not the thesis

**A proposal whose case is "it is cheap against its own history" is rejected.** That comparison is
the trigger that woke you — it is not a reason to own a business, and §2.4 says valuation is a
**filter**: a filter screens things out, it never argues you in.

So the floor comparison belongs in P5 with the other numbers, as a gate the name passed. The thesis
in P2 has to stand on the business: what it does, whether the earnings are any good (margin level,
the *consistency* of that margin, growth — §2.4), and what the market is missing. Leo's own two
proud buys were NVDA *because he used ChatGPT and reasoned about what compute would be worth*, and
M&S *because he kept noticing the food range changing in the shops* — neither was a screen result.

The first deep dive led with "33.43× against a 38.50× floor". That is exactly the mechanical
reasoning this section exists to stop.

**Use the freshest earnings you can source, and say when ours are stale.** `signals.json` flags a
ticker as `epsStale` when its trailing EPS predates results the company has already published. Both
sides of any multiple you quote must be current, and a stale denominator can flip the answer: NVDA
on our cached EPS is 5% *above* its floor; on its actual post-Q2 EPS it is 13% *below*.

## Spend the budget, not just the first slot

Sizing is a **§4 allocation across candidates**, not one ticket:

- The pot's cash is in `pot/positions.json`; if £0, work against the next £250 contribution.
- §4.2 caps any one position at **50%**, so £250 supports **two** £125 positions, not one.
- §4.1 has no minimum, but refuse a ticket whose first-year costs exceed **2%** of it.

After the first proposal, **keep going while cash remains and a candidate still clears the rules.**
If the second-best name does not clear, say so and leave the cash — §4.4 makes holding it a
position, and it is what the VIX standing order will need. What is not acceptable is stopping at
one because the brief only asked for one.

## Rank against Leo's rules, and show the ranking

State, in a short table, every name you considered and why it did or did not make the cut. Use his
own tests, not generic ones:

- **Earnings quality** — margin level, the *consistency* of that margin, and growth, **and what the
  capital behind it earns** (§2.4, extended 1 Sep). Not the P/E alone, and not the margin alone
  either: a margin is profit over SALES, and Leo invests capital. `earnings.json` carries filed
  `rev`, `opinc`, `nic` and `norm` per year; `prices.json` carries `capital` per quote with
  **roic**, **gpa** (gross profit over total assets) and **turnover** (revenue over total assets),
  with the fiscal year they came from.

  **Quote all three where they exist, and say the year.** They are blank for about a third of the
  book — a bank has no meaningful current-liability split so it gets no ROIC, and some filers do
  not tag gross profit at all. Blank is an answer; do not substitute a margin and call it the same
  thing.

  **A high margin is a question, not a comfort.** Margins decay: an elevated one invites
  competition, so say why this one should persist. "Margin is 60% and rising" is an observation,
  not a thesis.
- **Valuation as a filter, not an input** (§2.4) — a name he would like at the wrong price is a no.
- **A `oneOff` flag is the first thing to answer**, not a footnote. The multiple that triggered the
  signal may be inflated by an exceptional gain.

**Before researching any name, check it is locally covered (§7.2)** — in `prices.json` with real
`eps`, and `peBands` if it is an operating company. If not, say so and pick another: a fresh Sweep
candidate needs one price fetch, and the daily cycle now runs one between the Sweep and this
lane for exactly that reason, so a name raised this morning should already be covered.
fact-checked against independent data is void, and writing one anyway is worse than writing none.

## Verify before you argue — §7.2, mandatory

Every figure that exists locally must be checked against local data before you use it:
`prices.json` (price, eps, normEps, peBands, divYield), `earnings.json` (filed years: rev, opinc,
nic, norm, eps), `holdings.json`, `signals.json`.

If your researched figure and the local one disagree, **say so and say which you are using and
why.** Do not silently pick the one that suits the argument. A proposal that hides a disagreement
is void.

## Size — §4

- **No minimum** position, but refuse the ticket if its **first-year costs exceed 2%** of it.
  State the costs you expect: commission, FX spread, stamp duty, ADR custody if OTC.
- Maximum **50%** of the pot.
- The pot's cash is in `pot/positions.json`. **If it is £0, size against the next £250 contribution
  and say the order is pending funding.** Do not invent a balance.

## Write the proposal — the §8 contract, P1 to P6, none optional

To `pot/proposals/<stamp>-<ticker>.md`, where `<stamp>` is **`YYYY-MM-DD-HHMM` in UTC** — Leo runs
this lane several times a day while testing, and a date alone makes the second run of a day
overwrite the first. Never reuse a filename that exists.

```
model: <model>, lane: deep-dive, date: <today>, tokens: <if known>

# <TICKER> — <company>

## 1. Order
BUY <n> share(s) of <ticker> on <exchange>, £<deployed> of £<allocation>, <market|limit @ price>.
Currency <ccy>. Cash left idle: £<remainder>.
Expected first-year costs: <breakdown>, <x>% of the ticket.
<If n=1 under §4.2a: the % of contributed capital this is, and how many contributions bring it
 under the 50% cap. If the dominant risk is slow or unfalsifiable: half size, per Rule 4.>

## 2. Thesis
<Three sentences. Why this, why now, what the market is missing.
 About the BUSINESS. See "The multiple is not the thesis" below.
 Must NOT contain the answer to P6's dominant risk — that answer is what P3 tests (Rule 2).>

## 3. Falsifier
**Warning:** <the first observable that says the thesis is under strain. Usually a miss against
 management's OWN stated guidance or range, because that is the earliest hard evidence available.
 Trips a re-read, not a sale.>
**Break:** <the observable that says the thesis is wrong and the position should go. A number, a
 date, a disclosure. Not "the price falls".>

## 4. Review date
<a date, regardless of price>

## 5. Numbers as of today
| figure | value | source |
<price, multiple, and whatever the thesis rests on — each with a URL or a local file>
Local check: <agree / disagree, and which you used>

## 6. The case against
**Dominant risk (`financial|competitive|secular|accounting|regulatory`):** <ONE risk, one line.
 This is the line P3 answers. If P2 argued it away, that argument moves to P3 — Rule 2.>
**Earliest observable:** <the figure, its source, and when it next prints. If it is outside the
 filings, say where; if it is more than two quarters away or undated, P1 sizes at half — Rule 4.>
<Then the secondary arguments, written to persuade, not to dismiss.>
```

## Leo's filters, applied

Valuation is a **filter**, not an input (§2.4). Earnings quality means **margin level, its
consistency, growth, and the return on the capital behind it** — not the P/E alone, and not the
margin alone. ROIC, gross profit over assets and asset turnover are on the quote; use them. He is a CPA and reads annual reports; do not
hand-wave the accounts. His stated regret is 7532.T, *"blinded by the tourist rebound without
looking at the fundamentals, valuation, forward prospectus and yen depreciation carefully"* —
so answer, explicitly, **why this is not that mistake again.**

## Rules

- Write only `pot/proposals/…`. Touch nothing else.
- No figure without a source (§7.3), and **which source is settled by [`pot/sources.md`](sources.md)
  — read it.** Numbers this repo holds are quoted from the repo, company numbers from that
  company's filing or IR release, macro from the publishing agency, broker costs from the broker's
  own schedule. It also carries the list of aggregators and promotional sites never to cite.
- You are proposing, not deciding. Leo executes.

## Header your output with a provenance line

Write it exactly like this, placeholders and all — **do not try to fill it in**:

```
model: pending, lane: deep-dive, date: <today>, tokens: pending
```

`npm run pot-report` overwrites that line with the runtime's own figures: the exact model, wall
time, and total/fresh/cached/output tokens, read from the session log. You cannot see your own
token accounting, and guessing at the model produces a confident wrong answer — the last Sweep
headed its output "model: Codex (GPT-5) · tokens: unknown" where the runtime recorded
`gpt-5.6-sol` and 4,460,184 tokens. The line just has to exist and start with `model:`.
