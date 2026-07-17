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
// stockanalysis.com carries 5 fiscal years free. It has no public API: the numbers come
// out of the page's internal SvelteKit payload (`__data.json`), an undocumented
// index-pointer format that can change shape on any deploy of their site. That is
// exactly the kind of source AGENTS.md says not to trust.
//
// So it is used the only way it safely can be: ONCE, by hand, with the result committed.
// earnings.json is the store of record and mergeEarnings() keeps banked years forever, so
// the hourly Yahoo job merges its 4 years on top of this and the older years simply
// persist. If stockanalysis breaks or changes, this script fails loudly on a laptop and
// the live pipeline never notices — the data is already in the repo.
//
// Trust model: the source proves itself
// -------------------------------------
// The 4 years Yahoo *does* have overlap the 5 this source returns. So every overlapping
// year must match Yahoo EXACTLY on both revenue and bottom line, or the ticker is
// skipped whole. A source that disagrees where it can be checked is not trusted where it
// cannot. This also pins down a real hazard: the payload's field names vary by market
// (US pages carry `netIncome`, Hong Kong pages carry `netinc` AND `netinccmn`, which
// differ by minority interests). Rather than hard-code a guess per market, every
// candidate field is tried and only one that reproduces Yahoo's figures is accepted —
// the check picks the field, so a schema change cannot silently pick a wrong one.
//
// Deliberately backfills `rev` and `nic` only — never `eps` or `ni`. troughPe() skips a
// year whose EPS is not positive, so the P/E Low keeps its documented "cheapest in ~4y"
// meaning instead of silently shifting when this runs.
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const EARNINGS = 'earnings.json';

// Yahoo suffix -> stockanalysis exchange path. Verified by probe against a live ticker in
// each market. Frankfurt/Xetra (.DE, .F) are absent from the site, so they stay on 4 years.
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

async function fetchStatement(yahoo) {
    for (const path of urlsFor(yahoo)) {
        const res = await fetch(`https://stockanalysis.com/${path}/financials/__data.json`,
            { headers: { 'User-Agent': UA } });
        if (!res.ok) continue;
        const fd = financialData(await res.json());
        if (fd) return fd;
    }
    return null;
}

// Fiscal-year ends do not agree between sources — Yahoo normalises Apple's FY2022 to
// 2022-09-30 while the filing (and stockanalysis) says 2022-09-24. Align on the calendar
// year instead. A genuine misalignment cannot slip through: it would have to also match
// Yahoo's revenue and bottom line to the digit.
const fyOf = date => date.slice(0, 4);
const same = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.abs(a) * 1e-9;

// Pull { fy -> {rev, nic} } out of the payload, choosing the bottom-line field that
// reproduces Yahoo. Returns null if no candidate field validates.
function extract(fd, yahooYears) {
    const rows = fd.datekey
        .map((date, i) => ({ date, i }))
        .filter(r => r.date !== 'TTM' && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    const known = new Map(yahooYears.map(y => [fyOf(y.date), y]));

    // Revenue must line up first — if it doesn't, the whole payload is suspect.
    const revOk = rows.every(r => {
        const y = known.get(fyOf(r.date));
        return !y || y.rev == null || same(fd.revenue?.[r.i], y.rev);
    });
    const overlap = rows.filter(r => known.has(fyOf(r.date)));
    if (!revOk || !overlap.length) return null;

    for (const field of ['netinccmn', 'netIncome', 'netinc']) {
        const col = fd[field];
        if (!Array.isArray(col)) continue;
        // Every overlapping year must reproduce Yahoo's nic exactly.
        const ok = overlap.every(r => {
            const y = known.get(fyOf(r.date));
            return y.nic == null || same(col[r.i], y.nic);
        });
        if (!ok) continue;
        const out = new Map();
        for (const r of rows) {
            const rev = fd.revenue?.[r.i], nic = col[r.i];
            if (typeof rev === 'number' && typeof nic === 'number')
                out.set(fyOf(r.date), { date: r.date, rev, nic });
        }
        return { field, years: out };
    }
    return null;
}

const sleep = (ms = 400) => new Promise(r => setTimeout(r, ms));

async function main() {
    const store = JSON.parse(fs.readFileSync(EARNINGS, 'utf8'));
    const tickers = Object.entries(store.eps).filter(([, e]) => e.years?.length);
    console.log(`backfilling ${tickers.length} ticker(s) with earnings history\n`);

    let added = 0, skipped = 0, unchanged = 0, uncovered = 0;
    for (const [yahoo, entry] of tickers) {
        if (!urlsFor(yahoo).length) {
            console.log(`  –    ${yahoo.padEnd(9)} market not covered`);
            uncovered++;
            continue;
        }
        let fd;
        try { fd = await fetchStatement(yahoo); }
        catch (e) { console.log(`  !    ${yahoo.padEnd(9)} fetch failed: ${e.message}`); skipped++; continue; }
        if (!fd) { console.log(`  !    ${yahoo.padEnd(9)} no financials found`); skipped++; continue; }

        const got = extract(fd, entry.years);
        if (!got) {
            // The source disagreed with Yahoo where both had data. Trust Yahoo, take nothing.
            console.log(`  SKIP ${yahoo.padEnd(9)} does not reconcile with Yahoo`);
            skipped++;
            await sleep();
            continue;
        }
        // A year we already hold is NOT necessarily complete. Yahoo caps each field at 4 points
        // on windows that don't line up, so a year can arrive carrying EPS but no revenue
        // (2638.HK FY2025). Those get patched in place rather than skipped as "already have".
        const byFy = new Map(entry.years.map(y => [fyOf(y.date), y]));
        const fresh = [], patched = [];
        for (const [fy, v] of got.years) {
            const existing = byFy.get(fy);
            if (!existing) { fresh.push(v); continue; }
            if (existing.rev == null || existing.nic == null) {
                // Keep Yahoo's own date and its eps/ni — only fill the holes.
                if (existing.rev == null) existing.rev = v.rev;
                if (existing.nic == null) existing.nic = v.nic;
                patched.push(fy);
            }
        }
        if (!fresh.length && !patched.length) { unchanged++; await sleep(); continue; }

        entry.years = [...entry.years, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
        added += fresh.length + patched.length;
        const what = [fresh.length ? `+${fresh.map(f => fyOf(f.date)).join(' ')}` : '',
            patched.length ? `filled ${patched.join(' ')}` : ''].filter(Boolean).join(', ');
        console.log(`  ok   ${yahoo.padEnd(9)} ${what}  (verified on ${got.field})`);
        await sleep();
    }

    if (added) {
        fs.writeFileSync(EARNINGS, JSON.stringify(store, null, 1));
        console.log(`\nwrote ${EARNINGS}: +${added} fiscal year(s)`);
    } else {
        console.log('\nnothing to add');
    }
    console.log(`${unchanged} already complete, ${skipped} skipped, ${uncovered} market not covered`);
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
    // Hong Kong shape: netinc is the group total, netinccmn is after minorities. Only the
    // latter reproduces Yahoo, so it must be the one chosen — this is the 1113.HK case.
    const hk = {
        datekey: ['TTM', '2023-12-31', '2022-12-31', '2021-12-31'],
        revenue: [999, 200, 100, 50],
        netinc: [999, 24, 12, 6],
        netinccmn: [999, 20, 10, 5],
    };
    const gotHk = extract(hk, yahoo);
    assert.strictEqual(gotHk.field, 'netinccmn');
    assert.deepStrictEqual(gotHk.years.get('2021'), { date: '2021-12-31', rev: 50, nic: 5 });
    assert.ok(!gotHk.years.has('TTM'));                            // TTM is not a fiscal year

    // US shape: no netinccmn at all, netIncome IS the figure Yahoo reports as nic.
    const us = {
        datekey: ['TTM', '2023-12-31', '2022-12-31', '2021-12-31'],
        revenue: [999, 200, 100, 50],
        netIncome: [999, 20, 10, 5],
    };
    assert.strictEqual(extract(us, yahoo).field, 'netIncome');

    // A source that disagrees with Yahoo where both have data is refused outright, rather
    // than trusted for the years Yahoo cannot check. This is the whole point.
    const wrongNic = { ...us, netIncome: [999, 21, 10, 5] };
    assert.strictEqual(extract(wrongNic, yahoo), null);
    const wrongRev = { ...us, revenue: [999, 201, 100, 50] };
    assert.strictEqual(extract(wrongRev, yahoo), null);

    // Fiscal ends that differ by a few days are the SAME year (Apple: Yahoo 09-30 vs
    // filing 09-24) and must still reconcile.
    const offset = {
        datekey: ['TTM', '2023-12-28', '2022-12-24', '2021-12-25'],
        revenue: [999, 200, 100, 50],
        netIncome: [999, 20, 10, 5],
    };
    assert.strictEqual(extract(offset, yahoo).field, 'netIncome');

    // No overlap to verify against = no proof = nothing taken.
    assert.strictEqual(extract({ datekey: ['2019-12-31'], revenue: [1], netIncome: [1] }, yahoo), null);

    console.log('selftest ok');
} else if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
