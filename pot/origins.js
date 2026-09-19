#!/usr/bin/env node
// `npm run pot-report` writes this: why each watchlist name is on the list, in the words of the
// Sweep that found it.
//
// The funnel measured on 19 Sep: 75 Sweep discoveries, 27 in the cheapest decile today, 10 ever
// proposed. Sweep candidates lead with macro, a thesis, or a gap in Leo's book about three times
// as often as with valuation - Hormuz insurance, tourists redirected to Korea, an EU isotope
// bottleneck - but the Deep dive ranks only names that clear §2.4, judges them on valuation and
// quality, and never sees the original case: it reads the NEWEST sweep, and by the time a name is
// cheap enough to rank, the sweep that found it is weeks back. So the reason a name is on the list
// at all gets lost exactly where it should be weighed (D78).
//
// Derived, never declared: the date and lane come from git (discoveries), the wording from the
// sweep file itself. Nothing here is written by an agent about its own work (A20).
const fs = require('fs');
const path = require('path');
const { discoveries } = require('./discoveries');

const ROOT = path.resolve(__dirname, '..');
const p = f => path.join(ROOT, f);
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(p(f), 'utf8')); } catch { return d; } };

// A candidate table row is `| 1 | **TICKER — Name** | Exchange | why | what would have to be true |`,
// but the column order has moved over the weeks and older sweeps wrote prose lists. So: find the
// cell that names a ticker we actually track, and take the longest remaining cell as the case.
// Anything else would be guessing at a layout that has already changed twice.
const TICKER = /\b([A-Z][A-Z0-9]{0,5}(?:[.\-][A-Z]{1,3})?|\d{3,6}\.(?:HK|T|KS|JK|SW|PA|DE|L|MI|AS|OL|CO|HE|ST|VI|BK))\b/g;

// Only the CANDIDATES table: a sweep also carries a data-wishlist table, a sources table and the
// reading notes, and every one of them mentions tickers. The first cut took the longest cell in any
// table row and gave EUZ.DE a sentence about Yahoo snapshots from the wishlist. The candidate table
// is the one whose header says Ticker and Why; rows are taken until the table ends.
function candidateRows(md) {
    const lines = md.split('\n');
    const out = [];
    let inTable = false;
    for (const l of lines) {
        const isRow = l.trim().startsWith('|');
        if (!isRow) { inTable = false; continue; }
        const head = l.toLowerCase();
        if (/\|\s*ticker\s*\|/.test(head) && /why/.test(head)) { inTable = true; continue; }
        if (inTable && (l.match(/\|/g) || []).length >= 4 && !/^\s*\|[\s:|-]+\|\s*$/.test(l)) out.push(l);
    }
    return out;
}

// The prose fallback, for sweeps written before the candidate table existed. Restricted to the
// CANDIDATES section: elsewhere a ticker appears in source notes and wishlist lines, and taking the
// longest line anywhere gave MWA "No order, price target or position size is implied" as its case.
function candidateProse(md, ticker) {
    const names = l => new RegExp(`(^|[^A-Z0-9.])${ticker.replace(/[.\-]/g, '\\$&')}([^A-Z0-9.]|$)`).test(l);
    const clean = l => l.replace(/^[-*>\s|]+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim();
    const lines = md.split('\n');
    let inSection = false, underOwnHeading = false;
    const own = [], mentions = [];
    for (const l of lines) {
        const heading = /^#{1,4}\s/.test(l);
        // Only # and ## change section: ### is a candidate's own heading inside the candidates list.
        if (heading && /^#{1,2}\s/.test(l)) inSection = /candidate/i.test(l);
        if (!inSection) continue;
        // Older sweeps give each candidate its own sub-heading and put the case in the paragraph
        // below it, where the ticker is never repeated: `### AER — AerCap Holdings, NYSE`.
        if (heading) { underOwnHeading = names(l); continue; }
        if (underOwnHeading && l.trim().length > 80) own.push(clean(l));
        if (names(l) && l.length > 80) mentions.push(clean(l));
    }
    return own[0] || mentions.sort((a, b) => b.length - a.length)[0] || null;
}

function parseSweep(md, known) {
    const out = [];
    for (const line of candidateRows(md)) {
        const cells = line.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
        if (!cells.length || /^-+$/.test(cells[0])) continue;
        let ticker = null, tickerCell = -1;
        for (let i = 0; i < cells.length && !ticker; i++) {
            const plain = cells[i].replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
            for (const m of plain.matchAll(TICKER)) if (known.has(m[1])) { ticker = m[1]; tickerCell = i; break; }
        }
        if (!ticker) continue;
        const why = cells.filter((c, i) => i !== tickerCell)
            .map(c => c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim())
            .sort((a, b) => b.length - a.length)[0] || '';
        if (why.length < 40) continue;                       // a header or a figure, not a case
        out.push({ ticker, why: why.slice(0, 400) });
    }
    return out;
}

function build() {
    const known = new Set([
        ...(read('watchlist.json', []) || []).map(w => w.yahoo),
        ...((read('holdings.json', {}) || {}).holdings || []).map(h => h.yahoo),
    ].filter(Boolean));
    const found = discoveries(ROOT);
    const sweeps = fs.readdirSync(p('pot/sweeps')).filter(f => f.endsWith('.md')).sort();   // oldest first
    const why = new Map();
    for (const f of sweeps) {
        const md = fs.readFileSync(p('pot/sweeps/' + f), 'utf8');
        // Newest wins: a re-look is the more current case for the same name.
        for (const row of parseSweep(md, known)) why.set(row.ticker, { why: row.why, file: 'pot/sweeps/' + f });
    }
    const origins = {};
    for (const t of known) {
        const d = found.get(t);
        let w = why.get(t);
        // Older sweeps wrote prose, not tables: fall back to the longest sentence naming the ticker
        // in the sweep that found it, so a name found in August still carries a reason.
        if (!w && d?.lane === 'sweep' && d.date) {
            for (const f of sweeps.filter(f => f.startsWith(d.date))) {
                const line = candidateProse(fs.readFileSync(p('pot/sweeps/' + f), 'utf8'), t);
                if (line) { w = { why: line, file: 'pot/sweeps/' + f }; break; }
            }
        }
        if (!d && !w) continue;
        origins[t] = {
            lane: d?.lane || 'sweep',
            date: d?.date || null,
            ...(w ? { file: w.file, why: w.why } : {}),
        };
    }
    return { updated: new Date().toISOString(), origins };
}

if (require.main === module && process.argv.includes('--selftest')) {
    const assert = require('assert');
    const known = new Set(['WRT1V.HE', '6936.HK', 'NKE']);
    const md = [
        '| # | Ticker | Exchange | Why | What would have to be true |',
        '|---|---|---|---|---|',
        '| 1 | **WRT1V.HE — Wärtsilä** | Helsinki | All-time-high H1 order intake of EUR 4,934m, and service is half of it, which is the part that repeats | Orders hold through the cycle |',
        '| 2 | **6936.HK — SF Holding** | Hong Kong | Cross-border logistics benefits from trade rerouting and the starting valuation is undemanding at 11.67x trailing earnings | Volumes hold |',
    ].join('\n');
    const rows = parseSweep(md, known);
    assert.strictEqual(rows.length, 2, 'both candidate rows parsed');
    assert.strictEqual(rows[0].ticker, 'WRT1V.HE');
    assert.ok(rows[0].why.startsWith('All-time-high H1 order intake'), 'the case is the why cell, not the exchange');
    assert.strictEqual(parseSweep(md, new Set(['AAPL'])).length, 0, 'a ticker we do not track is not an origin');
    // A header row and a short cell are not cases.
    assert.strictEqual(parseSweep('| # | Ticker | Exchange |\n|---|---|---|\n| 1 | NKE | NYSE |', known).length, 0);
    // The prose fallback reads the candidates section and nothing else.
    const prose = ['## 2. Leo\'s reading', 'Sources checked: Yahoo Finance confirmed NKE and nothing else was priced here today, at length.',
        '## 3. Candidates', '- NKE at $36.80 against a 52-week range of $36.55-$76.97: a brand he can judge first-hand and a price that has halved.',
        '## 4. What I wanted', 'NKE monthly sales data would have helped here, and it is not something this repo carries at all.'].join('\n');
    assert.ok(candidateProse(prose, 'NKE').startsWith('NKE at $36.80'), 'takes the candidates section, not the sources note');
    // A candidate with its own sub-heading: the case is the paragraph under it, which never repeats the ticker.
    const headed = ['## 3. Candidates', '### AER — AerCap Holdings, NYSE',
        'Aircraft leasing at a discount to book while lease rates are still rising, and the fleet is young enough to matter here.',
        '### KSB3.DE — KSB SE, Xetra', 'A pump maker whose service book is the half that repeats, and it trades below its own five-year average.'].join('\n');
    assert.ok(candidateProse(headed, 'AER').startsWith('Aircraft leasing'), 'reads the paragraph under the candidate heading');
    assert.ok(candidateProse(headed, 'KSB3.DE').startsWith('A pump maker'), 'and the right one for the second candidate');
    assert.strictEqual(candidateProse('## 3. Candidates\nNothing today.', 'NKE'), null, 'no line, no case');
    console.log('selftest ok');
} else if (require.main === module) {
    const out = build();
    fs.writeFileSync(p('pot/origins.json'), JSON.stringify(out, null, 1) + '\n');
    const withWhy = Object.values(out.origins).filter(o => o.why).length;
    console.log(`wrote pot/origins.json — ${Object.keys(out.origins).length} names, ${withWhy} with the Sweep's own wording`);
}

module.exports = { parseSweep, build };
