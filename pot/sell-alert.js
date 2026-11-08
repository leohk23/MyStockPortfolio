#!/usr/bin/env node
// `node pot/sell-alert.js` — an email when a Review calls for a sale (D114, Leo 8 Nov 2026).
//
// Reads the newest pot/reviews/*.md. For each thesis it returns `broken`, `played-out` or `breach`,
// the verdicts that carry a §5.1 instruction, it opens a GitHub issue assigned to the repository's
// owner, and GitHub emails it. No mail credential exists anywhere: pot-alert.yml opens the issue with
// the workflow's own token. One issue per call: a title that already exists, open or closed, is not
// opened again (a stamp or relink commit re-runs this on the same Review), and while a sale of that
// name is open a later Review repeating it sends nothing. Leo closes the issue once he has acted, or
// decided not to.
//
// The text comes from a lane that reads web pages, so it goes in fenced, as code: no link, image or
// @mention in it can render or notify anyone. The title is built only from the verdict and a ticker
// that has a symbol's shape.
//   node pot/sell-alert.js          open what the newest Review calls for
//   node pot/sell-alert.js --dry    print it instead
//   node pot/sell-alert.js --test   open one test issue, to check the email reaches the inbox
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ACTION = { broken: 'SELL', 'played-out': 'SELL', breach: 'TRIM' };
const TICKER = /^[A-Z0-9][A-Z0-9.^=-]{0,14}$/i;

// Sections by `## ` heading, in order.
function sections(md) {
    const out = [];
    for (const line of md.replace(/\r/g, '').split('\n')) {
        if (/^## /.test(line)) out.push({ head: line.slice(3).trim(), lines: [line] });
        else if (out.length) out[out.length - 1].lines.push(line);
    }
    return out.map(s => ({ head: s.head, text: s.lines.join('\n').trim() }));
}

// Every call for a sale in one Review. `stamp` is its file name without `.md`.
function calls(md, stamp) {
    const all = sections(md);
    const instruction = all.find(s => /^Instruction\b/i.test(s.head));
    const out = [];
    for (const s of all) {
        const m = s.head.match(/^(\S+)\s+[—–-]\s+`?([a-z-]+)`?\s*$/i);
        if (!m || !TICKER.test(m[1]) || !ACTION[m[2].toLowerCase()]) continue;
        const ticker = m[1].toUpperCase(), verdict = m[2].toLowerCase(), action = ACTION[verdict];
        // The instruction lines that name this ticker; the whole section if none do.
        let order = '';
        if (instruction) {
            const own = instruction.text.split('\n').filter(l => l.toUpperCase().includes(ticker));
            order = own.length ? '## Instruction\n' + own.join('\n') : instruction.text;
        }
        out.push({
            ticker, verdict, action,
            prefix: `Pot ${action} ${ticker}:`,
            title: `Pot ${action} ${ticker}: the Review of ${stamp} returned ${verdict}`,
            excerpt: [s.text, order].filter(Boolean).join('\n\n'),
        });
    }
    return out;
}

// A fence longer than any run of tildes inside, so nothing in the text can close it.
function fenced(text) {
    const longest = Math.max(0, ...(text.match(/~+/g) || []).map(r => r.length));
    const fence = '~'.repeat(Math.max(3, longest + 1));
    return `${fence}\n${text}\n${fence}`;
}

function body(c, stamp, url) {
    return [
        `The Review of ${stamp} returned \`${c.verdict}\` on ${c.ticker}, which under strategy.md §5.1 is a call to ${c.action === 'TRIM' ? 'trim' : 'sell'}.`,
        '',
        fenced(c.excerpt),
        '',
        `The full Review: ${url}`,
        '',
        `Close this issue once you have acted on it, or decided not to. While it is open, a later Review making the same call sends no further email.`,
    ].join('\n');
}

// Which calls still need an issue: no issue with the same title in any state, and no open one of
// the same sale.
function toOpen(found, issues) {
    return found.filter(c => !issues.some(i => i.title === c.title ||
        (i.state === 'OPEN' && i.title.startsWith(c.prefix))));
}

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'] });

function run() {
    const owner = process.env.GITHUB_REPOSITORY_OWNER;
    const repoUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || 'leohk23/MyStockPortfolio'}`;
    const dry = process.argv.includes('--dry');
    if (!dry && !owner) throw new Error('GITHUB_REPOSITORY_OWNER is not set: run this in pot-alert.yml, or with --dry');
    const open = (title, text) => {
        if (dry) { console.log(`--- would open: ${title}\n${text}\n`); return; }
        gh(['issue', 'create', '--title', title, '--assignee', owner, '--body-file', '-'], text);
        console.log(`opened: ${title}`);
    };

    if (process.argv.includes('--test')) {
        open('Pot alert test: close me', [
            'A test of the email path for the pot\'s sale alerts (D114). If this reached your inbox, an',
            'alert for a Review that calls for a sale will too. Close the issue; nothing else is needed.',
        ].join('\n'));
        return;
    }

    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, 'pot/reviews')); } catch { /* none yet */ }
    const newest = names.filter(f => /^\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(f)).sort().pop();
    if (!newest) { console.log('no Review yet'); return; }
    const stamp = newest.replace(/\.md$/, '');
    const found = calls(fs.readFileSync(path.join(ROOT, 'pot/reviews', newest), 'utf8'), stamp);
    if (!found.length) { console.log(`${newest}: no call for a sale`); return; }
    const issues = dry ? [] : JSON.parse(gh(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'title,state']));
    const todo = toOpen(found, issues);
    for (const c of found.filter(c => !todo.includes(c))) console.log(`already raised: ${c.title}`);
    for (const c of todo) open(c.title, body(c, stamp, `${repoUrl}/blob/main/pot/reviews/${newest}`));
}

function selftest() {
    const assert = require('assert');
    const md = [
        'model: pending, lane: review', '', '# Review — 2026-11-09',
        '', '## RMD — hold', '**Verdict:** `hold`, because cash passes.',
        '', '## MWA — broken', '**Break:** two quarters of falling volumes — tripped.', '**Verdict:** `broken`, because volumes fell twice.',
        '', '## CME — `played-out`', '**Verdict:** `played-out`, because the target was reached.',
        '', '## EUZ.DE — breach', '**Verdict:** `breach`, because it is 52% of the pot. Ask @someone ~~~ here.',
        '', '## Instruction', '**SELL 7 MWA, day limit @ $24.10.** §5.1(1).', '**SELL 1 CME, day limit @ $290.** §5.1(2).',
        '**TRIM 3 EUZ.DE, day limit @ €61.** §5.1(3).',
        '', '## The paper record', '| proposal | written |', '|---|---|',
    ].join('\n');
    const found = calls(md, '2026-11-09-0031');
    assert.deepStrictEqual(found.map(c => `${c.action} ${c.ticker} ${c.verdict}`),
        ['SELL MWA broken', 'SELL CME played-out', 'TRIM EUZ.DE breach']);
    assert.strictEqual(found[0].title, 'Pot SELL MWA: the Review of 2026-11-09-0031 returned broken');
    // Each alert carries its own instruction line, not the others'.
    assert.ok(found[0].excerpt.includes('SELL 7 MWA') && !found[0].excerpt.includes('CME'));
    // A heading that is not a ticker and a verdict is ignored: `hold`, `Instruction`, prose.
    assert.strictEqual(calls('## The paper record — broken down\n## RMD — hold', 'x').length, 0);
    // The fence outlasts any tildes inside it, so the text cannot break out and render.
    const b = body(found[2], '2026-11-09-0031', 'https://example/x');
    assert.ok(b.includes('~~~~\n') && b.includes('@someone ~~~ here'));
    // One issue per call: the same title in any state, or an open sale of the same name, stops it.
    const issues = [
        { title: 'Pot SELL MWA: the Review of 2026-11-07-1228 returned broken', state: 'OPEN' },
        { title: 'Pot SELL CME: the Review of 2026-11-09-0031 returned played-out', state: 'CLOSED' },
        { title: 'Pot TRIM EUZ.DE: the Review of 2026-10-01-0031 returned breach', state: 'CLOSED' },
    ];
    assert.deepStrictEqual(toOpen(found, issues).map(c => c.ticker), ['EUZ.DE']);
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : run();
module.exports = { calls, toOpen, body };
