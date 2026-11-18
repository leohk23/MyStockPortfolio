#!/usr/bin/env node
// Where the pot's proposals sit (D99, D128). The ONE place that knows the folder layout: every
// script asks here rather than naming a folder itself, so a change of layout is a change to this
// file. Before D128 six scripts each named `pot/proposals` and `pot/proposals/archive`, and a new
// folder one of them missed would have failed silently: a thesis the Review could not find, a
// holding the book could not explain.
//
//   pot/proposals/            current: awaiting Leo, the D93 standing proposal, the newest run
//   pot/proposals/bought/     accepted: the theses behind what the pot holds
//   pot/proposals/rejected/   proposals of a company Leo has turned down (D83)
//   pot/proposals/archive/    the rest: superseded, expired, obsolete, withdrawn, older rankings
//
// A proposal's id is its file name, whichever folder holds it, so a Tradelog `Pot` cell, a
// positions.json reference or a link survives any move. pot/archive.js does the moving, each cycle,
// from each proposal's state; a file moves back when its state does.
//
//   node pot/proposal-files.js <id>     where that proposal is now
//   node pot/proposal-files.js --selftest
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'pot/proposals';
const FOLDERS = {
    current: BASE,
    bought: BASE + '/bought',
    rejected: BASE + '/rejected',
    archive: BASE + '/archive',
};
const ALL = Object.values(FOLDERS);

// Every .md file in the given folders, as { file, dir, rel }. Rankings included: a caller that wants
// proposals alone filters `-ranking.md` itself, as each did before.
function list(dirs = ALL, root = ROOT) {
    const out = [];
    for (const dir of dirs) {
        let names = [];
        try { names = fs.readdirSync(path.join(root, dir)); } catch { continue; }
        for (const file of names) if (file.endsWith('.md') && file !== 'README.md') out.push({ file, dir, rel: dir + '/' + file });
    }
    return out;
}

// Where a proposal is now, by id or file name: the repo-relative path, or null.
function find(id, root = ROOT) {
    const file = String(id).endsWith('.md') ? String(id) : id + '.md';
    for (const dir of ALL) if (fs.existsSync(path.join(root, dir, file))) return dir + '/' + file;
    return null;
}

// Which folder a file belongs in. State first: bought and rejected are what a file IS, whatever
// run it came from. Then current (`isCurrent`: awaiting Leo, D93's standing one, the newest run).
function placeFor(state, isCurrent) {
    if (state === 'accepted') return FOLDERS.bought;
    if (state === 'rejected') return FOLDERS.rejected;
    return isCurrent ? FOLDERS.current : FOLDERS.archive;
}

// True when a repo-relative path is a file in one of the folders.
const isProposalPath = rel => ALL.includes(path.posix.dirname(rel));

function selftest() {
    const assert = require('assert');
    const os = require('os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-files-'));
    for (const [dir, f] of [[FOLDERS.current, '2026-11-18-0702-ranking.md'], [FOLDERS.bought, '2026-09-08-2133-MWA.md'],
        [FOLDERS.rejected, '2026-10-09-1359-PDD.md'], [FOLDERS.archive, '2026-08-31-1526-NVDA.md'], [FOLDERS.archive, 'README.md']]) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, f), 'x');
    }
    assert.deepStrictEqual(list(ALL, root).map(x => x.rel).sort(), ['pot/proposals/2026-11-18-0702-ranking.md',
        'pot/proposals/archive/2026-08-31-1526-NVDA.md', 'pot/proposals/bought/2026-09-08-2133-MWA.md',
        'pot/proposals/rejected/2026-10-09-1359-PDD.md']);
    assert.strictEqual(find('2026-09-08-2133-MWA', root), 'pot/proposals/bought/2026-09-08-2133-MWA.md');
    assert.strictEqual(find('2026-10-09-1359-PDD.md', root), 'pot/proposals/rejected/2026-10-09-1359-PDD.md');
    assert.strictEqual(find('nope', root), null);
    assert.deepStrictEqual([placeFor('accepted', true), placeFor('rejected', true), placeFor('open', true), placeFor('expired', false)],
        [FOLDERS.bought, FOLDERS.rejected, FOLDERS.current, FOLDERS.archive], 'state before currency');
    assert.ok(isProposalPath('pot/proposals/bought/x.md') && isProposalPath('pot/proposals/x.md') && !isProposalPath('pot/sweeps/x.md'));
    fs.rmSync(root, { recursive: true, force: true });
    console.log('proposal-files.js selftest ok');
}

module.exports = { FOLDERS, ALL, BASE, list, find, placeFor, isProposalPath };

if (require.main === module) {
    if (process.argv.includes('--selftest')) selftest();
    else if (process.argv[2]) console.log(find(process.argv[2]) || `${process.argv[2]}: not found under ${BASE}`);
    else console.log(ALL.join('\n'));
}
