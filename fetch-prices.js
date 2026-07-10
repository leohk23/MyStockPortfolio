// Fetches quotes + FX rates from Yahoo Finance, writes prices.json.
// Run by .github/workflows/prices.yml; also `node fetch-prices.js` locally.
const fs = require('fs');
const { holdings } = require('./holdings.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const DAY = 86400;
const weekEnd = ts => ts + ((5 - new Date(ts * 1000).getUTCDay() + 7) % 7) * DAY;

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
// Retries transient failures — CI runs from a shared IP that Yahoo rate-limits,
// and a single hiccup would otherwise silently drop a holding from the dashboard.
async function fetchTicker(ticker, attempts = 3) {
    // Index symbols start with a caret (^GSPC); encode it so the URL stays valid.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.replace('^', '%5E')}?range=1y&interval=1d&events=div`;
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const r = (await res.json()).chart?.result?.[0];
            if (!r?.meta?.regularMarketPrice) throw new Error('no price in response');
            return shape(r);
        } catch (e) {
            lastErr = e;
            if (a < attempts - 1) await new Promise(r => setTimeout(r, 600 * (a + 1)));
        }
    }
    throw lastErr;
}

function shape(r) {
    const price = r.meta.regularMarketPrice;
    const timestamps = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    const divTTM = Object.values(r.events?.dividends || {}).reduce((sum, d) => sum + (d.amount || 0), 0);
    return {
        price,
        // Trust Yahoo over the workbook: .L tickers quote in pence ("GBp"), .T in JPY.
        currency: r.meta.currency || 'USD',
        divTTM: Number(divTTM.toPrecision(6)),
        divYield: price ? Number((divTTM / price).toPrecision(6)) : null,
        ...movements(timestamps, closes, price),
        series: { timestamps, closes }, // stripped before writing; only used to build NAV history
    };
}

// Weekly full-history closes for the long chart ranges (2Y/5Y/All). Weekly keeps the
// file bounded — daily over 10y × 57 tickers would be several MB. Same {currency,series}
// shape as the daily quotes, so alignedCloses/navHistory work on it unchanged.
async function fetchWeekly(ticker, attempts = 3) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.replace('^', '%5E')}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1wk`;
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const r = (await res.json()).chart?.result?.[0];
            if (!r?.timestamp) throw new Error('no history in response');
            if (r.meta?.dataGranularity !== '1wk') throw new Error(`Yahoo returned ${r.meta?.dataGranularity || 'unknown'} history`);
            return { currency: r.meta?.currency || 'USD', series: { timestamps: r.timestamp.map(weekEnd), closes: r.indicators?.quote?.[0]?.close || [] } };
        } catch (e) {
            lastErr = e;
            if (a < attempts - 1) await new Promise(r => setTimeout(r, 600 * (a + 1)));
        }
    }
    throw lastErr;
}

// GBp (pence) is GBP/100. Everything else needs a real FX rate.
function rateFor(code, rates) {
    if (code === 'GBp' || code === 'Gbpence') return rates.GBP / 100;
    return rates[code];
}

const isoDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// Per-ticker native closes aligned to one shared calendar (exchanges differ).
// Leading days before a ticker's first close are null; interior gaps (holidays,
// half-days) forward-fill. This is the "honest" matrix used to chart a single stock;
// the NAV sum below seeds the leading nulls so a late listing doesn't fake a ramp.
function alignedCloses(tickers, quotes) {
    const days = [...new Set(
        tickers.flatMap(t => quotes[t]?.series.timestamps.map(isoDay) ?? [])
    )].sort();

    const closes = {};
    for (const t of tickers) {
        const { timestamps, closes: cs } = quotes[t].series;
        const byDay = new Map();
        timestamps.forEach((ts, i) => { if (cs[i] != null) byDay.set(isoDay(ts), cs[i]); });
        const arr = [];
        let last = null, seen = false;
        for (const day of days) {
            if (byDay.has(day)) { last = byDay.get(day); seen = true; }
            arr.push(seen ? last : null);
        }
        closes[t] = arr;
    }
    return { days, closes };
}

// Portfolio value over the supplied price history.
//
// ponytail: assumes TODAY's share counts and TODAY's FX for every past day. It answers
// "what would this basket have been worth back then", not "what was my account worth" —
// buys, sells and FX drift are invisible. Real NAV needs the Tradelog replayed; do that
// only if this proxy starts misleading you.
function navHistory(holdings, quotes, rates) {
    const tickers = [...new Set(holdings.map(h => h.yahoo))];
    const { days, closes } = alignedCloses(tickers, quotes);

    // Seed each ticker's leading nulls with its first real close so a recently-listed
    // line (NW0.DE has ~113 bars) is held flat at its first price instead of counting
    // as zero — which would fake a ramp. Distortion is bounded by that holding's size.
    const seed = {};
    for (const t of tickers) seed[t] = closes[t].find(v => v != null);

    const values = days.map((_, i) => {
        let total = 0;
        for (const h of holdings) {
            const close = closes[h.yahoo][i] ?? seed[h.yahoo];
            if (close == null) continue;
            total += h.qty * close * rateFor(quotes[h.yahoo].currency, rates);
        }
        return Math.round(total);
    });
    return { days, values };
}

const sleep = () => new Promise(r => setTimeout(r, 300)); // ponytail: fixed delay; backoff if Yahoo starts 429ing

// Chart benchmarks: Yahoo symbol -> display name. Rebased to % on the client.
const BENCHMARKS = { '^GSPC': 'S&P 500', '^HSI': 'HSI' };

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

    // Benchmark indices for the chart overlay. Best-effort: a failed benchmark just
    // means that toggle has no data, never a broken price file.
    const benchQuotes = {};
    for (const sym of Object.keys(BENCHMARKS)) {
        try {
            benchQuotes[sym] = await fetchTicker(sym);
            console.log(`ok   ${sym} ${benchQuotes[sym].price} (${BENCHMARKS[sym]})`);
        } catch (e) {
            console.error(`skip ${sym}: ${e.message}`);
        }
        await sleep();
    }

    // Per-instrument close history (native currency) for charting a single stock,
    // plus the benchmarks, on one shared calendar. Separate file, loaded by the page
    // only when needed (stock click, benchmark toggle, or long range) so first paint stays lean.
    const histTickers = [...priced.map(h => h.yahoo), ...Object.keys(benchQuotes)];
    const dailyHistory = { ...quotes, ...benchQuotes };
    const hist = alignedCloses(histTickers, dailyHistory);
    const weeklyQuotes = {};
    for (const t of histTickers) {
        try {
            weeklyQuotes[t] = await fetchWeekly(t);
            console.log(`ok   ${t} weekly`);
        } catch (e) {
            weeklyQuotes[t] = dailyHistory[t];
            console.error(`fallback ${t} weekly: ${e.message}`);
        }
        await sleep();
    }
    const weeklyTickers = Object.keys(weeklyQuotes);
    const longHist = alignedCloses(weeklyTickers, weeklyQuotes);
    const longNav = navHistory(priced.filter(h => weeklyQuotes[h.yahoo]), weeklyQuotes, rates);
    const round = arr => arr.map(v => v == null ? null : Number(v.toPrecision(6)));
    const closes = {};
    for (const t of Object.keys(hist.closes)) closes[t] = round(hist.closes[t]);
    const longCloses = {};
    for (const t of Object.keys(longHist.closes)) longCloses[t] = round(longHist.closes[t]);
    const benchmarks = {};
    for (const [sym, name] of Object.entries(BENCHMARKS)) {
        if (benchQuotes[sym]) benchmarks[sym] = { name, currency: benchQuotes[sym].currency };
    }
    fs.writeFileSync('history.json', JSON.stringify({
        updated: new Date().toISOString(),
        days: hist.days,
        closes,
        benchmarks,
        long: { days: longHist.days, closes: longCloses, nav: longNav },
    }, null, 1));

    for (const q of Object.values(quotes)) delete q.series; // raw closes would 10x the file

    fs.writeFileSync('prices.json', JSON.stringify({
        updated: new Date().toISOString(),
        rates,
        quotes,
        nav,
        failed,
    }, null, 1));
    const kb = f => (fs.statSync(f).size / 1024).toFixed(0);
    console.log(`wrote prices.json (${Object.keys(quotes).length} tickers, ${failed.length} failed, ${nav.days.length} nav days, ${kb('prices.json')}KB)`);
    console.log(`wrote history.json (${Object.keys(closes).length} series, ${Object.keys(benchmarks).length} benchmarks, ${kb('history.json')}KB)`);
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
    const shaped = shape({
        meta: { regularMarketPrice: 100, currency: 'USD' }, timestamp: [],
        indicators: { quote: [{ close: [] }] },
        events: { dividends: { a: { amount: 1.25 }, b: { amount: 0.75 } } },
    });
    assert.strictEqual(shaped.divTTM, 2);
    assert.strictEqual(shaped.divYield, 0.02);
    // Exchanges timestamp the same weekly bar on different UTC days; align both to Friday.
    assert.strictEqual(isoDay(weekEnd(Date.parse('2021-07-11') / 1000)), '2021-07-16');
    assert.strictEqual(isoDay(weekEnd(Date.parse('2021-07-12') / 1000)), '2021-07-16');

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

    // alignedCloses keeps leading nulls honest (no backfill) so a single-stock chart
    // starts at the IPO, while interior holiday gaps forward-fill.
    const aligned = alignedCloses(['A', 'B'], late);
    assert.deepStrictEqual(aligned.days.length, 3);
    assert.deepStrictEqual(aligned.closes.A, [10, 10, 10]);
    assert.deepStrictEqual(aligned.closes.B, [null, null, 5]); // null before B's first close
    assert.deepStrictEqual(alignedCloses(['A'], gap).closes.A, [10, 10, 12]);

    console.log('selftest ok');
}

if (process.argv[2] === '--selftest') selftest();
else main().catch(e => { console.error(e.message); process.exit(1); });
