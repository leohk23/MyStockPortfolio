#!/usr/bin/env node
// `npm run fundamentals` — balance-sheet and income facts for the names SEC EDGAR cannot reach.
//
// capital.json comes from EDGAR and covers US filers, which is 38 of 59 holdings. The other 18 are
// Hong Kong, Tokyo, Paris, London, Frankfurt and Seoul lines that file with their own exchange:
// BYD reports to HKEX, and its US line BYDDY is an UNSPONSORED ADR that appears nowhere in the SEC
// ticker map at all. Without this they have no ROIC, no gross profitability and no turnover.
//
// Yahoo's fundamentals-timeseries endpoint carries all of it and — unlike quoteSummary, which
// answers "Invalid Crumb" — needs no authentication. Verified against 1211.HK, which returns four
// years of every field used here.
//
// EDGAR still wins where both exist. It is the filing itself rather than a vendor's reading of it,
// and mixing the two bases inside one series would make a trend that is partly an accounting
// change look like a change in the business.

const fs = require('fs');

const OUT = 'capital-yahoo.json';
const BASE = 'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/';

// Yahoo's names for the seven figures the three metrics need. Revenue and operating income are
// taken from HERE rather than from earnings.json on purpose: a ratio whose numerator and
// denominator come from different sources can silently mix currencies or accounting bases, and
// BYD reports in CNY while its ADR line is priced in USD.
const TYPES = [
    'annualTotalAssets', 'annualCurrentLiabilities', 'annualGrossProfit',
    'annualTotalRevenue', 'annualTaxProvision', 'annualPretaxIncome', 'annualOperatingIncome',
];
const FIELD = {
    annualTotalAssets: 'assets', annualCurrentLiabilities: 'liabCurrent',
    annualGrossProfit: 'grossProfit', annualTotalRevenue: 'rev',
    annualTaxProvision: 'tax', annualPretaxIncome: 'pretax', annualOperatingIncome: 'opinc',
};

const sleep = (ms = 400) => new Promise(r => setTimeout(r, ms));

function getJson(url) {
    return new Promise((resolve, reject) => {
        require('https').get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

// One symbol -> { 'YYYY-MM-DD': { assets, liabCurrent, ... } }, keyed by the fiscal year end the
// filing itself reports.
function parse(payload) {
    const byYear = {};
    for (const series of payload?.timeseries?.result || []) {
        const key = Object.keys(series).find(k => k.startsWith('annual'));
        const field = FIELD[key];
        if (!field) continue;
        for (const point of series[key] || []) {
            const v = point?.reportedValue?.raw;
            const end = point?.asOfDate;
            if (typeof v !== 'number' || !end) continue;
            (byYear[end] = byYear[end] || {})[field] = v;
        }
    }
    // A year with no assets cannot produce any of the three, so it is not worth storing.
    return Object.fromEntries(Object.entries(byYear).filter(([, v]) => v.assets > 0));
}

async function main() {
    const holdings = JSON.parse(fs.readFileSync('holdings.json', 'utf8')).holdings || [];
    let watch = [];
    try { watch = JSON.parse(fs.readFileSync('watchlist.json', 'utf8')); } catch { /* optional */ }
    let edgar = {};
    try { edgar = JSON.parse(fs.readFileSync('capital.json', 'utf8')).capital || {}; }
    catch { console.log('note no capital.json — fetching every name from Yahoo'); }

    // Only what EDGAR missed. Re-fetching the rest would spend requests to get a worse answer.
    const want = [...new Set([...holdings.map(h => h.yahoo), ...watch.map(w => w.yahoo)])]
        .filter(t => t && !edgar[t]);

    const capital = {};
    let ok = 0, empty = 0, failed = 0;
    for (const t of want) {
        // period2 must be a PLAUSIBLE timestamp. 9999999999 is accepted with a 200 and an empty
        // result for every series - the request looks like it worked and returns nothing, which
        // cost 69 names on the first run. A year ahead of now is far enough.
        const url = `${BASE}${encodeURIComponent(t)}?symbol=${encodeURIComponent(t)}`
            + `&type=${TYPES.join(',')}&period1=1262304000&period2=${Math.floor(Date.now() / 1000) + 31536000}&merge=false`;
        try {
            const years = parse(await getJson(url));
            const n = Object.keys(years).length;
            if (n) { capital[t] = years; ok++; } else empty++;
        } catch (e) {
            failed++;
            console.error(`      ${t}: ${e.message}`);
        }
        await sleep();
    }

    fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), capital }, null, 1) + '\n');
    const yrs = Object.values(capital).reduce((a, c) => a + Object.keys(c).length, 0);
    console.log(`wrote ${OUT} — ${ok} names, ${yrs} fiscal years`
        + `${empty ? `, ${empty} with nothing to return` : ''}${failed ? `, ${failed} failed` : ''}`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { parse, TYPES, FIELD };
