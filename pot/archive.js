#!/usr/bin/env node
// `node pot/archive.js` — keep pot/proposals/ to what is current, and move the rest to
// pot/proposals/archive/ (D99, Leo 25 Oct 2026). 218 files had accumulated, 62 of them run reports
// and 132 proposals already superseded, rejected or obsolete, around the dozen worth reading.
//
// A file's place follows its STATE, recomputed every cycle, so nothing is ever filed by hand and a
// file moves back if its state comes back: an expired proposal reopens when the price returns
// below its limit. Current is
//   - a proposal the pot bought (the thesis behind a holding);
//   - one awaiting Leo: open, and not superseded by a newer proposal of the name;
//   - the standing proposal of a name inside its two-week window (D93), which a STANDS row names;
//   - every file of the newest Deep dive run: its ranking, its proposals, its `none`.
// Everything else is archived. A proposal's id is its file name in either folder (positions.js reads
// both), so the Tradelog's `Pot` column and positions.json never notice. Links between the pot's
// documents are rewritten to wherever their target now sits, so they keep working on GitHub; the
// Pot tab names a document by its file name alone (bundle.js), so it does not depend on the folder.
//
// Runs at the end of a cycle, after the report and before the bundle, when no lane is running: a
// file moved under a running lane is put back by D91.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOP = 'pot/proposals', ARCHIVE = 'pot/proposals/archive';
const stampOf = f => (f.match(/^(\d{4}-\d{2}-\d{2}-\d{4})/) || [])[1] || '';

// Which files belong at the top. Pure: names in, a Set out.
function current(names, proposals, cooldown) {
    const keep = new Set();
    for (const p of proposals) {
        if (p.state === 'accepted' || (p.state === 'open' && !p.supersededBy)) keep.add(p.file);
    }
    for (const c of Object.values(cooldown || {})) if (c.last) keep.add(c.last + '.md');
    const newest = names.filter(f => /-ranking\.md$/.test(f)).map(stampOf).filter(Boolean).sort().pop();
    if (newest) for (const f of names) if (stampOf(f) === newest) keep.add(f);
    return keep;
}

// Rewrite every relative link whose target is a proposals file to where that file now is. `where`
// maps a file name to its repo-relative path; `fromDir` is the repo-relative folder of the document.
function relink(text, fromDir, where) {
    const fix = target => {
        if (/^(https?:|mailto:|#)/i.test(target)) return target;
        const [file, anchor] = target.split('#');
        const base = path.posix.basename(file);
        const to = where.get(base);
        if (!to || !file.endsWith('.md')) return target;
        const resolved = path.posix.normalize(path.posix.join(fromDir, file));
        if (!/^pot\/proposals\/(archive\/)?[^/]+$/.test(resolved)) return target;   // not a proposals link
        const rel = path.posix.relative(fromDir, to);
        return rel + (anchor !== undefined ? '#' + anchor : '');
    };
    return text
        .replace(/\]\(([^)\s]+)\)/g, (m, t) => '](' + fix(t) + ')')
        .replace(/^(\[[^\]]+\]:\s*)(\S+)/gm, (m, lead, t) => lead + fix(t));
}

// A moved file's own relative links were written from its old folder: `../sweeps/x.md` from
// pot/proposals/ is `../../sweeps/x.md` from archive/. Re-point every one of them at the same
// target from the new folder. (The first pass without this broke 376 links.)
function rebase(text, fromDir, toDir) {
    const fix = target => {
        if (/^(https?:|mailto:|#|\/)/i.test(target)) return target;
        const [file, anchor] = target.split('#');
        if (!file) return target;
        const rel = path.posix.relative(toDir, path.posix.normalize(path.posix.join(fromDir, file))) || '.';
        return rel + (anchor !== undefined ? '#' + anchor : '');
    };
    return text
        .replace(/\]\(([^)\s]+)\)/g, (m, t) => '](' + fix(t) + ')')
        .replace(/^(\[[^\]]+\]:\s*)(\S+)/gm, (m, lead, t) => lead + fix(t));
}

// Move one file, carrying its links with it.
function move(f, fromDir, toDir) {
    const from = path.join(ROOT, fromDir, f);
    fs.writeFileSync(path.join(ROOT, toDir, f), rebase(fs.readFileSync(from, 'utf8'), fromDir, toDir));
    fs.unlinkSync(from);
}

function run() {
    const { build } = require('./positions.js');
    const book = build();
    const list = d => { try { return fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.md') && f !== 'README.md'); } catch { return []; } };
    const atTop = list(TOP), archived = list(ARCHIVE);
    const keep = current([...atTop, ...archived], book.proposals, book.cooldown);
    fs.mkdirSync(path.join(ROOT, ARCHIVE), { recursive: true });
    let out = 0, back = 0;
    for (const f of atTop) if (!keep.has(f)) { move(f, TOP, ARCHIVE); out++; }
    for (const f of archived) if (keep.has(f)) { move(f, ARCHIVE, TOP); back++; }

    // Every document that can link to a proposal: the proposals themselves, sweeps, reviews, and
    // the pot's own pages. Derived and regenerated folders (logs, summaries) are left to the report.
    const where = new Map();
    for (const f of list(TOP)) where.set(f, TOP + '/' + f);
    for (const f of list(ARCHIVE)) where.set(f, ARCHIVE + '/' + f);
    const docs = [...[TOP, ARCHIVE, 'pot/sweeps', 'pot/reviews'].flatMap(d => list(d).map(f => d + '/' + f)),
        ...list('pot').map(f => 'pot/' + f)];
    let relinked = 0;
    for (const rel of docs) {
        const abs = path.join(ROOT, rel);
        const text = fs.readFileSync(abs, 'utf8');
        const next = relink(text, path.posix.dirname(rel), where);
        if (next !== text) { fs.writeFileSync(abs, next); relinked++; }
    }
    console.log(`archive: ${out} moved to archive/, ${back} moved back, ${list(TOP).length} current, `
        + `${list(ARCHIVE).length} archived; links updated in ${relinked} document(s)`);
}

function selftest() {
    const assert = require('assert');
    const P = (file, state, extra = {}) => ({ file, id: file.replace(/\.md$/, ''), state, ...extra });
    const names = ['2026-10-25-1133-ranking.md', '2026-10-25-1133-none.md', '2026-10-24-0948-ranking.md',
        '2026-10-24-0948-BN.PA.md', '2026-10-21-1818-MWA.md', '2026-10-09-1359-PDD.md', '2026-09-08-2133-MWA.md',
        '2026-09-04-2033-INTU.md', '2026-08-31-1526-NVDA.md', '2026-10-23-0918-HLMA.L.md'];
    const keep = current(names, [
        P('2026-10-24-0948-BN.PA.md', 'open'), P('2026-10-21-1818-MWA.md', 'expired'), P('2026-10-09-1359-PDD.md', 'open'),
        P('2026-09-08-2133-MWA.md', 'accepted'), P('2026-09-04-2033-INTU.md', 'expired'), P('2026-08-31-1526-NVDA.md', 'obsolete'),
        P('2026-10-23-0918-HLMA.L.md', 'rejected'), P('2026-10-25-1133-none.md', 'open'),
    ], { MWA: { last: '2026-10-21-1818-MWA' } });
    assert.deepStrictEqual([...keep].sort(), ['2026-09-08-2133-MWA.md', '2026-10-09-1359-PDD.md', '2026-10-21-1818-MWA.md',
        '2026-10-24-0948-BN.PA.md', '2026-10-25-1133-none.md', '2026-10-25-1133-ranking.md'],
        'bought, awaiting, the D93 standing one, and the newest run; not the expired, obsolete, rejected or an older ranking');
    // A superseded open proposal is not awaiting anything.
    assert.ok(!current(['a.md'], [P('a.md', 'open', { supersededBy: 'b' })], {}).has('a.md'));

    const where = new Map([['2026-10-24-0948-ranking.md', 'pot/proposals/archive/2026-10-24-0948-ranking.md'],
        ['2026-10-24-0948-BN.PA.md', 'pot/proposals/2026-10-24-0948-BN.PA.md']]);
    assert.strictEqual(relink('[r](2026-10-24-0948-ranking.md#second-reader)', 'pot/proposals', where),
        '[r](archive/2026-10-24-0948-ranking.md#second-reader)', 'top-level document to an archived one, anchor kept');
    assert.strictEqual(relink('[p](2026-10-24-0948-BN.PA.md)', 'pot/proposals/archive', where),
        '[p](../2026-10-24-0948-BN.PA.md)', 'archived document back up to a current one');
    assert.strictEqual(relink('[p](../proposals/2026-10-24-0948-ranking.md)', 'pot/sweeps', where),
        '[p](../proposals/archive/2026-10-24-0948-ranking.md)', 'from a sweep');
    assert.strictEqual(relink('[mwa]: ../proposals/2026-10-24-0948-ranking.md', 'pot/reviews', where),
        '[mwa]: ../proposals/archive/2026-10-24-0948-ranking.md', 'a reference-style definition');
    assert.strictEqual(relink('[x](https://example.com/2026-10-24-0948-ranking.md) [y](../../prices.json)', 'pot/proposals', where),
        '[x](https://example.com/2026-10-24-0948-ranking.md) [y](../../prices.json)', 'external and non-proposal links untouched');
    const once = relink('[r](2026-10-24-0948-ranking.md)', 'pot/proposals', where);
    assert.strictEqual(relink(once, 'pot/proposals', where), once, 'idempotent');

    // A file moving down a folder takes its own links with it; and back up again.
    const doc = '[s](../sweeps/2026-08-28.md) [p](../../prices.json#x) [w](https://a.b/c) [r](2026-08-28-ranking.md)\n[ref]: ../positions.json';
    const down = rebase(doc, 'pot/proposals', 'pot/proposals/archive');
    assert.strictEqual(down, '[s](../../sweeps/2026-08-28.md) [p](../../../prices.json#x) [w](https://a.b/c) [r](../2026-08-28-ranking.md)\n[ref]: ../../positions.json');
    assert.strictEqual(rebase(down, 'pot/proposals/archive', 'pot/proposals'), doc, 'a move back restores every link');
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : run();
module.exports = { current, relink, rebase };
