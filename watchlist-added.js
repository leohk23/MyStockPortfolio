// `node watchlist-added.js` — gives every watchlist.json entry an `added` date, for the watchlist
// table's Added column (sorted newest first). Most names are added by the pot's Sweep, not by
// hand, so the date cannot rely on anyone typing it: run-lane.ps1 runs this before committing a
// lane's work and `npm run publish` before publishing, and an entry without a date gets today's
// (London). `--backfill` dates the entries that predate the field from git: the first commit in
// which each name appears.
const fs = require('fs');
const { execSync } = require('child_process');
const FILE = 'watchlist.json';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

// Entries without `added` get `date`; the rest are left exactly as they are.
const stampAdded = (list, date) => list.map(w => (w.added ? w : { ...w, added: date }));

// The first commit in which `yahoo` appears in watchlist.json, as YYYY-MM-DD; null if never committed.
function firstSeen(yahoo) {
    const out = execSync(`git log --reverse --format=%ad --date=short -S "\\"${yahoo}\\"" -- ${FILE}`, { encoding: 'utf8' });
    return out.split('\n').find(Boolean) || null;
}

function main() {
    const text = fs.readFileSync(FILE, 'utf8');
    const list = JSON.parse(text);
    let out = list;
    if (process.argv.includes('--backfill')) out = list.map(w => (w.added ? w : { ...w, added: firstSeen(w.yahoo) || today() }));
    out = stampAdded(out, today());
    const n = out.filter((w, i) => w.added !== list[i].added).length;
    if (!n) return;
    const crlf = text.includes('\r\n');
    const json = JSON.stringify(out, null, 2) + '\n';
    fs.writeFileSync(FILE, crlf ? json.replace(/\n/g, '\r\n') : json);
    console.log(`watchlist.json: dated ${n} entr${n === 1 ? 'y' : 'ies'}`);
}

function selftest() {
    const assert = require('assert');
    assert.deepStrictEqual(stampAdded([{ yahoo: 'A', added: '2026-01-02' }, { yahoo: 'B' }], '2026-10-10'),
        [{ yahoo: 'A', added: '2026-01-02' }, { yahoo: 'B', added: '2026-10-10' }], 'a date, once given, is never moved');
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : main();
module.exports = { stampAdded };
