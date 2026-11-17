#!/usr/bin/env node
// `node pot/deepdive-due.js` — has a booked reopening landed (D127, Leo 17 Nov 2026)?
//
// A Deep dive that ends a name in WAIT because a publication it needs is not out yet books the run
// that reads it, in a `## Reopen when` table in its ranking. Leo's own bookings sit in the same table
// in pot/reopen.md. This finds which have landed, so the cycle can give that name its Deep dive
// without anyone having to watch for the filing. The Review's `## Next checks` (pot/review-due.js)
// is the same idea for what the pot holds; this is the Deep dive's, for what it does not.
//
//   | ticker | event | from | by | why |
//
//   event  10-Q, 10-K, 20-F, 40-F, 6-K or 8-K: a form filed with the SEC on or after `from`,
//          read from EDGAR's list of the company's filings. Amendments (10-Q/A) do not count.
//          `date`: the whole UTC day of `from` is over, for a market with no filings feed here.
//   from   the first day that counts.  by   the day to give up: past it, unlanded, the row lapses.
//
// pot/reopened.json records what has landed and which Deep dive read it. Only this script writes it,
// from the cycle; a lane may not (run-lane.ps1's allowlist), so no lane can close a booking itself.
// A row whose Deep dive has run is closed. A row for a name the pot holds is skipped: the Review
// owns those (brief-deepdive.md).
//
//   node pot/deepdive-due.js            what is due, waiting, lapsed; exits 0 when something is due
//   node pot/deepdive-due.js --json     the same as JSON on stdout, always exit 0 (for run-daily.ps1)
//   node pot/deepdive-due.js --ran <id> <ranking file>    record that a Deep dive read <id>
//   node pot/deepdive-due.js --selftest
//
// The only network use is EDGAR, and only for open filing rows: the ticker map, then one list of
// filings per company. A failed request leaves the row unchecked, never due and never lapsed.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const FORMS = ['10-Q', '10-K', '20-F', '40-F', '6-K', '8-K'];
const STATE = 'pot/reopened.json';
const HAND = 'pot/reopen.md';
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const endOfDay = d => Date.parse(d + 'T00:00:00Z') + DAY;

// Rows of the `## Reopen when` table in one document. A row that cannot be read is returned as
// unreadable with the reason, never dropped without a word.
function parseBookings(md, file) {
    const rows = [], bad = [];
    let inside = false;
    for (const raw of md.replace(/\r/g, '').split('\n')) {
        const l = raw.trim();
        if (/^#{1,6} /.test(l)) { inside = /^#{2,3} Reopen when\b/i.test(l); continue; }
        if (!inside || !l.startsWith('|') || /^\|[\s:|-]+\|$/.test(l)) continue;
        const c = l.replace(/^\||\|$/g, '').split('|').map(s => s.trim().replace(/^`|`$/g, ''));
        if (/^ticker$/i.test(c[0])) continue;
        const [ticker, ev, from, by, ...why] = c;
        const event = FORMS.find(f => f.toLowerCase() === String(ev || '').toLowerCase()) || (/^date$/i.test(ev || '') ? 'date' : null);
        const reason = !ticker ? 'no ticker' : !event ? `event "${ev}" is not one of ${FORMS.join(', ')} or date`
            : !ISO.test(from || '') ? `from "${from}" is not YYYY-MM-DD`
            : !ISO.test(by || '') ? `by "${by}" is not YYYY-MM-DD`
            : by < from ? 'by is before from' : null;
        if (reason) { bad.push({ file, line: l, reason }); continue; }
        rows.push({ id: `${file}|${ticker.toUpperCase()}|${event}|${from}`, file, ticker: ticker.toUpperCase(), event, from, by, why: why.join('|').trim() });
    }
    return { rows, bad };
}

// Every booking: the rankings, current and archived (D99), then Leo's own file.
function allBookings(root = ROOT) {
    const files = [];
    for (const dir of ['pot/proposals', 'pot/proposals/archive']) {
        let names = [];
        try { names = fs.readdirSync(path.join(root, dir)); } catch { continue; }
        for (const f of names) if (/^\d{4}-\d{2}-\d{2}-\d{4}-ranking\.md$/.test(f)) files.push(dir + '/' + f);
    }
    if (fs.existsSync(path.join(root, HAND))) files.push(HAND);
    const rows = [], bad = [];
    for (const f of files) {
        const out = parseBookings(fs.readFileSync(path.join(root, f), 'utf8'), f);
        rows.push(...out.rows); bad.push(...out.bad);
    }
    return { rows, bad };
}

// The first filing of `form` on or after `from`, from EDGAR's submissions document. Pure.
function firstFiling(subs, form, from, cik) {
    const r = subs?.filings?.recent;
    if (!r?.form) return null;
    let best = null;
    for (let i = 0; i < r.form.length; i++) {
        if (r.form[i] !== form || !(r.filingDate[i] >= from)) continue;
        if (best && best.filed <= r.filingDate[i]) continue;
        const acc = String(r.accessionNumber[i] || '');
        best = { form, filed: r.filingDate[i],
            url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${r.primaryDocument[i] || ''}` };
    }
    return best;
}

// Sorts open rows into due, waiting and lapsed. `landed` maps a row id to what was found, from this
// check or recorded earlier; `checked` is false for a filing row EDGAR could not answer. Pure.
function classify(rows, state, landed, held, now, checked = () => true) {
    const due = [], waiting = [], lapsed = [], closed = [], unchecked = [];
    for (const r of rows) {
        const s = state[r.id];
        if (s?.ran) { closed.push(r); continue; }
        if (held.has(r.ticker)) continue;
        const found = s?.landed || landed[r.id] || null;
        if (found) due.push({ ...r, landed: found });
        else if (!checked(r)) unchecked.push(r);
        else if (now >= endOfDay(r.by)) lapsed.push(r);
        else waiting.push(r);
    }
    due.sort((a, b) => a.landed.filed.localeCompare(b.landed.filed) || a.id.localeCompare(b.id));
    return { due, waiting, lapsed, closed, unchecked };
}

async function check(now = Date.now(), getJson = null) {
    const { rows, bad } = allBookings();
    const state = read(STATE, {});
    const pos = read('pot/positions.json', {});
    const held = new Set(Object.entries(pos.holdings || {}).filter(([, h]) => h?.qty > 0).map(([t]) => t.toUpperCase()));
    const landed = {}, failed = new Set(), notFiler = [];
    const today = new Date(now).toISOString().slice(0, 10);
    for (const r of rows) {
        if (state[r.id]?.landed || state[r.id]?.ran || held.has(r.ticker)) continue;
        if (r.event === 'date' && now >= endOfDay(r.from)) landed[r.id] = { form: 'date', filed: r.from };
    }
    const filingRows = rows.filter(r => r.event !== 'date' && !state[r.id]?.landed && !state[r.id]?.ran
        && !held.has(r.ticker) && r.from <= today && now < endOfDay(r.by) + 7 * DAY);
    if (filingRows.length) {
        getJson = getJson || require('../fetch-filing-dates').getJson;
        let cik = null;
        try {
            const map = await getJson('https://www.sec.gov/files/company_tickers.json');
            cik = new Map(Object.values(map).map(x => [String(x.ticker).toUpperCase(), String(x.cik_str).padStart(10, '0')]));
        } catch (e) { for (const r of filingRows) failed.add(r.id); console.error(`edgar ticker map: ${e.message}`); }
        const subs = new Map();
        for (const r of filingRows) {
            if (!cik) break;
            const id = cik.get(r.ticker);
            if (!id) { notFiler.push({ ...r, reason: 'not an SEC filer under this ticker: book a date instead' }); failed.add(r.id); continue; }
            try {
                if (!subs.has(id)) { subs.set(id, await getJson(`https://data.sec.gov/submissions/CIK${id}.json`)); await new Promise(res => setTimeout(res, 250)); }
                const f = firstFiling(subs.get(id), r.event, r.from, id);
                if (f) landed[r.id] = f;
            } catch (e) { failed.add(r.id); console.error(`edgar ${r.ticker}: ${e.message}`); }
        }
    }
    // What landed is written down at once, so a Deep dive that cannot run this cycle still finds it
    // the next, and the report can tell "landed, not yet read" from "lapsed".
    let wrote = false;
    for (const [id, f] of Object.entries(landed)) {
        if (!state[id]) { state[id] = { landed: f, seen: new Date(now).toISOString() }; wrote = true; }
    }
    if (wrote) fs.writeFileSync(path.join(ROOT, STATE), JSON.stringify(state, null, 1) + '\n');
    const out = classify(rows, state, landed, held, now, r => !failed.has(r.id));
    // A lapsed row is news for a week after its `by`, then old news (the D125 reasoning).
    const lapsed = out.lapsed.filter(r => now < endOfDay(r.by) + 7 * DAY);
    return { ...out, lapsed, unreadable: [...bad, ...notFiler] };
}

function recordRan(id, ranking, now = Date.now()) {
    const state = read(STATE, {});
    state[id] = { ...(state[id] || {}), ran: ranking, ranOn: new Date(now).toISOString() };
    fs.writeFileSync(path.join(ROOT, STATE), JSON.stringify(state, null, 1) + '\n');
}

function selftest() {
    const assert = require('assert');
    const md = [
        '# Ranking', '', '## Reopen when', '',
        '| ticker | event | from | by | why |', '|---|---|---|---|---|',
        '| NVDA | 10-Q | 2026-11-17 | 2026-12-01 | Q3 10-Q: legal note \\| China billing |',
        '| `0700.HK` | date | 2026-11-19 | 2026-11-19 | results day |',
        '| TSM | 10-q/A | 2026-11-17 | 2026-12-01 | an amendment is not an event |',
        '| ASML | 6-K | 2026-12-01 | 2026-11-30 | backwards |',
        '', '## Second reader', '| NVDA | 10-K | 2026-11-17 | 2026-12-01 | outside the section |',
    ].join('\n');
    const { rows, bad } = parseBookings(md, 'f.md');
    assert.deepStrictEqual(rows.map(r => r.id), ['f.md|NVDA|10-Q|2026-11-17', 'f.md|0700.HK|date|2026-11-19']);
    assert.deepStrictEqual(bad.map(b => b.reason), ['event "10-q/A" is not one of 10-Q, 10-K, 20-F, 40-F, 6-K, 8-K or date', 'by is before from']);

    const subs = { filings: { recent: {
        form: ['8-K', '10-Q', '10-Q/A', '10-Q', '10-Q'],
        filingDate: ['2026-11-18', '2026-11-19', '2026-11-18', '2026-08-26', '2026-11-18'],
        accessionNumber: ['a', '0001045810-26-000090', 'c', 'd', '0001045810-26-000088'],
        primaryDocument: ['x.htm', 'q2.htm', 'z.htm', 'old.htm', 'nvda-20261026.htm'] } } };
    assert.deepStrictEqual(firstFiling(subs, '10-Q', '2026-11-17', '0001045810'), { form: '10-Q', filed: '2026-11-18',
        url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/nvda-20261026.htm' }, 'the first 10-Q on or after from');
    assert.strictEqual(firstFiling(subs, '10-K', '2026-11-17', '1'), null);
    assert.strictEqual(firstFiling(subs, '10-Q', '2026-11-20', '1'), null, 'a filing before from does not count');

    const now = Date.parse('2026-11-20T06:30:00Z');
    const [nv, tc] = rows;
    const land = { form: '10-Q', filed: '2026-11-18', url: 'u' };
    let c = classify(rows, {}, { [nv.id]: land }, new Set(), now);
    assert.deepStrictEqual(c.due.map(r => r.ticker), ['NVDA']);
    assert.deepStrictEqual(c.lapsed.map(r => r.ticker), ['0700.HK'], 'a date row with nothing landed is lapsed once by is over');
    c = classify(rows, { [nv.id]: { landed: land, ran: 'r.md' } }, {}, new Set(), now);
    assert.deepStrictEqual([c.due.length, c.closed.length], [0, 1], 'a row its Deep dive read is closed');
    c = classify(rows, { [nv.id]: { landed: land } }, {}, new Set(), Date.parse('2026-12-10T00:00:00Z'));
    assert.deepStrictEqual(c.due.map(r => r.ticker), ['NVDA'], 'landed before by and not yet read: still due after by');
    c = classify(rows, {}, {}, new Set(['NVDA']), now);
    assert.ok(!c.due.length && !c.waiting.some(r => r.ticker === 'NVDA'), 'a name the pot holds belongs to the Review');
    c = classify([nv], {}, {}, new Set(), Date.parse('2026-11-19T00:00:00Z'), () => false);
    assert.deepStrictEqual([c.unchecked.length, c.lapsed.length, c.waiting.length], [1, 0, 0], 'EDGAR down: unchecked, never lapsed');
    c = classify([tc], {}, { [tc.id]: { form: 'date', filed: tc.from } }, new Set(), now);
    assert.deepStrictEqual(c.due.map(r => r.ticker), ['0700.HK']);
    console.log('deepdive-due.js selftest ok');
}

module.exports = { parseBookings, allBookings, firstFiling, classify, check, STATE, HAND };

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--selftest')) selftest();
    else if (args[0] === '--ran') {
        if (!args[1] || !args[2]) { console.error('usage: --ran <id> <ranking file>'); process.exit(2); }
        recordRan(args[1], args[2]);
        console.log(`recorded: ${args[1]} read by ${args[2]}`);
    } else check().then(out => {
        // ASCII only: Task Scheduler's console decodes a program's output as code page 437, so a £ or
        // — in a `why` would reach the Deep dive's prompt garbled. JSON escapes survive any code page.
        if (args.includes('--json')) {
            process.stdout.write(JSON.stringify(out).replace(/[\u007f-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')));
            return;
        }
        const line = r => `${r.ticker} ${r.event} from ${r.from} by ${r.by} (${r.file})`;
        for (const r of out.due) console.log(`due      ${line(r)}: ${r.landed.form} ${r.landed.filed} ${r.landed.url || ''}`);
        for (const r of out.waiting) console.log(`waiting  ${line(r)}`);
        for (const r of out.unchecked) console.log(`unchecked ${line(r)}: EDGAR did not answer`);
        for (const r of out.lapsed) console.log(`lapsed   ${line(r)}`);
        for (const b of out.unreadable) console.log(`unreadable ${b.file}: ${b.reason}`);
        if (!out.due.length && !out.waiting.length && !out.lapsed.length) console.log('no reopening booked');
        process.exitCode = out.due.length ? 0 : 1;
    }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
