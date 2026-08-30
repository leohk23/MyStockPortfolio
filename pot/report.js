#!/usr/bin/env node
// `npm run pot-report` — everything you need after a run, in three files.
//
//   pot/SUMMARY.md          the entry point. A bookmark that never moves.
//   pot/summaries/*.md    one dated report per run — the record that never overwrites.
//   pot/runs.md           the ledger: what each lane did, and what it cost.
//   pot/scan.md           what the free lane found, in prose. Rewritten each run.
//   pot/logs/*.md         readable transcripts, rendered from Codex JSONL.
//
// D12: judgement is measured by the return, so what is recorded here is PROVENANCE. Every figure
// comes from the session transcripts under ~/.codex/sessions/, never from what an agent said about
// itself — a model cannot see its own token accounting, which is why every proposal header so far
// reads "tokens: unknown" while the log has it to the token.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSIONS = path.join(os.homedir(), '.codex', 'sessions');
const LOGS = 'pot/logs';

const fmt = n => n == null ? '–' : n.toLocaleString();
const mmss = s => s == null ? '–' : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
const when = t => (t || '').slice(0, 16).replace('T', ' ');
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function sessionFiles(root, out = []) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(root, e.name);
        if (e.isDirectory()) sessionFiles(full, out);
        else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(full);
    }
    return out;
}

const parseJsonl = file => fs.readFileSync(file, 'utf8').trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// One run's facts, all read from the log rather than asserted by the agent.
function summarise(file) {
    let lines;
    try { lines = parseJsonl(file); } catch { return null; }
    if (!lines.length) return null;
    const blob = JSON.stringify(lines);
    const started = lines[0].timestamp || null, ended = lines[lines.length - 1].timestamp || null;
    const totals = [...blob.matchAll(/"total_token_usage":(\{[^}]*\})/g)].pop();
    // The lane comes from the INSTRUCTION, not from anywhere in the transcript. Searching the
    // whole blob found the first `brief-*.md` mentioned anywhere — and a deep dive reads the
    // sweep's output, while AGENTS.md names every brief — so a deep-dive run was being filed as a
    // sweep, and its proposal stamped with another run's model and token count.
    const asked = lines.find(l => l.payload?.item?.type === 'UserMessage')
        ?.payload.item.content?.map(c => c.text).join(' ') || '';
    const brief = (asked.match(/pot[\\/]brief-([a-z-]+)\.md/) || [])[1]
        || (blob.match(/pot[\\/]brief-([a-z-]+)\.md/) || [])[1] || null;
    return {
        file, started, ended, brief, lines,
        lane: brief ? brief.replace(/-/g, ' ') : 'unknown',
        model: (blob.match(/"model":"([^"]+)"/) || [])[1] || null,
        seconds: started && ended ? Math.round((Date.parse(ended) - Date.parse(started)) / 1000) : null,
        usage: totals ? JSON.parse(totals[1]) : null,
        repo: /MyStockPortfolio/.test((blob.match(/"cwd":"([^"]+)"/) || [])[1] || ''),
        // Which files this run wrote — so its provenance header can be stamped from the log
        // rather than from the agent's own guess at what model it is.
        wrote: [...new Set(lines.filter(l => l.payload?.item?.type === 'FileChange')
            .flatMap(l => Object.keys(l.payload.item.changes || {})))],
    };
}

// ---------------------------------------------------------------- readable transcript
//
// The raw JSONL is ~1MB and mostly encrypted reasoning blobs and whole-file dumps. What is worth
// reading is the shape of the run: what it was asked, what it searched for, what it ran, what it
// wrote, what it concluded. Output is truncated on purpose — this is a record to skim, and the
// JSONL is still there when the detail matters.
const clip = (s, n) => { s = String(s ?? '').replace(/\r/g, '').trim(); return s.length > n ? s.slice(0, n) + ' …' : s; };

function renderTranscript(run) {
    const items = run.lines.filter(l => l.payload?.type === 'item_completed').map(l => l.payload.item);
    const out = [
        `# ${run.lane} — ${when(run.started)}`, '',
        `\`${run.model}\`, ${mmss(run.seconds)}, ${fmt(run.usage?.total_tokens)} tokens`,
        `[${path.basename(run.file)}](${run.file.replace(/\\/g, '/')}) (raw)`, '',
    ];
    let searches = 0, commands = 0;
    for (const it of items) {
        if (it.type === 'UserMessage') {
            out.push('## Asked', '', '> ' + clip(it.content?.map(c => c.text).join(' '), 400), '');
        } else if (it.type === 'AgentMessage') {
            out.push('## Said', '', clip(it.content?.map(c => c.text).join('\n'), 1600), '');
        } else if (it.type === 'Extension' && it.kind === 'web.search') {
            searches++;
            // One Extension item can carry several queries; `query` is a joined summary and is
            // sometimes null, so the authoritative list is action.queries.
            const queries = it.action?.queries?.length ? it.action.queries : (it.query ? [it.query] : []);
            const urls = [...new Set((it.results || []).map(r => r.url || r.domain).filter(Boolean))].slice(0, 5);
            for (const q of queries) out.push(`**searched** \`${clip(q, 150)}\``);
            for (const u of urls) out.push(`  - ${u}`);
            out.push('');
        } else if (it.type === 'CommandExecution') {
            commands++;
            const cmd = Array.isArray(it.command) ? it.command[it.command.length - 1] : it.command;
            out.push('```', clip(cmd, 300), `→ exit ${it.exit_code}${it.duration?.secs != null ? ` (${it.duration.secs}s)` : ''}`, '```', '');
        } else if (it.type === 'FileChange') {
            for (const [f, c] of Object.entries(it.changes || {})) {
                out.push(`**${c.type}** \`${f.split(/[\\/]/).slice(-2).join('/')}\``
                    + (c.content ? ` — ${c.content.split('\n').length} lines` : ''), '');
            }
        }
    }
    out.splice(4, 0, `${searches} web search${searches === 1 ? '' : 'es'}, ${commands} command${commands === 1 ? '' : 's'}`, '');
    return out.join('\n');
}

// Stamp a run's provenance onto the files that run produced.
//
// D12 says the record is provenance, and that it comes from the log rather than from the agent —
// and the agent is measurably unreliable here. The last Sweep headed its own output
// "model: Codex (GPT-5) · tokens: unknown" when the runtime recorded `gpt-5.6-sol` and 4,460,184
// tokens. It is not being careless: a model genuinely cannot see its own accounting, and asking it
// to try invites a confident wrong answer instead of an honest blank.
//
// The log also says which files each run wrote, so there is no guessing about what to stamp.
// Rewrites the first line only, and only when it already looks like a provenance header, so a
// hand-written file is never touched.
// The log records the path the agent SAID it wrote, which is not always the path that
// survived. The 29 Aug deep dive announced pot/proposals/2026-08-29-1322-NVDA.md and then
// renamed its output to ...-1442-... before exiting, so this read a file that no longer
// existed, swallowed the ENOENT, and published two proposals still headed "model: pending".
//
// When the logged path is gone, look in the same directory for a file this run plausibly left:
// still carrying an unstamped header, and modified after the run began. Narrow enough not to
// claim somebody else's file, and it is the rename case in practice.
function renamedOutput(dir, run, claimed) {
    const startedMs = Date.parse(run.started || 0) || 0;
    const NL = String.fromCharCode(10);
    let best = null, entries = [];
    try { entries = fs.readdirSync(dir); } catch { return null; }
    for (const name of entries) {
        const rel = dir + '/' + name;
        if (!name.endsWith('.md') || claimed.has(rel)) continue;
        let st, head;
        try {
            st = fs.statSync(rel);
            head = fs.readFileSync(rel, 'utf8').split(NL)[0].trim();
        } catch { continue; }
        if (st.mtimeMs < startedMs) continue;
        if (!/^model:[ ]*(pending|.?<)/i.test(head)) continue;
        if (!best || st.mtimeMs > best.mtimeMs) best = { rel, mtimeMs: st.mtimeMs };
    }
    return best && best.rel;
}

function stampProvenance(run, claimed = new Set()) {
    const fresh = (run.usage?.input_tokens ?? 0) - (run.usage?.cached_input_tokens ?? 0);
    const line = `model: \`${run.model}\`, lane: ${run.lane}, ${when(run.started)}, `
        + `${mmss(run.seconds)}, ${fmt(run.usage?.total_tokens)} tokens `
        + `(${fmt(fresh)} fresh, ${fmt(run.usage?.cached_input_tokens)} cached, ${fmt(run.usage?.output_tokens)} out), `
        + `stamped from the session log rather than self-reported`;
    let stamped = 0;
    for (const abs of run.wrote || []) {
        const rel = abs.replace(/\\/g, '/').replace(/^.*?MyStockPortfolio\//, '');
        if (!rel.startsWith('pot/') || !rel.endsWith('.md')) continue;
        const onDisk = fs.existsSync(rel) ? rel
            : renamedOutput(rel.slice(0, rel.lastIndexOf('/')), run, claimed);
        if (!onDisk) continue;
        // Runs arrive newest-first, so the first to claim a file is the one that last wrote it.
        if (claimed.has(onDisk)) continue;
        claimed.add(onDisk);
        try {
            const body = fs.readFileSync(onDisk, 'utf8');
            const nl = body.indexOf('\n');
            if (nl < 0 || !/^model:/i.test(body.slice(0, nl))) continue;
            const next = body.slice(0, nl) === line ? null : line + body.slice(nl);
            if (next) { fs.writeFileSync(onDisk, next); stamped++; }
        } catch { /* the file may have been renamed or removed since; not worth failing over */ }
    }
    return stamped;
}

// The world-breadth block, as its own function rather than inline: it nests a template literal
// inside a template literal inside a map, which is where the last three attempts at this file
// went wrong.
function worldSection(sig) {
    const w = sig?.world;
    if (!w) return '_No world data — run `npm run fetch`._';
    const rows = w.deepest.map(d =>
        `| ${d.country} (\`${d.yahoo}\`) | ${(d.fromAth * 100).toFixed(0)}% | peak ${d.athDay} |`).join('\n');
    const dead = w.notTrading.length
        ? '\n\n**No longer trading:** ' + w.notTrading.map(d => `${d.country} (\`${d.yahoo}\`)`).join(', ')
            + ' — wound up, and still quoted at the last price each ever traded at.'
        : '';
    return `${w.says}.\n\n| furthest below its own all-time high | | |\n|---|---:|---|\n${rows}${dead}`;
}

// Same reason as worldSection: nested template literals inside a map, kept out of the big one.
function unannotatedLines(files) {
    if (!files.length) return '';
    return files.map(f => `- **Saved but not listed** — [${f}](reading/${f}) sits in \`pot/reading/\` `
        + 'with no entry in [reading.md](reading.md). The one line saying why you kept it is the '
        + 'part no machine can supply.').join('\n') + '\n';
}

// ---------------------------------------------------------------- build

function build() {
    fs.mkdirSync(LOGS, { recursive: true });
    const runs = sessionFiles(SESSIONS).map(summarise).filter(r => r && r.repo && r.brief);
    runs.sort((a, b) => (b.started || '').localeCompare(a.started || ''));

    // Stamp each run's own outputs before anything reads them, so the model and token counts
    // on a proposal are the runtime's numbers rather than the agent's recollection.
    let stamped = 0;
    const claimed = new Set();
    for (const r of runs) stamped += stampProvenance(r, claimed);

    // Readable transcript per run, named so it sorts with the run.
    for (const r of runs) {
        r.log = `${LOGS}/${(r.started || '').slice(0, 19).replace(/[:T]/g, '-')}-${r.brief}.md`;
        fs.writeFileSync(r.log, renderTranscript(r));
    }

    const sig = read('signals.json');
    const pos = read('pot/positions.json', { cashGBP: 0, holdings: {} });
    // By modification time. Sorting these by NAME put "smoke.md" after every dated sweep and
    // "2026-08-29-RSGN.SW.md" after "2026-08-29-1442-...", so the summary confidently named the
    // wrong output for both lanes: a smoke test as the latest Sweep, and a proposal four runs
    // old as the latest Deep dive.
    const byTime = dir => {
        try {
            return fs.readdirSync(dir).filter(f => f.endsWith(".md") && f !== "README.md")
                .map(f => ({ f, at: fs.statSync(dir + "/" + f).mtimeMs }))
                .sort((a, b) => b.at - a.at).map(x => x.f);
        } catch { return []; }
    };
    const sweep = byTime("pot/sweeps")[0] || null;
    const review = byTime("pot/reviews")[0] || null;
    const proposals = byTime("pot/proposals");

    const lastOf = lane => runs.find(r => r.brief === lane);

    const fresh = u => (u?.input_tokens ?? 0) - (u?.cached_input_tokens ?? 0);
    const totalTokens = runs.reduce((a, r) => a + (r.usage?.total_tokens || 0), 0);
    const totalFresh = runs.reduce((a, r) => a + fresh(r.usage), 0);
    const totalSecs = runs.reduce((a, r) => a + (r.seconds || 0), 0);

    // ---- the ledger
    fs.writeFileSync('pot/runs.md', `# Run ledger

Generated ${when(new Date().toISOString())} by \`npm run pot-report\`, from the Codex session
transcripts under \`~/.codex/sessions/\` — never from what an agent said about itself.

## Cost

**Cash cost: £0.** Codex is authenticated against a ChatGPT subscription (\`codex login status\` →
"Logged in using ChatGPT"), so nothing is billed per token. What a run spends is subscription
allowance and wall-clock time.

The token columns are kept because that is D12's whole purpose: if this ever moves to metered API
credits these are the numbers that would be charged, and runs either side of the switch stay
comparable. **Fresh** is input not served from cache — the part a metered call charges full rate for.

| runs | wall time | fresh input | total tokens |
|---|---|---:|---:|
| ${runs.length} | ${mmss(totalSecs)} | ${fmt(totalFresh)} | ${fmt(totalTokens)} |

| started | lane | model | wall | fresh in | cached in | out | total | transcript |
|---|---|---|---|---:|---:|---:|---:|---|
${runs.map(r => `| ${when(r.started)} | ${r.lane} | \`${r.model || '?'}\` | ${mmss(r.seconds)} `
        + `| ${fmt(fresh(r.usage))} | ${fmt(r.usage?.cached_input_tokens)} | ${fmt(r.usage?.output_tokens)} `
        + `| ${fmt(r.usage?.total_tokens)} | [read](${r.log.replace('pot/','')}) |`).join('\n') || '| – | none yet | | | | | | | |'}

## Scan lane

Free, deterministic, no session and no tokens — it runs on every CI pass.

${sig ? `| last run | prices as of | fired | instructions | quiet | blocked |
|---|---|---:|---:|---:|---:|
| ${when(sig.generated)} | ${when(sig.pricesAt)} | ${sig.fired?.length ?? 0} | ${sig.instructions?.length ?? 0} | ${sig.quiet?.length ?? 0} | ${sig.blocked?.length ?? 0} |`
        : '_No `signals.json` yet — run `npm run signals`._'}

## Raw transcripts

\`\`\`
${SESSIONS}\\<year>\\<month>\\<day>\\rollout-*.jsonl
\`\`\`

About 1MB each, full detail including whole file contents. \`codex resume --last\` reopens the most
recent interactively. Not committed: large, and the rendered logs above are the readable part.
`);

    const fired = sig?.fired || [];
    const byRule = fired.reduce((a, f) => ((a[f.rule] = (a[f.rule] || 0) + 1), a), {});

    // ---- the Scan, in prose
    //
    // Every other lane left a markdown behind and this one did not — it wrote signals.json and
    // nothing else, so the only way to read it was the console or a one-line summary. One file,
    // rewritten each run rather than dated: CI scans every fifteen minutes, and 96 dated files a
    // day is not a history, it is landfill. The dated record of what the Scan said at a point in
    // time is the summary that quotes it.
    const pctOf = n => n == null ? '–' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
    const byRuleFull = fired.reduce((a, f) => ((a[f.rule] = a[f.rule] || []).push(f), a), {});
    fs.writeFileSync('pot/scan.md', `# Scan — ${when(sig?.generated)}

The free lane. Every \`[auto]\` rule in [strategy.md](../strategy.md) §6, over data CI already
fetched. No LLM, no network, no cost. Rewritten on every run — for the dated record, see
[summaries/](summaries/).

Prices as of ${when(sig?.pricesAt)}. VIX ${sig?.vix?.close ?? '–'} (${pctOf(sig?.vix?.day)}), S&P ${pctOf(sig?.spxDay)} on the day.

${sig?.instructions?.length ? `## Instructions — no agent involved

${sig.instructions.map(i => `- **${i.action}** — ${i.rule}, VIX closed ${i.close} against a ${i.threshold} threshold.`).join('\n')}
` : ''}
## Signals${fired.length ? '' : ' — none'}

${Object.entries(byRuleFull).map(([rule, list]) => `### ${rule} — ${list.length}

${list[0].pe != null
        ? `| ticker | | P/E | own floor | vs floor | notes |\n|---|---|---:|---:|---:|---|\n`
            + list.map(f => `| \`${f.ticker}\` | ${f.where} | ${f.pe.toFixed(1)} | ${f.floor.toFixed(1)} | ${pctOf(f.vsFloor)} | `
                + `${[f.oneOff && `⚠ one-off: ${f.oneOff.why}`, f.epsStale && `⚠ stale EPS: ${f.epsStale.why}`].filter(Boolean).join('; ')} |`).join('\n')
        : list.map(f => `- \`${f.ticker || ''}\` ${JSON.stringify(f)}`).join('\n')}`).join('\n\n') || '_Nothing fired._'}

## Macro

The reading, not the level — each is a relation between two series, computed rather than inferred.

${(sig?.macro || []).map(n => `- **${n.name}** — ${n.says || 'mixed across windows, no clean direction'}`).join('\n') || '_No macro state._'}

## World breadth

${worldSection(sig)}

## Health

- **Quiet** (ran, found nothing): ${sig?.quiet?.join(', ') || 'none'}
- **Blocked** (could not run): ${sig?.blocked?.length ? sig.blocked.map(b => `${b.rule} — ${b.why}`).join('; ') : 'none'}

A quiet rule and a blocked one are both silent. Keeping them apart is the only way a dead scan
does not look exactly like a healthy one.
`);

    // Saved articles nobody has said anything about.
    //
    // `pot/reading/` holds full text; `pot/reading.md` holds the one line saying WHY it was kept —
    // and that line is the only part of an entry a machine could not have produced. Saving the
    // whole article is more work than listing it, so a saved-but-unlisted file is the likeliest
    // thing to fall through, and it used to do so in silence.
    const unannotated = (() => {
        try {
            const listed = fs.readFileSync('pot/reading.md', 'utf8');
            return fs.readdirSync('pot/reading')
                .filter(f => f.endsWith('.md') && f !== 'README.md')
                .filter(f => !listed.includes(f.replace(/\.md$/, '')));
        } catch { return []; }
    })();

    // A never-cite list nobody checks is a wish, not a rule. The list is read from sources.md
    // itself, so Leo adding one line there is all it takes to arm this — there is nothing here
    // to keep in step, which is the whole point of it living in one place.
    const banned = (() => {
        try {
            const doc = fs.readFileSync('pot/sources.md', 'utf8');
            const list = doc.slice(doc.indexOf('## The never-cite list'));
            return [...list.matchAll(/^- ([a-z0-9-]+[.][a-z.]+) /gm)].map(m => m[1]);
        } catch { return []; }
    })();
    // Only what the lanes actually publish. A domain covers its subdomains and nothing else:
    // finance.example.com is example.com, notexample.com is not.
    const propWhen = f => {
        try { return when(fs.statSync("pot/proposals/" + f).mtime.toISOString()); } catch { return "–"; }
    };
    const violations = (() => {
        const hits = [];
        for (const dir of ['pot/sweeps', 'pot/proposals']) {
            let files = [];
            try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { continue; }
            for (const f of files) {
                const text = fs.readFileSync(dir + '/' + f, 'utf8');
                const cited = new Set([...text.matchAll(new RegExp('https?://([a-z0-9.-]+)', 'gi'))]
                    .map(m => (m[1].toLowerCase().startsWith('www.') ? m[1].slice(4) : m[1]).toLowerCase()));
                const bad = banned.filter(b => [...cited].some(c => c === b || c.endsWith('.' + b)));
                if (bad.length) hits.push({ file: dir + '/' + f, bad });
            }
        }
        return hits;
    })();

    // Rule 3 of sources.md lets a Sweep quote a provisional price for a name we do not carry, on
    // condition it adds the ticker to watchlist.json so the next fetch makes it local. That second
    // half is the one that closes the loop, and it is the one that gets forgotten: on 30 Aug the
    // Sweep quoted PDD's March close, labelled it provisional exactly as asked, and never added
    // PDD - so the same external lookup would have recurred every week for good.
    //
    // Only the newest Sweep is checked. Older ones are a record of what was true then, and
    // nagging about a name added since would be noise.
    // No ticker parsing. Two earlier attempts failed in opposite directions: matching a ticker to
    // the word "provisional" by proximity missed the very case it was written for, and listing
    // every ticker-shaped token returned VIE, WTI and NBS alongside two names we already hold
    // under their local codes. The invariant does not need the tickers at all — rule 3 says a
    // provisional price obliges an addition to watchlist.json, so the question is simply whether
    // the sweep that quoted one also touched that file in the same commit.
    const strandedSweep = (() => {
        if (!sweep) return null;
        const rel = 'pot/sweeps/' + sweep;
        let text;
        try { text = fs.readFileSync(rel, 'utf8'); } catch { return null; }
        if (!/provisional/i.test(text)) return null;
        try {
            const sha = require('child_process')
                .execSync(`git log -1 --format=%H -- "${rel}"`, { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString().trim();
            if (!sha) return null;
            const touched = require('child_process')
                .execSync(`git show --name-only --format= ${sha}`, { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString();
            return touched.includes('watchlist.json') ? null : sweep;
        } catch { return null; }
    })();

    // ---- the entry point
    // "Awaiting a decision" means state `open` in the derived book — not "absent from
    // positions.json". That test was right while positions.json listed only DECIDED proposals;
    // since pot/positions.js started deriving every proposal with a state, being listed stopped
    // meaning anything, and the count silently fell from nine to two — the two written after the
    // book was last built. A file the book has not seen yet is still awaiting a decision.
    const stateOf = new Map((pos.proposals || []).map(p => [p.file, p.state]));
    const openProposals = proposals.filter(f => (stateOf.get(f) || 'open') === 'open');

    // Each run gets its own dated file, so the history is a history and not the last one only.
    // SUMMARY.md stays the stable entry point and points at the newest — a bookmark that never
    // moves, over a record that never overwrites.
    fs.mkdirSync('pot/summaries', { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const dated = 'pot/summaries/' + stamp + '.md';
    const body = `# AI pot

`+ `_${when(new Date().toISOString())}, from \`npm run pot-report\`. Everything else hangs off this page._

## Needs you

${sig?.instructions?.length
        ? sig.instructions.map(i => `- **STANDING ORDER FIRED** — ${i.action} (${i.rule}, VIX ${i.close})`).join('\n')
        : '- No standing order has fired.'}
${unannotatedLines(unannotated)}${openProposals.length
        ? '- **' + openProposals.length + ' proposal' + (openProposals.length === 1 ? '' : 's')
            + ' awaiting your decision**' + String.fromCharCode(10) + String.fromCharCode(10)
            + '| proposal | written |' + String.fromCharCode(10) + '|---|---|' + String.fromCharCode(10)
            + openProposals.map(f => `| [${f.replace(/.md$/, "")}](proposals/${f}) | ${propWhen(f)} |`).join(String.fromCharCode(10))
        : '- No proposal is waiting.'}
${violations.length
        ? violations.map(v => '- **Cited a never-cite source** — ' + v.file + ' used ' + v.bad.join(', ') + ' ([sources.md](sources.md))').join(String.fromCharCode(10))
        : ''}
${strandedSweep
        ? '- **Provisional price, nothing added to the watchlist** — ['
            + strandedSweep.replace('.md', '') + '](sweeps/' + strandedSweep + ')'
            + ' quoted a price for a name we do not carry. Rule 3 of [sources.md](sources.md) says '
            + 'add the ticker to `watchlist.json`, so the next fetch makes it local.'
        : ''}

## The pot

| cash | holdings | open theses | contributed |
|---:|---:|---:|---:|
| £${(pos.cashGBP ?? 0).toLocaleString()} | ${Object.keys(pos.holdings || {}).length} | ${(pos.proposals || []).length} | £${((pos.contributions || []).reduce((a, c) => a + (c.amountGBP || 0), 0)).toLocaleString()} |

## Latest by lane

| lane | last run | what it produced | transcript |
|---|---|---|---|
| **Scan** (free) | ${when(sig?.generated) || '–'} | [${fired.length} fired](scan.md)${Object.keys(byRule).length ? ' — ' + Object.entries(byRule).map(([r, n]) => `${r} ×${n}`).join(', ') : ''} | _no session_ |
| **Review** | ${when(lastOf('review')?.started) || '–'} | ${review ? `[${review.replace(/.md$/, '')}](reviews/${review})` : '–'} | ${lastOf('review') ? `[read](${lastOf('review').log.replace('pot/','')})` : '–'} |
| **Sweep** | ${when(lastOf('sweep')?.started) || '–'} | ${sweep ? `[${sweep.replace(/\.md$/, '')}](sweeps/${sweep})` : '–'} | ${lastOf('sweep') ? `[read](${lastOf('sweep').log.replace('pot/','')})` : '–'} |
| **Deep dive** | ${when(lastOf('deepdive')?.started) || '–'} | ${proposals[0] ? `[${proposals[0].replace(/\.md$/, '')}](proposals/${proposals[0]})` : '–'} | ${lastOf('deepdive') ? `[read](${lastOf('deepdive').log.replace('pot/','')})` : '–'} |

${sig?.blocked?.length ? `**Blocked:** ${sig.blocked.map(b => `${b.rule} (${b.why})`).join('; ')}\n` : ''}
## Cost so far

${runs.length} agent runs, ${mmss(totalSecs)} wall, ${fmt(totalFresh)} fresh input tokens,
**£0 cash** (subscription, not metered). Full breakdown: **[runs.md](runs.md)**.

## Everything else

| | |
|---|---|
| The rules — what to buy, what to sell | [strategy.md](../strategy.md) |
| The system — decisions, lanes, why | [pot-design.md](../pot-design.md) |
| Run ledger and costs | [runs.md](runs.md) |
| Readable transcripts | [logs/](logs/) |
| Articles you kept, as Sweep input | [reading.md](reading.md) |
| What the Scan found, in prose | [scan.md](scan.md) |
| Raw scan output | [signals.json](../signals.json) |
`;

    fs.writeFileSync(dated, body);

    // The stable entry point: a bookmark that never moves, pointing at the record that never
    // overwrites. It carries the same content as the newest dated file, plus the trail behind it —
    // so opening SUMMARY.md always shows the current state and how it got there.
    const past = fs.readdirSync('pot/summaries').filter(f => f.endsWith('.md')).sort().reverse();
    fs.writeFileSync('pot/SUMMARY.md', body + `
---

## Previous runs

${past.slice(0, 6).map((f, k) => {
        const s = f.replace(".md", "");
        const label = s.slice(0, 10) + " " + s.slice(11, 13) + ":" + s.slice(14, 16);
        return "- " + (k === 0 ? "**" : "") + "[" + label + "](summaries/" + f + ")" + (k === 0 ? "** — this one" : "");
    }).join(String.fromCharCode(10))}
${past.length > 6 ? String.fromCharCode(10) + "_…and " + (past.length - 6) + " older. In the app they are all in the picker under Past run reports._" : ""}
`);

    console.log(`wrote ${dated}, pot/SUMMARY.md, pot/runs.md and ${runs.length} transcript(s)`);
    if (stamped) console.log(`  stamped provenance onto ${stamped} file(s) from the session logs`);
    console.log(`  ${runs.length} agent runs, ${mmss(totalSecs)} wall, ${fmt(totalTokens)} tokens, £0`);
    if (openProposals.length) console.log(`  ${openProposals.length} proposal(s) awaiting a decision`);
    if (violations.length) {
        console.log(`  ${violations.length} file(s) cited a never-cite source:`);
        for (const v of violations) console.log(`    ${v.file} — ${v.bad.join(', ')}`);
    } else if (banned.length) {
        console.log(`  no never-cite source in any sweep or proposal (${banned.length} on the list)`);
    }
    if (strandedSweep) console.log(`  ${strandedSweep} quoted a provisional price but added nothing to watchlist.json`);
}

if (require.main === module) build();
module.exports = { summarise, sessionFiles, renderTranscript };
