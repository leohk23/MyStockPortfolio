#!/usr/bin/env node
// `node pot/review-due.js` — is the Review due? Prints why, and exits 0 when it is, 1 when it is not
// (D114, Leo 8 Nov 2026). Both machines ask it: the nightly cloud Review (pot-review.yml), and the
// laptop's cycle, which so finds nothing due once the cloud one has run and runs the Review itself
// when that one did not.
//
// Due when any of these holds:
//   - there is no Review yet;
//   - the newest is two or more calendar days old (UTC). The old every-other-day rule, kept as a
//     floor: a falsifier that turns on news rather than a filing has no date to book;
//   - a date the newest Review booked under `## Next checks` has passed since it was written;
//   - a pot holding's results have landed since then: a date in signals.json's `resultsDue`, or a
//     `6.3 results` signal. The backstop for a date the Review did not book.
// A booked or calendar date has passed once its whole UTC day is over, so an after-close US release
// is out by then, and a Review written the morning of results day does not count as having seen
// them. A 6.3 signal is evidence the results are out, so it counts from the scan that raised it.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAY = 86400000;
const FLOOR_DAYS = 2;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };

// pot/reviews/YYYY-MM-DD-HHMM.md, stamped in UTC (brief-review.md). Newest first.
const stamps = names => names.map(f => (f.match(/^(\d{4}-\d{2}-\d{2}-\d{4})\.md$/) || [])[1])
    .filter(Boolean).sort().reverse();
const stampTime = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(13, 15));
const endOfDay = d => Date.parse(d + 'T00:00:00Z') + DAY;

// The `## Next checks` table: | date | ticker | what | source |. A row whose date is not YYYY-MM-DD
// is returned as unreadable, never dropped without a word.
function booked(md) {
    const rows = [], bad = [];
    let inside = false, header = false;
    for (const raw of md.replace(/\r/g, '').split('\n')) {
        const l = raw.trim();
        if (/^#{1,6} /.test(l)) { inside = /^## Next checks\b/.test(l); header = inside; continue; }
        if (!inside || !l.startsWith('|') || /^\|[\s:|-]+\|$/.test(l)) continue;
        if (header) { header = false; continue; }
        const c = l.replace(/^\||\|$/g, '').split('|').map(s => s.replace(/[`*]/g, '').trim());
        ISO.test(c[0]) ? rows.push({ date: c[0], ticker: c[1] || '?', what: c[2] || '' }) : bad.push(l);
    }
    return { rows, bad };
}

// Pure: everything it reads is passed in. `names` are pot/reviews' file names, `md` the newest
// one's text, `holdings` the pot's tickers.
function decide({ names, md = '', signals = null, holdings = [], now = Date.now() }) {
    const all = stamps(names);
    if (!all.length) return { due: true, why: 'no Review yet' };
    const last = all[0], lastAt = stampTime(last);
    const landed = at => at > lastAt && at <= now;
    const reasons = [];

    const days = Math.floor(now / DAY) - Math.floor(lastAt / DAY);
    if (days >= FLOOR_DAYS) reasons.push(`the last Review is ${days} days old`);

    const { rows, bad } = booked(md);
    for (const r of rows) if (landed(endOfDay(r.date))) reasons.push(`${r.ticker} ${r.date}, booked: ${r.what}`);

    const held = new Set(holdings);
    for (const [t, d] of Object.entries(signals?.resultsDue || {})) {
        if (held.has(t) && ISO.test(d) && landed(endOfDay(d))) reasons.push(`${t} results ${d}`);
    }
    const scanAt = Date.parse(signals?.generated);
    for (const f of signals?.fired || []) {
        if (f.rule === '6.3 results' && landed(scanAt)) reasons.push(`${f.ticker} reported ${f.reported} (6.3)`);
    }

    const unread = bad.length ? `; ${bad.length} Next checks row(s) with no YYYY-MM-DD date, ignored` : '';
    if (reasons.length) return { due: true, why: `due: ${[...new Set(reasons)].join('; ')} (last Review ${last})${unread}` };
    const next = rows.filter(r => endOfDay(r.date) > now).sort((a, b) => a.date.localeCompare(b.date))[0];
    return { due: false, why: `not due: last Review ${last}` + (next ? `, next booked ${next.date} ${next.ticker}` : ', nothing booked') + unread };
}

function run() {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, 'pot/reviews')); } catch { /* none yet */ }
    let r;
    try {
        const newest = stamps(names)[0];
        const md = newest ? fs.readFileSync(path.join(ROOT, 'pot/reviews', newest + '.md'), 'utf8') : '';
        r = decide({ names, md, signals: read('signals.json'), holdings: Object.keys(read('pot/positions.json', {}).holdings || {}) });
    } catch (e) {
        // A broken gate must not stop the Review for good: fall back to the floor alone.
        r = decide({ names });
        r.why += ` (the full check failed: ${e.message}; the 2-day floor alone decided)`;
    }
    console.log(r.why);
    process.exit(r.due ? 0 : 1);
}

function selftest() {
    const assert = require('assert');
    const at = s => Date.parse(s);
    const names = ['README.md', '2026-11-05-0837.md', '2026-11-07-1228.md'];
    const md = [
        '## MWA — warned', '', '## Next checks', '',
        '| date | ticker | what | source |', '|---|---|---|---|',
        '| 2026-11-12 | EUZ.DE | Q3 results | issuer calendar |',
        '| `2026-11-18` | EXPN.L | H1 results | issuer calendar |',
        '| 12 Nov | 7532.T | results | Yahoo |', '', '## Calls', '| id | result |', '|---|---|', '| x | pass |',
    ].join('\n');

    // Nothing yet: due.
    assert.strictEqual(decide({ names: ['README.md'] }).due, true);
    // The day after: not due, and it names the next booked date.
    let r = decide({ names, md, now: at('2026-11-08T00:31:00Z') });
    assert.strictEqual(r.due, false);
    assert.ok(/next booked 2026-11-12 EUZ\.DE/.test(r.why), r.why);
    assert.ok(/1 Next checks row/.test(r.why), 'an unreadable row is reported, not dropped');
    // Two calendar days on: the floor.
    assert.strictEqual(decide({ names, md, now: at('2026-11-09T00:31:00Z') }).due, true);
    // A booked date counts once its whole UTC day is over, not during it.
    const fresh = ['2026-11-11-0031.md'];
    assert.strictEqual(decide({ names: fresh, md, now: at('2026-11-12T22:00:00Z') }).due, false);
    r = decide({ names: fresh, md, now: at('2026-11-13T00:31:00Z') });
    assert.strictEqual(r.due, true);
    assert.ok(/EUZ\.DE 2026-11-12, booked: Q3 results/.test(r.why), r.why);
    // ...and a Review written after that day ended has seen it.
    assert.strictEqual(decide({ names: ['2026-11-13-0031.md'], md, now: at('2026-11-13T06:30:00Z') }).due, false);
    // Backticks around a date are tolerated; the Calls table is not read as bookings.
    assert.strictEqual(booked(md).rows.length, 2);
    // The calendar backstop: a pot holding's results date, not anyone else's.
    const signals = { generated: '2026-11-13T06:30:05Z', resultsDue: { MWA: '2026-11-12', NVDA: '2026-11-12' }, fired: [] };
    r = decide({ names: fresh, signals, holdings: ['MWA'], now: at('2026-11-13T00:31:00Z') });
    assert.ok(r.due && /MWA results 2026-11-12/.test(r.why) && !/NVDA/.test(r.why), r.why);
    // A 6.3 signal counts from the scan that raised it, even the same day.
    const s63 = { generated: '2026-11-12T06:30:05Z', resultsDue: {}, fired: [{ rule: '6.3 results', ticker: 'AZN.L', reported: '2026-11-12' }] };
    assert.strictEqual(decide({ names: fresh, signals: s63, holdings: ['AZN.L'], now: at('2026-11-12T06:31:00Z') }).due, true);
    assert.strictEqual(decide({ names: ['2026-11-12-0700.md'], signals: s63, holdings: ['AZN.L'], now: at('2026-11-12T08:00:00Z') }).due, false);
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : run();
module.exports = { decide, booked };
