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
// `withEps` additionally returns the annual EPS per year end, which deriveQ4 needs to work out the
// fourth quarter nobody files on its own.
// Balance-sheet and tax facts per fiscal year, for ROIC, gross profit on assets, and asset
// turnover — the three the 24 Aug reading argues are the numbers a margin has to be read
// against. earnings.json is income statement only, so none of them could be computed before.
//
// Two shapes of fact, and they must not be mixed:
//   INSTANT   Assets, LiabilitiesCurrent — a balance on one date, `end` with no `start`.
//   DURATION  GrossProfit, tax, pretax — a period, and only a ~year-long one counts.
// Taking a quarterly duration row as the year is how a plausible wrong number gets in, so the
// same 340-380 day guard filedDates uses applies here too.
// Cash comes out of invested capital (D104), so ROIC is the return on the operating business, not
// on a pile of deposits. Cash and equivalents only, the same line Yahoo carries for the other
// filers; the restricted-cash total is a fallback for filers that tag only that.
const INSTANT = { assets: ['Assets'], liabCurrent: ['LiabilitiesCurrent'], equity: ['StockholdersEquity'],
    cash: ['CashAndCashEquivalentsAtCarryingValue',
        'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'] };
const DURATION = {
    // Operating income as filed (D104), so ROIC's numerator comes from the same filing as its
    // denominator. Yahoo's reading added MWA's $11.2m of charges back. A filer that presents no
    // operating line (IBM, Nike) gets no ROIC rather than a vendor's reconstruction of one.
    opinc: ['OperatingIncomeLoss'],
    grossProfit: ['GrossProfit'],
    tax: ['IncomeTaxExpenseBenefit'],
    // Cash conversion, the single most-reached-for series in pot/data-wishlist.md — 19 separate
    // sweeps went and got it by hand. Both halves are DURATION facts on the companyfacts endpoint
    // we already call, so the marginal cost of having it forever is two tag lists.
    //
    // Capex is PaymentsToAcquirePropertyPlantAndEquipment, filed as a POSITIVE outflow, so free
    // cash flow subtracts it. The alternates matter: filers split the tag when they separate
    // productive assets, and taking only the first name loses the whole year for those.
    cfo: ['NetCashProvidedByUsedInOperatingActivities',
        'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
    pretax: [
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
    ],
};

function capitalFacts(facts) {
    const byYear = {};
    const put = (end, key, val) => {
        if (typeof val !== 'number') return;
        (byYear[end] = byYear[end] || {});
        // First annual filing wins; a later restatement of the same year does not overwrite
        // the figure the market actually saw.
        if (byYear[end][key] == null) byYear[end][key] = val;
    };
    const rowsFor = tags => tags.flatMap(tag =>
        Object.values(facts?.facts?.['us-gaap']?.[tag]?.units || {}).flat());

    for (const [key, tags] of Object.entries(INSTANT)) {
        for (const x of rowsFor(tags)) {
            if (!/^(10-K|20-F)$/.test(x.form || '') || x.fp !== 'FY') continue;
            if (x.start || !x.end) continue;              // instants carry no start
            put(x.end, key, x.val);
        }
    }
    for (const [key, tags] of Object.entries(DURATION)) {
        for (const x of rowsFor(tags)) {
            if (!/^(10-K|20-F)$/.test(x.form || '') || x.fp !== 'FY') continue;
            if (!x.start || !x.end) continue;
            const days = (Date.parse(x.end) - Date.parse(x.start)) / 86400e3;
            if (!(days > 340 && days < 380)) continue;
            put(x.end, key, x.val);
        }
    }
    // A year with no assets is useless to all three metrics, so it is not worth carrying.
    return Object.fromEntries(Object.entries(byYear).filter(([, v]) => v.assets > 0));
}

function filedDates(facts, withEps = false) {
    const out = new Map();
    const eps = new Map();
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
                // The year as first filed, with the date of that filing: the two have to travel
                // together, because onTodaysBasis reads the date to decide which splits the value
                // has not yet seen. Taking whichever row came first in the file paired a value with
                // a date it might not belong to.
                if (tag === 'EarningsPerShareDiluted' && typeof x.val === 'number'
                    && (!eps.has(x.end) || x.filed < eps.get(x.end).filed)) {
                    eps.set(x.end, { val: x.val, filed: x.filed });
                }
            }
        }
    }
    return withEps ? { filed: out, eps } : out;
}

// Quarterly EPS, with the date each was published.
//
// The reason this exists: the trough multiple was being struck on the latest ANNUAL EPS while the
// headline P/E uses trailing twelve months, and two different denominators produce a nonsense.
// GameStop's page showed a "cheapest ever" of 23.21x against a current 13.34x — a cheapest that is
// dearer than today, which is not a number, it is a category error.
//
// EDGAR carries ~54 quarters per filer back to 2008, against Yahoo's four or five, so this also
// makes the series deep enough to be worth calling a history.
//
// 10-Qs cover Q1–Q3 only; the fourth quarter is never filed on its own. It is derived below as the
// audited year minus the three filed quarters, published on the 10-K's date — exact, because those
// four periods tile the year by construction.
// Two traps, both found by checking GameStop against a chart rather than trusting the feed.
//
// SPLITS. EDGAR restates a period when the share count changes: GME's quarter to 30 Oct 2021 was
// filed at −3.27 in Dec 2021 and refiled at −0.82 in Dec 2022, exactly 4x, after the July 2022
// four-for-one. Yahoo's prices are split-adjusted throughout, so pairing them with an as-filed EPS
// divides an adjusted price by an unadjusted denominator — which is how a first attempt produced a
// 0.93x "trough" for GameStop, four times too cheap. So: EARLIEST filing date, because that is
// when the information became public and the point-in-time property depends on it; LATEST value,
// because that is the one on today's share basis, which is the basis the price is on.
//
// DUPLICATES. One period can carry several values under this one tag on the same day — GME's
// quarter to 2017-10-28 has both 1.39 and 0.59 filed together, dimensional variants that
// companyfacts flattens away the labels for. Taking whichever came first is arbitrary, so the
// candidates are kept and `reconcileQuarters` below picks the set that actually ties to the
// audited year.
function quarterlyEps(facts) {
    const rows = facts?.facts?.['us-gaap']?.EarningsPerShareDiluted?.units?.['USD/shares'] || [];
    const byEnd = new Map();
    for (const x of rows) {
        if (x.form !== '10-Q' || !x.start || !x.end || !x.filed || typeof x.val !== 'number') continue;
        const days = (Date.parse(x.end) - Date.parse(x.start)) / 86400e3;
        if (!(days > 80 && days < 100)) continue;      // one quarter, not a year-to-date stack
        if (!byEnd.has(x.end)) byEnd.set(x.end, []);
        byEnd.get(x.end).push(x);
    }
    const out = [];
    for (const [end, all] of byEnd) {
        const filed = all.reduce((a, x) => x.filed < a ? x.filed : a, all[0].filed);
        // Latest filing wins the VALUE; among rows filed that same day, the one closest to zero is
        // the per-share figure rather than a cumulative or segment variant.
        const newest = all.reduce((a, x) => x.filed > a ? x.filed : a, all[0].filed);
        const candidates = all.filter(x => x.filed === newest).map(x => x.val);
        const nearZero = vals => vals.reduce((a, v) => Math.abs(v) < Math.abs(a) ? v : a);
        // `restated` is the filing the value came from, which decides the splits it has already
        // absorbed; `filed` stays the first publication, for the point-in-time date; `first` is the
        // value as first filed, which is how restatedEvents tells a split from a spin-off.
        out.push({ end, filed, restated: newest, eps: nearZero(candidates),
            first: nearZero(all.filter(x => x.filed === filed).map(x => x.val)),
            alts: [...new Set(candidates)] });
    }
    return out.sort((a, b) => a.end.localeCompare(b.end));
}

const SPLIT_URL = t => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}`
    + `?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1mo&events=split`;

async function splitHistory(ticker) {
    const res = await fetch(SPLIT_URL(ticker), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
    if (!res.ok) return [];
    const ev = (await res.json()).chart?.result?.[0]?.events?.splits || {};
    return Object.values(ev)
        .map(s => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10),
            ratio: (s.numerator || 1) / (s.denominator || 1) }))
        .filter(s => s.ratio > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
}

// Which of Yahoo's "splits" EDGAR restates.
//
// A share split is restated in every later filing (ASC 260 requires it). A spin-off is not, though
// Yahoo lists it as a split so its prices line up: IBM's Kyndryl at 1046:1000, Encompass's Enhabit
// at 1257:1000, Dell's VMware at 1973:1000. No share count changed, so a value filed after it is
// still on the old basis and has to be divided like any older one.
//
// Decided from the quarters filed on both sides of the event, each voting for the reading its later
// value is nearer: the earlier value divided by the ratio (restated), or unchanged (not). With no
// such quarter the event is taken as restated; that only reaches a quarter first filed after an
// event it predates, a window of a few weeks.
function restatedEvents(quarters, splits) {
    return new Set(splits.filter(s => {
        let yes = 0, no = 0;
        for (const q of quarters) {
            if (!q.first || !(q.end < s.date && q.filed < s.date && q.restated >= s.date)) continue;
            // A second event between the two filings would make this ratio the wrong one to test.
            if (splits.some(o => o !== s && o.date > q.filed && o.date <= q.restated)) continue;
            if (Math.abs(q.eps - q.first / s.ratio) < Math.abs(q.eps - q.first)) yes++; else no++;
        }
        return yes >= no;
    }));
}

// Put every quarter on TODAY'S share basis.
//
// EDGAR restates a period only while it still appears in new filings, so recent quarters come back
// split-adjusted and old ones do not. GameStop's quarter to Oct 2017 is still recorded at 0.59, its
// pre-split value, because 2017 stopped appearing in filings before the 2022 four-for-one. Prices
// from Yahoo are adjusted all the way back, so pairing the two divides an adjusted price by an
// unadjusted denominator and reports a company as four times cheaper than it was.
//
// Truncating at the last split was the first idea and it is too blunt — Netflix keeps 3 quarters of
// 72, ServiceNow 3 of 43. The events carry their ratios, so the factor can simply be applied: a
// quarter is divided by the product of every split after it that its value has not absorbed.
//
// A value has absorbed an event when EDGAR restates it (restatedEvents) and the filing the value
// came from (`restated`) is on or after it. Until 7 Nov 2026 the date tested was the FIRST filing:
// Netflix's Q1-Q3 2025, filed before the November 2025 ten-for-one and restated after it (0.66,
// 0.72, 0.59), were divided by ten again, and the Q4 derived from them read 2.333 against 0.56.
// Every split in the store was hit the same way, NVDA's FY2025 Q4 reading 1.43 against 0.89.
function onTodaysBasis(quarters, splits, restates = new Set(splits)) {
    if (!splits.length) return quarters;
    return quarters.map(q => {
        const basis = q.restated || q.filed || q.end;
        const after = splits.filter(s => s.date > q.end && (s.date > basis || !restates.has(s)));
        const factor = after.reduce((a, s) => a * s.ratio, 1);
        return factor === 1 ? q
            : { ...q, eps: Number((q.eps / factor).toFixed(4)), splitAdj: factor };
    });
}

// Do these quarters actually tile the audited years?
//
// The guard that stops a wrong denominator reaching the valuation. For every fiscal year where
// four quarters exist and the annual EPS is known, their sum must match it. One year agreeing is
// enough to trust the series; none agreeing means the quarters are on a different basis from the
// annuals — a variant, a restatement we mis-picked, a share count that moved — and the whole
// series is dropped rather than half-used.
// Checked against the STORE's quarters, which come from Yahoo — genuinely independent of EDGAR,
// and already split-adjusted, so a basis mismatch shows up immediately.
//
// A first attempt tested whether four filed quarters summed to the audited year. That can never
// pass: 10-Qs cover Q1–Q3 only, so a fiscal year holds at most three of them, and every ticker was
// dropped with "0 tested". Testing the derived Q4 instead would have been circular, since it is
// defined as the annual minus the other three.
//
// Fiscal period ends differ by a few days between sources — EDGAR has GME's quarter ending
// 2025-05-03, Yahoo 2025-04-30 — so they are matched by nearest date rather than equality.
const RECONCILE_TOL = 0.08;
const QUARTER_END_TOLERANCE_DAYS = 12;
function reconcileQuarters(edgar, storeQuarters) {
    let tested = 0, agreed = 0;
    for (const sq of storeQuarters || []) {
        if (!sq?.date || typeof sq.eps !== 'number' || Math.abs(sq.eps) < 0.01) continue;
        let best = null;
        for (const q of edgar) {
            if (q.derived) continue;
            const gap = Math.abs(Date.parse(q.end) - Date.parse(sq.date)) / 86400e3;
            if (gap <= QUARTER_END_TOLERANCE_DAYS && (!best || gap < best.gap)) best = { gap, q };
        }
        if (!best) continue;
        tested++;
        if (Math.abs(best.q.eps - sq.eps) <= Math.abs(sq.eps) * RECONCILE_TOL) agreed++;
    }
    // Most must agree, not merely one: a single coincidence across five quarters proves nothing.
    return { tested, agreed, ok: tested >= 2 && agreed >= Math.ceil(tested * 0.6) };
}

// The missing fourth quarter, from the annual it belongs to.
//
// A fiscal year's Q4 = the audited annual EPS less the three quarters already filed inside it, and
// it becomes public with the 10-K. Skipped where the three are not all present, because a partial
// subtraction is a wrong number rather than an approximate one.
function deriveQ4(quarters, annualEps, annualFiled) {
    const out = [];
    for (const [end, eps] of Object.entries(annualEps)) {
        const yearStart = new Date(Date.parse(end + 'T00:00:00Z'));
        yearStart.setUTCFullYear(yearStart.getUTCFullYear() - 1);
        const from = yearStart.toISOString().slice(0, 10);
        const inYear = quarters.filter(q => q.end > from && q.end <= end);
        if (inYear.length !== 3) continue;             // Q4 already filed, or a quarter is missing
        const filed = annualFiled[end];
        if (!filed) continue;
        out.push({ end, eps: Number((eps - inYear.reduce((a, q) => a + q.eps, 0)).toFixed(4)),
            filed, derived: true });
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
    const dates = {}, quarters = {}, capital = {};
    let ok = 0, missing = 0, years = 0;

    for (const t of tickers) {
        const id = cik.get(t);
        if (!id) { missing++; dates[t] = prev[t] || {}; continue; }
        try {
            const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`);
            const { filed, eps: annualEps } = filedDates(facts, true);
            const cap = capitalFacts(facts);
            if (Object.keys(cap).length) capital[t] = cap;
            const splits = await splitHistory(t);
            await sleep();
            const raw = quarterlyEps(facts);
            const restates = restatedEvents(raw, splits);
            const q = onTodaysBasis(raw, splits, restates);
            const unrestated = splits.filter(s => !restates.has(s))
                .map(s => `${s.date} ${Number(s.ratio.toFixed(4))}:1`);
            // The annual has to be put on the same basis before Q4 is derived from it, or the
            // subtraction mixes an unadjusted year with adjusted quarters — GME's FY2016 came
            // out at 3.05 where it should be 0.76, and that one bad quarter poisoned every
            // trailing window containing it.
            const annualAdj = Object.fromEntries(onTodaysBasis(
                [...annualEps].map(([end, a]) => ({ end, eps: a.val, filed: a.filed })), splits, restates)
                .map(x => [x.end, x.eps]));
            const withQ4 = [...q, ...deriveQ4(q, annualAdj, Object.fromEntries(filed))]
                .sort((a, b) => a.end.localeCompare(b.end));
            // Only trust the series if it ties to at least one audited year.
            const check = reconcileQuarters(q, store.eps[t]?.quarters);
            const adj = q.filter(x => x.splitAdj).length;
            quarters[t] = check.ok ? withQ4 : [];
            if (!check.ok && q.length >= 4) console.error(`      ${t}: EDGAR quarters disagree with the store (${check.agreed}/${check.tested} matched) — dropped`);
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
                + (lags.length ? `, filed ${Math.min(...lags)}–${Math.max(...lags)}d after year end` : '')
                + (unrestated.length ? `; not restated by EDGAR, so applied to every earlier period: ${unrestated.join(', ')}` : ''));
        } catch (e) {
            console.error(`skip ${t}: ${e.message}`);
            dates[t] = prev[t] || {};       // keep what we had rather than losing it to one bad call
        }
        await sleep();
    }

    fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), dates, quarters }, null, 1))
    console.log(`\nwrote ${OUT} — ${ok}/${tickers.length} tickers, ${years} fiscal years dated`
        + `${missing ? `, ${missing} not found in the SEC ticker map` : ''}`);

    // Its own file rather than a section of filing-dates.json, whose name would then be a lie.
    // Written from the same crawl, so it costs no extra EDGAR requests.
    fs.writeFileSync('capital.json',
        JSON.stringify({ updated: new Date().toISOString(), capital }, null, 1) + String.fromCharCode(10));
    const capYears = Object.values(capital).reduce((a, c) => a + Object.keys(c).length, 0);
    console.log(`wrote capital.json — ${Object.keys(capital).length} filers, ${capYears} fiscal years`);
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

    // Netflix: ten-for-one on 2025-11-17. Q1-Q3 2025 were filed before it and restated after it in
    // the 2026 10-Qs; Q2 2024 last appeared in a 10-Q filed before it, so it was never restated.
    const q = (start, end, filed, val) => ({ form: '10-Q', fp: 'Q', start, end, filed, val });
    const y = (start, end, filed, val) => ({ form: '10-K', fp: 'FY', start, end, filed, val });
    const nflx = { facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': [
        q('2024-04-01', '2024-06-30', '2024-07-19', 4.88), q('2024-04-01', '2024-06-30', '2025-07-18', 4.88),
        q('2025-01-01', '2025-03-31', '2025-04-18', 6.61), q('2025-01-01', '2025-03-31', '2026-04-17', 0.66),
        q('2025-04-01', '2025-06-30', '2025-07-18', 7.19), q('2025-04-01', '2025-06-30', '2026-07-17', 0.72),
        q('2025-07-01', '2025-09-30', '2025-10-22', 5.87), q('2025-07-01', '2025-09-30', '2026-10-21', 0.59),
        // The restated comparative listed BEFORE the original: the year must not depend on row order.
        y('2024-01-01', '2024-12-31', '2026-01-23', 1.98), y('2024-01-01', '2024-12-31', '2025-01-27', 19.83),
        y('2025-01-01', '2025-12-31', '2026-01-23', 2.53),
    ] } } } } };
    const split = [{ date: '2025-11-17', ratio: 10 }];
    const restates = restatedEvents(quarterlyEps(nflx), split);
    assert.strictEqual(restates.size, 1, 'three quarters show EDGAR restated the ten-for-one');
    const qs = onTodaysBasis(quarterlyEps(nflx), split, restates);
    const at = end => qs.find(x => x.end === end);
    assert.strictEqual(at('2025-03-31').eps, 0.66, 'restated after the split: not divided again');
    assert.strictEqual(at('2025-03-31').splitAdj, undefined);
    assert.strictEqual(at('2025-03-31').filed, '2025-04-18', 'still dated by first publication');
    assert.strictEqual(at('2025-09-30').eps, 0.59);
    assert.strictEqual(at('2024-06-30').eps, 0.488, 'last filed before the split: adjusted');
    assert.strictEqual(at('2024-06-30').splitAdj, 10);
    const { filed: nf, eps: ne } = filedDates(nflx, true);
    assert.deepStrictEqual(ne.get('2024-12-31'), { val: 19.83, filed: '2025-01-27' }, 'the year as first filed');
    const annualAdj = Object.fromEntries(onTodaysBasis(
        [...ne].map(([end, a]) => ({ end, eps: a.val, filed: a.filed })), split).map(x => [x.end, x.eps]));
    assert.strictEqual(annualAdj['2024-12-31'], 1.983);
    const q4 = deriveQ4(qs, annualAdj, Object.fromEntries(nf)).find(x => x.end === '2025-12-31');
    assert.strictEqual(q4.eps, 0.56, 'Q4 2025 is the year less three quarters on one basis, not 2.333');

    // Encompass: Yahoo's 1257:1000 on 2022-07-01 is the Enhabit spin-off. Q2 2021 was refiled after
    // it unchanged, so the event is not a restatement and the refiled value is still divided.
    const ehc = { facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': [
        q('2021-04-01', '2021-06-30', '2021-07-28', 1.13), q('2021-04-01', '2021-06-30', '2022-07-27', 1.13),
        q('2021-07-01', '2021-09-30', '2021-10-27', 1.00), q('2021-07-01', '2021-09-30', '2022-10-26', 1.00),
    ] } } } } };
    const spin = [{ date: '2022-07-01', ratio: 1.257 }];
    const eq = quarterlyEps(ehc);
    assert.strictEqual(restatedEvents(eq, spin).size, 0, 'a spin-off is not restated');
    assert.strictEqual(onTodaysBasis(eq, spin, restatedEvents(eq, spin))[0].eps, 0.899);
    // No quarter on both sides of an event: taken as restated, the documented default.
    assert.strictEqual(restatedEvents([], spin).size, 1);

    console.log('selftest ok');
}

if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { filedDates, matchYearEnd };
