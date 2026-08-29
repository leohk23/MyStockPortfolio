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

## The multiple is not the thesis

**A proposal whose case is "it is cheap against its own history" is rejected.** That comparison is
the trigger that woke you — it is not a reason to own a business, and §2.4 says valuation is a
**filter**: a filter screens things out, it never argues you in.

So the floor comparison belongs in §5 with the other numbers, as a gate the name passed. The thesis
in §2 has to stand on the business: what it does, whether the earnings are any good (margin level,
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

- **Earnings quality** — margin level, the *consistency* of that margin, and growth (§2.4). Not the
  P/E alone. `earnings.json` carries filed `rev`, `opinc`, `nic` and `norm` per year.
- **Valuation as a filter, not an input** (§2.4) — a name he would like at the wrong price is a no.
- **A `oneOff` flag is the first thing to answer**, not a footnote. The multiple that triggered the
  signal may be inflated by an exceptional gain.

**Before researching any name, check it is locally covered (§7.2)** — in `prices.json` with real
`eps`, and `peBands` if it is an operating company. If not, say so and pick another: a fresh Sweep
candidate needs one CI pass, which takes under fifteen minutes. A proposal that cannot be
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

## Write the proposal — §8, all six, none optional

To `pot/proposals/<stamp>-<ticker>.md`, where `<stamp>` is **`YYYY-MM-DD-HHMM` in UTC** — Leo runs
this lane several times a day while testing, and a date alone makes the second run of a day
overwrite the first. Never reuse a filename that exists.

```
model: <model> · lane: deep-dive · date: <today> · tokens: <if known>

# <TICKER> — <company>

## 1. Order
BUY <ticker> on <exchange>, £<amount>, <market|limit @ price>. Currency <ccy>.
Expected first-year costs: <breakdown>, <x>% of the ticket.

## 2. Thesis
<Three sentences. Why this, why now, what the market is missing.
 About the BUSINESS. See "The multiple is not the thesis" below.>

## 3. Falsifier
<One specific observable that would prove this wrong. Not "the price falls".
 A number, a date, a disclosure. Something you could check and be told "no".>

## 4. Review date
<a date, regardless of price>

## 5. Numbers as of today
| figure | value | source |
<price, multiple, and whatever the thesis rests on — each with a URL or a local file>
Local check: <agree / disagree, and which you used>

## 6. The case against
<The strongest argument for NOT buying. Written to persuade, not to dismiss.>
```

## Leo's filters, applied

Valuation is a **filter**, not an input (§2.4). Earnings quality means **margin level, its
consistency, and growth** — not the P/E alone. He is a CPA and reads annual reports; do not
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
model: pending · lane: deep-dive · date: <today> · tokens: pending
```

`npm run pot-report` overwrites that line with the runtime's own figures: the exact model, wall
time, and total/fresh/cached/output tokens, read from the session log. You cannot see your own
token accounting, and guessing at the model produces a confident wrong answer — the last Sweep
headed its output "model: Codex (GPT-5) · tokens: unknown" where the runtime recorded
`gpt-5.6-sol` and 4,460,184 tokens. The line just has to exist and start with `model:`.
