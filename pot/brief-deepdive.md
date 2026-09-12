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

## What you need to read — and where to stop

A **ceiling, not a checklist**. Sufficient for this lane; go further only where a specific name
needs it, and say which name and why. Reading widely is not the same as ranking well, and every
file you open is resent on every turn that follows.

| File | Why this lane needs it |
|---|---|
| `strategy.md` | the rules. Authoritative on what may be bought, sizing and the gates |
| `pot/theses.md` | Rule 0 requires you to declare which bear on each name |
| the newest `pot/sweeps/*.md` | this cycle's candidates — the lane runs because it did |
| the newest `pot/reviews/*.md` | what was already judged, so you do not re-litigate it |
| `watchlist.json` | the full set you must account for — every name, ranked or excluded |
| `prices.json`, `earnings.json` | valuation and filed years for the names you rank |
| `pot/positions.json` | cash, holdings, and §4.5a's preference for a name not already held |
| `pot/adjustments.json` | one-offs this repo can cite, plus direct company-adjusted EPS by period |

**Filings are for the shortlist, not the list.** Accounting for all ~72 watchlist names (§D34) is a
screening job done from local data — an excluded line may be one clause. Opening a company's own
release is for names you are seriously ranking, because a filing pulled in at turn 5 is resent on
every turn after it.

`AGENTS.md` is already in your context before you start. Do not open it; reading it again pays for
the same bytes twice, and five tool calls did exactly that on 8 September.

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
not enough; the rules below make the check structural. Rule 0 runs before all of them.

**Rule 0 — declare the theses BEFORE naming the risk, and do it for every proposal.** P6 opens with
a `Theses:` line listing which entries in [`pot/theses.md`](theses.md) bear on this name and in one
clause why, or the single word `none` — never blank, never omitted. This runs first because the
earlier version of this rule did not: it bound the thesis check to the dominant risk, so the agent
chose the risk and the check then asked whether any thesis bore on the choice it had just made.
Tag `financial` and nothing bears. The 7 Sep cycles are the evidence — RELX sells LexisNexis and
Elsevier, seat-priced information tools to lawyers and scientists, and T2 names that category
exactly; both proposals tagged the dominant risk `financial` (buybacks and leverage) and neither
document mentions AI displacement anywhere. The thesis file was listed among the files read and
changed nothing. Declaring first makes `financial` a conclusion to defend against the theses on the
line above it, rather than a way of never meeting them. `none` is a legitimate and common answer —
MWA sells water infrastructure and no thesis here touches it — but it is now an answer, written
down, and not a silence.

**Rule 1 — P6 names ONE dominant risk, directly under the `Theses:` line, on its own line, with a category.** The categories
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

[`pot/theses.md`](theses.md) is the standing list of where to look — Leo's own views about how the
world is moving, kept in their own file because they change on a different clock from this brief.
Rule 0 has already forced you to declare which of them bear on this name. Any you declared is then
engaged **here**, with the external figure and cadence this rule asks for, not asserted away; Rule 2
applies to it exactly as to any other rebuttal. A thesis is never on its own a reason to reject a
name — it is a place the falsifier is likely to be, and a declared thesis that survives the search
is a stronger proposal than one that never named it.

**Rule 4 — an unfalsifiable or slow dominant risk sizes the position, mechanically.** If the
earliest observable for the dominant risk is more than two quarters away, or lives entirely
outside any dated source, the order is **half the allocation §4 would otherwise give**, and P1
says so and why. A proposal may argue for the full size against this rule, in P1, with the
argument written out — but the default is the smaller order, not the larger one with a caveat.
This replaces the earlier "say so and count it against the position", which the INTU proposal did
not invoke and nothing made it. An unfalsifiable main risk is a reason to size smaller or wait,
never a reason to test something easier and call it a falsifier.

**Rule 5 — cheapness a declared thesis would explain is not an opportunity until you argue the
discount is wrong.** §4 screens on how cheap a name is against its OWN history, and a live secular
thesis is one of the things that MAKES a name cheap against its own history. So the screen will keep
delivering, at the top of the ranking, the names a thesis is attacking — and their cheapness will
keep reading as opportunity when it is the market's price for the risk. Where Rule 0 made you
declare a thesis and Rule 2 forbids the thesis pre-answering the risk, this one binds the valuation:
if a name sits in the cheapest decile and a declared thesis bears on it, P2 must say **what the
market is discounting and why that is wrong**, with the de-rating quantified. "What the market may
be missing" is not an answer on its own. RELX is the worked example: 20.2x recurring at the **9.9th
percentile** of its own five-year range against a **34.1x median**, down 26% over a year — and its
P2 said *"the market appears to be pricing a sharp fade in that compounding; what it may be missing
is that the mix continues to shift toward higher-value analytics"*. It states that a fade is being
priced, never says what the market thinks is causing it, and asserts the rebuttal. The unnamed cause
is T2. This is Leo's own 7532.T test aimed at the thesis file: **is the cheap price the thesis,
priced?** A good answer makes the proposal stronger, not weaker; no answer makes the discount the
only real information in the document.

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
- **§4.5a — a top-up ranks behind a fresh name.** Ranking stays blind to what the pot holds; this
  binds only the ALLOCATION that follows it. Where the top-ranked name is already in
  `positions.json` and a fresh name of comparable merit also clears the rules, the cash goes to the
  fresh one. Adding to a holding until it reaches the §4.2 cap is not forbidden — it has to be
  argued in P1, naming the fresh candidates that cleared and why the held name beats all of them.
  A preference, not a veto, exactly as §3.3 treats overlap with Leo's own book. What it prevents is
  the pot arriving at a 50% single position because rank order chose for it.

After the first proposal, **keep going while cash remains and a candidate still clears the rules.**
If the second-best name does not clear, say so and leave the cash — §4.4 makes holding it a
position, and it is what the VIX standing order will need. What is not acceptable is stopping at
one because the brief only asked for one.

## Rank against Leo's rules, and show the ranking

**The ranking is its OWN file: `pot/proposals/<stamp>-ranking.md`, same stamp as the proposals it
belongs to.** Not a section inside each proposal. Two runs arrived at this without being told and
both were better for it: on 7 September each proposal repeated the same 22-row table, and with
every watchlist name now to be accounted for that duplication grows with the number of names times
the number of proposals. One ranking, linked from each proposal.

**It is the run's report, so write it as one and link FORWARD to the proposals it produced.** The
app lists these as `Run reports`, one per cycle, and they are the entry point a reader opens — the
individual proposals sit behind them. Open with what the run had to work with (cash, contributed
capital, the sweep and review it read), then the ranking, then what it decided and why. A reader
should be able to follow the whole cycle from this file alone and click through only for detail.

**Every ranked row opens with a verdict, and the verdict is one of three words.** Also arrived at
unprompted, also kept:

- **PROPOSE** — and the share count, where a proposal follows
- **WAIT** — it clears the rules but something dated is missing; say what and by when
- **EXCLUDE** — it does not clear a rule; say which one, in a clause

A ranking that is only an ordering makes the reader infer the decision from position, and position
is not a decision — the 8 September run ranked INTU second and bought nothing, which a reader
skimming ranks would have misread. The verdict says what the rank means.

**Account for every name in `watchlist.json`, not every name you happened to consider.** The list
is 70+ names; the 8 September run ranked 23 and said nothing about the other 47, so names Leo added
by hand and names the Sweep found were never judged and nobody could see that they had not been.
"Every name you considered" was the old wording and it let the set be chosen silently.

Two tiers, so completeness does not mean 70 paragraphs:

- **Ranked** — every name that clears §2.4's valuation filter gets a row with the reasoning below.
- **Excluded** — everything else in one compact **table**, `| ticker | reason |`, one row per name,
  where the reason may be as short as "31st percentile, not cheapest decile" or "no local earnings".
  Not a run-on paragraph of `TICKER — reason ·` items: at 70 names that reads as a wall, and Leo asked
  for a table on 12 Sep. A name with nothing to say still has to appear.

**Ranked + excluded must equal the watchlist count, and state that count.** If a name cannot be
assessed at all, that is an excluded line reading "no data", not an omission.

Use his own tests, not generic ones:

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

**§7.2a — an earnings base you cannot certify sizes the position; it does not veto it.** The
percentile is computed across ~200 weekly bars, so one hand-derived adjustment can never certify
it, and non-US names have no EDGAR to certify it from. If "unverified" meant "no order", the pot
would never buy anything and would look principled doing it. So: state which basis you are quoting
and how many years carry cited adjustments, give the multiple on each basis where they differ, and
take **half the allocation** where the uncertainty is material — the same mechanic as Rule 4.
Declining is still allowed, and often right, but it must be argued on the business rather than on
the data being incomplete. The 8 September run held all cash with seven of thirteen names blocked
on unreconciled earnings; that was judgement, not a rule, and this is the rule.

## Record every one-off and direct adjusted EPS — `pot/adjustments.json`

You keep deriving these by hand and throwing them away. LULU's $134.5m tariff refund was found by
reading the filing, used once, and re-derived from scratch the next run. Write it down instead.

**When you reconcile filed earnings against a company's own release and find income that will not
repeat, append it to [`pot/adjustments.json`](adjustments.json)** under the ticker:

```json
{ "fy": "2026-01-31", "amount": 134500000, "ccy": "USD",
  "what": "tariff refund and associated interest",
  "source": "https://www.sec.gov/Archives/edgar/data/1397187/.../lulu-20260802xex991.htm",
  "found": "2026-09-08" }
```

- `fy` is the fiscal year END exactly as it appears in `earnings.json`, or the row will never match.
- `amount` is positive for income to REMOVE, in the filing's own currency. It may drive arithmetic
  only when the source states the **after-tax amount attributable to common shareholders**; record
  that as `"basis": "after-tax attributable"`. Otherwise add `"arithmetic": false` and keep it as
  evidence.
- **`amountPerShare` is accepted instead**, because that is how releases usually word it — MWA's
  was *"a one-time tax benefit of $0.06 per share"*. `fetch-prices.js` converts it using implied
  shares from the filer's own `ni / eps`, so you do not have to. Use whichever form the source
  states; do not convert by hand and do not skip the entry because the units did not match.
- `source` is mandatory and must be the company's or the regulator's own document. This store is
  agent-written, which is what A20 normally forbids — the citation is what makes it admissible, so
  an entry without one is worse than no entry.
- Never edit or delete an existing entry to make a name look better. Append a correcting entry and
  say so in `what`.

**Prefer direct adjusted EPS when the company publishes it.** Add the annual and quarterly figures
under `normalizedEps.<ticker>`, each with its period end and official source. Four consecutive
quarters produce `prices.json researchEps`; quote that field rather than repeating arithmetic in
prose. Tradeweb is the worked example: $0.87 + $0.87 + $1.08 + $0.97 = $3.79, or 26.8× at $101.44.
The label must name the issuer's basis — **company-adjusted**, not GAAP and not independently
reconstructed owner earnings.

An absolute one-off may drive arithmetic only when it is on the same basis as the income it is
subtracted from. The pipeline enforces this: an `amount` needs `"basis": "after-tax attributable"`.
A pre-tax consolidated gain cannot be subtracted dollar-for-dollar from after-tax income
attributable to common shareholders. Retain such evidence with `"arithmetic": false`; do not turn
it into `normEpsOwn`, `peLowOwn` or a percentile.

**A current adjusted P/E does not create an adjusted history.** A research low or percentile needs
enough consecutive adjusted quarters to replay the rolling denominator over the whole window.
Until that exists, quote the current `researchEps` multiple and label reported/Yahoo historical
figures as references. Never attach their percentile to the research denominator.

## Size — §4

- **No minimum** position, but refuse the ticket if its **first-year costs exceed 2%** of it.
  State the costs you expect: commission, FX spread, stamp duty, ADR custody if OTC.
- **§4.1a — broker fees under 0.5% of the ticket, taxes excluded and stated separately.** Commission
  plus FX spread only. **Transaction taxes are not fees**: UK stamp duty is 0.5% on every purchase,
  identical at every broker, so counting it would make every UK share permanently unbuyable — and
  REL.L, BNZL.L, IMI.L, LRE.L, SPX.L, BME.L and CHRT.L are all on the watchlist. State the tax as
  its own line in P1 and add it to the §4.1 first-year total, never to this gate.
  This sits **beside** §4.1's 2%, which is a different question: §4.1 is total FIRST-YEAR cost
  including recurring custody and dividend fees — Leo's own worry was *"custody fee is a fixed
  amount and eating its dividends"* on a small OTC holding. A ticket must clear both.

- **§4.2b — a fee-charging venue may push an order past the 50% cap; a free one may not.** On T212
  the cost is 0.15% at any size, so nothing about fees argues for a bigger ticket and **§4.2's 50%
  binds strictly**. On a venue with a per-order minimum the arithmetic reverses: $1 is 1.21% of £62
  and 0.4% of £250, so a small ticket is not prudence, it is waste. Where a name can only be traded
  on a fee-charging venue and no ticket inside the 50% cap clears §4.1a, the order **may exceed
  50%**, and P1 must say by how much, what the concentration becomes, and how many contributions
  bring it back under. Order of preference, always: a cheaper venue first, then a bigger ticket,
  then defer — never a bigger ticket because it is easier than looking for the cheaper venue.

- **When a listing is unbuyable, check the company's other listings before rejecting it.** Board
  lots and per-order minimums are properties of the VENUE, not of the business. `1211.HK` trades in
  **500-share board lots**: at £7.90 a share that is a **£3,948** minimum order, eight times the
  whole pot — while `BYDDY`, the same company's ADR, trades in single shares at £7.87. Rejecting BYD
  for being unaffordable would have been a fact about Hong Kong's lot rules, not about BYD.
  `prices.json` already carries the mapping: a quote's `primary` field names the listing it follows,
  so **BYDDY → 1211.HK**, and ten such pairs exist today. Scan the quotes for any whose `primary`
  is the name you are stuck on. If an alternative exists, cost both and say which you chose and why;
  a receipt is not identical to the share — different currency, an ADR fee, and less liquidity — so
  the choice is an argument, not an automatic swap.
  **Lot sizes are not in `prices.json`.** Where one might bind, source it and cite it; if you cannot,
  say so and log it to [`pot/data-wishlist.md`](data-wishlist.md) rather than assuming single shares.
- **The broker follows the venue, and you must say which one you costed (§10, 8 Sep 2026).**
  **Trading 212 wherever it lists the name** — £0 commission, FX charged at **0.15%**, so a ticket
  costs 0.15% at any size. **IBKR for anything T212 cannot trade**, which is Hong Kong, Japan and
  most non-US lines: `1211.HK` is the worked example Leo gave. The choice is availability, not
  preference — on pot-sized tickets T212 is far cheaper and the crossover is about **£617**, which
  the pot will not reach for years:

  | ticket | T212 (0% + 0.15% FX) | IBKR ($1 + 0.03% FX) |
  |---:|---:|---:|
  | £62.50 | 0.15% | 1.21% |
  | £125 | 0.15% | 0.62% |
  | £617 | 0.15% | 0.15% |

  So **never quote $1 on a name T212 lists** — that was an inference from one remark of Leo's about
  a draft order, and it overstated a US ticket's cost by 8x. Equally, never quote 0.15% on a Hong
  Kong or Japanese line: T212 cannot trade it, so the T212 rate does not apply to it at all.

- **IBKR's non-US charges are NOT known to this repo — source them, do not assume.** The US figures
  above came from Leo; the HK/Japan/Europe schedules did not. IBKR charges a percentage with a
  **minimum per order**, and a minimum is what kills a small ticket. Find the current schedule for
  the actual venue, cite it, and if you cannot, say so in P1 and treat the cost as unknown rather
  than inventing one. Adding it to [`pot/data-wishlist.md`](data-wishlist.md) is the right move.

- **Expect non-US names to fail §4.1 at the pot's current size, and check rather than assume.** A
  per-order minimum of even £1.75 is **2.8%** of a £62.50 half-allocation and 1.4% of a full £125 —
  either side of the 2% ceiling. So a half-sized order under §7.2a can fail the cost gate on a venue
  where a full-sized one passes, which is the one case where **sizing down makes a name unbuyable**.
  Say so in P1 when it happens: the honest answer may be a full-sized order or none, not a half.
- **A flat fee makes share count a real decision, so show the drag and say whether more shares fix
  it.** Fee ÷ ticket falls as the order grows: $1 on 7 MWA shares at $24 is 0.6%, on 10 it is 0.42%,
  on 20 it is 0.21%. P1 states the fee as a **% of the ticket at the proposed size**, and where idle
  cash could buy another whole share or two, says what that would do to the percentage and whether
  it is worth it. **This is a consideration, not a gate.** Leo's words: *"for 7 shares it's
  acceptable to me but I don't want to create a hard rule here especially the pot is so small."*
  Nothing here overrides §4.2, §4.2a or the 2% ceiling, and a good name is never dropped for costing
  0.6% instead of 0.4%. What is forbidden is leaving the number unstated, or reporting one that
  assumes a broker Leo may not be using.
- Maximum **50%** of the pot.
- The pot's cash is in `pot/positions.json`. **If it is £0, size against the next £250 contribution
  and say the order is pending funding.** Do not invent a balance.

## Write the proposal — the §8 contract, P1 to P6, none optional

To `pot/proposals/<stamp>-<ticker>.md`, where `<stamp>` is **`YYYY-MM-DD-HHMM` in UTC** — Leo runs
this lane several times a day while testing, and a date alone makes the second run of a day
overwrite the first. Never reuse a filename that exists.

The ranking goes beside them as `<stamp>-ranking.md` with the SAME stamp, and each proposal links
to it rather than repeating the table. A run that proposes nothing still writes both: the ranking,
and a `<stamp>-none.md` saying why cash won. `Lane-Due` reads this directory to decide whether the
lane has run today, so a run that writes nothing here looks like a run that never happened.

```
model: <model>, lane: deep-dive, date: <today>, tokens: <if known>

# <TICKER> — <company>

**What it does:** <Two or three sentences of ordinary course of business, in plain English: what it
 sells, to whom, and how it earns. No thesis, no adjectives, no valuation — a reader who has never
 heard of the company should be able to say what it is. Leo buys what he is familiar enough with
 (§2), and this is what he judges that on; it also forces the business to be described before it is
 argued about, which is where a category-level risk becomes hard to skip.>

## 1. Order
BUY <n> share(s) of <ticker> on <exchange>, £<deployed> of £<allocation>, <market|limit @ price>.
Currency <ccy>. Cash left idle: £<remainder>.
Expected first-year costs: <breakdown, naming the broker assumed and the flat commission>, <x>% of
 the ticket. <If a flat fee applies and idle cash could buy another whole share, what that does to
 the percentage — a consideration, never a gate.>
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
**Adjustments:** <the entry you appended to pot/adjustments.json for any one-off or direct adjusted
 EPS you reconciled — ticker, period and amount/amountPerShare/EPS — or one clause saying why none was writable
 ("not separately quantified in the release"). Never blank, never omitted. If you adjusted the
 earnings you valued on, the adjustment is recordable; if it is not recordable, say why you trusted
 it enough to size on.>

## 6. The case against
**Theses:** <which entries in pot/theses.md bear on this name, each with one clause saying why —
 or the single word `none`. Never blank, never omitted — Rule 0.>
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

- Write `pot/proposals/…`, and append to `pot/adjustments.json` and `pot/data-wishlist.md` where
  the rules above require it. Touch nothing else.
  This line used to read "Write only `pot/proposals/…`", which flatly contradicted the adjustments
  rule and the forced P5 `Adjustments` line. On 11 Sep a Claude deep dive obeyed it literally and
  said so — *"brief restricts writes to `pot/proposals/`"* — which is likely why the store sat
  empty all week under Codex too. When two rules conflict the stricter one wins silently; a
  rule that another rule depends on must not be contradicted further down the page.
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
