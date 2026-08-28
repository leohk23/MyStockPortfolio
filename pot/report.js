#!/usr/bin/env node
// `npm run pot-report` — what every lane did, and what it cost.
//
// D12: judgement is measured by the return, so what gets recorded here is PROVENANCE. If the
// model changes, or this ever moves to metered API credits, a 24-month record spanning two
// systems has to be separable afterwards — and it only can be if the stamp was taken at the time.
//
// Two lanes, two very different sources:
//   Scan   — signals.json. Free, deterministic, no session, no tokens.
//   Agent  — Codex writes a full JSONL transcript per session under ~/.codex/sessions/. That file
//            is the authority on model and token usage; the agent's own header is NOT, because a
//            model cannot see its own accounting (every proposal so far says "tokens: unknown").
//
// Writes pot/runs.md, newest first, and leaves the transcripts where they are — they are large
// (~1MB a session) and belong outside the repo.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

// Every rollout-*.jsonl under the sessions tree, newest first.
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

// Pull one run's facts out of a transcript. Everything here is read from the log rather than
// from anything the agent said about itself.
function summarise(file) {
    let lines;
    try {
        lines = fs.readFileSync(file, 'utf8').trim().split('\n')
            .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return null; }
    if (!lines.length) return null;

    const blob = JSON.stringify(lines);
    const started = lines[0].timestamp || null;
    const ended = lines[lines.length - 1].timestamp || null;
    // The model as the runtime recorded it, not as the agent described itself.
    const model = (blob.match(/"model":"([^"]+)"/) || [])[1] || null;
    // Cumulative usage is the last total_token_usage in the file.
    const totals = [...blob.matchAll(/"total_token_usage":(\{[^}]*\})/g)].pop();
    const usage = totals ? JSON.parse(totals[1]) : null;
    // Which brief was this? The instruction names it.
    const brief = (blob.match(/pot[\\/]brief-([a-z-]+)\.md/) || [])[1] || null;
    const cwdMatch = blob.match(/"cwd":"([^"]+)"/);

    return {
        file, started, ended, model, brief,
        lane: brief ? brief.replace(/-/g, ' ') : 'unknown',
        seconds: started && ended ? Math.round((Date.parse(ended) - Date.parse(started)) / 1000) : null,
        usage,
        repo: cwdMatch ? cwdMatch[1].includes('MyStockPortfolio') : false,
    };
}

const fmt = n => n == null ? '–' : n.toLocaleString();
const mmss = s => s == null ? '–' : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;

function build() {
    const runs = sessionFiles(SESSIONS).map(summarise).filter(r => r && r.repo && r.brief);
    runs.sort((a, b) => (b.started || '').localeCompare(a.started || ''));

    const sig = (() => { try { return JSON.parse(fs.readFileSync('signals.json', 'utf8')); } catch { return null; } })();

    const rows = runs.map(r => {
        const u = r.usage || {};
        // Fresh input is what a metered API would actually bill; cached reads are the rest.
        const fresh = (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0);
        return `| ${(r.started || '').slice(0, 16).replace('T', ' ')} | ${r.lane} | \`${r.model || '?'}\` `
            + `| ${mmss(r.seconds)} | ${fmt(fresh)} | ${fmt(u.cached_input_tokens)} | ${fmt(u.output_tokens)} `
            + `| ${fmt(u.total_tokens)} |`;
    });

    const totalTokens = runs.reduce((a, r) => a + (r.usage?.total_tokens || 0), 0);
    const totalFresh = runs.reduce((a, r) => a + ((r.usage?.input_tokens ?? 0) - (r.usage?.cached_input_tokens ?? 0)), 0);
    const totalSecs = runs.reduce((a, r) => a + (r.seconds || 0), 0);

    const md = `# Run ledger

Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by \`npm run pot-report\`.
Every figure is read from the Codex session transcripts under \`~/.codex/sessions/\`, never from
what an agent said about itself — a model cannot see its own token accounting, which is why every
proposal header so far reads "tokens: unknown".

## Cost

**Cash cost so far: £0.** Codex is authenticated against a ChatGPT subscription
(\`codex login status\` → "Logged in using ChatGPT"), so there is no per-token charge. What a run
actually spends is subscription allowance and wall-clock time.

The token columns are kept anyway, and they are the point of D12: if this ever moves to metered
API credits, these are the numbers that would be billed, and a run from before the switch stays
comparable with one after it. **Fresh** is input that was not served from cache — the part a
metered call would charge full rate for.

| total runs | wall time | fresh input | total tokens |
|---|---|---|---|
| ${runs.length} | ${mmss(totalSecs)} | ${fmt(totalFresh)} | ${fmt(totalTokens)} |

## Agent lanes

| started | lane | model | wall | fresh in | cached in | out | total |
|---|---|---|---|---:|---:|---:|---:|
${rows.join('\n') || '| – | no sessions found | | | | | | |'}

## Scan lane

Free, deterministic, no session and no tokens. It runs on every CI pass; the figures below are
from the last one recorded in \`signals.json\`.

${sig ? `| last run | prices as of | fired | instructions | quiet | blocked |
|---|---|---:|---:|---:|---:|
| ${(sig.generated || '').slice(0, 16).replace('T', ' ')} | ${(sig.pricesAt || '').slice(0, 16).replace('T', ' ')} | ${sig.fired?.length ?? 0} | ${sig.instructions?.length ?? 0} | ${sig.quiet?.length ?? 0} | ${sig.blocked?.length ?? 0} |`
        : '_No `signals.json` yet — run `npm run signals`._'}

## Transcripts

Full chat logs live outside the repo, one JSONL per session, about 1MB each:

\`\`\`
${SESSIONS.replace(/\\/g, '\\\\')}\\<year>\\<month>\\<day>\\rollout-*.jsonl
\`\`\`

\`codex resume\` reopens one interactively (\`--last\` for the most recent). They are deliberately
not committed: they are large, they carry full file contents, and the ledger above is the part
worth keeping.
`;
    fs.writeFileSync('pot/runs.md', md);
    console.log(`wrote pot/runs.md — ${runs.length} agent run(s), ${fmt(totalTokens)} tokens, ${mmss(totalSecs)} wall time`);
    for (const r of runs.slice(0, 8)) {
        console.log(`  ${(r.started || '').slice(0, 16).replace('T', ' ')}  ${r.lane.padEnd(10)} ${(r.model || '?').padEnd(13)} ${mmss(r.seconds).padStart(7)}  ${fmt(r.usage?.total_tokens).padStart(10)} tokens`);
    }
}

if (require.main === module) build();
module.exports = { summarise, sessionFiles };
