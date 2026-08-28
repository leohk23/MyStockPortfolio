#!/usr/bin/env node
// `npm run filings` — when US annual results were ACTUALLY published.
//
// troughPe and peBands are point-in-time: each weekly close is divided by the latest annual EPS a
// buyer could already have seen. "Could have seen" was a flat 90 days after the fiscal year end,
// because real publication dates only exist for some markets. For US filers they exist exactly,
// and the guess is wrong by two to three times:
//
//     NVDA FY2025   ended 2025-01-26   10-K filed 2025-02-26    31 days, not 90
//     GOOG FY2025   ended 2025-12-31   10-K filed 2026-02-05    36 days, not 90
//     AAPL FY2025   ended 2025-09-27   10-K filed 2025-10-31    34 days, not 90
//
// What that cost: NVDA's trough read 38.50x on 2 May 2025 — which is simply the first weekly bar
// after the 90-day cutoff, not anything the market did. Its FY2025 results were public from 26
// February, so the April selloff was priced on them: 94.31 / 2.97 = 31.71x on 4 April. The
// dashboard was 21% too dear, and the low date was an artefact of the rule.
//
// Written as its own file and its own fetch, deliberately. backfill-earnings.js reconciles VALUES
// across three sources and is complicated for good reasons; this is a different question with one
// authoritative answer, and it follows the pattern hk-board.json already sets — a small committed
// file that fetch-prices.js consults and can do without.

const fs = require('fs');

const OUT = 'filing-dates.json';
// SEC asks for a contactable User-Agent. This is a personal tool making a few dozen requests.
const SEC_UA = 'MyStockPortfolio/1.0 (personal portfolio tool; leohk23@gmail.com)';
// Fiscal year ends disagree between sources: EDGAR records NVDA's FY2025 as ending 2025-01-26
// (the last Sunday), Yahoo as 2025-01-31 (the month end). Same year, different convention.
const YEAR_END_TOLERANCE_DAYS = 12;
// Any tag will do — the question is when the FORM was filed, not what it said. Several are tried
// because not every filer reports every tag.
const TAGS = ['EarningsPerShareDiluted', 'NetIncomeLoss', 'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax'];

const sleep = (ms = 250) => new Promise(r => setTimeout(r, ms));
const isUS = t => !t.includes('.') && !t.startsWith('^');

async function getJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': SEC_UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Fiscal year end -> the date that year was FIRST filed. Pure, so it is selftest-able.
//
// Earliest wins: a 10-K carries two years of comparatives, so FY2024 appears again in the FY2025
// and FY2026 filings. The first time it was filed is when it became public; the later appearances
// are reprints and would push the date years late.
//
// Only 10-K and 20-F, only `fp: FY`, and only a period that is actually about a year — the same
// three guards edgarAnnual uses, for the same reason: quarterly and segment rows share the tag.
function filedDates(facts) {
    const out = new Map();
    for (const tag of TAGS) {
        const units = facts?.facts?.['us-gaap']?.[tag]?.units || {};
        for (const rows of Object.values(units)) {
            for (const x of rows) {
                if (!/^(10-K|20-F)$/.test(x.form || '') || x.fp !== 'FY') continue;
                if (!x.start || !x.end || !x.filed) continue;
                const days = (Date.parse(x.end) - Date.parse(x.start)) / 86400e3;
                if (!(days > 340 && days < 380)) continue;
                const prev = out.get(x.end);
                if (!prev || x.filed < prev) out.set(x.end, x.filed);
            }
        }
    }
    return out;
}

// The store's fiscal year end, matched to EDGAR's. Nearest within the tolerance, so a filer whose
// year end drifts by a few days across years still lines up, and one that genuinely has no
// matching year gets nothing rather than the wrong neighbour.
function matchYearEnd(storeDate, filed, tolerance = YEAR_END_TOLERANCE_DAYS) {
    let best = null;
    for (const [end, date] of filed) {
        const gap = Math.abs(Date.parse(end) - Date.parse(storeDate)) / 86400e3;
        if (gap <= tolerance && (!best || gap < best.gap)) best = { gap, end, date };
    }
    return best ? best.date : null;
}

async function main() {
    const store = JSON.parse(fs.readFileSync('earnings.json', 'utf8'));
    const tickers = Object.keys(store.eps || {}).filter(isUS);
    console.log(`${tickers.length} US-listed tickers in the store`);

    const map = await getJson('https://www.sec.gov/files/company_tickers.json');
    const cik = new Map(Object.values(map).map(x => [x.ticker, String(x.cik_str).padStart(10, '0')]));
    await sleep();

    const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')).dates || {}; } catch { return {}; } })();
    const dates = {};
    let ok = 0, missing = 0, years = 0;

    for (const t of tickers) {
        const id = cik.get(t);
        if (!id) { missing++; dates[t] = prev[t] || {}; continue; }
        try {
            const filed = filedDates(await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`));
            const forTicker = {};
            for (const y of store.eps[t].years || []) {
                const d = matchYearEnd(y.date, filed);
                if (d) { forTicker[y.date] = d; years++; }
            }
            dates[t] = forTicker;
            if (Object.keys(forTicker).length) ok++;
            const lags = Object.entries(forTicker)
                .map(([end, f]) => Math.round((Date.parse(f) - Date.parse(end)) / 864e5));
            console.log(`ok   ${t.padEnd(8)} ${Object.keys(forTicker).length} year(s)`
                + (lags.length ? `, filed ${Math.min(...lags)}–${Math.max(...lags)}d after year end` : ''));
        } catch (e) {
            console.error(`skip ${t}: ${e.message}`);
            dates[t] = prev[t] || {};       // keep what we had rather than losing it to one bad call
        }
        await sleep();
    }

    fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), dates }, null, 1));
    console.log(`\nwrote ${OUT} — ${ok}/${tickers.length} tickers, ${years} fiscal years dated`
        + `${missing ? `, ${missing} not found in the SEC ticker map` : ''}`);
}

function selftest() {
    const assert = require('assert');

    const facts = { facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': [
        // FY2025 as first filed, and again as a comparative in the next year's 10-K. Earliest wins.
        { form: '10-K', fp: 'FY', start: '2024-01-29', end: '2025-01-26', filed: '2025-02-26', val: 2.94 },
        { form: '10-K', fp: 'FY', start: '2024-01-29', end: '2025-01-26', filed: '2026-02-25', val: 2.94 },
        { form: '10-K', fp: 'FY', start: '2025-01-27', end: '2026-01-25', filed: '2026-02-25', val: 4.9 },
        // Excluded: a quarter, a non-FY period, and the wrong form.
        { form: '10-Q', fp: 'Q1', start: '2025-01-27', end: '2025-04-27', filed: '2025-05-28', val: 0.76 },
        { form: '10-K', fp: 'Q4', start: '2024-01-29', end: '2025-01-26', filed: '2025-02-26', val: 1 },
        { form: '8-K', fp: 'FY', start: '2024-01-29', end: '2025-01-26', filed: '2025-02-20', val: 2.94 },
    ] } } } } };
    const filed = filedDates(facts);
    assert.strictEqual(filed.get('2025-01-26'), '2025-02-26', 'earliest filing, not the reprint');
    assert.strictEqual(filed.get('2026-01-25'), '2026-02-25');
    assert.strictEqual(filed.size, 2, 'quarters and non-10-K forms excluded');
    assert.strictEqual(filedDates({}).size, 0);

    // The store says 2025-01-31, EDGAR says 2025-01-26 — the same year, five days apart.
    assert.strictEqual(matchYearEnd('2025-01-31', filed), '2025-02-26');
    assert.strictEqual(matchYearEnd('2026-01-31', filed), '2026-02-25');
    // A year EDGAR has nothing near gets nothing, rather than the closest wrong one.
    assert.strictEqual(matchYearEnd('2024-01-31', filed), null);
    // Nearest wins when two are within tolerance.
    const two = new Map([['2025-01-26', 'A'], ['2025-02-08', 'B']]);
    assert.strictEqual(matchYearEnd('2025-02-05', two, 30), 'B');
    assert.strictEqual(matchYearEnd('2025-01-28', two, 30), 'A');

    console.log('selftest ok');
}

if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { filedDates, matchYearEnd };
