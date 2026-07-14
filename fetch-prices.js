// Fetches quotes + FX rates from Yahoo Finance, writes prices.json.
// Run by .github/workflows/prices.yml; also `node fetch-prices.js` locally.
const fs = require('fs');
const { holdings } = require('./holdings.json');
const { cohortMV, twr } = require('./portfolio.js'); // local, dependency-free — CI stays clean

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

// Yahoo gates EPS behind a crumb+cookie handshake (unlike the chart endpoint above,
// which is why everything else in this file uses only that). Best-effort: a failed
// handshake just means no auto EPS this run — meta.json's manual `eps`/`specialEps`
// (via holdings.json) still drive the PE columns, same as a missing quote does elsewhere.
//
// The crumb endpoint's own Set-Cookie is not sufficient on its own — Yahoo's quote API
// 401s on it. It needs a real session cookie first, from fc.yahoo.com (this is the same
// two-step dance yfinance and other Yahoo scrapers settled on after Yahoo tightened this
// in 2023-24). Both requests below must reuse that one cookie.
async function getCrumb() {
    const sessionRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } });
    const cookie = (sessionRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('no session cookie from fc.yahoo.com');

    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, Cookie: cookie },
    });
    if (!crumbRes.ok) throw new Error(`HTTP ${crumbRes.status}`);
    const crumb = (await crumbRes.text()).trim();
    if (!crumb) throw new Error('no crumb in response');
    return { crumb, cookie };
}

// Pure parse, kept separate from the fetch so it's selftest-able without a network call.
function parseEps(json) {
    const eps = {};
    for (const r of json.quoteResponse?.result || []) {
        if (typeof r.epsTrailingTwelveMonths === 'number') eps[r.symbol] = r.epsTrailingTwelveMonths;
    }
    return eps;
}

// Yahoo's fundamentals are in the major currency unit even for tickers whose price
// quote is in a minor unit (pence) — same GBp quirk rateFor() handles for FX.
function epsInQuoteUnits(eps, currency) {
    return (currency === 'GBp' || currency === 'Gbpence') ? eps * 100 : eps;
}

// One batched request for every ticker's trailing EPS — v7/finance/quote allows
// comma-separated symbols, so this is a single round-trip regardless of holding count.
async function fetchEps(tickers, { crumb, cookie }) {
    const symbols = tickers.map(t => t.replace('^', '%5E')).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseEps(await res.json());
}

// Annual diluted EPS per fiscal year. Yahoo caps this at ~4 points regardless of the range
// asked for (quarterly gives only ~5, trailing ~11), so 4 fiscal years is the real ceiling
// on free earnings history — the trough below is "cheapest in ~4y", not 5.
async function fetchAnnualEps(ticker, { crumb, cookie }) {
    const now = Math.floor(Date.now() / 1000);
    const sym = ticker.replace('^', '%5E');
    const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${sym}`
        + `?symbol=${sym}&type=annualDilutedEPS&period1=${now - 6 * 365 * DAY}&period2=${now}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = (await res.json()).timeseries?.result?.[0]?.annualDilutedEPS || [];
    return arr
        .filter(x => x && x.asOfDate && typeof x.reportedValue?.raw === 'number')
        .map(x => ({ date: x.asOfDate, eps: x.reportedValue.raw }));
}

const yearBefore = day => {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
};

// The cheapest multiple this ever traded at: for each fiscal year, the lowest close *within
// that year* over that year's own earnings, then the minimum across years.
//
// Pairing an old low with TODAY's EPS would be meaningless — a company that has since grown
// into its earnings (NVDA's 2022 low over its 2026 EPS) would read as absurdly cheap. The
// low has to be measured against what the business was earning at the time.
//
// Pure, so it is selftest-able. days/closes are the weekly history; eps is in Yahoo's major
// unit and gets scaled into the quote's unit (the GBp/pence trap) before dividing.
function troughPe(annualEps, days, closes, currency) {
    let best = null;
    for (const { date, eps } of annualEps) {
        const e = epsInQuoteUnits(eps, currency);
        if (!(e > 0)) continue;                        // a loss year has no meaningful multiple
        const from = yearBefore(date);
        let low = null, lowDate = null;
        for (let i = 0; i < days.length; i++) {
            if (days[i] <= from || days[i] > date) continue;
            const c = closes[i];
            if (c == null) continue;
            if (low == null || c < low) { low = c; lowDate = days[i]; }
        }
        if (low == null) continue;
        const pe = low / e;
        if (best == null || pe < best.peLow) best = { peLow: pe, lowPrice: low, lowEps: e, lowDate };
    }
    return best;
}

// Last run's EPS, straight out of the committed prices.json. The crumb handshake is the
// one thing here Yahoo actively gates, and it 401/429s from CI's shared IPs far more than
// from a laptop — without a fallback, one blocked run blanks the whole PE column for
// everyone. Trailing EPS only moves once a quarter, so a stale figure is a fine trade.
function previousEps() {
    try {
        const prev = JSON.parse(fs.readFileSync('prices.json', 'utf8'));
        return Object.fromEntries(Object.entries(prev.quotes || {})
            .filter(([, q]) => typeof q.eps === 'number')
            .map(([t, q]) => [t, q.eps]));
    } catch { return {}; }               // no previous file (first run) — nothing to carry
}

// Annual EPS is reported four times a year, so re-fetching it hourly for every holding is 56
// wasted requests an hour against the one endpoint Yahoo rate-limits hardest. Keep it in the
// repo and refresh only when it ages out — or when a new holding has no history yet.
//
// The *trough* is still recomputed every run (from this store plus the fresh weekly closes),
// which costs nothing and means a new low is picked up the hour it happens.
const EARNINGS = 'earnings.json';
const EARNINGS_MAX_AGE_DAYS = 7;

function loadEarnings() {
    try { return JSON.parse(fs.readFileSync(EARNINGS, 'utf8')); }
    catch { return { updated: null, eps: {} }; }   // first run
}

function earningsStale(store, tickers, now = Date.now()) {
    if (!store.updated) return true;
    if ((now - Date.parse(store.updated)) / 86400e3 >= EARNINGS_MAX_AGE_DAYS) return true;
    return tickers.some(t => !(t in store.eps));   // a holding added since the last refresh
}

// Fresh Yahoo EPS wins and is scaled into the quote's unit. A carried-forward value is
// ALREADY in quote units (it was scaled when written), so scaling it again would multiply
// a pence ticker by 100 a second time.
function resolveEps(fresh, carried, currency) {
    if (typeof fresh === 'number') return epsInQuoteUnits(fresh, currency);
    return typeof carried === 'number' ? carried : undefined;
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

    // Trailing EPS for the PE columns — best-effort; see getCrumb's comment. Never blocks
    // the price write, and never throws past this point. Anything Yahoo doesn't hand us
    // (blocked handshake, or a symbol it has no EPS for) falls back to the last run's value.
    const carried = previousEps();
    let fresh = {};
    let auth = null;                 // reused by the trough-multiple step, after weekly history
    try {
        auth = await getCrumb();
        fresh = await fetchEps(tickers, auth);
    } catch (e) {
        console.error(`skip eps: ${e.message} — falling back to the previous run's EPS`);
    }
    let live = 0, stale = 0;
    for (const t of tickers) {
        if (!quotes[t]) continue;
        const eps = resolveEps(fresh[t], carried[t], quotes[t].currency);
        if (eps === undefined) continue;
        quotes[t].eps = eps;
        fresh[t] != null ? live++ : stale++;
    }
    console.log(`ok   eps for ${live + stale}/${tickers.length} tickers (${live} fresh, ${stale} carried forward)`);

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

    // Annual EPS: read from the repo, refreshed only when stale. See EARNINGS above.
    const store = loadEarnings();
    if (auth && earningsStale(store, tickers)) {
        console.log(`     annual EPS stale (updated ${store.updated || 'never'}) — refreshing`);
        for (const t of tickers) {
            try { store.eps[t] = await fetchAnnualEps(t, auth); }
            catch (e) {
                console.error(`     eps history ${t}: ${e.message}`);
                // Record it as known-empty rather than leaving the key absent: earningsStale
                // treats a missing ticker as "new", so a symbol Yahoo never has fundamentals
                // for would otherwise force a full refetch every single hour.
                if (!(t in store.eps)) store.eps[t] = [];
            }
            await sleep();
        }
        store.updated = new Date().toISOString();
        fs.writeFileSync(EARNINGS, JSON.stringify(store, null, 1));
        console.log(`wrote ${EARNINGS} (${Object.keys(store.eps).length} tickers)`);
    } else {
        console.log(`ok   annual EPS from ${EARNINGS} (updated ${store.updated || 'never'}, no fetch)`);
    }

    // Trough multiple — cheapest close in each fiscal year over THAT year's earnings. Pure and
    // free: stored EPS + this run's weekly closes, so a fresh low shows up the hour it prints.
    let troughOk = 0, troughMissing = 0;
    for (const t of tickers) {
        if (!quotes[t]) continue;
        const low = troughPe(store.eps[t] || [], longHist.days, longHist.closes[t] || [], quotes[t].currency);
        if (!low) { troughMissing++; continue; }
        Object.assign(quotes[t], {
            peLow: Number(low.peLow.toPrecision(6)),
            lowPrice: Number(low.lowPrice.toPrecision(6)),
            lowEps: Number(low.lowEps.toPrecision(6)),
            lowDate: low.lowDate,
        });
        troughOk++;
    }
    console.log(`ok   trough PE for ${troughOk}/${tickers.length} tickers (${troughMissing} no earnings history)`);

    // Year-to-date time-weighted return for the headline KPIs — computed here because the
    // daily closes live in this process and the page loads only prices.json (not history).
    // Deposits/withdrawals removed, so it's investment performance not money added.
    const YEAR_START = new Date().getUTCFullYear() + '-01-01';
    const twrHold = priced.map(h => ({ yahoo: h.yahoo, trades: h.trades || [], quoteCurrency: quotes[h.yahoo].currency }));
    let ytdStart = 0;
    for (let i = 0; i < hist.days.length; i++) if (hist.days[i] < YEAR_START) ytdStart = i; // last close of last year
    const ytdTwr = filter => {
        const { mv, flow } = cohortMV(hist.days, twrHold, hist.closes, rates, filter);
        const t = twr(mv.slice(ytdStart), flow.slice(ytdStart));
        for (let i = t.length - 1; i >= 0; i--) if (t[i] != null) return Number(t[i].toPrecision(4));
        return null;
    };
    const performance = {
        ytdTotal: ytdTwr(null),
        ytdNew: ytdTwr(t => t.date >= YEAR_START && t.side !== 'SELL'),
    };

    for (const q of Object.values(quotes)) delete q.series; // raw closes would 10x the file

    fs.writeFileSync('prices.json', JSON.stringify({
        updated: new Date().toISOString(),
        rates,
        quotes,
        nav,
        performance,
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
    // Yahoo's EPS is in pounds even for a pence-quoted ticker; PE = price/eps needs both
    // in the same unit, so this must match price's unit, not pass the pounds figure through.
    assert.strictEqual(epsInQuoteUnits(0.12, 'GBp'), 12);
    assert.strictEqual(epsInQuoteUnits(3.1, 'USD'), 3.1);

    // resolveEps: fresh Yahoo EPS wins and gets scaled; a carried-forward value is already
    // in quote units and must NOT be scaled again (that would 100x a pence ticker twice).
    assert.strictEqual(resolveEps(0.12, 999, 'GBp'), 12);      // fresh wins, scaled once
    assert.strictEqual(resolveEps(undefined, 12, 'GBp'), 12);  // carried used as-is
    assert.strictEqual(resolveEps(undefined, 3.1, 'USD'), 3.1);
    assert.strictEqual(resolveEps(undefined, undefined, 'USD'), undefined); // no data anywhere

    // earningsStale: refresh on age, on a never-fetched store, or when a holding is new —
    // otherwise the trough would silently have no earnings to divide by.
    const fresh7 = new Date(Date.now() - 3 * 86400e3).toISOString();
    const old7 = new Date(Date.now() - 9 * 86400e3).toISOString();
    assert.strictEqual(earningsStale({ updated: null, eps: {} }, ['A']), true);        // never fetched
    assert.strictEqual(earningsStale({ updated: old7, eps: { A: [] } }, ['A']), true);  // aged out
    assert.strictEqual(earningsStale({ updated: fresh7, eps: { A: [] } }, ['A']), false);
    assert.strictEqual(earningsStale({ updated: fresh7, eps: { A: [] } }, ['A', 'B']), true); // B is new

    // troughPe: each fiscal year's lowest close over THAT year's earnings; cheapest wins.
    // 2024 low 50 / eps 5 = 10.0;  2025 low 90 / eps 6 = 15.0  ->  trough is 10.0, not 90/6.
    const days = ['2024-03-01', '2024-09-01', '2025-03-01', '2025-09-01'];
    const px   = [        60,           50,           90,          120];
    const annual = [{ date: '2024-12-31', eps: 5 }, { date: '2025-12-31', eps: 6 }];
    const tr = troughPe(annual, days, px, 'USD');
    assert.strictEqual(tr.peLow, 10);
    assert.strictEqual(tr.lowPrice, 50);
    assert.strictEqual(tr.lowEps, 5);
    assert.strictEqual(tr.lowDate, '2024-09-01');
    // A loss-making year is skipped, not turned into a negative multiple.
    assert.strictEqual(troughPe([{ date: '2024-12-31', eps: -2 }], days, px, 'USD'), null);
    // No earnings history at all (ETFs, gold, bitcoin) -> null, never NaN.
    assert.strictEqual(troughPe([], days, px, 'USD'), null);
    // Pence again: EPS arrives in pounds, closes are in pence, so EPS must be scaled first
    // or the multiple comes out 100x too high.
    assert.strictEqual(troughPe([{ date: '2024-12-31', eps: 0.5 }], days, px, 'GBp').peLow, 1); // 50 / (0.5*100)
    const shaped = shape({
        meta: { regularMarketPrice: 100, currency: 'USD' }, timestamp: [],
        indicators: { quote: [{ close: [] }] },
        events: { dividends: { a: { amount: 1.25 }, b: { amount: 0.75 } } },
    });
    assert.strictEqual(shaped.divTTM, 2);
    assert.strictEqual(shaped.divYield, 0.02);

    // parseEps skips symbols with no EPS (indices, some ETFs) rather than writing null.
    assert.deepStrictEqual(
        parseEps({ quoteResponse: { result: [{ symbol: 'AAPL', epsTrailingTwelveMonths: 6.5 }, { symbol: '^GSPC' }] } }),
        { AAPL: 6.5 }
    );
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
