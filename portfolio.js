// Pure aggregation shared by index.html (via <script src>) and `node portfolio.js --selftest`.
// No DOM, no fetch — so the maths can be tested without a browser.

// Yahoo quotes London in pence ("GBp"); the workbook calls the same thing "Gbpence".
function rateFor(code, rates) {
    return (code === 'GBp' || code === 'Gbpence') ? rates.GBP / 100 : rates[code];
}

// A group's period move is its instruments' moves weighted by market value, so BYD
// reports one number rather than separate HK-line and ADR numbers. Instruments with
// no data for the period are left out of both sides of the ratio.
function weightedMove(legs, period) {
    let num = 0, den = 0;
    for (const leg of legs) {
        const move = leg.quote[period];
        if (move == null) continue;
        num += leg.value * move;
        den += leg.value;
    }
    return den ? num / den : null;
}

const PERIODS = ['1d', '7d', '1m', '3m', '6m', '1y', 'ytd'];

// How to bucket holdings into rows. 'company' is Grouping1 from the workbook
// (VOO + VUSA.L -> "S&P 500"); 'geography' its region; 'instrument' one row each.
const DIMENSIONS = { company: 'group', geography: 'geography', instrument: 'yahoo' };

// Replays the workbook's split-adjusted balance quantity and average cost on each
// price day. Values and costs are in USD using today's FX, matching the rest of the app.
function gainHistory(days, closes, trades, rates, quoteCurrency) {
    const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    const quoteRate = rateFor(quoteCurrency, rates);
    const gains = [], costs = [], quantities = [];
    let ti = 0, state = null;
    for (let i = 0; i < days.length; i++) {
        while (ti < ordered.length && ordered[ti].date <= days[i]) state = ordered[ti++];
        if (!state || closes[i] == null) {
            gains.push(null); costs.push(null); quantities.push(0);
            continue;
        }
        const qty = state.balanceQty;
        const cost = qty * state.avgPrice * rateFor(state.currency, rates);
        gains.push(qty * closes[i] * quoteRate - cost);
        costs.push(cost);
        quantities.push(qty);
    }
    return { gains, costs, quantities };
}


// Signed share change (+buy / -sell) and its external cash flow in USD (today's FX).
function tradeFlow(t, rates) {
    const dq = (t.side === 'SELL' ? -1 : 1) * t.qty;
    return { dq, cash: dq * t.price * rateFor(t.currency, rates) };
}

// Daily market value and daily external cash flow (both USD, today's FX) for a set of
// holdings, optionally restricted to a subset of each holding's trades. Trades on/before
// the first day fold into the opening balance — their cash is a starting value, not an
// in-window flow. Days where no holding has a close are null so twr() can gap them.
// holdings items need { yahoo, trades, quoteCurrency }; closesBySym maps yahoo -> closes[].
function cohortMV(days, holdings, closesBySym, rates, tradeFilter) {
    const mv = new Array(days.length).fill(0);
    const flow = new Array(days.length).fill(0);
    const priced = new Array(days.length).fill(false);
    for (const h of holdings) {
        const closes = closesBySym[h.yahoo];
        if (!closes) continue;
        // Hold price flat across data gaps so a holding doesn't blink in/out of the basket:
        // a ragged first day (some tickers list a day later) would otherwise read as a return.
        // Leading gaps use the first known close (seed); interior gaps carry the last known.
        const seed = closes.find(v => v != null);
        if (seed == null) continue;
        const qc = rateFor(h.quoteCurrency, rates);
        const trades = (tradeFilter ? h.trades.filter(tradeFilter) : h.trades)
            .slice().sort((a, b) => a.date.localeCompare(b.date));
        let ti = 0, qty = 0, lastClose = null;
        for (let i = 0; i < days.length; i++) {
            while (ti < trades.length && trades[ti].date <= days[i]) {
                const { dq, cash } = tradeFlow(trades[ti], rates);
                qty += dq;
                if (i > 0) flow[i] += cash; // day-0 (and earlier) trades are opening balance
                ti++;
            }
            if (closes[i] != null) lastClose = closes[i];
            mv[i] += qty * (lastClose != null ? lastClose : seed) * qc;
            priced[i] = true;
        }
    }
    for (let i = 0; i < days.length; i++) if (!priced[i]) mv[i] = null;
    return { mv, flow };
}

// Cumulative time-weighted return from a daily market-value series (nulls = no data) and
// daily external cash flows. Removing the flow from each day's change strips out the
// effect of investing/withdrawing money, leaving pure investment performance. Fractional
// (0.1 = +10%); 0 on the first valid day, chained after, carried across gaps.
function twr(mv, flow) {
    const out = new Array(mv.length).fill(null);
    let cum = 1, prev = null;
    for (let i = 0; i < mv.length; i++) {
        const v = mv[i];
        if (v == null) { prev = null; continue; }        // gap: break the daily linkage
        if (prev != null && prev > 0) cum *= 1 + (v - prev - (flow[i] || 0)) / prev;
        out[i] = cum - 1;                                 // 0 at first valid day; carries otherwise
        prev = v;
    }
    return out;
}

// Everything the "is it cheap?" question needs, from the quote alone.
//
// Deliberately takes no position, cost or trade: valuation is a property of the STOCK, not of
// owning it. That is what lets a watchlist name get these numbers from the identical code path
// as a holding — one formula, so the two can never drift apart.
// `h` supplies only optional manual overrides from meta.json (eps, specialEps, lowPrice/lowEps
// for symbols Yahoo has no earnings for, and the growth inputs); {} is a fine argument.
//
// PE uses native price ÷ native EPS (both in the same currency) so no FX enters a ratio that
// shouldn't need any. specialPe uses a stock-tailored earnings figure (FFO, adjusted EPS, ...)
// when meta.json sets one; otherwise it's the same as pe.
//
// Trough-multiple: peLow is the multiple the market paid at this stock's recorded low — a
// *ratio*, so it is currency- and ADR-agnostic: a low logged off the US ADR yields the same
// multiple as the Tokyo ordinary. Applying it to today's EPS gives implied — what the price
// would be at its cheapest-ever multiple, on today's earnings. vsLow is the premium you pay
// above that: >0 dearer, <0 cheaper. peLow is derived online by fetch-prices' troughPe():
// point-in-time, each weekly close over the latest annual EPS PUBLISHED by that date — never
// the same year's own earnings, which weren't public at the low. A manual meta.json low is
// only a fallback — nothing here needs hand-maintaining.
//
// No PEG here: it needs a growth rate, and the deep-dive panel derives that from the filed
// earnings history (see peg() in the page) rather than from a hand-entered number. An earlier
// pegLow/impliedPeg pair read `growth`/`lowGrowth` out of meta.json, which was never populated
// for a single instrument — so it never once rendered. Deleted rather than left as a second,
// dead definition of the same idea.
function valuation(h, quote) {
    const eps = quote.eps ?? h.eps ?? null;
    const pe = eps > 0 ? quote.price / eps : null;
    // Special P/E denominator, in order: a manual meta.json override (FFO, bank-adjusted, ...);
    // else the recurring EPS fetch-prices derives from normalized income (headline minus one-offs
    // — see normEpsFrom); else plain headline, leaving Special P/E equal to the normal one.
    const specialEps = h.specialEps ?? quote.normEps ?? eps;
    const specialPe = specialEps > 0 ? quote.price / specialEps : null;
    const specialEpsLabel = h.specialEps != null ? (h.specialEpsLabel ?? null)
        : quote.normEps != null ? 'Recurring' : null;

    const peLow = quote.peLow ?? (h.lowPrice > 0 && h.lowEps > 0 ? h.lowPrice / h.lowEps : null);
    const lowDate = quote.lowDate ?? h.lowDate ?? null;
    const lowPrice = quote.lowPrice ?? h.lowPrice ?? null;
    const lowEps = quote.lowEps ?? h.lowEps ?? null;
    const implied = peLow != null && eps > 0 ? peLow * eps : null;
    const vsLow = implied > 0 ? (quote.price - implied) / implied : null;

    return { eps, pe, specialPe, specialEpsLabel, peLow, implied, vsLow, lowDate, lowPrice, lowEps };
}

// Yahoo's quarterly series sometimes drops a quarter outright — BYD's Sep '25 is simply absent,
// while the quarters either side are there. That hole costs more than one row: the remaining
// quarters no longer span a year, so the TTM guard (rightly) refuses to total them, and the whole
// trailing row disappears. Left alone it would have summed Mar '25 + Jun '25 + Dec '25 + Mar '26 —
// double-counting a first quarter and omitting the third.
//
// When a fiscal year is complete except for ONE quarter, the hole is not a guess: the audited
// annual MINUS the three filed quarters IS the missing quarter, exactly. Fill only then; two holes
// are not determinable from one equation, and zero needs nothing.
//
// FLOWS only. Revenue, operating income, net income and normalized income accumulate over the year,
// so they subtract cleanly. Never EPS and never a share count: a per-share figure needs that
// quarter's own share base, and a bonus issue or buyback inside the year would make an imputed EPS
// fiction — BYD's diluted shares roughly doubled during FY2025 (EPS 9.22 -> 3.58 on net income down
// only 19%). A blank EPS is the honest output; `derivedQuarter` lets the page label the row.
const QUARTER_FLOWS = ['rev', 'opinc', 'ni', 'nic', 'norm'];

// The four quarter-ends of the fiscal year ending `fyEnd`, newest first. Built as month-ends
// (day 0 of the following month) so a December year-end yields Sep 30, not an overflowed Sep 31.
function quarterEnds(fyEnd) {
    const d = new Date(fyEnd + 'T00:00:00Z');
    return [0, 1, 2, 3].map(k =>
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 - 3 * k, 0)).toISOString().slice(0, 10));
}

// How long has this money actually been in the position?
//
// NOT the first purchase date. 43 of the 57 positions in this book were built with more than one
// buy, and 13 would have their age overstated by more than a year if measured from the first one.
// BYD is the extreme: first bought in 2018, but sold down and re-entered, so "held 8.6 years" is
// true of the ticker and false of the money — the open lots average about one year.
//
// So: match sells against buys FIFO, keep the lots still open, and average their age weighted by
// what each one COST. Cost rather than share count because a group can hold two listings of one
// company (an ADR and its local line) whose share counts are not comparable — cost in one currency
// always is. For a single-price position the two weightings agree.
//
// Returns null when nothing is open or no trade carries a date. `rate` converts a trade's currency
// into the common one; pass () => 1 to weight in native money.
function holdingAge(trades, asOf, rate = () => 1) {
    const ordered = [...(trades || [])].filter(t => t && t.date).sort((a, b) => a.date.localeCompare(b.date));
    const open = [];
    for (const t of ordered) {
        if (t.side === 'SELL') {
            // Oldest lots go first — the same convention as the tax treatment of a part sale, and
            // the only one that lets a re-entry read as recent rather than as the original purchase.
            let n = t.qty;
            while (n > 0 && open.length) {
                const take = Math.min(n, open[0].qty);
                open[0].qty -= take;
                n -= take;
                if (open[0].qty <= 1e-9) open.shift();
            }
        } else if (t.qty > 0) {
            open.push({ date: t.date, qty: t.qty, price: t.price || 0, currency: t.currency });
        }
    }
    let num = 0, den = 0, first = null;
    for (const l of open) {
        const w = l.qty * l.price * (rate(l.currency) || 0);
        if (!(w > 0)) continue;
        num += w * (Date.parse(asOf) - Date.parse(l.date)) / 864e5;
        den += w;
        if (!first || l.date < first) first = l.date;
    }
    if (!(den > 0)) return null;
    return { days: num / den, firstOpen: first, lots: open.length };
}

// Which fiscal quarter is this calendar period end, for a company whose year does not end in
// December? Disney's year ends late September, so its Apr-Jun quarter — the one this app labels
// "Qtr Jun '26" — is the Q3 FY26 your broker's earnings notice names. Both labels are right; they
// just count from different places, and only one of them matches the notice in your inbox.
//
// Returns null for a December filer (where "Qtr Jun '26" already IS Q2 2026 and a second label
// would be noise) and null when the years give no usable year end.
//
// `years` is earnings.json's filed annual list. The fiscal year END MONTH comes from the data
// rather than a table of companies: a filer that shifts its year end starts labelling correctly by
// itself, and nothing has to be maintained.
function fiscalQuarter(date, years) {
    const ends = (years || []).map(y => y && y.date).filter(Boolean).sort();
    if (!ends.length || !date) return null;
    const fyEndMonth = new Date(ends[ends.length - 1] + 'T00:00:00Z').getUTCMonth() + 1;
    if (fyEndMonth === 12) return null;                       // calendar filer: nothing to add
    const d = new Date(date + 'T00:00:00Z');
    const m = d.getUTCMonth() + 1;
    // Months elapsed since the fiscal year began; a quarter landing ON the year end is Q4, not Q0.
    const elapsed = ((m - fyEndMonth + 12) % 12) || 12;
    if (elapsed % 3) return null;                             // not on a quarter boundary — say nothing
    const q = elapsed / 3;
    // The fiscal year is the one ENDING on or after this quarter, named by the year it ends in.
    const fyYear = m > fyEndMonth ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
    return { q, fy: fyYear, label: `Q${q} FY${String(fyYear).slice(2)}` };
}

function fillMissingQuarters(quarters, years) {
    const out = [...(quarters || [])];
    for (const y of years || []) {
        const ends = quarterEnds(y.date);
        // Match by proximity, not equality: a 52/53-week filer's quarter can land a few days off
        // the calendar month-end. Searching `out` means an already-derived quarter is never
        // re-derived on a second pass.
        const found = ends.map(end =>
            out.find(x => Math.abs(Date.parse(x.date + 'T00:00:00Z') - Date.parse(end + 'T00:00:00Z')) <= 10 * 864e5));
        if (found.filter(x => !x).length !== 1) continue;
        const known = found.filter(Boolean);
        const q = { date: ends[found.findIndex(x => !x)], derivedQuarter: true };
        for (const f of QUARTER_FLOWS) {
            if (y[f] == null || known.some(x => x[f] == null)) continue;
            q[f] = Number((y[f] - known.reduce((a, x) => a + x[f], 0)).toPrecision(12));
        }
        // No top line means the page would filter the row out anyway — don't add a stub.
        if (q.rev == null) continue;
        out.push(q);
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

// An ADR is a claim on a FRACTION of a share, and Yahoo scales per-share figures to the receipt
// while reporting revenue and income at company level. That leaves one column of the financials
// table on a different basis from every other: Kawasaki's filed FY2026 reads 51.76 per ADR where
// the company's own accounts — and its guidance PDF — say 129.41 per ordinary share. Both are
// correct; they are simply different units sharing a column.
//
// The statements belong to the COMPANY, so the table shows them as filed: per ordinary share.
// `perAdr` is the ordinary shares one ADR represents (0.25 = a quarter of a share), so dividing
// by it converts receipt -> share. Only `eps` is rescaled; the share count (ni/eps) and recurring
// EPS (norm*eps/ni) are derived from it and follow automatically.
//
// The Valuation panel deliberately does NOT use this: it divides by the ADR's own market price,
// so its EPS must stay per receipt or the multiple would be wrong by exactly this ratio.
//
// Verified against sources outside Yahoo: Nintendo at 0.25 reproduces its Frankfurt line (which
// trades 1:1 with the ordinary) to the cent — 91.1275 / 0.25 = 364.51 — and Kawasaki at 0.4
// reproduces the figure in the company's own statement, 129.41.
function onUnderlying(entry, perAdr) {
    if (!entry || !(perAdr > 0) || perAdr === 1) return entry;
    const scale = row => row.eps == null ? row : { ...row, eps: row.eps / perAdr };
    return {
        ...entry,
        years: (entry.years || []).map(scale),
        quarters: (entry.quarters || []).map(scale),
    };
}

// watchlist[] + prices.json -> leg-shaped rows for stocks NOT held.
//
// Kept out of build() and out of holdings.json on purpose. Totals, TWR, cohorts and the NAV
// series all iterate holdings; a stock you are only THINKING about must never be able to move a
// number that reports how you are actually doing. Separate file, separate path, no contact.
// The shape matches a leg closely enough for the deep-dive panel to render it unchanged.
function buildWatchlist(watchlist, quotes) {
    return watchlist
        .filter(w => quotes[w.yahoo])
        .map(w => ({
            ...w, group: w.name, quote: quotes[w.yahoo], ...valuation(w, quotes[w.yahoo]),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// holdings[] + prices.json -> one row per bucket of `dimension`, sorted by market value.
// Each row keeps its constituent instruments as `legs` (a single-instrument row has one).
// `asOf` is a parameter only so holding ages are testable without freezing the clock.
function build(holdings, rates, quotes, dimension = 'company', asOf = new Date().toISOString().slice(0, 10)) {
    const field = DIMENSIONS[dimension] || DIMENSIONS.company;
    const groups = new Map();
    for (const h of holdings) {
        const quote = quotes[h.yahoo];
        if (!quote) continue;
        const rate = rateFor(h.currency, rates);
        if (!rate) throw new Error(`no FX rate for ${h.currency} (${h.yahoo})`);
        // Compare the trade price to spot in USD: a London trade may be logged in pence
        // while the same instrument's sibling is logged in pounds.
        let since = null;
        if (h.lastTrade) {
            const tradeUSD = h.lastTrade.price * rateFor(h.lastTrade.currency, rates);
            if (tradeUSD) since = (quote.priceUSD - tradeUSD) / tradeUSD;
        }
        const value = h.qty * quote.priceUSD;

        // Average cost per share, converted into the QUOTE's currency so it can sit beside the
        // price on the same scale. The purchase currency is not always the quote's — CSUK is
        // bought in GBP and quoted in GBp — and putting 12.34 next to 1234 would be a 100x lie.
        const quoteRate = rateFor(quote.currency, rates);
        const avgQuote = h.avgPrice > 0 && quoteRate ? h.avgPrice * rate / quoteRate : null;

        const leg = {
            ...h, quote, since, ...valuation(h, quote), avgQuote,
            cost: h.costLC * rate,
            value,
            realized: (h.realizedLC || 0) * rate,
            income: value * (quote.divYield || 0),
        };
        const key = String(h[field]);
        if (!groups.has(key)) groups.set(key, { name: key, legs: [] });
        groups.get(key).legs.push(leg);
    }

    const rows = [...groups.values()].map(g => {
        const sum = k => g.legs.reduce((a, l) => a + l[k], 0);
        const cost = sum('cost'), value = sum('value'), income = sum('income');
        g.legs.sort((a, b) => b.value - a.value);
        // A row's "last trade" is the most recent across its instruments.
        const traded = g.legs.filter(l => l.lastTrade);
        const recent = traded.sort((a, b) => b.lastTrade.date.localeCompare(a.lastTrade.date))[0];
        const single = g.legs.length === 1 ? g.legs[0] : null;
        return {
            ...g, cost, value, income, realized: sum('realized'),
            gain: value - cost,
            gainPct: cost ? (value - cost) / cost : null,
            yield: value ? income / value : null,
            moves: Object.fromEntries(PERIODS.map(p => [p, weightedMove(g.legs, p)])),
            lastTrade: recent ? recent.lastTrade : null,
            since: recent ? recent.since : null,
            // How long the money has been in this row, cost-weighted across every open lot of
            // every leg (see holdingAge). Pooling the legs' trades is right precisely because
            // cost is the weight: an ADR and its local line contribute in one common currency.
            held: holdingAge(g.legs.flatMap(l => l.trades || []), asOf,
                c => rateFor(c === 'Gbpence' ? 'GBp' : c, rates)),
            // Current price per share only makes sense for a single instrument; shown native.
            price: single ? single.quote.price : null,
            priceCurrency: single ? single.quote.currency : null,
            pe: single ? single.pe : null,
            specialPe: single ? single.specialPe : null,
            specialEpsLabel: single ? single.specialEpsLabel || null : null,
            // Same single-instrument rule as the price above: two legs can be in different
            // currencies (CSUK trades in both GBP and GBp), so a blended average has no unit.
            avgPrice: single ? single.avgQuote : null,
            // Same single-instrument rule as PE: a basket has no meaningful trough multiple.
            peLow: single ? single.peLow : null,
            implied: single ? single.implied : null,
            vsLow: single ? single.vsLow : null,
            lowDate: single ? single.lowDate || null : null,
            lowPrice: single ? single.lowPrice : null,
            lowEps: single ? single.lowEps : null,
            // The instrument a click on this row charts: its largest leg.
            primaryYahoo: g.legs[0].yahoo,
        };
    });
    rows.sort((a, b) => b.value - a.value);
    return rows;
}

const portfolioLib = { rateFor, weightedMove, gainHistory, cohortMV, twr, build, valuation, buildWatchlist, fillMissingQuarters, onUnderlying, fiscalQuarter, holdingAge, PERIODS, DIMENSIONS };
if (typeof module !== 'undefined') module.exports = portfolioLib;
else if (typeof window !== 'undefined') window.portfolioLib = portfolioLib;

if (typeof require !== 'undefined' && require.main === module && process.argv[2] === '--selftest') {
    const assert = require('assert');
    const rates = { USD: 1, GBP: 2, HKD: 0.1 };

    // Pence is pounds/100, under either spelling.
    assert.strictEqual(rateFor('GBp', rates), 0.02);
    assert.strictEqual(rateFor('Gbpence', rates), 0.02);
    assert.strictEqual(rateFor('USD', rates), 1);

    // Transaction-replayed gain/loss uses the balance and average cost after each trade.
    const replay = gainHistory(
        ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
        [10, 12, 11, 15],
        [
            { date: '2026-01-02', balanceQty: 2, avgPrice: 10, currency: 'USD' },
            { date: '2026-01-04', balanceQty: 3, avgPrice: 12, currency: 'USD' },
        ],
        rates, 'USD',
    );
    assert.deepStrictEqual(replay.gains, [null, 4, 2, 9]);
    assert.deepStrictEqual(replay.costs, [null, 20, 20, 36]);
    assert.deepStrictEqual(replay.quantities, [0, 2, 2, 3]);

    // TWR strips out cash flows: a deposit that doubles market value is not a return.
    // Day1: value 100->160 but +50 was deposited -> real move +10%. Day2: 160->176 = +10%.
    const perf = twr([100, 160, 176], [0, 50, 0]);
    assert.strictEqual(perf[0], 0);
    assert.ok(Math.abs(perf[1] - 0.10) < 1e-12);
    assert.ok(Math.abs(perf[2] - 0.21) < 1e-12);       // 1.1 * 1.1 - 1
    // No flows -> TWR is just the value ratio; nulls gap without breaking the chain.
    assert.deepStrictEqual(twr([100, 110, 90], [0, 0, 0]).map(v => Math.round(v * 100) / 100), [0, 0.1, -0.1]);
    assert.strictEqual(twr([null, 100, 110], [0, 0, 0])[0], null);

    // cohortMV: one holding, a buy on day2 adds shares (flow) and lifts market value.
    const cm = cohortMV(
        ['2026-01-01', '2026-01-02', '2026-01-03'],
        [{ yahoo: 'A', quoteCurrency: 'USD', trades: [
            { date: '2026-01-01', side: 'BUY', qty: 10, price: 10, currency: 'USD' },
            { date: '2026-01-03', side: 'BUY', qty: 5, price: 12, currency: 'USD' },
        ] }],
        { A: [10, 11, 12] }, rates, null,
    );
    assert.deepStrictEqual(cm.mv, [100, 110, 180]);     // 10@10, 10@11, 15@12
    assert.deepStrictEqual(cm.flow, [0, 0, 60]);        // day-1 buy is opening balance; day-3 buy = 5*12
    // A trade filter partitions the same holding into cohorts (existing vs new-money).
    const newOnly = cohortMV(['2026-01-01', '2026-01-03'],
        [{ yahoo: 'A', quoteCurrency: 'USD', trades: [
            { date: '2025-06-01', side: 'BUY', qty: 10, price: 8, currency: 'USD' },
            { date: '2026-01-03', side: 'BUY', qty: 5, price: 12, currency: 'USD' },
        ] }],
        { A: [11, 12] }, rates, t => t.date >= '2026-01-01');
    assert.deepStrictEqual(newOnly.mv, [0, 60]);        // only the 5 new shares counted
    assert.deepStrictEqual(newOnly.flow, [0, 60]);
    // Price gaps hold flat, so a ragged first day doesn't read as a huge day-1 jump:
    // leading null uses the first known close (seed), interior null carries the last known.
    const gap = cohortMV(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
        [{ yahoo: 'A', quoteCurrency: 'USD', trades: [{ date: '2026-01-01', side: 'BUY', qty: 10, price: 10, currency: 'USD' }] }],
        { A: [null, 20, null, 22] }, rates, null);
    assert.deepStrictEqual(gap.mv, [200, 200, 200, 220]);

    // Weighted by value: a $300 leg at +10% and a $100 leg at -10% => +5%.
    const legs = [{ value: 300, quote: { '1y': 0.10 } }, { value: 100, quote: { '1y': -0.10 } }];
    assert.strictEqual(weightedMove(legs, '1y'), 0.05);
    // A leg with no data for the period must not drag the average toward zero.
    assert.strictEqual(weightedMove([...legs, { value: 1000, quote: { '1y': null } }], '1y'), 0.05);
    assert.strictEqual(weightedMove([{ value: 5, quote: { '1y': null } }], '1y'), null);
    assert.strictEqual(weightedMove([], '1y'), null);

    // Two instruments of one company collapse into a single row, costs and values summed.
    const holdings = [
        { yahoo: 'A', group: 'BYD', geography: 'China', currency: 'USD', qty: 10, costLC: 100, realizedLC: 5 },
        { yahoo: 'B', group: 'BYD', geography: 'China', currency: 'HKD', qty: 100, costLC: 1000, realizedLC: 10 },
        { yahoo: 'C', group: 'Solo', geography: 'US', currency: 'USD', qty: 1, costLC: 50, specialEps: 4, specialEpsLabel: 'Adj EPS' },
    ];
    const quotes = {
        A: { price: 20, priceUSD: 20, divYield: 0.01, '1y': 0.5 },
        B: { price: 20, priceUSD: 2, divYield: 0.03, '1y': 0 },
        C: { price: 100, priceUSD: 100, divYield: 0.02, '1y': null, eps: 5 },
    };
    const rows = build(holdings, rates, quotes);
    assert.strictEqual(rows.length, 2);
    const byd = rows.find(r => r.name === 'BYD');
    assert.strictEqual(byd.legs.length, 2);
    assert.strictEqual(byd.cost, 100 * 1 + 1000 * 0.1);   // 200
    assert.strictEqual(byd.value, 10 * 20 + 100 * 2);     // 400
    assert.strictEqual(byd.gain, 200);
    assert.strictEqual(byd.gainPct, 1);
    assert.strictEqual(byd.realized, 6);
    assert.strictEqual(byd.income, 8);
    assert.strictEqual(byd.yield, 0.02);                  // value-weighted online yields
    assert.strictEqual(byd.moves['1y'], 0.25);            // 200@+50% and 200@0%
    // Rows are sorted by value, and yield uses trailing dividends over market value.
    assert.strictEqual(rows[0].name, 'BYD');
    assert.strictEqual(rows[1].yield, 0.02);
    assert.strictEqual(rows[1].income, 2);

    // PE: normal PE is native price ÷ Yahoo's auto-fetched trailing EPS; special PE uses
    // meta.json's stock-tailored earnings figure instead. Multi-leg rows (BYD, no eps set
    // on A/B) leave both null — a group PE isn't well-defined without earnings weighting.
    const solo = rows.find(r => r.name === 'Solo');
    assert.strictEqual(solo.pe, 20);          // 100 / 5
    assert.strictEqual(solo.specialPe, 25);   // 100 / 4
    assert.strictEqual(solo.specialEpsLabel, 'Adj EPS');
    assert.strictEqual(byd.pe, null);
    assert.strictEqual(byd.specialPe, null);

    // Since-last-trade compares in USD. A pence trade at 500 GBp = $10 vs $20 spot = +100%.
    const pence = [{ yahoo: 'P', group: 'G', geography: 'UK', currency: 'GBp', qty: 1, costLC: 0, divTTM: 0,
        lastTrade: { date: '2026-01-01', side: 'BUY', price: 500, currency: 'Gbpence' } }];
    const pRow = build(pence, rates, { P: { priceUSD: 20 } })[0];
    assert.strictEqual(pRow.since, 1);
    assert.strictEqual(pRow.lastTrade.side, 'BUY');

    // The group's last trade is the most recent across its instruments.
    const two = [
        { yahoo: 'X', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 0, divTTM: 0,
          lastTrade: { date: '2026-01-01', side: 'BUY', price: 10, currency: 'USD' } },
        { yahoo: 'Y', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 0, divTTM: 0,
          lastTrade: { date: '2026-05-05', side: 'SELL', price: 50, currency: 'USD' } },
    ];
    const gRow = build(two, rates, { X: { priceUSD: 10 }, Y: { priceUSD: 25 } })[0];
    assert.strictEqual(gRow.lastTrade.date, '2026-05-05');
    assert.strictEqual(gRow.lastTrade.side, 'SELL');
    assert.strictEqual(gRow.since, -0.5); // 25 vs 50
    // A holding with no trade history yields null rather than NaN.
    assert.strictEqual(build([{ ...pence[0], lastTrade: null }], rates, { P: { priceUSD: 20 } })[0].since, null);

    // An unpriced instrument is skipped rather than crashing the page.
    assert.strictEqual(build(holdings, rates, { A: quotes.A }).length, 1);
    // A missing FX rate is loud, not a silent zero.
    assert.throws(() => build(holdings, { USD: 1 }, quotes), /no FX rate for HKD/);

    // Trough-multiple valuation, checked against the workbook's own GOOG row:
    // low 86.70 / EPS 4.96 = P/E Low 17.48; PEG Low = 17.48/22.7 = 0.77;
    // implied = 17.48 x 8.04 EPS = 140.54; PEG-implied = 0.77 x 26.9 x 8.04 = 166.54.
    const val = build(
        [{ yahoo: 'G', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 0,
           lowPrice: 86.7, lowEps: 4.96, lowGrowth: 0.227, growth: 0.269 }],
        rates, { G: { price: 200, priceUSD: 200, eps: 8.04 } },
    )[0];
    assert.ok(Math.abs(val.peLow - 17.48) < 0.01);
    assert.ok(Math.abs(val.implied - 140.54) < 0.05);
    // Premium to the trough multiple: 200 vs implied ~140.54 = +42% dearer.
    assert.ok(Math.abs(val.vsLow - (200 - val.implied) / val.implied) < 1e-12);
    assert.ok(Math.abs(val.vsLow - 0.423) < 0.001);
    // A ratio, so an ADR-recorded low gives the same multiple as the ordinary line: scaling
    // both low price and low EPS by the ADR ratio leaves peLow (and so implied/vsLow) intact.
    const adr = build(
        [{ yahoo: 'G', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 0,
           lowPrice: 86.7 * 5, lowEps: 4.96 * 5 }],
        rates, { G: { price: 200, priceUSD: 200, eps: 8.04 } },
    )[0];
    assert.ok(Math.abs(adr.peLow - val.peLow) < 1e-9);
    // No low recorded (ETFs, gold, bitcoin) -> nulls, never NaN.
    const none = build([{ yahoo: 'G', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 0 }],
        rates, { G: { price: 200, priceUSD: 200, eps: 8.04 } })[0];
    assert.strictEqual(none.peLow, null);
    assert.strictEqual(none.implied, null);
    assert.strictEqual(none.vsLow, null);
    // Loss-making at the low (negative EPS) is not a meaningful multiple.
    const loss = build([{ yahoo: 'G', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 0,
        lowPrice: 50, lowEps: -2 }], rates, { G: { price: 200, priceUSD: 200, eps: 8.04 } })[0];
    assert.strictEqual(loss.peLow, null);

    // Single-instrument rows carry a native price; merged rows do not.
    assert.strictEqual(rows.find(r => r.name === 'Solo').price, 100);
    assert.strictEqual(byd.price, null);
    assert.strictEqual(byd.primaryYahoo, 'A'); // larger leg (value 200 vs 200 -> A first is fine)

    // Grouping by geography buckets both BYD legs plus Solo into China + US.
    const geo = build(holdings, rates, quotes, 'geography');
    assert.deepStrictEqual(geo.map(g => g.name).sort(), ['China', 'US']);
    assert.strictEqual(geo.find(g => g.name === 'China').value, 400);
    assert.strictEqual(geo.find(g => g.name === 'China').legs.length, 2);

    // Grouping by instrument gives one row per holding, never merged.
    const inst = build(holdings, rates, quotes, 'instrument');
    assert.strictEqual(inst.length, 3);
    assert.ok(inst.every(r => r.legs.length === 1));
    assert.ok(inst.every(r => r.price != null));

    // avgQuote: average cost expressed in the QUOTE's currency, so it compares to the price.
    // Same currency both sides: nothing to convert.
    const sameCcy = build([{ yahoo: 'A', currency: 'USD', qty: 1, costLC: 10, avgPrice: 10, group: 'A', geography: 'US' }],
        rates, { A: { price: 12, currency: 'USD', priceUSD: 12 } }, 'instrument')[0];
    assert.strictEqual(sameCcy.avgPrice, 10);
    // Bought in pounds, quoted in pence — the CSUK case. 160.94 GBP must read as 16094 GBp,
    // not sit next to a 19820p price looking like a 99% loss.
    const penceAvg = build([{ yahoo: 'C', currency: 'GBP', qty: 1, costLC: 160.94, avgPrice: 160.94, group: 'C', geography: 'Europe' }],
        rates, { C: { price: 19820, currency: 'GBp', priceUSD: 396.4 } }, 'instrument')[0];
    assert.ok(Math.abs(penceAvg.avgPrice - 16094) < 0.01, `expected ~16094 GBp, got ${penceAvg.avgPrice}`);
    // A basket has no single unit, so no average — same rule as price and PE.
    const twoLegs = build([
        { yahoo: 'C', currency: 'GBP', qty: 1, costLC: 160.94, avgPrice: 160.94, group: 'C', geography: 'Europe' },
        { yahoo: 'C2', currency: 'GBp', qty: 1, costLC: 16094, avgPrice: 16094, group: 'C', geography: 'Europe' },
    ], rates, { C: { price: 19820, currency: 'GBp', priceUSD: 396.4 }, C2: { price: 19820, currency: 'GBp', priceUSD: 396.4 } }, 'company')[0];
    assert.strictEqual(twoLegs.avgPrice, null);
    assert.strictEqual(twoLegs.price, null);

    // valuation: derived from the quote alone, so it needs no position at all.
    const q = { price: 100, eps: 5, peLow: 8, lowPrice: 40, lowEps: 5, lowDate: '2022-10-28', currency: 'USD' };
    const v = valuation({}, q);
    assert.strictEqual(v.pe, 20);
    assert.strictEqual(v.implied, 40);          // trough multiple 8x on today's EPS of 5
    assert.strictEqual(v.vsLow, 1.5);           // 100 vs 40 = 150% dearer than its cheapest
    // A holding and a watchlist entry on the same quote MUST agree — one formula, no drift.
    const heldLeg = build([{ yahoo: 'X', currency: 'USD', qty: 1, costLC: 1, group: 'X', geography: 'US' }],
        rates, { X: q }, 'instrument')[0].legs[0];
    const watched = buildWatchlist([{ yahoo: 'X', name: 'X', geography: 'US' }], { X: q })[0];
    for (const k of ['pe', 'peLow', 'implied', 'vsLow', 'lowDate'])
        assert.strictEqual(watched[k], heldLeg[k], `watchlist ${k} disagrees with holding`);

    // A loss-maker has no meaningful multiple, and nothing may be fabricated from it.
    const lossMaker = valuation({}, { price: 10, eps: -2, currency: 'USD' });
    assert.strictEqual(lossMaker.pe, null);
    assert.strictEqual(lossMaker.implied, null);
    assert.strictEqual(lossMaker.vsLow, null);
    // meta.json overrides only fill gaps; a live quote always wins.
    assert.strictEqual(valuation({ eps: 99 }, { price: 100, eps: 5, currency: 'USD' }).pe, 20);
    assert.strictEqual(valuation({ eps: 4 }, { price: 100, currency: 'USD' }).pe, 25);

    // Special P/E precedence: manual override > recurring (normEps) > headline.
    const rec = valuation({}, { price: 100, eps: 5, normEps: 4, currency: 'USD' });
    assert.strictEqual(rec.pe, 20);                    // headline unchanged
    assert.strictEqual(rec.specialPe, 25);             // 100 / recurring 4
    assert.strictEqual(rec.specialEpsLabel, 'Recurring');
    const manual = valuation({ specialEps: 2, specialEpsLabel: 'FFO' }, { price: 100, eps: 5, normEps: 4, currency: 'USD' });
    assert.strictEqual(manual.specialPe, 50);          // manual 2 beats normEps
    assert.strictEqual(manual.specialEpsLabel, 'FFO');
    const plain = valuation({}, { price: 100, eps: 5, currency: 'USD' });
    assert.strictEqual(plain.specialPe, 20);           // no normEps -> Special == normal
    assert.strictEqual(plain.specialEpsLabel, null);

    // buildWatchlist drops names with no quote rather than rendering a blank row.
    assert.strictEqual(buildWatchlist([{ yahoo: 'NOPE', name: 'Nope' }], { X: q }).length, 0);

    // onUnderlying: an ADR's per-share figures are Yahoo-scaled to the RECEIPT while revenue and
    // income stay company-level. Dividing by the ordinary-shares-per-ADR ratio puts the filed
    // statements back on the company's own basis. Real figures: Kawasaki's FY2026.
    const adrEntry = { currency: 'JPY', years: [{ date: '2026-03-31', nic: 108157000000, eps: 51.764, ni: 108157000000, norm: 108157000000 }],
                  quarters: [{ date: '2025-06-30', eps: 2.0312 }] };
    const ord = onUnderlying(adrEntry, 0.4);
    assert.ok(Math.abs(ord.years[0].eps - 129.41) < 1e-9, 'KWHIY 51.764 / 0.4 must be the filed 129.41');
    assert.strictEqual(ord.years[0].nic, 108157000000);      // income is company-level; never rescaled
    assert.ok(Math.abs(ord.quarters[0].eps - 5.078) < 1e-9); // quarters follow the same scaling
    // The derived columns fall out of the rescaled EPS rather than needing their own conversion.
    assert.ok(Math.abs(ord.years[0].nic / ord.years[0].eps / 1e6 - 835.8) < 0.5, 'share count becomes the ordinary count');
    // Nintendo at 0.25 must reproduce its Frankfurt line, which trades 1:1 with the ordinary.
    assert.ok(Math.abs(onUnderlying({ years: [{ date: '2026-03-31', eps: 91.1275 }] }, 0.25).years[0].eps - 364.51) < 1e-9);
    // Not an ADR, or no ratio known: returned untouched rather than guessed at.
    assert.strictEqual(onUnderlying(adrEntry, undefined), adrEntry);
    assert.strictEqual(onUnderlying(adrEntry, 1), adrEntry);
    assert.strictEqual(onUnderlying(adrEntry, 0), adrEntry);
    assert.strictEqual(onUnderlying(null, 0.4), null);
    // A row with no EPS is passed through, not turned into NaN.
    assert.deepStrictEqual(onUnderlying({ years: [{ date: '2024-03-31', nic: 5 }] }, 0.4).years[0], { date: '2024-03-31', nic: 5 });
    // The source entry is never mutated — the Valuation panel still needs the per-receipt figures.
    assert.strictEqual(adrEntry.years[0].eps, 51.764);

    // quarterEnds walks back in three-month steps and lands on real month-ends: a December
    // year-end must give Sep 30, not an overflowed "Sep 31" (and a March one crosses the year).
    assert.deepStrictEqual(quarterEnds('2025-12-31'), ['2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31']);
    assert.deepStrictEqual(quarterEnds('2026-03-31'), ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30']);

    // fillMissingQuarters, on BYD's real FY2025 hole: Sep '25 is absent from Yahoo's series
    // while the three around it are filed. The annual minus those three IS the missing quarter.
    const bydYear = { date: '2025-12-31', rev: 803964958000, opinc: 38516936000, ni: 32619022000, nic: 32619022000 };
    const bydQ = [
        { date: '2025-03-31', rev: 170360448000, opinc: 8899868000, ni: 9154985000, nic: 9154985000, eps: 2.0782 },
        { date: '2025-06-30', rev: 200920500000, opinc: 6198055000, ni: 6355548000, nic: 6355548000 },
        { date: '2025-12-31', rev: 237699412000, opinc: 13228268000, ni: 9285849000, nic: 9285849000 },
    ];
    const filled = fillMissingQuarters(bydQ, [bydYear]);
    assert.strictEqual(filled.length, 4);
    const sep = filled.find(x => x.date === '2025-09-30');
    assert.ok(sep && sep.derivedQuarter);
    assert.strictEqual(sep.rev, 194984598000);          // 803.96B - (170.36 + 200.92 + 237.70)B
    assert.strictEqual(sep.nic, 7822640000);
    assert.strictEqual(sep.opinc, 10190745000);
    // Never a per-share figure: the quarter's own share base is unknown, and a bonus issue
    // inside the year (BYD's shares doubled in FY2025) would make an imputed EPS fiction.
    assert.strictEqual(sep.eps, undefined);
    // The point of the fill: four quarters now span a year, so the TTM guard accepts them.
    const span = (Date.parse(filled[3].date) - Date.parse(filled[0].date)) / 864e5;
    assert.ok(span >= 250 && span <= 290, `four filled quarters span ${span}d, outside the TTM window`);

    // Two holes are not determinable from one equation — leave both alone rather than guess.
    assert.strictEqual(fillMissingQuarters(bydQ.slice(0, 2), [bydYear]).length, 2);
    // A complete year needs nothing added, and must not be disturbed.
    assert.strictEqual(fillMissingQuarters(filled, [bydYear]).length, 4);
    // Idempotent: a second pass re-derives nothing (the derived quarter is matched, not replaced).
    assert.strictEqual(fillMissingQuarters(fillMissingQuarters(bydQ, [bydYear]), [bydYear]).length, 4);
    // A year with no quarters at all (Nintendo's ADR) stays empty — four holes, not one.
    assert.deepStrictEqual(fillMissingQuarters([], [bydYear]), []);
    // A missing quarter with no derivable top line is not added as a stub.
    assert.strictEqual(fillMissingQuarters(bydQ.map(({ rev, ...r }) => r), [{ date: '2025-12-31', nic: 1 }]).length, 3);

    // holdingAge: how long the MONEY has been in, not how long the ticker has been on the sheet.
    const usd = () => 1;
    // One lot, one year.
    assert.strictEqual(Math.round(holdingAge(
        [{ date: '2025-08-09', side: 'BUY', qty: 10, price: 100, currency: 'USD' }], '2026-08-09', usd).days), 365);
    // Two equal-cost lots, four and two years old -> three years.
    const twoLots = holdingAge([
        { date: '2022-08-09', side: 'BUY', qty: 10, price: 100, currency: 'USD' },
        { date: '2024-08-09', side: 'BUY', qty: 10, price: 100, currency: 'USD' }], '2026-08-09', usd);
    assert.ok(Math.abs(twoLots.days - 3 * 365) < 2);
    assert.strictEqual(twoLots.lots, 2);
    // Weighted by COST, not by lot count: a 9x bigger recent buy pulls the average to the recent one.
    const skewed = holdingAge([
        { date: '2016-08-09', side: 'BUY', qty: 1, price: 100, currency: 'USD' },
        { date: '2025-08-09', side: 'BUY', qty: 9, price: 100, currency: 'USD' }], '2026-08-09', usd);
    assert.ok(Math.abs(skewed.days - (10 * 365 * 0.1 + 365 * 0.9)) < 2);
    // FIFO: selling the old lot leaves the RECENT one, so the position reads new — the BYD case,
    // where measuring from the first-ever buy would claim 2018 for money that went in last year.
    const reentry = holdingAge([
        { date: '2018-01-22', side: 'BUY', qty: 10, price: 100, currency: 'USD' },
        { date: '2024-01-22', side: 'SELL', qty: 10, price: 200, currency: 'USD' },
        { date: '2025-08-09', side: 'BUY', qty: 5, price: 300, currency: 'USD' }], '2026-08-09', usd);
    assert.strictEqual(Math.round(reentry.days), 365);
    assert.strictEqual(reentry.firstOpen, '2025-08-09');
    // A partial sell consumes the oldest lot first and leaves the remainder of it open.
    const partial = holdingAge([
        { date: '2020-08-09', side: 'BUY', qty: 10, price: 100, currency: 'USD' },
        { date: '2026-08-09', side: 'SELL', qty: 4, price: 200, currency: 'USD' }], '2026-08-09', usd);
    assert.strictEqual(Math.round(partial.days), 6 * 365 + 1);      // one leap day (2024) in the window
    assert.strictEqual(partial.lots, 1);
    // Fully closed, or nothing usable: null rather than a misleading zero.
    assert.strictEqual(holdingAge([
        { date: '2020-08-09', side: 'BUY', qty: 10, price: 100, currency: 'USD' },
        { date: '2026-08-09', side: 'SELL', qty: 10, price: 200, currency: 'USD' }], '2026-08-09', usd), null);
    assert.strictEqual(holdingAge([], '2026-08-09', usd), null);
    assert.strictEqual(holdingAge(null, '2026-08-09', usd), null);
    // Different currencies are weighted through the rate, so one leg cannot dominate by denomination.
    const fxAge = holdingAge([
        { date: '2016-08-09', side: 'BUY', qty: 1, price: 100, currency: 'JPY' },     // ~$1 of cost
        { date: '2025-08-09', side: 'BUY', qty: 1, price: 100, currency: 'USD' }],    // $100 of cost
        '2026-08-09', c => (c === 'JPY' ? 0.01 : 1));
    assert.ok(Math.abs(fxAge.days - (10 * 365 * (1 / 101) + 365 * (100 / 101))) < 3);
    // build() surfaces it per row, pooling the legs of a multi-listing group.
    const heldRows = build([
        { yahoo: 'A', group: 'G', geography: 'US', currency: 'USD', qty: 1, costLC: 100,
          trades: [{ date: '2024-08-09', side: 'BUY', qty: 1, price: 100, currency: 'USD' }] }],
        { USD: 1 }, { A: { priceUSD: 120, price: 120, currency: 'USD' } }, 'company', '2026-08-09');
    assert.ok(Math.abs(heldRows[0].held.days - 2 * 365) < 2);

    // fiscalQuarter: the label a broker's earnings notice uses, for off-calendar filers.
    // Disney's year ends late September, so the quarter this app calls "Qtr Jun '26" is the
    // "Q3 '26" its notice names — the mismatch that prompted this.
    const disneyYears = [{ date: '2024-09-30' }, { date: '2025-09-30' }];
    assert.strictEqual(fiscalQuarter('2025-12-31', disneyYears).label, 'Q1 FY26');
    assert.strictEqual(fiscalQuarter('2026-03-31', disneyYears).label, 'Q2 FY26');
    assert.strictEqual(fiscalQuarter('2026-06-30', disneyYears).label, 'Q3 FY26');
    assert.strictEqual(fiscalQuarter('2026-09-30', disneyYears).label, 'Q4 FY26');  // ON the year end is Q4, not Q0
    // A March filer: Jun is Q1 of the year ending the following March.
    assert.strictEqual(fiscalQuarter('2025-06-30', [{ date: '2026-03-31' }]).label, 'Q1 FY26');
    assert.strictEqual(fiscalQuarter('2026-03-31', [{ date: '2026-03-31' }]).label, 'Q4 FY26');
    // A December filer needs no second label — "Qtr Jun '26" already is Q2 2026.
    assert.strictEqual(fiscalQuarter('2026-06-30', [{ date: '2025-12-31' }]), null);
    // Nothing to derive from, or a period end off the quarter grid: say nothing.
    assert.strictEqual(fiscalQuarter('2026-06-30', []), null);
    assert.strictEqual(fiscalQuarter('2026-05-31', [{ date: '2025-09-30' }]), null);

    console.log('selftest ok');
}
