# Sweep — find candidates, not orders

The discovery lane. Weekly. You read the world; the machine already read the book.

**You may not produce an order.** Your entire output is *candidates* — names worth watching, each
with one line saying why. A candidate goes on the watchlist, gets its real fundamentals fetched
independently within the hour, and only later — if it ever becomes cheap or something breaks —
does a Deep dive turn it into an instruction. Getting a candidate wrong costs a cluttered
watchlist. That is the point of this lane.

## Read first

| File | What it gives you |
|---|---|
| `strategy.md` | the rules. **Authoritative.** The "Rules at a glance" table is the summary |
| `signals.json` | what the free scan fired on, and what it did not |
| `pot/reading.md` | articles Leo chose to keep, each with why it caught him |
| `pot/positions.json` | what the pot holds and its cash |
| `watchlist.json`, `holdings.json` | the ~80 names already covered — do not re-propose these as new |

## Then

1. **Macro state.** `signals.json` carries VIX and the S&P's move. Say in two sentences what the
   current regime looks like. State, then interpretation — do not fetch what you were handed.
2. **Leo's reading.** For each entry in `pot/reading.md` not yet actioned: what has the price done
   *since* the article? Say if the argument no longer holds, or is already in the price.
3. **Candidates.** Up to **five**. For each: ticker, exchange, one line on why, and one line on
   what would have to be true. Anything already in the 80 is a *re-look*, not a candidate — label
   it so.

## What to bias towards, and against

Do **not** produce a list of what is being written about most. That correlates almost perfectly
with what is already priced in, and it is the failure mode of this lane. Prefer:

- stories that were loud and **have gone quiet** — the news broke, the price has not resolved
- **second-order effects** of a macro shift, which are slow and under-covered
- **what changed in the world of what Leo already owns** — highest value, needs no discovery

Leo's own words, from `strategy.md` §2: he buys what he is *familiar enough with*, from first-hand
observation (M&S from shopping there, NVDA from using ChatGPT), reads annual reports, is a CPA,
distrusts technical analysis, and treats valuation as a **filter**. His stated regret is 7532.T —
*"blinded by the tourist rebound without looking at the fundamentals, valuation, forward prospectus
and yen depreciation carefully."* Ask of every candidate: **is this the 7532.T mistake again?**

## Rules

- **No figure without a source.** A URL, or a file in this repo. §7.3 — if you cannot source it,
  do not write it.
- Anything you claim that overlaps local data will be checked against it. Say so where they differ
  rather than picking the flattering one.
- Write to `pot/sweeps/YYYY-MM-DD.md` and, if you have candidates, append them to `watchlist.json`
  (`{"yahoo": "...", "name": "...", "geography": "..."}`) — keeping the file valid JSON.
- Touch nothing else.

## Header your output with provenance (§9.2)

```
model: <the model you are> · lane: sweep · date: <today> · tokens: <if known>
```
