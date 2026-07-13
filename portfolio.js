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

const PERIODS = ['7d', '1m', '3m', '6m', '1y', 'ytd'];

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

// Values today's shares in a selected company/geography basket across a shared
// history calendar. Leading pre-listing gaps are held flat at the first close,
// matching the whole-portfolio NAV proxy.
function basketHistory(days, closes, legs, rates) {
    const seeds = Object.fromEntries(legs.map(l => [l.yahoo, closes[l.yahoo]?.find(v => v != null)]));
    return days.map((_, i) => legs.reduce((total, leg) => {
        const close = closes[leg.yahoo]?.[i] ?? seeds[leg.yahoo];
        return total + (close == null ? 0 : leg.qty * close * rateFor(leg.quote.currency, rates));
    }, 0));
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

// holdings[] + prices.json -> one row per bucket of `dimension`, sorted by market value.
// Each row keeps its constituent instruments as `legs` (a single-instrument row has one).
function build(holdings, rates, quotes, dimension = 'company') {
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
        // PE uses native price ÷ native EPS (both in the same currency) so no FX enters a
        // ratio that shouldn't need any. eps: Yahoo's auto-fetched trailing EPS, falling
        // back to a manual meta.json value. specialPe uses a stock-tailored earnings figure
        // (FFO, adjusted EPS, ...) when meta.json sets one; otherwise it's the same as pe.
        const eps = quote.eps ?? h.eps ?? null;
        const pe = eps > 0 ? quote.price / eps : null;
        const specialEps = h.specialEps ?? eps;
        const specialPe = specialEps > 0 ? quote.price / specialEps : null;
        const leg = {
            ...h, quote, since, pe, specialPe,
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
            // Current price per share only makes sense for a single instrument; shown native.
            price: single ? single.quote.price : null,
            priceCurrency: single ? single.quote.currency : null,
            pe: single ? single.pe : null,
            specialPe: single ? single.specialPe : null,
            specialEpsLabel: single ? single.specialEpsLabel || null : null,
            // The instrument a click on this row charts: its largest leg.
            primaryYahoo: g.legs[0].yahoo,
        };
    });
    rows.sort((a, b) => b.value - a.value);
    return rows;
}

const portfolioLib = { rateFor, weightedMove, gainHistory, basketHistory, cohortMV, twr, build, PERIODS, DIMENSIONS };
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

    const basket = basketHistory(
        ['2026-01-01', '2026-01-02', '2026-01-03'],
        { A: [10, 11, 12], B: [null, 20, 21] },
        [{ yahoo: 'A', qty: 2, quote: { currency: 'USD' } }, { yahoo: 'B', qty: 1, quote: { currency: 'HKD' } }],
        rates,
    );
    assert.deepStrictEqual(basket, [22, 24, 26.1]);

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

    console.log('selftest ok');
}
