// Fetches quotes + FX rates from Yahoo Finance, writes prices.json.
// Run by .github/workflows/prices.yml; also `node fetch-prices.js` locally.
const fs = require('fs');
const { holdings } = require('./holdings.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const DAY = 86400;

// Fractional change (0.25 = +25%) from the first close on/after cutoff, to current.
// Fractions, not whole percents: the page formats them, and every other ratio in
// this codebase is a fraction. Rounded to 4dp purely to keep prices.json small.
function pctFrom(timestamps, closes, cutoffTs, current) {
    for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= cutoffTs && closes[i] != null) {
            return Math.round(((current - closes[i]) / closes[i]) * 1e4) / 1e4;
        }
    }
    return null;
}

function movements(timestamps, closes, current, now = Date.now() / 1000) {
    const jan1 = Math.floor(Date.UTC(new Date(now * 1000).getUTCFullYear(), 0, 1) / 1000);
    return {
        '7d': pctFrom(timestamps, closes, now - 7 * DAY, current),
        '1m': pctFrom(timestamps, closes, now - 30 * DAY, current),
        '3m': pctFrom(timestamps, closes, now - 91 * DAY, current),
        '6m': pctFrom(timestamps, closes, now - 182 * DAY, current),
        '1y': pctFrom(timestamps, closes, now - 365 * DAY, current),
        'ytd': pctFrom(timestamps, closes, jan1, current),
    };
}

// One request per ticker: a year of daily closes covers every period column.
async function fetchTicker(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = (await res.json()).chart?.result?.[0];
    if (!r?.meta?.regularMarketPrice) throw new Error('no price in response');
    const price = r.meta.regularMarketPrice;
    const timestamps = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    return {
        price,
        // Trust Yahoo over the workbook: .L tickers quote in pence ("GBp"), .T in JPY.
        currency: r.meta.currency || 'USD',
        ...movements(timestamps, closes, price),
        series: { timestamps, closes }, // stripped before writing; only used to build NAV history
    };
}

// GBp (pence) is GBP/100. Everything else needs a real FX rate.
function rateFor(code, rates) {
    if (code === 'GBp' || code === 'Gbpence') return rates.GBP / 100;
    return rates[code];
}

const isoDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// Portfolio value over the last year, valued daily.
//
// ponytail: assumes TODAY's share counts and TODAY's FX for every past day. It answers
// "what would this basket have been worth back then", not "what was my account worth" —
// buys, sells and FX drift are invisible. Real NAV needs the Tradelog replayed; do that
// only if this proxy starts misleading you.
function navHistory(holdings, quotes, rates) {
    // Exchanges keep different calendars, so use the union of all trading days.
    const days = [...new Set(
        holdings.flatMap(h => quotes[h.yahoo]?.series.timestamps.map(isoDay) ?? [])
    )].sort();

    const seriesFor = {};
    for (const h of holdings) {
        const { timestamps, closes } = quotes[h.yahoo].series;
        const byDay = new Map();
        timestamps.forEach((ts, i) => { if (closes[i] != null) byDay.set(isoDay(ts), closes[i]); });
        seriesFor[h.yahoo] = byDay;
    }

    // Seed with each ticker's earliest close so a recently-listed line (NW0.DE has ~113
    // bars) is held flat at its first price instead of counting as zero, which would
    // fake a ramp — or, if we trimmed to full coverage instead, cost everyone else
    // half a year of history. Distortion is bounded by that holding's size.
    const last = {};
    for (const h of holdings) {
        const first = seriesFor[h.yahoo].keys().next().value;
        if (first !== undefined) last[h.yahoo] = seriesFor[h.yahoo].get(first);
    }

    const values = [];
    for (const day of days) {
        let total = 0;
        for (const h of holdings) {
            const close = seriesFor[h.yahoo].get(day) ?? last[h.yahoo]; // forward-fill holidays
            if (close == null) continue;
            last[h.yahoo] = close;
            total += h.qty * close * rateFor(quotes[h.yahoo].currency, rates);
        }
        values.push(Math.round(total));
    }
    return { days, values };
}

const sleep = () => new Promise(r => setTimeout(r, 300)); // ponytail: fixed delay; backoff if Yahoo starts 429ing

async function main() {
    const tickers = [...new Set(holdings.map(h => h.yahoo))];
    const quotes = {};
    const failed = [];

    for (const t of tickers) {
        try {
            quotes[t] = await fetchTicker(t);
            console.log(`ok   ${t} ${quotes[t].price} ${quotes[t].currency}`);
        } catch (e) {
            failed.push(t);
            console.error(`FAIL ${t}: ${e.message}`);
        }
        await sleep();
    }
    // Refuse to publish a gutted file — better to keep yesterday's prices than show a broken page.
    if (Object.keys(quotes).length < tickers.length * 0.8) {
        throw new Error(`only ${Object.keys(quotes).length}/${tickers.length} tickers fetched; not writing`);
    }

    // Every currency in play: what the workbook declares, plus what Yahoo actually quotes in.
    const declared = holdings.map(h => h.currency === 'Gbpence' ? 'GBp' : h.currency);
    const needed = [...new Set([...declared, ...Object.values(quotes).map(q => q.currency)])]
        .map(c => c === 'GBp' ? 'GBP' : c)
        .filter(c => c !== 'USD');

    const rates = { USD: 1 };
    for (const c of [...new Set(needed)]) {
        try {
            rates[c] = (await fetchTicker(`${c}USD=X`)).price;
            console.log(`ok   ${c}USD=X ${rates[c]}`);
        } catch (e) {
            throw new Error(`missing FX rate for ${c} (${e.message}); not writing`);
        }
        await sleep();
    }

    // Convert each quote to USD here so the page does no currency guessing.
    for (const [t, q] of Object.entries(quotes)) {
        const rate = rateFor(q.currency, rates);
        if (!rate) throw new Error(`no rate for ${q.currency} (${t}); not writing`);
        q.priceUSD = q.price * rate;
    }

    const priced = holdings.filter(h => quotes[h.yahoo]);
    const nav = navHistory(priced, quotes, rates);

    for (const q of Object.values(quotes)) delete q.series; // raw closes would 10x the file

    fs.writeFileSync('prices.json', JSON.stringify({
        updated: new Date().toISOString(),
        rates,
        quotes,
        nav,
        failed,
    }, null, 1));
    console.log(`wrote prices.json (${Object.keys(quotes).length} tickers, ${failed.length} failed, ${nav.days.length} nav days)`);
}

function selftest() {
    const assert = require('assert');
    const now = 1000 * DAY;
    const ts = [now - 10 * DAY, now - 5 * DAY, now - 1 * DAY];
    const closes = [50, 80, 90];
    // Fractions, not whole percents: 100 vs the 80 at the 7d cutoff = +0.25
    assert.strictEqual(pctFrom(ts, closes, now - 7 * DAY, 100), 0.25);
    // 1y cutoff precedes everything; falls back to the 50 = +100%
    assert.strictEqual(pctFrom(ts, closes, now - 365 * DAY, 100), 1);
    // a fall is negative, not a magnitude
    assert.strictEqual(pctFrom(ts, closes, now - 7 * DAY, 40), -0.5);
    // cutoff after every sample = no data
    assert.strictEqual(pctFrom(ts, closes, now, 100), null);
    // nulls are skipped, not treated as zero
    assert.strictEqual(pctFrom(ts, [null, 80, 90], now - 365 * DAY, 100), 0.25);
    assert.strictEqual(pctFrom([], [], now, 100), null);

    assert.strictEqual(rateFor('GBp', { GBP: 2 }), 0.02);
    assert.strictEqual(rateFor('Gbpence', { GBP: 2 }), 0.02);

    // NAV: two holdings, one priced in HKD, over three trading days.
    const d = ['2026-01-05', '2026-01-06', '2026-01-07'].map(s => Date.parse(s) / 1000);
    const q = {
        A: { currency: 'USD', series: { timestamps: d, closes: [10, 11, 12] } },
        B: { currency: 'HKD', series: { timestamps: d, closes: [100, 100, 100] } },
    };
    const hold = [{ yahoo: 'A', qty: 2 }, { yahoo: 'B', qty: 1 }];
    const nav = navHistory(hold, q, { USD: 1, HKD: 0.1 });
    assert.deepStrictEqual(nav.values, [30, 32, 34]); // 2*close + 100*0.1

    // A gap (holiday) forward-fills rather than dropping the holding to zero.
    const gap = { A: { currency: 'USD', series: { timestamps: d, closes: [10, null, 12] } } };
    assert.deepStrictEqual(navHistory([{ yahoo: 'A', qty: 1 }], gap, { USD: 1 }).values, [10, 10, 12]);

    // A holding whose history starts late is held flat at its first close, so it adds a
    // constant instead of a fake ramp from zero. Full date range is preserved.
    const late = {
        A: { currency: 'USD', series: { timestamps: d, closes: [10, 10, 10] } },
        B: { currency: 'USD', series: { timestamps: d.slice(2), closes: [5] } },
    };
    const back = navHistory([{ yahoo: 'A', qty: 1 }, { yahoo: 'B', qty: 1 }], late, { USD: 1 });
    assert.strictEqual(back.days.length, 3);
    assert.deepStrictEqual(back.values, [15, 15, 15]);

    console.log('selftest ok');
}

if (process.argv[2] === '--selftest') selftest();
else main().catch(e => { console.error(e.message); process.exit(1); });
