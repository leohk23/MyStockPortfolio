# Where a figure may come from

Read by both lanes. One file rather than a copy in each brief, because two copies drift.

The rule is about **what kind of claim you are making**, not about which websites are nice. There
is deliberately **no approved-domain list**: the Sweep exists to find things the Scan cannot see,
and deciding in advance where an idea may come from is the same narrowing the Scan/Sweep
separation was built to prevent (D15, A14–A16). AMSC, OSIS and Novo Nordisk all arrived from
company IR pages that no sensible pre-approved list would have contained.

## The hierarchy — best available source wins, every time

1. **A number this repo already holds comes from this repo.** Price, EPS, P/E, the five-year
   percentile and its floor, FX, drawdown, dividend yield, ATH distance: `prices.json`,
   `signals.json`, `earnings.json`, `holdings.json`, `history.json`. Never cite an outside site
   for one of these. If the name is off-universe and we simply do not carry it yet, say the figure
   is **provisional**, and add the ticker to `watchlist.json` so the next run has it properly.

2. **A number about a company comes from that company.** Its filing or its IR release —
   SEC/EDGAR, HKEXnews, an RNS, the annual report PDF, the results announcement. Revenue, margin,
   backlog, book-to-bill, net debt, guidance, share count: all of it exists at the source, and the
   source is free.

3. **A macro number comes from the agency that publishes it.** BLS, BEA, ONS, Eurostat, IEA, IMF,
   OECD, a central bank. Not a news story *about* the release.

4. **A cost or tax figure comes from the broker or the tax authority.** IBKR's and Trading 212's
   own schedules, HMRC.

5. **Secondary press is for narrative and for finding candidates — never as the sole source of a
   figure.** Reuters, the FT, Bloomberg, the trade press: excellent for what is going on and why,
   and a perfectly good way to notice a company exists. Once you want to state a *number* from
   one, go and get it from 2, 3 or 4 instead.

## Never cite these

Not because everything on them is false, but because everything on them is **downstream** — the
number is always available upstream, so citing one of these is never the best available answer,
and several of them are paid promotion or SEO output wearing the clothes of research.

MarketBeat · Zacks · Benzinga · The Motley Fool (fool.com, fool.co.uk) · Simply Wall St ·
InvestorPlace · Seeking Alpha contributor posts · TipRanks · GuruFocus · Insider Monkey ·
24/7 Wall St · WallStreetZen · Stocktwits · InvestorsObserver · stockanalysis.com ·
financecharts.com · Fox Business quote pages · Nasdaq.com syndicated articles · any
"top N stocks to buy" listicle · any newsletter or blog whose author is not identified.

**Finding is not citing.** If one of these puts a name in front of you, that is fine — take the
name, then verify every figure against the hierarchy above and cite what you verified against.
The name is a lead; only the filing is evidence.

## When the hierarchy cannot be satisfied

Say so plainly and move on — that is §7.3, and a "–" is worth more than a number nobody can
check. Then append the gap to `pot/data-wishlist.md`: a source you keep reaching for and cannot
reach cleanly is the argument for building a feed, which is how this list is supposed to get
shorter over time.

The 29 August runs are the worked example. Of 155 citations, 149 were filings, IR releases,
statistical agencies, broker schedules or HMRC. The other 6 were price aggregators — and every
one of the 6 was cited for a **price or market cap**, the one class of number rule 1 already
covers.
