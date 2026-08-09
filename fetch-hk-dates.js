// When did our Hong Kong names actually announce their results?
//
//   npm run hkdates
//
// Yahoo gives no announcement dates for HK issuers, so everything downstream has been guessing:
// troughPe assumes a flat 90 days from fiscal year end to "public", and check-interim assumes a
// flat 60 days before an interim counts as overdue. Both are stand-ins for a fact that is
// published — and this is where it is published.
//
// SOURCE: webb-database.com, which continues the Webb-site Database built by David M Webb
// (1965-2026) and released by him under CC-BY 4.0. Attribution is a licence condition, not a
// courtesy: it is recorded in the output file and in the README. The original webb-site.com server
// was shut down on 31-Oct-2025.
//
// Scope, honestly: the reporting-speed table carries ONE row per company — its most recent annual
// and most recent interim. It is not a history, and the per-company pages do not carry one either,
// so this cannot backfill years of point-in-time dates. What it does give is each company's actual
// latest announcement and the lag it ran, which is enough to replace a flat guess with an observed
// one. A full history would need the SQL dump at github.com/renavondata/webbsite.
//
// Run by hand, never from CI: this is a third-party HTML page, it changes about twice a year per
// company, and the price pipeline must not acquire a dependency on someone else's markup.

const fs = require('fs');

const OUT = 'hk-results.json';
const BASE = 'https://webb-database.com/dbpub/reportspeed.asp';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MyStockPortfolio/1.0 (personal portfolio tool)';
const KINDS = { annual: 0, interim: 1 };
// The site's own Days column must equal (result date - record date). Checking it on every row is
// what makes a positional parse safe: if the columns ever move, this fails loudly instead of
// silently pairing one company's name with another's dates. An early version of this parser picked
// "the first 3-5 digit cell" as the stock code, matched the ROW NUMBER, and cheerfully reported CK
// Asset's dates against China Oil & Gas. Hence a hard gate rather than a warning.
const MIN_ALIGNED = 0.99;

const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// Row | Stock code | Name | Days | Record date | Result date — a fixed six-column table.
function parseRows(html) {
    const rows = [];
    for (const [, body] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => strip(c[1]));
        if (cells.length !== 6) continue;
        const [, code, name, days, end, announced] = cells;
        if (!/^\d{1,5}$/.test(code)) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(announced)) continue;
        rows.push({ code: code.padStart(4, '0'), name, days: Number(days), end, announced });
    }
    return rows;
}

const lag = r => Math.round((Date.parse(r.announced) - Date.parse(r.end)) / 864e5);
function alignedFraction(rows) {
    if (!rows.length) return 0;
    return rows.filter(r => lag(r) === r.days).length / rows.length;
}

// HK tickers we actually track, as four-digit codes.
function trackedCodes() {
    const held = JSON.parse(fs.readFileSync('holdings.json', 'utf8')).holdings.map(h => h.yahoo);
    const watched = JSON.parse(fs.readFileSync('watchlist.json', 'utf8')).map(w => w.yahoo);
    const codes = new Map();
    for (const y of [...held, ...watched]) {
        const m = /^(\d{1,5})\.HK$/.exec(y);
        if (m) codes.set(m[1].padStart(4, '0'), y);
    }
    return codes;
}

async function fetchKind(r) {
    const res = await fetch(`${BASE}?sort=daysup&e=a&r=${r}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRows(await res.text());
}

async function main() {
    const codes = trackedCodes();
    console.log(`${codes.size} Hong Kong ticker(s) tracked: ${[...codes.values()].sort().join(', ')}\n`);

    const out = {};
    for (const [kind, r] of Object.entries(KINDS)) {
        const rows = await fetchKind(r);
        const frac = alignedFraction(rows);
        console.log(`${kind.padEnd(8)} ${rows.length} rows parsed, `
            + `${(frac * 100).toFixed(1)}% with Days == announced - period end`);
        if (frac < MIN_ALIGNED)
            throw new Error(`${kind}: only ${(frac * 100).toFixed(1)}% of rows line up — the table layout `
                + `has probably changed. Refusing to write rather than risk pairing the wrong company.`);
        for (const row of rows) {
            const yahoo = codes.get(row.code);
            if (!yahoo) continue;
            (out[yahoo] ||= { name: row.name })[kind] = { end: row.end, announced: row.announced, days: row.days };
        }
    }

    const names = Object.keys(out).sort();
    console.log(`\nticker      latest annual                 latest interim`);
    for (const t of names) {
        const a = out[t].annual, i = out[t].interim;
        console.log(`  ${t.padEnd(10)} ${(a ? `${a.end} -> ${a.announced} (${a.days}d)` : '–').padEnd(30)}`
            + (i ? `${i.end} -> ${i.announced} (${i.days}d)` : '–'));
    }
    const lags = k => names.map(t => out[t][k]?.days).filter(Number.isFinite);
    const range = v => v.length ? `${Math.min(...v)}-${Math.max(...v)}d (mean ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}d)` : 'none';
    console.log(`\nannual lag:  ${range(lags('annual'))}`);
    console.log(`interim lag: ${range(lags('interim'))}`);

    fs.writeFileSync(OUT, JSON.stringify({
        _source: {
            what: 'Latest annual and interim RESULTS ANNOUNCEMENT dates for the Hong Kong names this '
                + 'book tracks. Dates only — this source carries no revenue, profit or EPS.',
            from: 'https://webb-database.com/dbpub/reportspeed.asp',
            credit: 'Webb-site Database, built by David M Webb (1965-2026) and released under CC-BY 4.0. '
                + 'webb-database.com continues it; the original webb-site.com server closed 31-Oct-2025.',
            licence: 'CC-BY 4.0',
            limits: 'One row per company — the most recent period only, not a history. Regenerate with '
                + '`npm run hkdates`; it is never fetched by CI.',
            fetched: new Date().toISOString(),
        },
        results: out,
    }, null, 1));
    console.log(`\nwrote ${OUT} (${names.length} ticker(s))`);
}

if (require.main === module) {
    if (process.argv.includes('--selftest')) {
        const assert = require('assert');
        const html = `<table>
          <tr><th>Row</th><th>Stock<br>code</th><th>Name</th><th>Days</th><th>Record date</th><th>Result date</th></tr>
          <tr><td>1</td><td class="x">1113</td><td><a href='orgdata.asp?p=1'>CK Asset Holdings Limited (KY)</a></td><td>78</td><td>2025-12-31</td><td>2026-03-19</td></tr>
          <tr><td>2</td><td>1</td><td><a href='#'>CK Hutchison &amp; Co</a></td><td>78</td><td>2025-12-31</td><td>2026-03-19</td></tr>
          <tr><td colspan="6">a spacer row</td></tr>
        </table>`;
        const rows = parseRows(html);
        assert.strictEqual(rows.length, 2);                     // header and spacer ignored
        assert.strictEqual(rows[0].code, '1113');
        assert.strictEqual(rows[0].name, 'CK Asset Holdings Limited (KY)');
        assert.strictEqual(rows[0].announced, '2026-03-19');
        assert.strictEqual(rows[1].code, '0001');               // padded, so "1" is CK Hutchison
        assert.strictEqual(rows[1].name, 'CK Hutchison & Co');  // entity decoded
        assert.strictEqual(alignedFraction(rows), 1);
        // The guard that matters: a row whose Days disagrees with its own dates drags the fraction
        // down, which is what a shifted column looks like.
        assert.ok(alignedFraction([...rows, { days: 5, end: '2025-12-31', announced: '2026-03-19' }]) < MIN_ALIGNED);
        assert.strictEqual(alignedFraction([]), 0);
        console.log('selftest ok');
    } else {
        main().catch(e => { console.error(`hk dates: ${e.message}`); process.exit(1); });
    }
}
