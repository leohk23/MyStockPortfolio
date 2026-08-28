# Deep dive — produce one executable instruction

The only lane permitted to produce an order. One name, researched properly, written so it can be
placed without further thought and audited in two years.

## Pick

From `signals.json`, take the **strongest candidate that is not flagged `oneOff`**. A one-off flag
means the multiple that triggered the signal is inflated by an exceptional gain — you may still
choose it, but then the flag is the first thing your thesis has to answer.

State in one line why this name and not the others that fired.

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
