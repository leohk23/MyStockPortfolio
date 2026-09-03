#!/usr/bin/env node
// backfill-earnings.js — top up earnings.json with fiscal years Yahoo cannot reach.
//
// RUN BY HAND, LOCALLY. Never in CI, never on a schedule. `npm run backfill`.
//
// Why this exists
// ---------------
// Yahoo hard-caps annual fundamentals at 4 fiscal years — asking for a 15-year window
// returns the same four, on both the timeseries and quoteSummary endpoints. That is the
// ceiling on the hourly pipeline, and it is not a parameter that can be widened.
//
// Two sources fill the gap, tried deepest first:
//
//   1. SEC EDGAR (data.sec.gov) — the filings themselves. Free, no key, documented, stable,
//      and ~9 fiscal years deep. US filers only: no Hong Kong, Tokyo, Paris, Korea. Covers
//      20-F filers too (BABA, TSM, ASML all report under us-gaap).
//   2. stockanalysis.com — 5 fiscal years, but it covers the other markets. No public API:
//      the numbers come out of the page's internal SvelteKit payload (`__data.json`), an
//      undocumented index-pointer format that can change shape on any deploy of their site.
//
// Source 2 is exactly what AGENTS.md says not to trust, so it is used the only way it safely
// can be: ONCE, by hand, with the result committed. earnings.json is the store of record and
// mergeEarnings() keeps banked years forever, so the hourly Yahoo job merges its 4 years on top
// of this and the older years simply persist. If a source breaks, it breaks on a laptop and the
// live pipeline never notices — the data is already in the repo.
//
// The source proves itself, per ticker
// ------------------------------------
// The 4 years Yahoo *does* have overlap what these sources return. So every overlapping year
// must reproduce Yahoo EXACTLY on both revenue and bottom line, or the source is refused for
// that ticker. A source that disagrees where it can be checked is not trusted where it cannot.
//
// This also pins down a real hazard: field names vary. stockanalysis's US pages carry
// `netIncome` while its Hong Kong pages carry `netinc` AND `netinccmn` (differing by minority
// interests); EDGAR has `NetIncomeLossAvailableToCommonStockholdersBasic` for some filers and
// only `NetIncomeLoss` for others, and several revenue tags per company. Rather than hard-code
// a guess, every candidate field is tried and only one that reproduces Yahoo is accepted — the
// check picks the field, so a schema change cannot silently pick a wrong one. The danger hides
// where it cannot be seen: Apple has no minorities, so every candidate agrees there.
//
// Backfills `rev`, `nic` and `opinc` — never `eps` or `ni`. troughPe() skips a year whose EPS
// is not positive, so leaving EPS alone keeps the P/E Low's documented "cheapest in ~4y" meaning
// instead of silently shifting when this runs. `opinc` touches nothing but the Financials
// panel's Operating income and Op margin columns, which is why it is safe to add and why it was
// added on 3 Sep 2026 — without it a backfilled row showed revenue and net income with a blank
// middle. It is optional at every step: a filer whose OperatingIncomeLoss cannot be verified
// against Yahoo still gets its revenue and bottom line.
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
// SEC asks for a real contact in the User-Agent and blocks generic browser strings.
const SEC_UA = 'MyStockPortfolio/1.0 (leohk23@gmail.com)';
const EARNINGS = 'earnings.json';

const getJson = async (url, ua = UA) => {
    const res = await fetch(url, { headers: { 'User-Agent': ua } });
    return res.ok ? res.json() : null;
};

// Fiscal-year ends do not agree between sources — Yahoo normalises Apple's FY2022 to
// 2022-09-30 while the filing (and both sources here) says 2022-09-24. Align on the calendar
// year instead. A genuine misalignment cannot slip through: it would have to also match
// Yahoo's revenue and bottom line to the digit.
const fyOf = date => date.slice(0, 4);
const same = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.abs(a) * 1e-9;
const sleep = (ms = 400) => new Promise(r => setTimeout(r, ms));

/* ---------------- source 1: SEC EDGAR ---------------- */

// Several tags can carry the same line, and which one a filer uses varies (Apple files both
// Revenues and RevenueFromContractWithCustomer...). Validation picks; these are just candidates.
const EDGAR_REV = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues',
    'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'];
const EDGAR_NIC = ['NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLoss'];
// Operating income fills the Financials panel's third column. OPTIONAL throughout: a filer that
// does not tag it still gets its revenue and bottom line backfilled, exactly as before. EDGAR
// only — stockanalysis is the source AGENTS.md says not to trust, and guessing a field name
// there buys nothing while the markets it covers currently reconcile for almost nobody.
const EDGAR_OPINC = ['OperatingIncomeLoss'];

let cikCache = null;
async function cikFor(ticker) {
    cikCache ||= await getJson('https://www.sec.gov/files/company_tickers.json', SEC_UA) || {};
    const byTicker = {};
    for (const v of Object.values(cikCache)) byTicker[v.ticker] = String(v.cik_str).padStart(10, '0');
    // Yahoo writes BRK-B where SEC writes BRK-B or BRK.B.
    return byTicker[ticker] || byTicker[ticker.replace('-', '.')] || null;
}

// One tag -> { fiscal year end date -> value }.
//
// The filter is the whole trick. A raw concept mixes annual, quarterly and per-segment rows
// that share an `end` date — AAPL's 2020-09-26 appears as both 274.5B (the year) and 64.7B (a
// quarter), and taking the wrong one is a silent 4x error. Annual rows are the ones whose
// start..end spans a year, on an annual form. Later filings restate earlier ones, so the newest
// filing of a given year wins.
function edgarAnnual(facts, tag, currency) {
    const units = facts.facts?.['us-gaap']?.[tag]?.units;
    if (!units) return null;
    const rows = units[currency] || units.USD;
    if (!rows) return null;
    const out = new Map();
    for (const x of [...rows].sort((a, b) => (a.filed || '').localeCompare(b.filed || ''))) {
        if (!/^(10-K|20-F)$/.test(x.form) || x.fp !== 'FY') continue;
        if (!x.start || !x.end) continue;
        const days = (Date.parse(x.end) - Date.parse(x.start)) / 86400e3;
        if (!(days > 340 && days < 380)) continue;      // a year, not a quarter or a segment
        out.set(x.end, x.val);
    }
    return out.size ? out : null;
}

async function edgarCandidate(yahoo, currency) {
    if (yahoo.includes('.') || yahoo.startsWith('^')) return null;   // not a US listing
    const cik = await cikFor(yahoo);
    if (!cik) return null;
    const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC_UA);
    if (!facts) return null;
    const byField = (tags) => {
        const m = new Map();
        for (const t of tags) { const col = edgarAnnual(facts, t, currency); if (col) m.set(t, col); }
        return m;
    };
    const rev = byField(EDGAR_REV), nic = byField(EDGAR_NIC), opinc = byField(EDGAR_OPINC);
    // opinc is not part of the gate: rev and nic still decide whether this source is usable.
    return rev.size && nic.size ? { rev, nic, opinc } : null;
}

/* ---------------- source 2: stockanalysis.com ---------------- */

// Yahoo suffix -> stockanalysis exchange path. Verified by probe against a live ticker in
// each market. Frankfurt/Xetra (.DE, .F) and Korea (.KS) are absent from the site.
const EXCHANGE = { HK: 'hkg', T: 'tyo', PA: 'epa', L: 'lon' };

// A ticker can sit at more than one path (US listings under /stocks/, ADRs under
// /quote/otc/), so candidates are tried in order until one returns financials.
function urlsFor(yahoo) {
    const m = yahoo.match(/^(.+)\.(\w+)$/);
    if (m) {
        const ex = EXCHANGE[m[2]];
        if (!ex) return [];                              // market not covered
        // Yahoo's code carries through as-is (0001.HK -> hkg/0001). Zero-stripped is a
        // fallback only: hkg/0001 resolves and hkg/1 does not, so padding must be kept.
        const codes = [...new Set([m[1], String(Number(m[1]))])].filter(c => c !== 'NaN');
        return codes.map(c => `quote/${ex}/${c}`);
    }
    if (yahoo.startsWith('^')) return [];                // index
    return [`stocks/${yahoo.replace('-', '.')}`, `quote/otc/${yahoo}`];  // BRK-B -> BRK.B
}

// SvelteKit serialises its payload as a flat pool where every value is an INDEX into that
// pool (so repeated values are stored once). Walk it back into a plain object.
function hydrate(pool, i, depth = 0) {
    if (typeof i !== 'number' || depth > 6) return i;
    const v = pool[i];
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => hydrate(pool, x, depth + 1));
    const out = {};
    for (const k in v) out[k] = hydrate(pool, v[k], depth + 1);
    return out;
}

function financialData(json) {
    for (const node of json.nodes || []) {
        if (node.type !== 'data') continue;
        const root = hydrate(node.data, 0, 0);
        if (root?.financialData?.fiscalYear) return root.financialData;
    }
    return null;
}

const SA_NIC = ['netinccmn', 'netIncome', 'netinc'];

function saColumns(fd) {
    const dates = fd.datekey
        .map((date, i) => ({ date, i }))
        // TTM is not a fiscal year, and would land as a duplicate of the current one.
        .filter(r => r.date !== 'TTM' && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    const col = arr => {
        if (!Array.isArray(arr)) return null;
        const m = new Map();
        for (const { date, i } of dates) if (typeof arr[i] === 'number') m.set(date, arr[i]);
        return m.size ? m : null;
    };
    const rev = new Map(), nic = new Map();
    const r = col(fd.revenue);
    if (r) rev.set('revenue', r);
    for (const f of SA_NIC) { const c = col(fd[f]); if (c) nic.set(f, c); }
    return rev.size && nic.size ? { rev, nic } : null;
}

async function saCandidate(yahoo) {
    for (const path of urlsFor(yahoo)) {
        const json = await getJson(`https://stockanalysis.com/${path}/financials/__data.json`);
        if (!json) continue;
        const fd = financialData(json);
        if (fd) return saColumns(fd);
    }
    return null;
}

/* ---------------- validation ---------------- */

// Pick the (revenue tag, bottom-line tag) pair that reproduces Yahoo on every year both have.
// Returns null if no pair does — in which case the source is refused outright rather than
// trusted for the years Yahoo cannot check. That refusal is the point.
function reconcile(cand, yahooYears) {
    if (!cand) return null;
    const known = new Map(yahooYears.map(y => [fyOf(y.date), y]));
    const agrees = (col, field) => {
        const dates = [...col.keys()].filter(d => known.has(fyOf(d)));
        if (!dates.length) return false;                 // nothing to verify against = no proof
        return dates.every(d => {
            const want = known.get(fyOf(d))[field];
            return want == null || same(col.get(d), want);
        });
    };
    // Stricter than `agrees`, and only used for operating income. `agrees` passes a column whose
    // every overlapping year is null on Yahoo's side — fine for rev and nic, which Yahoo always
    // carries, but Yahoo's opinc coverage is patchy, so that would accept a tag nothing ever
    // checked. This demands at least one real comparison: the file's own rule that a source is
    // not trusted where it cannot be verified.
    const proves = (col, field) => {
        const dates = [...col.keys()]
            .filter(d => known.has(fyOf(d)) && known.get(fyOf(d))[field] != null);
        return dates.length > 0 && dates.every(d => same(col.get(d), known.get(fyOf(d))[field]));
    };
    for (const [revField, revCol] of cand.rev) {
        if (!agrees(revCol, 'rev')) continue;
        for (const [nicField, nicCol] of cand.nic) {
            if (!agrees(nicCol, 'nic')) continue;
            // Optional, and deliberately chosen AFTER rev/nic have decided the source: a filer
            // that never tags OperatingIncomeLoss, or whose tag disagrees with Yahoo, still gets
            // its revenue and bottom line. It just does not get this column.
            let opField = null, opCol = null;
            for (const [f, col] of (cand.opinc || new Map())) {
                if (proves(col, 'opinc')) { opField = f; opCol = col; break; }
            }
            const years = new Map();
            for (const [date, rev] of revCol) {
                const nic = nicCol.get(date);
                if (typeof rev === 'number' && typeof nic === 'number') {
                    const y = { date, rev, nic };
                    const op = opCol?.get(date);
                    if (typeof op === 'number') y.opinc = op;
                    years.set(fyOf(date), y);
                }
            }
            if (years.size) {
                return { field: `${revField}/${nicField}${opField ? `/${opField}` : ''}`, years };
            }
        }
    }
    return null;
}

// Which fiscal years may be kept: the unbroken run back from the most recent one, across what
// we already hold plus what the source offers.
//
// A filer switches XBRL tags mid-history — Google files `Revenues` for its older years and
// RevenueFromContractWithCustomer... for its newer ones — so a single validated tag has holes.
// The tag covering only the old years cannot be validated at all (no overlap with Yahoo's four
// years = no proof), so it is correctly refused, and what survives is 2017 sitting next to 2021
// with nothing between. Rendering that as consecutive rows would imply a continuity that does
// not exist and quietly corrupt a CAGR. Anything on the far side of a gap is dropped.
function unbrokenRun(haveFys, sourceFys) {
    const all = [...new Set([...haveFys, ...sourceFys])].map(Number).sort((a, b) => a - b);
    let i = all.length - 1;
    while (i > 0 && all[i - 1] === all[i] - 1) i--;
    return new Set(all.slice(i).map(String));
}

/* ---------------- main ---------------- */

async function main() {
    const store = JSON.parse(fs.readFileSync(EARNINGS, 'utf8'));
    const tickers = Object.entries(store.eps).filter(([, e]) => e.years?.length);
    console.log(`backfilling ${tickers.length} ticker(s) with earnings history\n`);

    let added = 0, skipped = 0, unchanged = 0, uncovered = 0;
    for (const [yahoo, entry] of tickers) {
        // Deepest source first: EDGAR is the filings themselves and reaches ~9 years, where
        // stockanalysis stops at 5. Whichever reconciles first wins outright — the years are
        // never mixed across sources, so a fiscal year can't sit on a different definition
        // from the one before it.
        let got = null, via = null;
        for (const [name, fn] of [['EDGAR', () => edgarCandidate(yahoo, entry.currency)],
            ['SA', () => saCandidate(yahoo)]]) {
            let cand;
            try { cand = await fn(); }
            catch (e) { console.log(`  !    ${yahoo.padEnd(10)} ${name} failed: ${e.message}`); continue; }
            if (!cand) continue;
            const ok = reconcile(cand, entry.years);
            if (ok) { got = ok; via = name; break; }
            console.log(`  SKIP ${yahoo.padEnd(10)} ${name} does not reconcile with Yahoo`);
        }
        if (!got) { (via === null ? uncovered++ : skipped++); await sleep(); continue; }

        // A year we already hold is NOT necessarily complete. Yahoo caps each field at 4 points
        // on windows that don't line up, so a year can arrive carrying EPS but no revenue
        // (2638.HK FY2025). Those get patched in place rather than skipped as "already have".
        const byFy = new Map(entry.years.map(y => [fyOf(y.date), y]));
        const allowed = unbrokenRun([...byFy.keys()], [...got.years.keys()]);
        const fresh = [], patched = [];
        for (const [fy, v] of got.years) {
            if (!allowed.has(fy)) continue;
            const existing = byFy.get(fy);
            if (!existing) { fresh.push(v); continue; }
            // Keep Yahoo's own date and its eps/ni — only fill the holes. opinc counts as a hole
            // like the others: a year backfilled by an earlier run carries rev and nic but no
            // operating income, and this is what fills it in without re-adding the year.
            if (existing.rev == null || existing.nic == null
                || (existing.opinc == null && v.opinc != null)) {
                if (existing.rev == null) existing.rev = v.rev;
                if (existing.nic == null) existing.nic = v.nic;
                if (existing.opinc == null && v.opinc != null) existing.opinc = v.opinc;
                patched.push(fy);
            }
        }
        if (!fresh.length && !patched.length) { unchanged++; await sleep(); continue; }

        entry.years = [...entry.years, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
        added += fresh.length + patched.length;
        const what = [fresh.length ? `+${fresh.map(f => fyOf(f.date)).join(' ')}` : '',
            patched.length ? `filled ${patched.join(' ')}` : ''].filter(Boolean).join(', ');
        console.log(`  ok   ${yahoo.padEnd(10)} ${what}  (${via}, on ${got.field})`);
        await sleep();
    }

    if (added) {
        fs.writeFileSync(EARNINGS, JSON.stringify(store, null, 1));
        console.log(`\nwrote ${EARNINGS}: +${added} fiscal year(s)`);
    } else {
        console.log('\nnothing to add');
    }
    console.log(`${unchanged} already complete, ${skipped} refused, ${uncovered} no source`);
}

// --selftest: the trust logic, which is the only part worth testing. No network.
if (process.argv.includes('--selftest')) {
    const assert = require('assert');

    assert.deepStrictEqual(urlsFor('1113.HK'), ['quote/hkg/1113']);
    // The padded code is the one that resolves (hkg/0001 works, hkg/1 404s), so it must be
    // tried first; the stripped form is only a fallback.
    assert.deepStrictEqual(urlsFor('0001.HK'), ['quote/hkg/0001', 'quote/hkg/1']);
    assert.deepStrictEqual(urlsFor('MC.PA'), ['quote/epa/MC']);
    assert.deepStrictEqual(urlsFor('BRK-B'), ['stocks/BRK.B', 'quote/otc/BRK-B']);
    assert.deepStrictEqual(urlsFor('NW0.DE'), []);                 // Xetra not on the site
    assert.deepStrictEqual(urlsFor('^GSPC'), []);

    const yahoo = [                      // what the hourly job already banked
        { date: '2022-12-31', rev: 100, nic: 10, eps: 1, ni: 12 },
        { date: '2023-12-31', rev: 200, nic: 20, eps: 2, ni: 24 },
    ];
    const cand = (rev, nic) => ({
        rev: new Map(Object.entries(rev).map(([k, v]) => [k, new Map(Object.entries(v))])),
        nic: new Map(Object.entries(nic).map(([k, v]) => [k, new Map(Object.entries(v))])),
    });

    // Hong Kong shape: netinc is the group total, netinccmn is after minorities. Only the
    // latter reproduces Yahoo, so it must be the one chosen — this is the 1113.HK case.
    const hk = cand(
        { revenue: { '2023-12-31': 200, '2022-12-31': 100, '2021-12-31': 50 } },
        {
            netinc: { '2023-12-31': 24, '2022-12-31': 12, '2021-12-31': 6 },
            netinccmn: { '2023-12-31': 20, '2022-12-31': 10, '2021-12-31': 5 },
        });
    const gotHk = reconcile(hk, yahoo);
    assert.strictEqual(gotHk.field, 'revenue/netinccmn');
    assert.deepStrictEqual(gotHk.years.get('2021'), { date: '2021-12-31', rev: 50, nic: 5 });
    // A source with no opinc at all is unchanged — the column is optional end to end.
    assert.ok(!('opinc' in gotHk.years.get('2021')));

    // ---- operating income ----
    const withOp = (rev, nic, opinc) => ({ ...cand(rev, nic),
        opinc: new Map(Object.entries(opinc).map(([k, v]) => [k, new Map(Object.entries(v))])) });
    const yahooOp = [
        { date: '2022-12-31', rev: 100, nic: 10, opinc: 30, eps: 1 },
        { date: '2023-12-31', rev: 200, nic: 20, opinc: 60, eps: 2 },
    ];
    const revCol = { revenue: { '2023-12-31': 200, '2022-12-31': 100, '2021-12-31': 50 } };
    const nicCol = { netinccmn: { '2023-12-31': 20, '2022-12-31': 10, '2021-12-31': 5 } };

    // Reproduces Yahoo on the overlapping years, so the older year is carried.
    const good = reconcile(withOp(revCol, nicCol,
        { OperatingIncomeLoss: { '2023-12-31': 60, '2022-12-31': 30, '2021-12-31': 15 } }), yahooOp);
    assert.strictEqual(good.field, 'revenue/netinccmn/OperatingIncomeLoss');
    assert.deepStrictEqual(good.years.get('2021'), { date: '2021-12-31', rev: 50, nic: 5, opinc: 15 });

    // Disagrees on 2022 (31 vs 30): the column is dropped, but rev and nic still come through.
    // A wrong operating-income tag must never cost the years that ARE verified.
    const bad = reconcile(withOp(revCol, nicCol,
        { OperatingIncomeLoss: { '2023-12-31': 60, '2022-12-31': 31, '2021-12-31': 15 } }), yahooOp);
    assert.strictEqual(bad.field, 'revenue/netinccmn');
    assert.deepStrictEqual(bad.years.get('2021'), { date: '2021-12-31', rev: 50, nic: 5 });

    // Nothing to check it against — Yahoo carries no opinc on any overlapping year — so the tag
    // is refused rather than trusted. This is the case `agrees` would have waved through.
    const unproven = reconcile(withOp(revCol, nicCol,
        { OperatingIncomeLoss: { '2023-12-31': 60, '2022-12-31': 30, '2021-12-31': 15 } }), yahoo);
    assert.strictEqual(unproven.field, 'revenue/netinccmn');
    assert.ok(!('opinc' in unproven.years.get('2021')));

    // US shape: no "available to common" tag at all, and plain net income IS what Yahoo reports.
    const us = cand({ revenue: { '2023-12-31': 200, '2022-12-31': 100, '2021-12-31': 50 } },
        { netIncome: { '2023-12-31': 20, '2022-12-31': 10, '2021-12-31': 5 } });
    assert.strictEqual(reconcile(us, yahoo).field, 'revenue/netIncome');

    // EDGAR shape: several revenue tags, only one of which is the top line. The check picks.
    const edgar = cand(
        {
            Revenues: { '2023-12-31': 999, '2022-12-31': 999 },                  // wrong tag
            RevenueFromContractWithCustomerExcludingAssessedTax:
                { '2023-12-31': 200, '2022-12-31': 100, '2021-12-31': 50, '2020-12-31': 25 },
        },
        {
            NetIncomeLossAvailableToCommonStockholdersBasic:
                { '2023-12-31': 20, '2022-12-31': 10, '2021-12-31': 5, '2020-12-31': 2 },
        });
    const gotEdgar = reconcile(edgar, yahoo);
    assert.strictEqual(gotEdgar.field,
        'RevenueFromContractWithCustomerExcludingAssessedTax/NetIncomeLossAvailableToCommonStockholdersBasic');
    assert.strictEqual(gotEdgar.years.size, 4);
    assert.deepStrictEqual(gotEdgar.years.get('2020'), { date: '2020-12-31', rev: 25, nic: 2 });

    // A source that disagrees with Yahoo where both have data is refused outright, rather
    // than trusted for the years Yahoo cannot check. This is the whole point.
    assert.strictEqual(reconcile(cand({ revenue: { '2023-12-31': 200, '2022-12-31': 100 } },
        { netIncome: { '2023-12-31': 21, '2022-12-31': 10 } }), yahoo), null);   // nic off by 1
    assert.strictEqual(reconcile(cand({ revenue: { '2023-12-31': 201, '2022-12-31': 100 } },
        { netIncome: { '2023-12-31': 20, '2022-12-31': 10 } }), yahoo), null);   // rev off by 1

    // Fiscal ends that differ by a few days are the SAME year (Apple: Yahoo 09-30 vs
    // filing 09-24) and must still reconcile.
    assert.ok(reconcile(cand({ revenue: { '2023-12-28': 200, '2022-12-24': 100 } },
        { netIncome: { '2023-12-28': 20, '2022-12-24': 10 } }), yahoo));

    // No overlap to verify against = no proof = nothing taken.
    assert.strictEqual(reconcile(cand({ revenue: { '2019-12-31': 1 } },
        { netIncome: { '2019-12-31': 1 } }), yahoo), null);

    // unbrokenRun: nothing on the far side of a gap.
    // A clean extension backwards is kept whole.
    assert.deepStrictEqual([...unbrokenRun(['2024', '2025'], ['2022', '2023', '2024', '2025'])].sort(),
        ['2022', '2023', '2024', '2025']);
    // The TSLA/GOOG case: 2018 is stranded behind a hole, so it goes.
    assert.deepStrictEqual([...unbrokenRun(['2024', '2025'], ['2018', '2021', '2022', '2023'])].sort(),
        ['2021', '2022', '2023', '2024', '2025']);
    // A gap the store itself already has is respected — nothing before it is added.
    assert.deepStrictEqual([...unbrokenRun(['2020', '2024', '2025'], ['2019'])].sort(), ['2024', '2025']);
    // Source years bridging a hole in the store make the whole span contiguous again.
    assert.deepStrictEqual([...unbrokenRun(['2022', '2025'], ['2023', '2024'])].sort(),
        ['2022', '2023', '2024', '2025']);

    console.log('selftest ok');
} else if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
