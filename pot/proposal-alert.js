#!/usr/bin/env node
// `node pot/proposal-alert.js` — an email when the Deep dive proposes a trade (D119, Leo 9 Nov 2026).
//
// The same path as the sale alert (sell-alert.js, D114): a GitHub issue assigned to the repository's
// owner, which GitHub emails, opened by pot-alert.yml with the workflow's own token, so no mail
// credential exists anywhere. The issue carries the whole proposal, so it can be read in the email.
//
// A proposal is sent once its cycle has stamped it: the draft and the examination are both committed
// with `model: pending`, and only the report at the cycle's end writes the models in, so a stamped
// file is one the second reader has finished with, or failed on (the draft then stands, D95). A
// proposal the second reader withdrew never reaches Leo, so it sends nothing. Only files in
// pot/proposals/ stamped in the last two days count, so a cycle whose push was missed still sends on
// the next, and nothing older is sent when this first runs. One issue per proposal, by title.
//
// The text comes from a lane that reads web pages. It is shown rendered, so its tables read, but
// every way GitHub turns text into a link, an image, a mention or a reference is broken first (inert).
//   node pot/proposal-alert.js          open what is due
//   node pot/proposal-alert.js --dry    print it instead
//   node pot/proposal-alert.js --test   open one test issue carrying the newest proposal
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { WITHDRAWN } = require('./positions');

const ROOT = path.resolve(__dirname, '..');
const DIR = 'pot/proposals';
const ID = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})-([A-Z0-9][A-Z0-9.^=-]{0,14})$/i;
const WINDOW_MS = 2 * 86400000;
const MAX_BODY = 60000;            // GitHub refuses an issue body over 65,536 characters
const WJ = '⁠';               // word joiner: invisible, and no part of any link syntax
const MODEL = /^[a-z0-9][a-z0-9.-]{0,40}$/;

// The proposal as it reads, with nothing in it able to link, load or notify. Every way GitHub makes
// a link, an image, an @mention, an issue reference or raw HTML is broken with an invisible joiner,
// inside code as well, rather than parsed around: a parser that misjudged where code ends would let
// the rest render. A link and an image keep their text; the committed file, linked above it, has
// the URLs.
function inert(md) {
    return md
        .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
        .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"\n]*")?\)/g, '$1')
        .replace(/[@<&]/g, c => c + WJ)                     // mentions, HTML, <autolinks>, entities
        .replace(/\]([(:[])/g, ']' + WJ + '$1')             // whatever link syntax is left
        .replace(/:\/\//g, ':/' + WJ + '/')                 // bare URLs
        .replace(/\bwww\./gi, m => m.slice(0, 3) + WJ + '.')
        .replace(/#(?=\d)/g, '#' + WJ)                      // #12 and owner/repo#12
        .replace(/\bGH-(?=\d)/gi, m => m.slice(0, 2) + WJ + '-');
}

// What a proposal file says about itself. Null for a run report, a `none`, or a name that is not a
// proposal id.
function read(file, md) {
    const id = file.replace(/\.md$/, '');
    const m = id.match(ID);
    if (!m || /^(none|ranking)$/i.test(m[6])) return null;
    const head = md.replace(/\r/g, '').split('\n');
    const stamp = (head[0].match(/^model: `([^`]+)`/) || [])[1];
    const examiner = (head.slice(0, 3).join('\n').match(/^examined: `([^`]+)`/m) || [])[1];
    const order = (md.match(/^## 1\.[^\n]*\n([\s\S]*?)(?=\n## |(?![\s\S]))/m) || [])[1] || '';
    return {
        id, file, ticker: m[6].toUpperCase(),
        at: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]),
        when: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} UTC`,
        drafter: stamp && MODEL.test(stamp) ? stamp : null,
        examiner: examiner && MODEL.test(examiner) ? examiner : null,
        withdrawn: WITHDRAWN.test(md),
        side: /\bSELL\b/.test(order) ? 'SELL' : 'BUY',     // as positions.js reads it
        text: md,
    };
}

const title = p => `Pot proposal: ${p.side} ${p.ticker} (${p.id})`;

// Which proposals still need an issue: stamped, not withdrawn, recent, and not yet sent.
function due(found, issues, now) {
    return found.filter(p => p && p.drafter && !p.withdrawn && now - p.at <= WINDOW_MS && now >= p.at
        && !issues.some(i => i.title === title(p)));
}

function body(p, link) {
    const who = p.examiner
        ? `Drafted by \`${p.drafter}\` and examined by \`${p.examiner}\`.`
        : `Drafted by \`${p.drafter}\`. **Not examined:** no second reader finished, so this is the draft alone.`;
    let text = inert(p.text.replace(/\r/g, '').replace(/^(?:(?:model|examined): [^\n]*\n)+/, '').trim());
    if (text.length > MAX_BODY) {
        const cut = text.lastIndexOf('\n## ', MAX_BODY);
        text = text.slice(0, cut > 0 ? cut : MAX_BODY) + '\n\n*Cut here for length: the rest is in the committed file.*';
    }
    return [
        `The Deep dive of ${p.when} proposes **${p.side} ${p.ticker}**. ${who}`,
        '',
        `The proposal as committed, with its links: ${link}`,
        '',
        'Close this issue once you have decided on it. It is the whole proposal below, with links shown as text.',
        '',
        '---',
        '',
        text,
    ].join('\n');
}

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'] });

function run() {
    const owner = process.env.GITHUB_REPOSITORY_OWNER;
    const repoUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || 'leohk23/MyStockPortfolio'}`;
    const dry = process.argv.includes('--dry'), test = process.argv.includes('--test');
    if (!dry && !owner) throw new Error('GITHUB_REPOSITORY_OWNER is not set: run this in pot-alert.yml, or with --dry');
    // A permalink, since archive.js moves the file to archive/ once it is no longer current.
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const linkTo = p => `${repoUrl}/blob/${sha}/${DIR}/${p.file}`;
    const open = (t, text) => {
        if (dry) { console.log(`--- would open: ${t}\n${text}\n`); return; }
        gh(['issue', 'create', '--title', t, '--assignee', owner, '--body-file', '-'], text);
        console.log(`opened: ${t}`);
    };

    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, DIR)).filter(f => f.endsWith('.md')); } catch { /* none yet */ }
    const found = names.map(f => read(f, fs.readFileSync(path.join(ROOT, DIR, f), 'utf8'))).filter(Boolean);

    if (test) {
        const p = found.filter(p => p.drafter && !p.withdrawn).sort((a, b) => b.at - a.at)[0];
        if (!p) { console.log('no stamped proposal to test with'); return; }
        open(`Pot proposal test: ${p.side} ${p.ticker}, close me`, body(p, linkTo(p)));
        return;
    }
    const issues = dry ? [] : JSON.parse(gh(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'title']));
    const todo = due(found, issues, Date.now());
    if (!todo.length) { console.log('no new proposal to send'); return; }
    for (const p of todo) open(title(p), body(p, linkTo(p)));
}

function selftest() {
    const assert = require('assert');
    const md = (head, extra = '') => [head, '', '# NFLX — Netflix', '', '## 1. Order', '', 'BUY **1 share of NFLX**, limit @ $66.50.',
        extra, '', '## 2. Thesis', '', 'Ask @someone, see #12 and owner/repo#3, GH-4.', ''].join('\n');
    const stamped = 'model: `gpt-6-astra`, lane: deepdive, 2026-11-05 09:04, stamped from the session log\nexamined: `claude-opus-5-5`, lane: examine';
    const now = Date.UTC(2026, 10, 6, 12, 0);
    const p = read('2026-11-05-0910-NFLX.md', md(stamped));
    assert.deepStrictEqual([p.ticker, p.side, p.drafter, p.examiner, p.withdrawn, p.when],
        ['NFLX', 'BUY', 'gpt-6-astra', 'claude-opus-5-5', false, '2026-11-05 09:10 UTC']);
    // Run reports and a `none` are not proposals.
    assert.strictEqual(read('2026-11-05-0910-ranking.md', md(stamped)), null);
    assert.strictEqual(read('2026-11-05-0910-none.md', md(stamped)), null);
    assert.strictEqual(read('notes.md', md(stamped)), null);
    // Not yet stamped, withdrawn, too old, or already sent: nothing.
    const pending = read('2026-11-05-0910-NFLX.md', md('model: pending, lane: deep-dive, date: 2026-11-05'));
    const withdrawn = read('2026-11-05-0910-NVO.md', md(stamped, '**Withdrawn by the second reader:** the outlook.'));
    const old = read('2026-11-01-0910-MWA.md', md(stamped));
    assert.deepStrictEqual(due([p, pending, withdrawn, old], [], now).map(x => x.id), ['2026-11-05-0910-NFLX']);
    assert.strictEqual(due([p], [{ title: 'Pot proposal: BUY NFLX (2026-11-05-0910-NFLX)' }], now).length, 0);
    // A failed examination leaves the draft standing, and it is sent, saying so.
    const alone = read('2026-11-05-0910-NFLX.md', md('model: `gpt-6-astra`, lane: deepdive'));
    assert.strictEqual(due([alone], [], now).length, 1);
    assert.ok(body(alone, 'L').includes('**Not examined:**'));
    // The body drops the stamps and keeps the text, with nothing in it able to notify or link.
    const b = body(p, 'https://github.com/x/blob/abc/pot/proposals/2026-11-05-0910-NFLX.md');
    assert.ok(!b.includes('lane: deepdive') && b.includes('## 1. Order') && b.includes('limit @' + WJ + ' $66.50'));
    assert.ok(b.includes('@' + WJ + 'someone') && b.includes('#' + WJ + '12') && b.includes('repo#' + WJ + '3') && b.includes('GH' + WJ + '-4'));
    // The link written here, above the proposal, is the only one that works.
    assert.ok(b.includes('with its links: https://github.com/x/blob/abc/'));
    const bad = [
        '[Trading 212](https://www.trading212.com/x_(y)) and [ref][1] and [bare]',
        '![pixel](https://evil.example/p.png) <img src="https://evil.example/q"> <https://evil.example/r>',
        'https://github.com/other/repo/issues/1 www.evil.example a@b.com &#64;someone',
        '[1]: https://evil.example/def',
        '`[code](https://evil.example/c)` and ``@inside ` code``',
    ].join('\n');
    const out = inert(bad);
    assert.ok(out.startsWith('Trading 212 and [ref]' + WJ + '[1] and [bare]'));
    assert.ok(out.includes('pixel <' + WJ + 'img'));
    for (const live of ['](', ']:', '][', '://', 'www.', '<i', '<h', '@s', '@b', '@i', '&#', '#1'])
        assert.ok(!out.includes(live), `inert left ${JSON.stringify(live)} in place`);
    // A long proposal is cut at a section, inside GitHub's limit.
    const long = read('2026-11-05-0910-NFLX.md', md(stamped) + '\n## 5. Numbers\n\n' + 'x'.repeat(70000));
    const lb = body(long, 'L');
    assert.ok(lb.length < 65536 && lb.includes('## 2. Thesis') && !lb.includes('## 5. Numbers') && lb.includes('Cut here for length'));
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : run();
module.exports = { read, due, body, inert };
