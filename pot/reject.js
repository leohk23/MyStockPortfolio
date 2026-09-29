// `node pot/reject.js YUMC "reason"` records Leo's rejection of a company; `--lift YUMC` removes it.
// Extra listings the repo cannot link on its own: `node pot/reject.js YUMC "reason" --also 9987.HK`.
//
// A rejection covers the COMPANY, every listing of it, until Leo lifts it (strategy.md §3.2, D83).
// The Deep dive must not propose or rank it and the Sweep must not raise it; a name the pot already
// holds is still reviewed. The price at rejection is kept so the run report can say, in one line,
// when the name has fallen 20% below where he said no - a note, never a re-proposal.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'pot/rejections.json');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };

// Every listing linked to this one through a `primary` in meta.json or watchlist.json: the home
// listing it points at, and every other receipt pointing at the same home.
function listingsOf(ticker, entries) {
    const home = new Map(entries.filter(e => e.yahoo && e.primary).map(e => [e.yahoo, e.primary]));
    const root = home.get(ticker) || ticker;
    return [...new Set([ticker, root, ...[...home].filter(([, p]) => p === root).map(([t]) => t)])].sort();
}

function add(list, entry) {
    const taken = new Set(entry.listings);
    return [...list.filter(r => !r.listings.some(t => taken.has(t))), entry]
        .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

const lift = (list, ticker) => list.filter(r => !r.listings.includes(ticker));

function main(argv) {
    const list = read('pot/rejections.json', []);
    if (argv[0] === '--lift') {
        const out = lift(list, argv[1]);
        if (out.length === list.length) { console.log(`${argv[1]} is not rejected - nothing to lift`); return; }
        fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
        console.log(`lifted ${argv[1]}; ${out.length} rejection(s) left`);
        return;
    }
    const [ticker, reason] = argv;
    if (!ticker || !reason || reason.startsWith('--')) {
        console.error('usage: node pot/reject.js TICKER "one-line reason" [--also OTHER.LISTING ...] | --lift TICKER');
        process.exit(1);
    }
    const at = argv.indexOf('--also');
    const also = at < 0 ? [] : argv.slice(at + 1);
    const meta = Object.values(read('meta.json', {}));
    const listings = [...new Set([...listingsOf(ticker, [...meta, ...read('watchlist.json', [])]), ...also])].sort();
    const q = (read('prices.json', {}).quotes || {})[ticker];
    let proposals = [];
    try { proposals = fs.readdirSync(path.join(ROOT, 'pot/proposals')); } catch { /* none */ }
    const from = proposals.filter(f => listings.some(t => f.endsWith(`-${t}.md`))).sort().pop();
    const entry = {
        ticker, listings, date: new Date().toISOString().slice(0, 10), reason,
        from: from ? from.replace(/\.md$/, '') : null,
        price: q && q.price != null ? { value: q.price, currency: q.currency } : null,
    };
    fs.writeFileSync(FILE, JSON.stringify(add(list, entry), null, 1) + '\n');
    console.log(`rejected ${listings.join(', ')}${entry.from ? ` (from ${entry.from})` : ''}: ${reason}`);
}

function selftest() {
    const assert = require('assert');
    const entries = [{ yahoo: 'BYDDY', primary: '1211.HK' }, { yahoo: 'NTDOY', primary: '7974.T' }, { yahoo: 'NTO.F', primary: '7974.T' }];
    assert.deepStrictEqual(listingsOf('BYDDY', entries), ['1211.HK', 'BYDDY'], 'a receipt brings its home listing');
    assert.deepStrictEqual(listingsOf('7974.T', entries), ['7974.T', 'NTDOY', 'NTO.F'], 'a home listing brings every receipt');
    assert.deepStrictEqual(listingsOf('NTO.F', entries), ['7974.T', 'NTDOY', 'NTO.F'], 'a receipt brings its siblings too');
    assert.deepStrictEqual(listingsOf('YUMC', entries), ['YUMC'], 'an unlinked name is just itself');
    const one = add([], { ticker: 'BYDDY', listings: ['1211.HK', 'BYDDY'], reason: 'a' });
    const again = add(one, { ticker: '1211.HK', listings: ['1211.HK', 'BYDDY'], reason: 'b' });
    assert.strictEqual(again.length, 1, 'rejecting the same company twice replaces, not duplicates');
    assert.strictEqual(again[0].reason, 'b', 'the newer reason wins');
    assert.strictEqual(lift(again, 'BYDDY').length, 0, 'lifting by any listing lifts the company');
    console.log('reject.js selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : main(process.argv.slice(2));
module.exports = { listingsOf };
