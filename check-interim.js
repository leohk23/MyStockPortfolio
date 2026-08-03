// What half-year results are missing, and are the ones we have self-consistent?
//
//   npm run interim
//
// interim.json is typed by hand, and hand-maintained files rot silently — you only notice the
// gap when a number on the page turns out to be a year old. This says which companies report
// twice a year, which of their interims are overdue, and whether what is already filed hangs
// together against the annual figures Yahoo gives us.
//
// Re-runnable and read-only: it never writes, never fetches, and can be run any number of times.
// Exit 1 means an entry is WRONG (fix it). Missing periods are reported but exit 0 — a company
// that has not announced yet is not an error.

const fs = require('fs');

const EARNINGS = 'earnings.json', INTERIM = 'interim.json';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

// Results follow a period end by roughly one to three months; nothing is "late" before that.
// Same shape of bounded window as the earnings due-check in fetch-prices.js.
const DUE_AFTER_DAYS = 60;

const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const addMonths = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    // Clamp to the month's length so 31 Aug + 6 months lands on 28/29 Feb, not 3 March.
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
};

// A company reports semi-annually (or only annually) if we hold annual figures for it and Yahoo
// has no sub-annual periods at all. Derived from the data rather than a hardcoded ticker list, so
// a name that starts reporting quarterly drops off this list by itself.
function semiAnnualReporters(store, tracked) {
    return tracked.filter(t => {
        const e = store[t];
        if (!e?.years?.length) return false;
        if ((e.quarters || []).length) return false;
        return e.years.some(y => y.eps != null);      // an operating company, not a fund
    }).sort();
}

// Split the half-years into the ones that actually make the page fresher and the ones that only
// add history.
//
// Only an interim AFTER the latest filed annual tells you anything new: H1 2025 is already inside
// the FY2025 annual we hold, so typing it in changes no headline figure. That distinction is the
// difference between a useful list and a wall of 36 chores nobody fills in.
//
//   due      - past the reporting window AND newer than the last filed annual. Type these in.
//   optional - superseded by an annual we already have. Adds a half-yearly trend, nothing more.
function expectedInterims(entry, today) {
    const ends = (entry.years || []).map(y => y.date).sort();
    if (!ends.length) return { due: [], optional: [] };
    const latestFiled = ends[ends.length - 1];
    const all = new Set();
    for (const fy of ends.slice(-3)) all.add(addMonths(fy, -6));       // half-year of each filed year
    all.add(addMonths(addMonths(latestFiled, 12), -6));                // ...and of the year in progress
    const ready = [...all].filter(d => days(today, d) >= DUE_AFTER_DAYS).sort();
    return {
        due: ready.filter(d => d > latestFiled),
        optional: ready.filter(d => d <= latestFiled),
    };
}

function main() {
    const store = read(EARNINGS).eps;
    const interim = read(INTERIM);
    const held = read('holdings.json').holdings.map(h => h.yahoo);
    const watched = read('watchlist.json').map(w => w.yahoo);
    const tracked = [...new Set([...held, ...watched])];
    const today = new Date().toISOString().slice(0, 10);

    const names = semiAnnualReporters(store, tracked);
    console.log(`${names.length} semi-annual reporter(s) tracked. A company gets ${DUE_AFTER_DAYS} days `
        + `after a half-year end before its interim counts as due.\n`);

    let missing = 0, optional = 0, have = 0, problems = [];
    for (const t of names) {
        const e = store[t];
        const rows = Array.isArray(interim[t]) ? interim[t] : [];
        const want = expectedInterims(e, today);
        const got = new Set(rows.map(r => r.end));
        const gaps = want.due.filter(d => !got.has(d));
        const extras = want.optional.filter(d => !got.has(d));
        const latestFiled = e.years[e.years.length - 1].date;

        const flag = gaps.length ? 'NEEDS H1' : rows.length ? 'ok' : 'nothing due';
        console.log(`${t.padEnd(10)} ${(e.currency || '?').padEnd(4)} annual to ${latestFiled} `
            + `(${days(today, latestFiled)}d old)  ${flag}`);
        if (gaps.length) {
            missing += gaps.length;
            console.log(`           type in: ${gaps.join(', ')}   <- makes this name fresher`);
        } else if (!rows.length) {
            // Say WHEN it will be worth coming back, rather than leaving a silent "nothing to do".
            const nextEnd = addMonths(addMonths(latestFiled, 12), -6);
            console.log(`           next H1 ends ${nextEnd}, due from ${addMonths(nextEnd, 2)}`);
        }
        optional += extras.length;

        for (const r of rows) {
            have++;
            const where = `${t} ${r.end}`;
            const bad = m => problems.push(`${where}: ${m}`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(r.end || '')) bad('end is not a YYYY-MM-DD date');
            if (r.currency && e.currency && r.currency !== e.currency)
                bad(`currency ${r.currency} does not match earnings.json (${e.currency})`);
            for (const k of ['rev', 'nic', 'eps']) {
                if (r[k] == null) { bad(`${k} is missing — omit the period rather than filing it half-empty`); continue; }
                if (!Number.isFinite(r[k])) bad(`${k} is "${r[k]}", not a number`);
            }
            if (r.opinc != null && !Number.isFinite(r.opinc)) bad('opinc is not a number');
            // The check that catches a units slip: a half year cannot out-earn its own full year.
            // Its fiscal year is the first year end at or after the period end.
            const fy = (e.years || []).find(y => y.date >= r.end);
            if (fy && Number.isFinite(r.rev)) {
                if (!(r.rev > 0)) bad('revenue is not positive');
                else if (fy.rev != null && r.rev > fy.rev)
                    bad(`revenue ${r.rev} exceeds the filed ${fy.date.slice(0, 4)} full year (${fy.rev}) — units slip?`);
            }
            if (fy && Number.isFinite(r.eps) && fy.eps != null && Math.abs(r.eps) > Math.abs(fy.eps) * 3)
                bad(`EPS ${r.eps} is more than 3x the filed ${fy.date.slice(0, 4)} full year (${fy.eps})`);
        }
    }

    console.log(`\n${have} interim period(s) on file. ${missing} would make a name fresher; `
        + `${optional} more would only add half-yearly history (already inside an annual we hold).`);
    if (problems.length) {
        console.log(`\n${problems.length} problem(s) — these would put wrong numbers on the page:`);
        problems.forEach(p => console.log('  ' + p));
        process.exit(1);
    }
    if (have) console.log('Every filed interim is self-consistent.');
    if (!missing) console.log('Nothing overdue: no company has an un-filed half-year past its announcement window.');
}

if (require.main === module) {
    if (process.argv.includes('--selftest')) {
        const assert = require('assert');
        assert.strictEqual(addMonths('2026-12-31', -6), '2026-06-30');
        assert.strictEqual(addMonths('2026-03-31', -6), '2025-09-30');
        assert.strictEqual(addMonths('2026-08-31', 6), '2027-02-28');   // clamped, not overflowed
        assert.strictEqual(addMonths('2025-12-31', 12), '2026-12-31');
        const e = { years: [{ date: '2025-12-31', eps: 1 }] };
        // H1 2025 sits INSIDE the FY2025 annual we already hold, so it is history, never a chore.
        assert.deepStrictEqual(expectedInterims(e, '2026-08-03').optional, ['2025-06-30']);
        // HKEx gives Main Board issuers two months to announce, so nothing is chased inside that
        // window: 34 days past the 2026 half-year is not late...
        assert.deepStrictEqual(expectedInterims(e, '2026-08-03').due, []);
        // ...77 days is, and that one IS newer than the last filed annual, so it earns its place.
        assert.deepStrictEqual(expectedInterims(e, '2026-09-15').due, ['2026-06-30']);
        // A quarterly reporter is not on the list; a fund (no EPS anywhere) is not either.
        const store = {
            A: { years: [{ date: '2025-12-31', eps: 1 }] },
            B: { years: [{ date: '2025-12-31', eps: 1 }], quarters: [{ date: '2025-09-30' }] },
            C: { years: [{ date: '2025-12-31' }] },
        };
        assert.deepStrictEqual(semiAnnualReporters(store, ['A', 'B', 'C']), ['A']);
        console.log('selftest ok');
    } else {
        main();
    }
}
