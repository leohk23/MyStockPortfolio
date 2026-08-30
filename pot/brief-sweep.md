# Sweep — find candidates, not orders

The discovery lane. Weekly. You read the world; the machine already read the book.

**You may not produce an order.** Your entire output is *candidates* — names worth watching, each
with one line saying why. A candidate goes on the watchlist, gets its real fundamentals fetched
independently within the hour, and only later — if it ever becomes cheap or something breaks —
does a Deep dive turn it into an instruction. Getting a candidate wrong costs a cluttered
watchlist. That is the point of this lane.

---

## The Scan does not set your scope

**Start from the world, not from our data.** The Scan is a different lane answering a different
question over a closed universe: *has anything among the ~80 names we already track moved?* Yours
is: *what exists that we do not know about?* Neither scope may bound the other.

This brief used to get that backwards. It opened with "read `signals.json` first", handed over 17
macro series with "**do not look any of it up**", and asked which of those series drove each
candidate. The result did exactly as told — it reported that "WTI did not produce a candidate" and
"rates did not drive a bank candidate", as though our seventeen series were the available world.
A discovery lane whose horizon is the thing it is meant to look past is not discovering.

So:

- **Our data is a fact-check, never a starting point.** Cite a figure and it will be checked
  against `prices.json` / `earnings.json` where they overlap. That is a guard on accuracy, not a
  limit on subject.
- **The macro block is 17 series we happen to hold**, no more. If the thing that matters this week
  is Chinese GDP, container rates, semiconductor lead times, a policy change, a court ruling or a
  drought — go and look. Use the local numbers where they exist so you do not waste the session
  re-fetching what we have, and go past them freely where they do not.
- **A candidate does not have to trace to anything we track.** It has to be a good idea.

---

## Read when useful — not in this order, and not first

| File | What it gives you |
|---|---|
| `strategy.md` | the rules. **Authoritative** — what may be bought and on what basis |
| `pot/reading.md` | articles Leo kept, each with why it caught him |
| `watchlist.json`, `holdings.json` | the ~80 names already covered — do not re-propose these as new |
| `prices.json` (`macro`), `signals.json` | levels and moves we already hold, for checking figures |
| `pot/positions.json` | what the pot holds and its cash |

## Produce

**1. Where the world is.** Two or three paragraphs on what actually matters right now — whatever
that is. Use our macro block where it is relevant and say where you went beyond it. Keep the
observation and the inference visibly apart: *what is true*, then *what you take from it*.

**2. Leo's reading.** Two places, and read both:

- `pot/reading.md` — the list, each entry with a **`Why:`** line saying what caught his eye.
- `pot/reading/*.md` — full text he saved. **Read these even when they are not listed**, and say so
  where an entry is missing. A file dropped in that folder and never listed used to be invisible to
  this lane, which is the wrong way round: saving the whole article is *more* effort than listing
  it, so it cannot be the thing that gets ignored.
- [`pot/sources.md`](sources.md) lists **voices worth seeking out** — people whose thinking Leo
  rates. Go and look for them. Most are paywalled, so what you will actually find is whatever he
  saved into `pot/reading/`; treat those pieces as strong leads, and still verify every number
  against the filing.

**The reading list is slow-moving, and this section should be too.** Leo adds an article every few
weeks, not every day. A sweep that re-argues the same three essays every morning is spending his
attention on something that has not changed — the 30 August sweep gave 56 of its 160 lines to
readings and reported nothing new about any of them.

So each entry carries a **`Kind:`** line, and the two kinds are handled differently.

- **`Kind: method`** — about how to invest: position sizing, holding period, when to sell,
  convexity. **Write nothing about it.** Absorb it, let it inform how you weigh candidates, and
  move on. It bears on `strategy.md`, never on the watchlist, and pricing the tickers an essay
  happens to mention teaches nobody anything. The single exception: if it argues against a rule
  Leo has actually written down, say that once, in one paragraph — then check the previous sweep
  and do not say it again if you already have.
- **`Kind: idea`** — names instruments, or an argument that implies some. Give it a short
  paragraph: what the price has done *since* publication, and whether the argument still holds or
  is now priced. One paragraph, not a section per name.

An entry with no `Kind:` line is an **idea**. Leo writes these by hand and the tag is optional.

**Stop repeating yourself.** Before writing this section, read the previous sweep in
`pot/sweeps/`. If your paragraph would say substantially what you said last time, replace it with
one line — "unchanged since [date]" — and spend the space on section 3 instead. The whole section
should run to a dozen lines on a quiet week.

Forcing a ticker out of an essay about compounding is how this lane goes wrong.

**3. Candidates.** Up to five. Ticker, exchange, one line on why, one line on what would have to be
true. Anything already in the 80 is a *re-look*, label it so.

**4. What you wanted and did not have.** The feedback loop, and the reason this section exists:
anything you had to go and fetch, estimate, or work around because we do not carry it. Name the
series, the source you used, and whether you would want it every week.

That list is how the free lane grows. If three sweeps in a row reach for Chinese GDP, that is the
case for a data feed — and once it is fetched, checking it costs nothing forever. Say so even when
you found the number easily; the point is not whether you could get it, but whether we should hold
it. Append to [data-wishlist.md](data-wishlist.md).

## Sources: unconstrained on the way in, recorded on the way out

**No whitelist.** Confining you to approved sources would recreate, one level up, exactly the
closed-universe problem this section exists to fix. Read anything.

What is required is the record: **list what you actually consulted**, so that recurring sources
become visible over time and Leo can say "always check that one" or "stop using this". The
structure belongs on the output, not the input.

Weight primary sources — filings, company releases, statistical agencies — above commentary about
them, and say when something is one person's opinion rather than a reported fact.

## What to bias towards, and against

Do **not** produce a list of what is being written about most. That correlates almost perfectly
with what is already priced in, and it is the failure mode of this lane. Prefer:

- stories that were loud and **have gone quiet** — the news broke, the price has not resolved
- **second-order effects** of a shift, which are slow and under-covered
- **what changed in the world of what Leo already owns** — highest value, needs no discovery

Leo's own words, from `strategy.md` §2: he buys what he is *familiar enough with*, from first-hand
observation (M&S from shopping there, NVDA from using ChatGPT), reads annual reports, is a CPA,
distrusts technical analysis, and treats valuation as a **filter**. His stated regret is 7532.T —
*"blinded by the tourist rebound without looking at the fundamentals, valuation, forward prospectus
and yen depreciation carefully."* Ask of every candidate: **is this the 7532.T mistake again?**

## Rules

- **No figure without a source.** A URL, or a file in this repo. §7.3 — if you cannot source it,
  do not write it.
- **Which source is settled by [`pot/sources.md`](sources.md) — read it.** In short: anything this
  repo already holds (price, EPS, P/E, percentile, FX) is quoted from the repo, company numbers
  come from the company's own filing or IR release, macro from the agency that publishes it, and
  the press is for narrative and for finding names — never as the sole source of a figure. It also
  carries the short list of aggregators and promotional sites never to cite. There is no
  approved-domain list, and that is deliberate: finding a name anywhere is fine, citing anything
  but the best available source is not.
- Anything you claim that overlaps local data will be checked against it. Say where they differ
  rather than picking the flattering one.
- Write to `pot/sweeps/YYYY-MM-DD-HHMM.md`, the time in **UTC** — Leo runs this lane several times
  a day while testing, and a date alone makes the second run overwrite the first. Never reuse a
  filename that exists. Append any data gaps to `pot/data-wishlist.md`; and if you
  have candidates, add them to `watchlist.json` (`{"yahoo": "...", "name": "...",
  "geography": "..."}`), keeping the file valid JSON.
- Touch nothing else.

## Header your output with a provenance line

Write it exactly like this, placeholders and all — **do not try to fill it in**:

```
model: pending, lane: sweep, date: <today>, tokens: pending
```

`npm run pot-report` overwrites that line with the runtime's own figures: the exact model, wall
time, and total/fresh/cached/output tokens, read from the session log. You cannot see your own
token accounting, and guessing at the model produces a confident wrong answer — the last Sweep
headed its output "model: Codex (GPT-5) · tokens: unknown" where the runtime recorded
`gpt-5.6-sol` and 4,460,184 tokens. The line just has to exist and start with `model:`.
