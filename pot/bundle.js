#!/usr/bin/env node
// `npm run pot-report` calls this last. It renders every pot document to HTML and writes
// pot.json at the repo root, which the dashboard's Pot tab reads.
//
// Why render here rather than in the page: the repo has no runtime dependencies and no build
// step, and it is going to keep both. Markdown-to-HTML in Node costs nothing at page load and
// keeps index.html free of a parser it would otherwise have to carry forever.
//
// The subset below is exactly what the pot's own documents use — headings, tables, lists,
// blockquotes, fenced code, links, bold/italic/code spans, rules. It is not a Markdown
// implementation and should not grow into one; if a document needs something it lacks, the
// document is usually the thing to simplify.

const fs = require('fs');
const path = require('path');

const REPO = 'https://github.com/leohk23/MyStockPortfolio/blob/main/';
const ROOT = path.resolve(__dirname, '..');

const esc = s => s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Everything git actually tracks. runs.md, scan.md, SUMMARY.md, summaries/ and logs/ are all
// gitignored, so sending a reader to the repo for those returns a GitHub 404 - which is what
// happened to the "Full breakdown: runs.md" link the moment the Pot tab went live.
const tracked = (() => {
    try {
        return new Set(require('child_process').execSync('git ls-files', { cwd: ROOT })
            .toString().split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean));
    } catch { return null; }          // not a git checkout: fall back to linking everything
})();

// Three fates for a relative link, decided by where the target actually lives.
//   in this bundle  -> switch documents inside the app, which beats leaving the page anyway
//   tracked in git  -> the repo, where it resolves
//   neither         -> not a link at all. A dead link is worse than plain text.
const linkTo = (target, fromDir, ids) => {
    if (/^(https?:|mailto:|#)/i.test(target)) return { href: target, external: true };
    const abs = path.resolve(ROOT, fromDir, target.split('#')[0]);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel.startsWith('..')) return { href: target, external: true };
    const id = rel.replace(/^pot[/]/, '');
    if (ids.has(id)) return { doc: id };
    if (!tracked || tracked.has(rel)) return { href: REPO + rel, external: true };
    return { dead: true };
};

// Inline spans. Order matters: code first, so a backtick span containing an asterisk or an
// underscore is not mangled by the emphasis rules that follow.
const A = String.fromCharCode(0xE000), B = String.fromCharCode(0xE001);   // code-span sentinels
const inline = (text, fromDir, ids) => {
    const code = [];
    // Park code spans behind private-use sentinels while the other rules run. A bare number
    // would not do: the restore pass would then match every figure in the document.
    let s = esc(text).replace(/`([^`]+)`/g, (_, c) => A + (code.push(c) - 1) + B);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, target) => {
        const to = linkTo(target, fromDir, ids);
        if (to.doc) return `<a href="#" data-pot="${esc(to.doc)}">${label}</a>`;
        if (to.dead) return label;
        return `<a href="${esc(to.href)}" target="_blank" rel="noopener">${label}</a>`;
    });
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // Underscore emphasis too: the summary's own standfirst uses it. Anchored at a word
    // boundary on both sides so snake_case in prose is left alone.
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return s.replace(new RegExp(A + "([0-9]+)" + B, "g"), (_, i) => `<code>${code[i]}</code>`);
};

const cells = row => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

function toHtml(md, fromDir, ids = new Set()) {
    const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
    const out = [];
    let list = null;          // 'ul' | 'ol' | null

    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^```/.test(line)) {                                   // fenced code
            closeList();
            const body = [];
            while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
            out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
            continue;
        }
        if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
            closeList();                                            // table
            const head = cells(line.trim());
            i++;
            const body = [];
            while (/^\s*\|.*\|\s*$/.test(lines[i + 1] || '')) body.push(cells(lines[++i].trim()));
            // A table whose header cells are all empty is a layout table, not a data table —
            // "Everything else" in the summary is a list of label/link pairs. Rendered as a table
            // it needs horizontal scrolling on a phone, and the long labels push the links off
            // screen where nobody finds them. A description list wraps instead.
            if (head.every(c => !c.trim()) && head.length === 2) {
                out.push('<dl class="pot-kv">' + body.map(r =>
                    `<div><dt>${inline(r[0], fromDir, ids)}</dt><dd>${inline(r[1] ?? '', fromDir, ids)}</dd></div>`
                ).join('') + '</dl>');
                continue;
            }
            out.push('<div class="pot-scroll"><table>',
                '<thead><tr>' + head.map(c => `<th>${inline(c, fromDir, ids)}</th>`).join('') + '</tr></thead>',
                '<tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${inline(c, fromDir, ids)}</td>`).join('') + '</tr>').join('') + '</tbody>',
                '</table></div>');
            continue;
        }
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2], fromDir, ids)}</h${h[1].length}>`); continue; }
        if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
        if (/^\s*>\s?/.test(line)) {
            closeList();                                            // blockquote, possibly several lines
            const body = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
            i--;
            out.push(`<blockquote>${inline(body.join(' '), fromDir, ids)}</blockquote>`);
            continue;
        }
        const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (li) {
            const want = /^\d/.test(li[1]) ? 'ol' : 'ul';
            if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
            // Continuation lines are indented under the bullet; fold them into the same item.
            const body = [li[2]];
            while (/^\s{2,}\S/.test(lines[i + 1] || '') && !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1])) body.push(lines[++i].trim());
            out.push(`<li>${inline(body.join(' '), fromDir, ids)}</li>`);
            continue;
        }
        if (!line.trim()) { closeList(); continue; }
        // A plain paragraph: gather its wrapped lines so the sentence reads as one.
        const body = [line.trim()];
        while ((lines[i + 1] || '').trim() && !/^(#{1,6}\s|```|\s*\||\s*>|\s*([-*]|\d+\.)\s)/.test(lines[i + 1])) body.push(lines[++i].trim());
        out.push(`<p>${inline(body.join(' '), fromDir, ids)}</p>`);
    }
    closeList();
    return out.join('\n');
}

// Newest first within each group, and the groups themselves ordered the way they are read:
// the summary, then what needs a decision, then the evidence behind it.
const listDir = (dir, kind) => {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, dir)); } catch { return []; }
    // By modification time, not by name: '2026-08-29-RSGN.SW.md' sorts after
    // '2026-08-29-1442-...' alphabetically while being the older file.
    return names.filter(f => f.endsWith('.md') && f !== 'README.md')
        .map(f => ({ kind, dir, file: f, at: fs.statSync(path.join(ROOT, dir, f)).mtimeMs }))
        .sort((x, y) => y.at - x.at);
};

// YYYY-MM-DD-HHMM out of a filename, read as UTC because that is what the lanes stamp. Files
// without one (SUMMARY.md, runs.md, scan.md) fall back to their mtime.
const runTime = file => {
    const m = file.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`;
};

function build() {
    // The document list is settled before anything is rendered: a proposal links to the sweep
    // behind it and the summary links to almost everything, so linkTo() has to know the whole
    // set to route a link inward rather than out to a repo path that may not even be tracked.
    const wanted = [
        { dir: 'pot', file: 'SUMMARY.md', kind: 'summary', title: 'Summary' },
        ...listDir('pot/proposals', 'proposal'),
        ...listDir('pot/sweeps', 'sweep'),
        ...listDir('pot/reviews', 'review'),
        { dir: 'pot', file: 'runs.md', kind: 'runs', title: 'Runs and cost' },
        { dir: 'pot', file: 'scan.md', kind: 'scan', title: 'Scan' },
        ...listDir('pot/summaries', 'archive'),
    ].filter(d => fs.existsSync(path.join(ROOT, d.dir, d.file)));

    const idOf = d => `${d.dir}/${d.file}`.replace(/^pot\//, '');
    const ids = new Set(wanted.map(idOf));

    const docs = wanted.map(d => {
        const full = path.join(ROOT, d.dir, d.file);
        return {
            id: idOf(d),
            kind: d.kind,
            title: d.title || d.file.replace(/\.md$/, ''),
            // The time in the NAME, not the file's mtime. A name is stamped when the run starts
            // and the mtime when report.js later writes provenance into it, so the two differ by
            // however long the lane took — 2026-08-31-2024-MWA showed as 20:34, ten minutes adrift
            // from its own title, on top of the hour that local rendering adds in BST.
            updated: runTime(d.file) || fs.statSync(full).mtime.toISOString(),
            html: toHtml(fs.readFileSync(full, 'utf8'), d.dir, ids),
        };
    });

    const out = { generated: new Date().toISOString(), docs };
    fs.writeFileSync(path.join(ROOT, 'pot.json'), JSON.stringify(out));
    const kb = (fs.statSync(path.join(ROOT, 'pot.json')).size / 1024).toFixed(0);
    console.log(`wrote pot.json: ${docs.length} documents, ${kb}KB`);
    return out;
}

if (require.main === module) build();
module.exports = { build, toHtml };
