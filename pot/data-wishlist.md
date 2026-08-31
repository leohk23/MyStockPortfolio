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

Appended by the Sweep. Date and subject lead the entry; everything else is a sentence.

```
- **2026-09-04 — China GDP, quarterly YoY.**
  Fetched from tradingeconomics.com. Wanted weekly. Drove the Hang Seng read, and had to be
  fetched by hand.
```

<!-- newest first -->

- **2026-08-31 — oil inventories and refined-product margins, second reach.**
  Fetched from the International Energy Agency's August Oil Market Report. Wanted monthly while
  Hormuz remains disrupted; stock depletion and product bottlenecks matter more than the crude
  headline alone and this is the second sweep to need the set.
- **2026-08-31 — China PMI by company size and new orders.**
  Fetched from the National Bureau of Statistics of China. Wanted monthly; the split between
  expanding large manufacturers and contracting smaller firms tests whether recovery is broad or
  concentrated.
- **2026-08-31 — aircraft leasing asset values, lease economics and airline credit.**
  Fetched from AerCap's results. Wanted quarterly while AerCap is tracked; aircraft scarcity can
  lift lessor returns while high fuel and rates simultaneously weaken the customers paying rent.
- **2026-08-31 — industrial pump orders, service mix and conversion.**
  Fetched from KSB's half-year results. Wanted on results dates while KSB is tracked; orders and
  recurring service revenue test whether energy and water investment can outrun weak industry.
- **2026-08-30 — US corporate profits, private domestic demand and PCE inflation.**
  Fetched from the Bureau of Economic Analysis. Wanted quarterly rather than weekly; the mix of
  slowing real GDP, strong private demand, high inflation and sharply higher profits changed the
  interpretation of elevated US yields from a simple growth scare to a pricing-power test.
- **2026-08-30 — derivatives volume by asset class and market-data revenue.**
  Fetched from CME Group's monthly volume release and quarterly results. Wanted monthly while CME
  is on the watchlist; it tests whether the exchange is gaining durable participation across
  products or merely enjoying a short volatility spike.
- **2026-08-30 — power-cable growth, capacity and segment margins.**
  Fetched from Prysmian and Nexans results, with Quanta Services' backlog used as a demand-side
  cross-check. Wanted on results dates rather than weekly; these measures distinguish a physical
  grid and data bottleneck from an AI-themed revenue label.
- **2026-08-30 — European industrial activity and business investment.**
  Fetched from Eurostat and the UK Office for National Statistics. Wanted monthly and quarterly,
  not weekly; it tested whether cable and grid demand sits on broad capital formation or only on
  a narrow group of projects.
- **2026-08-30 — China industrial profit mix, inventories and receivables.**
  Fetched from the National Bureau of Statistics of China. Wanted monthly; the sharp gap between
  electronics and non-ferrous profit growth and falling auto profit materially changed the BYD
  re-look and was not visible in the local macro file.
- **2026-08-30 — US consumer traffic and comparable sales by retail format.**
  Fetched from Ross Stores and Walmart results. Wanted on results dates rather than weekly; the
  contrast between traffic-led off-price growth and slower mass-market comps was more useful than
  a broad consumer-spending aggregate for candidate selection.
- **2026-08-30 — BYD cash conversion and supplier funding.**
  Fetched from BYD's interim filing: operating cash flow, trade payables and bills payable. Wanted
  on each filing date; these figures test the saved article's supplier-financing concern more
  directly than revenue or EPS alone.
- **2026-08-29 — US inflation, payroll revisions and the goods/services spending split.**
  Fetched from the Federal Reserve, Bureau of Labor Statistics and Bureau of Economic Analysis.
  Wanted monthly; this was the second sweep to need the labour and spending set, and the inflation
  context determined whether weak employment could safely be read as imminent rate relief.
- **2026-08-29 — China retail and catering demand.**
  Fetched from the National Bureau of Statistics of China. Wanted monthly; it distinguished
  Haidilao's company-specific self-help from a consumer recovery that has not yet arrived.
- **2026-08-29 — refined-product flows, refinery margins and product-tanker rates.**
  Fetched from the IEA Oil Market Report and Scorpio Tankers' results. Wanted monthly from the IEA
  while Hormuz remains disrupted and on company results dates for TCE rates and fleet changes.
- **2026-08-29 — off-universe price and valuation history, second reach.**
  Fetched provisionally from Yahoo Finance for Haidilao and PDD. Wanted only until candidates enter
  `watchlist.json`; CI should then replace the manual lookup with the repo's own data.
- **2026-08-29 — global electricity demand, grid investment and connection queues.**
  Fetched from the IEA Electricity 2026 report and its mid-year update. Wanted on each
  publication rather than weekly; it distinguished physical power demand from company promotion.
- **2026-08-29 — company order/backlog conversion, and GLP-1 realised pricing and volume.**
  Fetched from AMSC, OSI Systems and Novo Nordisk releases and filings. Wanted on results dates
  rather than weekly; price and trailing earnings alone could not test whether a backlog or a low
  multiple represented durable economics.
- **2026-08-29 — US payrolls, real earnings and real consumer spending.**
  Fetched from the Bureau of Labor Statistics and the Bureau of Economic Analysis. Wanted monthly,
  with the latest release carried into each weekly Sweep. Drove the value-retail read.
- **2026-08-29 — AI and power-infrastructure order intake and backlog.**
  Fetched from NVIDIA, R&S Group and Ameresco company releases. Wanted on results dates rather
  than weekly; company-specific backlog quality mattered more than a broad capex estimate.
- **2026-08-29 — specialty-insurance pricing cycle and underwriting margin.**
  Fetched from Lancashire and Beazley results, an imperfect substitute for a consistent market
  series. Wanted quarterly rather than weekly; it decided whether Lancashire’s low multiple was a
  bargain or peak-cycle earnings.
- **2026-08-29 — off-universe price and valuation history.**
  Fetched from FT Markets and Yahoo Finance. Wanted only until a candidate enters
  `watchlist.json`; the existing pipeline should then replace this manual lookup.
- **2026-09-04 — China GDP, quarterly YoY.**
  Fetched from tradingeconomics.com. Wanted weekly. Drove the Hang Seng read, and had to be
  fetched by hand.
