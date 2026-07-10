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
        const leg = {
            ...h, quote, since,
            cost: h.costLC * rate,
            value: h.qty * quote.priceUSD,
            income: h.qty * (h.divTTM || 0) * rate,
        };
        const key = String(h[field]);
        if (!groups.has(key)) groups.set(key, { name: key, legs: [] });
        groups.get(key).legs.push(leg);
    }

    const rows = [...groups.values()].map(g => {
        const sum = k => g.legs.reduce((a, l) => a + l[k], 0);
        const cost = sum('cost'), value = sum('value');
        g.legs.sort((a, b) => b.value - a.value);
        // A row's "last trade" is the most recent across its instruments.
        const traded = g.legs.filter(l => l.lastTrade);
        const recent = traded.sort((a, b) => b.lastTrade.date.localeCompare(a.lastTrade.date))[0];
        const single = g.legs.length === 1 ? g.legs[0] : null;
        return {
            ...g, cost, value,
            gain: value - cost,
            gainPct: cost ? (value - cost) / cost : null,
            yield: value ? sum('income') / value : null,
            moves: Object.fromEntries(PERIODS.map(p => [p, weightedMove(g.legs, p)])),
            lastTrade: recent ? recent.lastTrade : null,
            since: recent ? recent.since : null,
            // Current price per share only makes sense for a single instrument; shown native.
            price: single ? single.quote.price : null,
            priceCurrency: single ? single.quote.currency : null,
            // The instrument a click on this row charts: its largest leg.
            primaryYahoo: g.legs[0].yahoo,
        };
    });
    rows.sort((a, b) => b.value - a.value);
    return rows;
}

const portfolioLib = { rateFor, weightedMove, build, PERIODS, DIMENSIONS };
if (typeof module !== 'undefined') module.exports = portfolioLib;
else if (typeof window !== 'undefined') window.portfolioLib = portfolioLib;

if (typeof require !== 'undefined' && require.main === module && process.argv[2] === '--selftest') {
    const assert = require('assert');
    const rates = { USD: 1, GBP: 2, HKD: 0.1 };

    // Pence is pounds/100, under either spelling.
    assert.strictEqual(rateFor('GBp', rates), 0.02);
    assert.strictEqual(rateFor('Gbpence', rates), 0.02);
    assert.strictEqual(rateFor('USD', rates), 1);

    // Weighted by value: a $300 leg at +10% and a $100 leg at -10% => +5%.
    const legs = [{ value: 300, quote: { '1y': 0.10 } }, { value: 100, quote: { '1y': -0.10 } }];
    assert.strictEqual(weightedMove(legs, '1y'), 0.05);
    // A leg with no data for the period must not drag the average toward zero.
    assert.strictEqual(weightedMove([...legs, { value: 1000, quote: { '1y': null } }], '1y'), 0.05);
    assert.strictEqual(weightedMove([{ value: 5, quote: { '1y': null } }], '1y'), null);
    assert.strictEqual(weightedMove([], '1y'), null);

    // Two instruments of one company collapse into a single row, costs and values summed.
    const holdings = [
        { yahoo: 'A', group: 'BYD', geography: 'China', currency: 'USD', qty: 10, costLC: 100, divTTM: 0 },
        { yahoo: 'B', group: 'BYD', geography: 'China', currency: 'HKD', qty: 100, costLC: 1000, divTTM: 0 },
        { yahoo: 'C', group: 'Solo', geography: 'US', currency: 'USD', qty: 1, costLC: 50, divTTM: 2 },
    ];
    const quotes = {
        A: { price: 20, priceUSD: 20, '1y': 0.5 }, B: { price: 20, priceUSD: 2, '1y': 0 }, C: { price: 100, priceUSD: 100, '1y': null },
    };
    const rows = build(holdings, rates, quotes);
    assert.strictEqual(rows.length, 2);
    const byd = rows.find(r => r.name === 'BYD');
    assert.strictEqual(byd.legs.length, 2);
    assert.strictEqual(byd.cost, 100 * 1 + 1000 * 0.1);   // 200
    assert.strictEqual(byd.value, 10 * 20 + 100 * 2);     // 400
    assert.strictEqual(byd.gain, 200);
    assert.strictEqual(byd.gainPct, 1);
    assert.strictEqual(byd.moves['1y'], 0.25);            // 200@+50% and 200@0%
    // Rows are sorted by value, and yield uses trailing dividends over market value.
    assert.strictEqual(rows[0].name, 'BYD');
    assert.strictEqual(rows[1].yield, 2 / 100);

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
