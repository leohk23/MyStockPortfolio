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
    const brief = (blob.match(/pot[\\/]brief-([a-z-]+)\.md/) || [])[1] || null;
    return {
        file, started, ended, brief, lines,
        lane: brief ? brief.replace(/-/g, ' ') : 'unknown',
        model: (blob.match(/"model":"([^"]+)"/) || [])[1] || null,
        seconds: started && ended ? Math.round((Date.parse(ended) - Date.parse(started)) / 1000) : null,
        usage: totals ? JSON.parse(totals[1]) : null,
        repo: /MyStockPortfolio/.test((blob.match(/"cwd":"([^"]+)"/) || [])[1] || ''),
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
        `\`${run.model}\` · ${mmss(run.seconds)} · ${fmt(run.usage?.total_tokens)} tokens`,
        `· [${path.basename(run.file)}](${run.file.replace(/\\/g, '/')}) (raw)`, '',
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
    out.splice(4, 0, `${searches} web search${searches === 1 ? '' : 'es'} · ${commands} command${commands === 1 ? '' : 's'}`, '');
    return out.join('\n');
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

// ---------------------------------------------------------------- build

function build() {
    fs.mkdirSync(LOGS, { recursive: true });
    const runs = sessionFiles(SESSIONS).map(summarise).filter(r => r && r.repo && r.brief);
    runs.sort((a, b) => (b.started || '').localeCompare(a.started || ''));

    // Readable transcript per run, named so it sorts with the run.
    for (const r of runs) {
        r.log = `${LOGS}/${(r.started || '').slice(0, 19).replace(/[:T]/g, '-')}-${r.brief}.md`;
        fs.writeFileSync(r.log, renderTranscript(r));
    }

    const sig = read('signals.json');
    const pos = read('pot/positions.json', { cashGBP: 0, holdings: {} });
    const newest = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().pop(); } catch { return null; } };
    const sweep = newest('pot/sweeps'), proposals = (() => {
        try { return fs.readdirSync('pot/proposals').filter(f => f.endsWith('.md')).sort().reverse(); } catch { return []; }
    })();
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

    // ---- the entry point
    const openProposals = proposals.filter(f => !(pos.proposals || []).some(p => p.file === f));

    // Each run gets its own dated file, so the history is a history and not the last one only.
    // SUMMARY.md stays the stable entry point and points at the newest — a bookmark that never
    // moves, over a record that never overwrites.
    fs.mkdirSync('pot/summaries', { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const dated = 'pot/summaries/' + stamp + '.md';
    const body = `# AI pot — ${when(new Date().toISOString())}

_Generated ${when(new Date().toISOString())} by \`npm run pot-report\`. This is the entry point;
everything else hangs off it._

## Needs you

${sig?.instructions?.length
        ? sig.instructions.map(i => `- **STANDING ORDER FIRED** — ${i.action} (${i.rule}, VIX ${i.close})`).join('\n')
        : '- No standing order has fired.'}
${openProposals.length
        ? openProposals.map(f => `- **Proposal awaiting your decision** — [${f.replace(/\.md$/, '')}](proposals/${f})`).join('\n')
        : '- No proposal is waiting.'}

## The pot

| cash | holdings | open theses | contributed |
|---:|---:|---:|---:|
| £${(pos.cashGBP ?? 0).toLocaleString()} | ${Object.keys(pos.holdings || {}).length} | ${(pos.proposals || []).length} | £${((pos.contributions || []).reduce((a, c) => a + (c.amountGBP || 0), 0)).toLocaleString()} |

## Latest by lane

| lane | last run | what it produced | transcript |
|---|---|---|---|
| **Scan** (free) | ${when(sig?.generated) || '–'} | [${fired.length} fired](scan.md)${Object.keys(byRule).length ? ' — ' + Object.entries(byRule).map(([r, n]) => `${r} ×${n}`).join(', ') : ''} | _no session_ |
| **Sweep** | ${when(lastOf('sweep')?.started) || '–'} | ${sweep ? `[${sweep.replace(/\.md$/, '')}](sweeps/${sweep})` : '–'} | ${lastOf('sweep') ? `[read](${lastOf('sweep').log.replace('pot/','')})` : '–'} |
| **Deep dive** | ${when(lastOf('deepdive')?.started) || '–'} | ${proposals[0] ? `[${proposals[0].replace(/\.md$/, '')}](proposals/${proposals[0]})` : '–'} | ${lastOf('deepdive') ? `[read](${lastOf('deepdive').log.replace('pot/','')})` : '–'} |

${sig?.blocked?.length ? `**Blocked:** ${sig.blocked.map(b => `${b.rule} (${b.why})`).join('; ')}\n` : ''}
## Cost so far

${runs.length} agent runs · ${mmss(totalSecs)} wall · ${fmt(totalFresh)} fresh input tokens ·
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

${past.slice(0, 20).map((f, i) => `- ${i === 0 ? '**' : ''}[${f.replace(/\.md$/, '').replace(/-(\d\d)-(\d\d)$/, ' $1:$2')}](summaries/${f})${i === 0 ? '** — this one' : ''}`).join('\n')}
${past.length > 20 ? `\n_…and ${past.length - 20} older, in [summaries/](summaries/)._` : ''}
`);

    console.log(`wrote ${dated}, pot/SUMMARY.md, pot/runs.md and ${runs.length} transcript(s)`);
    console.log(`  ${runs.length} agent runs · ${mmss(totalSecs)} wall · ${fmt(totalTokens)} tokens · £0`);
    if (openProposals.length) console.log(`  ${openProposals.length} proposal(s) awaiting a decision`);
}

if (require.main === module) build();
module.exports = { summarise, sessionFiles, renderTranscript };
