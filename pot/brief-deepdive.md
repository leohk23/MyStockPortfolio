# Deep dive — produce one executable instruction

The only lane permitted to produce an order. One name, researched properly, written so it can be
placed without further thought and audited in two years.

## The name is given to you

**Leo names the ticker.** It arrives in the instruction — "Follow pot/brief-deepdive.md for
CHRT.L". You do not choose it, and you do not substitute a different one because you like it
better; if you think the pick is wrong, research it anyway and say so in §6.

This is deliberate. An earlier version of this brief told the agent to pick the strongest unflagged
signal itself, and it dutifully produced a proposal for GME — a name that had never appeared in
that week's Sweep, because the brief pointed at `signals.json` and nothing pointed at the Sweep.
The lanes were not connected. Selection is judgement, judgement is Leo's, and this is where it goes.

**Before anything else, check the name is locally covered (§7.2).** It must be in `prices.json`
with fundamentals — real `eps`, and `peBands` if it is an operating company. If it is not, stop and
say so: a fresh Sweep candidate needs one CI pass to be fetched, which takes under fifteen minutes.
A proposal that cannot be fact-checked against independent data is void, and writing one anyway is
worse than writing none.

Useful context, not instructions: `pot/sweeps/` holds the latest candidates and why they were
raised; `signals.json` holds what the free scan fired on and whether it flagged a `oneOff` risk on
this name. If it did, the flag is the first thing your thesis has to answer — the multiple that
looked cheap may be inflated by an exceptional gain.

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

To `pot/proposals/YYYY-MM-DD-<ticker>.md`:

```
model: <model> · lane: deep-dive · date: <today> · tokens: <if known>

# <TICKER> — <company>

## 1. Order
BUY <ticker> on <exchange>, £<amount>, <market|limit @ price>. Currency <ccy>.
Expected first-year costs: <breakdown>, <x>% of the ticket.

## 2. Thesis
<Three sentences. Why this, why now, what the market is missing.>

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
- No figure without a source (§7.3).
- You are proposing, not deciding. Leo executes.
