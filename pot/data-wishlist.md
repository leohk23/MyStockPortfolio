# Data wishlist — what the Sweep reached for and we did not have

The feedback loop, written down. The Sweep looks at the open world; the Scan only sees what CI
fetches. Every time the Sweep has to go and get something, that is evidence about what the Scan is
missing — and once a series is fetched, checking it costs nothing forever.

**The causation runs this way and only this way.** The Sweep's scope is never set by what the Scan
holds; what the Scan holds is set, over time, by what the Sweep keeps reaching for. Anything else
makes the discovery lane a mirror of the closed one.

## How an entry earns a feed

One mention is a curiosity. **Three sweeps reaching for the same series is a case to build it** —
by then it is a recurring input, not a one-off. Roughly, a candidate feed wants to be:

- **repeatedly wanted** — it keeps coming up, across different weeks and different candidates
- **free to fetch** — the macro block cost one request each on an endpoint already in use; a
  paid or scraped source is a different decision
- **actually decisive** — it changed what the Sweep concluded, rather than decorating it

## Entries

Appended by the Sweep. Format:

```
- 2026-09-04 · China GDP, quarterly YoY · used tradingeconomics.com
  Wanted weekly. Drove the Hang Seng read; had to be fetched by hand.
```

<!-- newest first -->

- 2026-08-29 · US payrolls, real earnings and real consumer spending · used the US Bureau of
  Labor Statistics and Bureau of Economic Analysis. Wanted monthly, with the latest release carried
  into each weekly Sweep. Drove the value-retail read.
- 2026-08-29 · AI and power-infrastructure order intake/backlog · used NVIDIA, R&S Group and
  Ameresco company releases. Wanted on results dates, not weekly; company-specific backlog quality
  mattered more than a broad capex estimate.
- 2026-08-29 · specialty-insurance pricing cycle and underwriting margin · used Lancashire and
  Beazley results as an imperfect substitute for a consistent market series. Wanted quarterly, not
  weekly; it determined whether Lancashire's low multiple was a bargain or peak-cycle earnings.
- 2026-08-29 · off-universe price and valuation history · used FT Markets and Yahoo Finance.
  Wanted only until a candidate enters `watchlist.json`; the existing pipeline should then replace
  this manual lookup.

## Already built from this loop

For the record, the pattern working before the file existed:

- **17 macro series** (indices, US 5y/10y, five currency pairs, gold, crude, copper, bitcoin) — the
  first Sweep quoted VIX and the S&P from `signals.json` and had nothing else, so they were added
  to `fetch-prices.js` and now come free on every CI run.
- **`macroNotes()`** — the second Sweep's macro reasoning turned out to be four repeatable
  relations (a commodity net of the dollar, a foreign index net of its currency, a long move
  contradicted by a short one, mixed-across-windows). All four are now computed deterministically,
  so the Sweep is handed the inference rather than re-deriving it.
