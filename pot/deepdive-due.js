#!/usr/bin/env node
// `node pot/deepdive-due.js` — has a booked reopening landed (D127, Leo 17 Nov 2026)?
//
// A Deep dive that ends a name in WAIT because a publication it needs is not out yet books the run
// that reads it, in a `## Reopen when` table in its ranking. Leo's own bookings sit in the same table
// in pot/reopen.md. This finds which have landed, so the cycle can give that name an extra Deep dive
// without anyone having to watch for the filing. The Review's `## Next checks` (pot/review-due.js)
// is the same idea for what the pot holds; this is the Deep dive's, for what it does not.
//
//   | ticker | event | from | by | why |
//
//   event  10-Q, 10-K, 20-F, 40-F, 6-K or 8-K: a form filed with the SEC on or after `from`,
//          read from EDGAR's list of the company's filings. Amendments (10-Q/A) do not count.
//          `date`: the whole UTC day of `from` is over, for a market with no filings feed here.
//   from   the first day that counts.  by   the day to give up, at most six weeks after `from`.
//
// What keeps old names from piling up (Leo, 17 Nov): the runs are extra, on top of the day's own
// Deep dive, so each one has to earn its place.
//   1. Still cheap when it lands, or no run: the name must still have a §6.1 ceiling in
//      signals.json and a price at or under it. Otherwise the run could only say WAIT (D124), and
//      the booking closes as out of reach.
//   2. One booking per name. Leo's in pot/reopen.md wins; otherwise the newest ranking's.
//   3. A lane may book a name twice in a row without a proposal, not three times: then the name goes
//      back to the normal flow, where the Scan and the full Deep dive still see it (D122). Leo's own
//      bookings are his call and are not counted against him.
//   4. A landed booking not read within three days is dropped as stale: by then the full Deep dive
//      has seen the results anyway.
//
// pot/reopened.json records what landed, which Deep dive read it, whether that run proposed the
// name, and any closing. Only this script writes it, from the cycle; a lane may not (run-lane.ps1's
// allowlist), so no lane can close a booking itself. A booking for a name the pot holds is skipped:
// the Review owns those (brief-deepdive.md).
//
//   node pot/deepdive-due.js            what is due, waiting, lapsed, closed; exits 0 when something is due
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
const MAX_WINDOW_DAYS = 42;     // `by` at most six weeks after `from`
const STALE_DAYS = 3;           // guard 4
const MAX_UNPROPOSED = 2;       // guard 3
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const endOfDay = d => Date.parse(d + 'T00:00:00Z') + DAY;
const stampOf = file => (path.basename(file).match(/^(\d{4}-\d{2}-\d{2}-\d{4})/) || [])[1] || '';

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
            : by < from ? 'by is before from'
            : (Date.parse(by) - Date.parse(from)) / DAY > MAX_WINDOW_DAYS ? `by is more than six weeks after from` : null;
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

// What the guards read from local files: the pot's holdings, and each name's §6.1 ceiling against
// its price. `inReach` is true, false, or null when the files cannot say.
function context(root = ROOT) {
    const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { return null; } };
    const pos = rd('pot/positions.json') || {}, sig = rd('signals.json'), prices = rd('prices.json');
    const held = new Set(Object.entries(pos.holdings || {}).filter(([, h]) => h?.qty > 0).map(([t]) => t.toUpperCase()));
    const ceiling = new Map((sig?.fired || []).filter(f => /^6\.1/.test(f.rule || '') && f.ceiling?.price > 0)
        .map(f => [String(f.ticker).toUpperCase(), f.ceiling.price]));
    const price = new Map(Object.entries(prices?.quotes || {}).map(([t, q]) => [t.toUpperCase(), q?.price]));
    const inReach = t => !sig || !prices ? null : ceiling.has(t) && price.get(t) > 0 && price.get(t) <= ceiling.get(t);
    return { held, inReach, ceiling, price };
}

// Sorts every row. Pure: `landed` maps a row id to what this check found, `state` is
// pot/reopened.json, `checked` is false for a filing row EDGAR could not answer. Returns the rows by
// status, and `close`: closings this check decided, for check() to write down.
function classify(rows, state, { landed = {}, held = new Set(), now = Date.now(), checked = () => true, inReach = () => null } = {}) {
    const out = { due: [], waiting: [], lapsed: [], unchecked: [], closed: [], superseded: [], refused: [], close: [] };
    const open = [];
    for (const r of rows) {
        const s = state[r.id];
        if (s?.ran || s?.closed) out.closed.push({ ...r, ...(s.ran ? { read: s.ran, proposed: !!s.proposed } : { closedAs: s.closed, closedOn: s.closedOn }) });
        else if (!held.has(r.ticker)) open.push(r);
    }
    // Guard 2: one booking per name. Leo's, the last row of his file; else the newest ranking's.
    const winner = new Map();
    for (const r of open) {
        const w = winner.get(r.ticker);
        const better = !w || r.file === HAND || (w.file !== HAND && stampOf(r.file) > stampOf(w.file));
        if (better) winner.set(r.ticker, r);
    }
    for (const r of open) {
        if (winner.get(r.ticker) !== r) { out.superseded.push(r); continue; }
        // Guard 3: the lane's bookings of this name read since its last proposal. Leo's own count
        // only as a reset, when the run they started proposed it.
        if (r.file !== HAND) {
            const reads = rows.filter(x => x.ticker === r.ticker && state[x.id]?.ran)
                .sort((a, b) => String(state[b.id].ranOn).localeCompare(String(state[a.id].ranOn)));
            let unproposed = 0;
            for (const x of reads) { if (state[x.id].proposed) break; if (x.file !== HAND) unproposed++; }
            if (unproposed >= MAX_UNPROPOSED) { out.refused.push({ ...r, unproposed }); continue; }
        }
        const s = state[r.id];
        const found = s?.landed || landed[r.id] || null;
        if (found) {
            const seen = s?.seen ? Date.parse(s.seen) : now;
            const reach = inReach(r.ticker);
            if (now - seen > STALE_DAYS * DAY) out.close.push({ ...r, landed: found, closedAs: 'stale' });
            else if (reach === false) out.close.push({ ...r, landed: found, closedAs: 'out of reach' });
            else out.due.push({ ...r, landed: found });
        } else if (!checked(r)) out.unchecked.push(r);
        else if (now >= endOfDay(r.by)) out.lapsed.push(r);
        else out.waiting.push(r);
    }
    out.due.sort((a, b) => a.landed.filed.localeCompare(b.landed.filed) || a.id.localeCompare(b.id));
    return out;
}

async function check(now = Date.now(), getJson = null) {
    const { rows, bad } = allBookings();
    const state = read(STATE, {});
    const ctx = context();
    const open = r => !state[r.id]?.landed && !state[r.id]?.ran && !state[r.id]?.closed && !ctx.held.has(r.ticker);
    const landed = {}, failed = new Set(), notFiler = [];
    const today = new Date(now).toISOString().slice(0, 10);
    for (const r of rows) if (open(r) && r.event === 'date' && now >= endOfDay(r.from)) landed[r.id] = { form: 'date', filed: r.from };
    const filingRows = rows.filter(r => open(r) && r.event !== 'date' && r.from <= today && now < endOfDay(r.by));
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
    // the next, and guard 4 can count three days from the first sighting.
    let wrote = false;
    for (const [id, f] of Object.entries(landed)) {
        if (!state[id]) { state[id] = { landed: f, seen: new Date(now).toISOString() }; wrote = true; }
    }
    const out = classify(rows, state, { landed, held: ctx.held, now, checked: r => !failed.has(r.id), inReach: ctx.inReach });
    for (const c of out.close) {
        state[c.id] = { ...state[c.id], closed: c.closedAs, closedOn: new Date(now).toISOString() };
        out.closed.push(c); wrote = true;
    }
    if (wrote) fs.writeFileSync(path.join(ROOT, STATE), JSON.stringify(state, null, 1) + '\n');
    // A lapsed row is news for a week after its `by`, then old news (the D125 reasoning).
    const lapsed = out.lapsed.filter(r => now < endOfDay(r.by) + 7 * DAY);
    return { ...out, lapsed, unreadable: [...bad, ...notFiler] };
}

// Whether the run that read a booking proposed the name: a proposal file of that run's stamp for
// that ticker, not withdrawn. Feeds guard 3.
function proposedBy(ranking, ticker, root = ROOT) {
    const stamp = stampOf(ranking);
    if (!stamp) return false;
    for (const dir of ['pot/proposals', 'pot/proposals/archive']) {
        let names = [];
        try { names = fs.readdirSync(path.join(root, dir)); } catch { continue; }
        const f = names.find(n => n.toUpperCase() === `${stamp}-${ticker}.MD`.toUpperCase());
        if (f && !/^\*\*Withdrawn by the second reader:\*\*/m.test(fs.readFileSync(path.join(root, dir, f), 'utf8'))) return true;
    }
    return false;
}

function recordRan(id, ranking, now = Date.now()) {
    const state = read(STATE, {});
    const ticker = id.split('|')[1] || '';
    state[id] = { ...(state[id] || {}), ran: ranking, ranOn: new Date(now).toISOString(), proposed: proposedBy(ranking, ticker) };
    fs.writeFileSync(path.join(ROOT, STATE), JSON.stringify(state, null, 1) + '\n');
    return state[id];
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
        '| META | 10-K | 2026-11-17 | 2027-03-01 | a window of months |',
        '', '## Second reader', '| NVDA | 10-K | 2026-11-17 | 2026-12-01 | outside the section |',
    ].join('\n');
    const F = 'pot/proposals/2026-11-17-2041-ranking.md';
    const { rows, bad } = parseBookings(md, F);
    assert.deepStrictEqual(rows.map(r => r.ticker), ['NVDA', '0700.HK']);
    assert.deepStrictEqual(bad.map(b => b.reason), ['event "10-q/A" is not one of 10-Q, 10-K, 20-F, 40-F, 6-K, 8-K or date',
        'by is before from', 'by is more than six weeks after from']);

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
    const seenNow = { landed: land, seen: '2026-11-19T06:30:00Z' };
    let c = classify(rows, {}, { landed: { [nv.id]: land }, now, inReach: () => true });
    assert.deepStrictEqual(c.due.map(r => r.ticker), ['NVDA']);
    assert.deepStrictEqual(c.lapsed.map(r => r.ticker), ['0700.HK'], 'a date row with nothing landed is lapsed once by is over');
    c = classify(rows, { [nv.id]: { ...seenNow, ran: F, ranOn: '2026-11-19T07:00:00Z' } }, { now });
    assert.deepStrictEqual([c.due.length, c.closed.length], [0, 1], 'a row its Deep dive read is closed');
    c = classify(rows, { [nv.id]: seenNow }, { now: Date.parse('2026-11-21T06:00:00Z'), inReach: () => true });
    assert.deepStrictEqual(c.due.map(r => r.ticker), ['NVDA'], 'landed and unread: due, inside three days');
    c = classify([nv], {}, { held: new Set(['NVDA']), now });
    assert.ok(!c.due.length && !c.waiting.length, 'a name the pot holds belongs to the Review');
    c = classify([nv], {}, { now: Date.parse('2026-11-19T00:00:00Z'), checked: () => false });
    assert.deepStrictEqual([c.unchecked.length, c.lapsed.length, c.waiting.length], [1, 0, 0], 'EDGAR down: unchecked, never lapsed');

    // Guard 1: landed, but no longer cheap.
    c = classify([nv], { [nv.id]: seenNow }, { now, inReach: () => false });
    assert.deepStrictEqual([c.due.length, c.close.map(x => x.closedAs)], [0, ['out of reach']]);
    c = classify([nv], { [nv.id]: seenNow }, { now, inReach: () => null });
    assert.strictEqual(c.due.length, 1, 'files unreadable: run rather than drop');
    // Guard 4: landed, unread for over three days.
    c = classify([nv], { [nv.id]: { landed: land, seen: '2026-11-16T06:30:00Z' } }, { now, inReach: () => true });
    assert.deepStrictEqual(c.close.map(x => x.closedAs), ['stale']);
    // Guard 2: one booking per name. The newer ranking's wins, and Leo's beats both.
    const later = parseBookings(md.replace('2026-12-01 | Q3', '2026-12-05 | Q3'), 'pot/proposals/archive/2026-11-19-0630-ranking.md').rows[0];
    const hand = parseBookings('## Reopen when\n| NVDA | 10-Q | 2026-11-18 | 2026-12-01 | Leo |', HAND).rows[0];
    c = classify([nv, later], {}, { now: Date.parse('2026-11-18T00:00:00Z') });
    assert.deepStrictEqual([c.waiting.map(r => r.file), c.superseded.map(r => r.file)], [[later.file], [F]]);
    c = classify([hand, later, nv], {}, { now: Date.parse('2026-11-18T00:00:00Z') });
    assert.deepStrictEqual(c.waiting.map(r => r.file), [HAND]);
    // Guard 3: a third lane booking after two reads without a proposal is refused; Leo's is not.
    const third = parseBookings(md.replace('2026-11-17 | 2026-12-01', '2026-11-25 | 2026-12-20'), 'pot/proposals/2026-11-24-0630-ranking.md').rows[0];
    const read2 = { [nv.id]: { landed: land, ran: F, ranOn: '2026-11-18T07:00:00Z', proposed: false },
                    [later.id]: { landed: land, ran: later.file, ranOn: '2026-11-21T07:00:00Z', proposed: false } };
    c = classify([nv, later, third], read2, { now: Date.parse('2026-11-24T08:00:00Z') });
    assert.deepStrictEqual([c.refused.map(r => r.unproposed), c.waiting.length], [[2], 0]);
    c = classify([nv, later, third], { ...read2, [later.id]: { ...read2[later.id], proposed: true } }, { now: Date.parse('2026-11-24T08:00:00Z') });
    assert.deepStrictEqual([c.refused.length, c.waiting.length], [0, 1], 'a proposal resets the count');
    c = classify([nv, later, hand], read2, { now: Date.parse('2026-11-19T08:00:00Z') });
    assert.deepStrictEqual(c.waiting.map(r => r.file), [HAND], "Leo's booking is not refused");
    c = classify([tc], {}, { landed: { [tc.id]: { form: 'date', filed: tc.from } }, now, inReach: () => true });
    assert.deepStrictEqual(c.due.map(r => r.ticker), ['0700.HK']);
    console.log('deepdive-due.js selftest ok');
}

module.exports = { parseBookings, allBookings, firstFiling, classify, context, check, STATE, HAND };

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--selftest')) selftest();
    else if (args[0] === '--ran') {
        if (!args[1] || !args[2]) { console.error('usage: --ran <id> <ranking file>'); process.exit(2); }
        const s = recordRan(args[1], args[2]);
        console.log(`recorded: ${args[1]} read by ${args[2]}, ${s.proposed ? 'with a proposal' : 'no proposal'}`);
    } else check().then(out => {
        // ASCII only: Task Scheduler's console decodes a program's output as code page 437, so a £ or
        // — in a `why` would reach the Deep dive's prompt garbled. JSON escapes survive any code page.
        if (args.includes('--json')) {
            process.stdout.write(JSON.stringify(out).replace(/[\u007f-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')));
            return;
        }
        const line = r => `${r.ticker} ${r.event} from ${r.from} by ${r.by} (${r.file})`;
        for (const r of out.due) console.log(`due        ${line(r)}: ${r.landed.form} ${r.landed.filed} ${r.landed.url || ''}`);
        for (const r of out.waiting) console.log(`waiting    ${line(r)}`);
        for (const r of out.unchecked) console.log(`unchecked  ${line(r)}: EDGAR did not answer`);
        for (const r of out.lapsed) console.log(`lapsed     ${line(r)}`);
        for (const r of out.close) console.log(`closed now ${line(r)}: ${r.closedAs}`);
        for (const r of out.refused) console.log(`refused    ${line(r)}: read ${r.unproposed} times without a proposal`);
        for (const r of out.superseded) console.log(`superseded ${line(r)}`);
        for (const b of out.unreadable) console.log(`unreadable ${b.file}: ${b.reason}`);
        if (!out.due.length && !out.waiting.length && !out.lapsed.length) console.log('nothing booked is open');
        process.exitCode = out.due.length ? 0 : 1;
    }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
