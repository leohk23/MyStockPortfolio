#!/usr/bin/env node
// backfill-gilts.js — a gilt's daily closes from before the price bot started storing them.
//
// RUN BY HAND, LOCALLY. Never in CI, never on a schedule. `npm run backfill-gilts`.
//
// Why this exists
// ---------------
// Yahoo lists no gilts, so fetch-prices.js prices them from the London Stock Exchange (fetchLse).
// The exchange has no history endpoint, so the bot stores each weekday's mid as it goes
// (`lseCloses` in prices.json), and a gilt's chart starts the day it was added here.
//
// onvista.de, a German market-data site, carries every gilt by ISIN with the London Stock
// Exchange as one of its venues, and serves that venue's daily history back to the gilt's issue.
// Its API is undocumented, the same risk class as stockanalysis.com in backfill-earnings.js, so it
// is used the same way: once, by hand, result committed to gilt-history.json. The bot only reads
// that file, so if onvista changes shape it breaks here and nowhere else.
//
// What the figures are
// --------------------
// onvista's close is the day's LAST TRADE on the exchange, not the mid of the order book the bot
// stores. On T31's first twelve stored days the last trade sat 0.055 below the mid on average
// (a typical day moves 0.16). So the bot uses these only for the days BEFORE its first stored mid
// (fetch-prices.js withBackfill), and the page labels those days. Clean price, per £100 nominal,
// like everything else a gilt is quoted in.
//
// The source proves itself, per gilt
// ----------------------------------
// The days onvista has that the bot also stored must agree, each within MAX_GAP of the mid: a last
// trade lies inside the day's spread, while a wrong instrument or a price in another unit misses by
// points. Too few days to compare, or one outside, and the gilt is refused whole; its existing
// entry (if any) is left as it was.

const fs = require('fs');

const OV = 'https://api.onvista.de/api/v1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OUT = 'gilt-history.json';
const MAX_GAP = 0.5;        // per £100 nominal: T31's bid-offer spread is ~0.3
const MIN_OVERLAP = 5;      // days both sources have

async function getJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
}

// onvista's bond page by ISIN, and the London Stock Exchange venue on it, in GBP. Any other venue
// (Stuttgart, Frankfurt, gettex …) is a German market maker's price, not the exchange's.
function lseNotation(snap, isin) {
    if (snap?.instrument?.isin !== isin) throw new Error(`onvista returned ${snap?.instrument?.isin || 'nothing'} for ${isin}`);
    const q = (snap.quoteList?.list || []).find(x => x.market?.codeExchange === 'LSE' && x.isoCurrency === 'GBP');
    if (!q) throw new Error('no London Stock Exchange GBP venue on onvista');
    return { entity: String(snap.instrument.entityValue), notation: String(q.market.idNotation) };
}

// One eod_history response as { 'YYYY-MM-DD': close }. Each bar is stamped 12:00 UTC on its day.
// Weekdays and plausible clean prices only, or the whole response is refused.
function closesOf(e) {
    if (e?.isoCurrency !== 'GBP' || e?.unitType !== 'PCT') throw new Error(`not a GBP price per £100 (${e?.isoCurrency} ${e?.unitType})`);
    const out = {};
    (e.datetimeLast || []).forEach((t, i) => {
        const day = new Date(t * 1000).toISOString().slice(0, 10), v = e.last?.[i];
        if (new Date(day + 'T12:00:00Z').getUTCDay() % 6 === 0) throw new Error(`weekend bar on ${day}`);
        if (!(v > 0 && v < 250)) throw new Error(`implausible close ${v} on ${day}`);
        out[day] = v;
    });
    return out;
}

// eod_history's `range` is a LENGTH counted forward from startDate, not a window back from today:
// range=Y1 from T31's issue returns its first year only. So ask once from long before any gilt in
// issue: that window is empty, but the reply says where the history starts (a reply with no bars
// in it, such as one asked from a Sunday, leaves that out). Then walk forward a chunk at a time.
const PROBE_FROM = '1950-01-01';
async function fetchCloses({ entity, notation }, get = getJson) {
    const url = start => `${OV}/instruments/BOND/${entity}/eod_history?idNotation=${notation}&range=Y5&startDate=${start}`;
    let start = String((await get(url(PROBE_FROM))).datetimeStartAvailableHistory || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('onvista gave no start of history');
    const all = {};
    for (let n = 0; n < 20; n++) {
        const got = closesOf(await get(url(start))), days = Object.keys(got).sort();
        const fresh = days.filter(d => !(d in all));
        Object.assign(all, got);
        if (!fresh.length) break;
        const next = new Date(Date.parse(days[days.length - 1] + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
        if (next <= start) break;
        start = next;
    }
    return all;
}

// The proof: every day both sources have, within MAX_GAP of the stored mid.
function reconcile(back, mids) {
    const days = Object.keys(mids || {}).filter(d => d in back).sort();
    if (days.length < MIN_OVERLAP) return { ok: false, why: `only ${days.length} days to compare with the stored mids (need ${MIN_OVERLAP})` };
    const gaps = days.map(d => back[d] - mids[d]);
    const worst = days[gaps.reduce((k, g, i) => Math.abs(g) > Math.abs(gaps[k]) ? i : k, 0)];
    const max = Math.max(...gaps.map(Math.abs));
    const stats = { days: days.length, meanGap: Number((gaps.reduce((a, b) => a + b, 0) / days.length).toFixed(4)), maxGap: Number(max.toFixed(4)) };
    if (max > MAX_GAP) return { ok: false, why: `${worst}: onvista ${back[worst]} against the stored mid ${mids[worst]}`, ...stats };
    return { ok: true, ...stats };
}

async function main() {
    const meta = JSON.parse(fs.readFileSync('meta.json', 'utf8'));
    let watch = [];
    try { watch = JSON.parse(fs.readFileSync('watchlist.json', 'utf8')); } catch { /* none */ }
    const quotes = JSON.parse(fs.readFileSync('prices.json', 'utf8')).quotes || {};
    let store = {};
    try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }

    const gilts = [...new Set([...Object.values(meta), ...(Array.isArray(watch) ? watch : [])].filter(x => x?.lse).map(x => x.yahoo))];
    const today = new Date().toISOString().slice(0, 10);
    for (const t of gilts) {
        const isin = quotes[t]?.bond?.isin;
        if (!isin) { console.log(`skip ${t}: no ISIN in prices.json yet (run npm run fetch first)`); continue; }
        try {
            const snap = await getJson(`${OV}/bonds/ISIN:${isin}/snapshot`);
            const venue = lseNotation(snap, isin);
            const back = await fetchCloses(venue);
            const check = reconcile(back, quotes[t].lseCloses);
            const days = Object.keys(back).sort();
            if (!check.ok) { console.log(`REFUSED ${t}: ${check.why}`); continue; }
            store[t] = { isin, source: 'onvista.de', market: 'London Stock Exchange', notation: venue.notation,
                basis: 'last trade', fetched: today, check: { days: check.days, meanGap: check.meanGap, maxGap: check.maxGap },
                closes: back };
            console.log(`ok   ${t}: ${days.length} closes, ${days[0]} to ${days[days.length - 1]}; `
                + `${check.days} days checked against the stored mids, last trade ${check.meanGap >= 0 ? '+' : ''}${check.meanGap} on average, worst ${check.maxGap}`);
        } catch (e) {
            console.log(`FAIL ${t}: ${e.message}`);
        }
    }
    const sorted = Object.fromEntries(Object.keys(store).sort().map(k => [k, store[k]]));
    fs.writeFileSync(OUT, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`wrote ${OUT}: ${Object.keys(sorted).length} gilts. Commit it; the next price run uses it.`);
}

if (process.argv.includes('--selftest')) {
    const assert = require('assert');
    const snap = { instrument: { isin: 'GB00BPSNBF73', entityValue: '266511461' }, quoteList: { list: [
        { market: { codeExchange: 'STU', idNotation: 1 }, isoCurrency: 'GBP' },
        { market: { codeExchange: 'LSE', idNotation: 452812499 }, isoCurrency: 'GBP' }] } };
    assert.deepStrictEqual(lseNotation(snap, 'GB00BPSNBF73').notation, '452812499', 'the exchange, not a German venue');
    assert.throws(() => lseNotation(snap, 'GB0000000000'), /returned GB00BPSNBF73/);
    assert.throws(() => lseNotation({ ...snap, quoteList: { list: [snap.quoteList.list[0]] } }, 'GB00BPSNBF73'), /no London/);

    const bar = d => Date.parse(d + 'T12:00:00Z') / 1000;
    const eod = (days, last) => ({ isoCurrency: 'GBP', unitType: 'PCT', datetimeLast: days.map(bar), last,
        datetimeStartAvailableHistory: days[0] + 'T00:00:00.000+00:00' });
    assert.deepStrictEqual(closesOf(eod(['2026-10-22', '2026-10-23'], [95.71, 95.6])), { '2026-10-22': 95.71, '2026-10-23': 95.6 });
    assert.throws(() => closesOf(eod(['2026-10-24'], [95])), /weekend/);
    assert.throws(() => closesOf(eod(['2026-10-23'], [9560])), /implausible/, 'a price in pence, not per £100');
    assert.throws(() => closesOf({ ...eod(['2026-10-23'], [95.6]), isoCurrency: 'EUR' }), /not a GBP/);

    // Walks forward in chunks until a chunk brings nothing new.
    const pages = [eod(['2024-02-29'], [99.7]), eod(['2024-02-29', '2024-03-01'], [99.7, 99.8]), eod(['2024-03-04'], [99.9]), eod([], [])];
    const urls = [];
    fetchCloses({ entity: 'e', notation: 'n' }, async u => { urls.push(u); return pages[urls.length - 1]; }).then(all => {
        assert.deepStrictEqual(all, { '2024-02-29': 99.7, '2024-03-01': 99.8, '2024-03-04': 99.9 });
        assert.ok(urls[0].endsWith('startDate=1950-01-01') && urls[1].endsWith('startDate=2024-02-29'), 'probe, then from the start');
        assert.ok(urls[2].endsWith('startDate=2024-03-02'), 'the next chunk starts the day after the last bar');
        assert.strictEqual(urls.length, 4);

        const mids = { '2026-10-15': 95.765, '2026-10-16': 95.865, '2026-10-19': 95.545, '2026-10-20': 95.525, '2026-10-21': 95.665 };
        const back = { '2026-10-14': 95.52, '2026-10-15': 95.68, '2026-10-16': 95.82, '2026-10-19': 95.47, '2026-10-20': 95.49, '2026-10-21': 95.59 };
        const ok = reconcile(back, mids);
        assert.ok(ok.ok && ok.days === 5 && ok.maxGap === 0.085, JSON.stringify(ok));
        assert.ok(!reconcile({ ...back, '2026-10-16': 96.9 }, mids).ok, 'a day a point away is refused');
        assert.match(reconcile(back, { '2026-10-15': 95.765 }).why, /only 1 days/);
        console.log('selftest ok');
    }).catch(e => { console.error(e); process.exit(1); });
} else {
    main().catch(e => { console.error(e); process.exit(1); });
}
