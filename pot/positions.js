#!/usr/bin/env node
// `npm run pot-book` — derive the pot's own book from the two places that already record it.
//
// Nothing here is hand-maintained. Leo records a decision where he records every other trade,
// in Tradelog.xlsx, by putting the proposal id in the `Pot` column; the thesis being tested is
// in the proposal file the id names. So this reads holdings.json (extracted from the workbook)
// and pot/proposals/*.md, and writes pot/positions.json.
//
// Why derive rather than maintain: a second ledger is a second thing to forget. The pot went
// nine proposals and two days with an empty positions.json precisely because keeping it current
// was a separate act of bookkeeping nobody had a reason to perform.
//
// A proposal's state is therefore a FACT about the workbook, not an opinion:
//
//   accepted  a pot trade names this proposal id
//   expired   no trade, and the order's day limit is no longer reachable at today's price
//   open      no trade yet, and the order could still be placed
//
// "Rejected" is deliberately absent. Not buying something is not an event, and inventing a
// ceremony for it would mean a decision to record every time the answer is no.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const p = f => path.join(ROOT, f);
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(p(f), 'utf8')); } catch { return d; } };

// ---------------------------------------------------------------- the proposal contract
//
// Parsed out of the markdown rather than duplicated into JSON, so the file a human reads and the
// record a machine checks cannot disagree. Anything absent comes back null and is reported as a
// gap; guessing a falsifier would be worse than admitting the proposal did not carry one.
const CCY = /(?:£|GBP|\$|USD|CHF|HK\$|HKD|€|EUR)/;

function parseProposal(file) {
    let md;
    try { md = fs.readFileSync(p('pot/proposals/' + file), 'utf8'); } catch { return null; }
    const section = n => {
        // `$` cannot end this: the `m` flag makes it match every LINE end, so the lazy group
        // matched nothing at all. `(?![\s\S])` is the real end of the string.
        const m = md.match(new RegExp('^## ' + n + '\\.[^\\n]*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))', 'm'));
        return m ? m[1].trim() : '';
    };
    const order = section(1);
    const falsifier = section(3);
    const line = (body, label) => {
        const m = body.match(new RegExp('\\*\\*' + label + ':?\\*\\*[:\\s]*([\\s\\S]*?)(?=\\n\\*\\*|$)', 'i'));
        return m ? m[1].replace(/\s+/g, ' ').trim() : null;
    };
    // A day limit is the only part of an order that can go stale on its own. The decimals are
    // matched explicitly so the full stop ending the sentence is not swallowed: "@ $220.00."
    // captured as "220.00." and Number() turned it into NaN.
    const limit = (order.match(new RegExp('day\\s+limit\\s*@?\\s*' + CCY.source + '?\\s*([\\d,]+(?:\\.\\d+)?)', 'i')) || [])[1];
    // Proposals write the review date either way round, so normalise to ISO — a date the Review
    // lane cannot compare is the same as no date at all.
    const s4 = section(4);
    const iso = (s4.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1];
    const words = (s4.match(/\b(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})\b/) || [])[1];
    const reviewBy = iso || (words && !isNaN(Date.parse(words))
        ? new Date(words + ' UTC').toISOString().slice(0, 10) : null);
    return {
        ticker: file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}(-\d{4})?-/, ''),
        written: file.slice(0, 10),
        side: /\bSELL\b/.test(order) ? 'SELL' : 'BUY',
        limit: limit ? Number(limit.replace(/,/g, '')) : null,
        // Two tiers since 30 Aug. Older proposals carry one unlabelled paragraph; keep it as the
        // break, because that is what a single-threshold falsifier always meant.
        warning: line(falsifier, 'Warning'),
        break: line(falsifier, 'Break') || (falsifier && !/\*\*Warning/i.test(falsifier)
            ? falsifier.replace(/\s+/g, ' ').trim() : null),
        reviewBy,
    };
}

// ---------------------------------------------------------------- what the workbook says
//
// Every trade whose Pot column is set. `pot` holds the proposal id, or "Y" where there is no
// proposal behind it (the §11.1 standing order buys VUAG without one).
function potTrades(holdings) {
    const out = [];
    for (const h of holdings || []) {
        for (const t of h.trades || []) {
            if (!t.pot) continue;
            out.push({ ...t, yahoo: h.yahoo, group: h.group, currency: t.currency || h.currency });
        }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Shares and cost per instrument, from the pot's trades alone. The workbook's own running
// balance is the whole book's, so it cannot be used here.
function potHoldings(trades) {
    const book = {};
    for (const t of trades) {
        const b = book[t.yahoo] || (book[t.yahoo] = { qty: 0, cost: 0, currency: t.currency, trades: [] });
        const signed = t.side === 'SELL' ? -t.qty : t.qty;
        b.qty += signed;
        b.cost += signed * t.price;
        b.trades.push({ date: t.date, side: t.side, qty: t.qty, price: t.price, pot: t.pot });
    }
    for (const k of Object.keys(book)) if (Math.abs(book[k].qty) < 1e-9) delete book[k];
    return book;
}

function build({ today = new Date().toISOString().slice(0, 10) } = {}) {
    // Pot trades live in the sealed half (vault.js, D67). Unopenable means no trades, and the book
    // would silently read as unfunded — so refuse instead.
    const vaulted = require('../vault').readHoldings(p('holdings.json'));
    if (!vaulted.full) throw new Error('holdings.json is sealed and no passphrase is available (.holdings-key or HOLDINGS_KEY)');
    const holdings = vaulted.holdings;
    const quotes = read('prices.json')?.quotes || {};
    const prev = read('pot/positions.json', {});

    const trades = potTrades(holdings);
    const claimed = new Set(trades.map(t => t.pot).filter(x => x && x !== 'Y'));

    let files = [];
    // A `-ranking.md` is the run's report, not a proposal: parsed as one it became ticker "ranking",
    // counted as a live decision and was marked on the paper page.
    try { files = fs.readdirSync(p('pot/proposals')).filter(f => f.endsWith('.md') && !f.endsWith('-ranking.md')).sort().reverse(); }
    catch { /* none yet */ }

    const proposals = files.map(file => {
        const parsed = parseProposal(file);
        if (!parsed) return null;
        const id = file.replace(/\.md$/, '');
        const trade = trades.find(t => t.pot === id);
        let state = 'open';
        if (trade) state = 'accepted';
        else if (parsed.limit != null && parsed.side === 'BUY') {
            // A buy limit that today's price has left behind cannot be filled as written. That is
            // not a rejection - it is an order that expired, and it needs re-proposing, not
            // executing at a price nobody agreed to.
            const px = quotes[parsed.ticker]?.price;
            if (px != null && px > parsed.limit) state = 'expired';
        }
        return {
            file, id, state, ...parsed,
            ...(trade ? { executed: { date: trade.date, qty: trade.qty, price: trade.price } } : {}),
        };
    }).filter(Boolean);

    // Thirteen proposals, three decisions: NVDA six times, RSGN.SW six, GME once. Scoring every
    // FILE would read as a book that is 46% NVDA and 46% RSGN, measuring one judgement six times
    // and calling it six results. So the newest proposal for a ticker is the live one and the
    // earlier ones are marked superseded — kept and readable, not counted.
    //
    // Deleting them would be worse than double-counting. Choosing which proposals to keep after
    // their outcomes are visible is how a track record gets faked, however honest the intent.
    const newestFor = new Map();
    for (const p of proposals) {
        if (p.state === 'accepted') continue;              // an executed thesis is never superseded
        const seen = newestFor.get(p.ticker);
        if (!seen || p.id > seen) newestFor.set(p.ticker, p.id);
    }
    // Everything written before the pot had money is a test-phase artefact: the rules were still
    // moving under it (no two-tier falsifier, no P3-answers-P6, RSGN's percentile still carrying
    // the SPAC it listed through). Judging the experiment on those would judge the scaffolding.
    const funded = (prev.contributions || []).map(c => c.date).sort()[0] || null;
    for (const p of proposals) {
        const live = newestFor.get(p.ticker);
        p.supersededBy = p.state !== 'accepted' && live && live !== p.id ? live : null;
        p.phase = !funded || p.written < funded ? 'pre-live' : 'live';
        // One entry per decision, and only from the phase that is being judged.
        p.counts = !p.supersededBy && p.phase === 'live';
    }

    const book = potHoldings(trades);
    const contributions = prev.contributions || [];
    const paidIn = contributions.reduce((a, c) => a + (c.amountGBP || 0), 0);
    // Cash = paid in, less what the pot spent, plus what it sold — converted at TODAY's rates.
    //
    // This used to carry the previous balance forward once anything was bought, on the grounds
    // that converting needed rates "this file does not fetch". It does not need to fetch them:
    // prices.json already holds them and CI refreshes it every few minutes. The consequence of
    // not doing this was live from the pot's first trade — 3 MWA at $23.76 left cashGBP reading
    // £500.00 when £52.73 had gone, so the next Deep dive would have sized against money that
    // was no longer there.
    //
    // Today's rates, not the trade date's: this is "what is the balance now", not a cost basis.
    // The error is a few pence on a £50 ticket and it is the same convention prices.json uses
    // everywhere else. Rates are USD per unit, so GBP = amount x rates[ccy] / rates.GBP.
    //
    // ponytail: commission is NOT deducted — extract-portfolio.js does not carry it onto a trade.
    // Zero on T212, which is where the pot trades by default (§10), and wrong by roughly $1 an
    // order on IBKR. Fix it by adding commission to the extracted trade if that ever matters.
    let rates = null;
    try { rates = JSON.parse(fs.readFileSync('prices.json', 'utf8')).rates || null; } catch { /* no rates */ }
    const toGBP = (amt, ccy) => {
        if (!rates || !rates[ccy] || !rates.GBP) return null;
        return amt * rates[ccy] / rates.GBP;
    };
    let spent = 0, unconverted = [];
    for (const b of Object.values(book)) {
        for (const t of b.trades) {
            const signed = (t.side === 'SELL' ? -1 : 1) * t.qty * t.price;
            const gbp = toGBP(signed, b.currency);
            if (gbp == null) unconverted.push(b.currency); else spent += gbp;
        }
    }
    // A currency prices.json cannot price must not silently vanish from the balance. Fall back to
    // carrying the previous number and say so, rather than reporting a total that is quietly wrong.
    const cashGBP = unconverted.length ? (prev.cashGBP ?? paidIn)
        : Math.round((paidIn - spent) * 100) / 100;
    if (unconverted.length) {
        console.log(`  cash carried forward: no rate for ${[...new Set(unconverted)].join(', ')}`);
    }

    return {
        note: 'Derived by `npm run pot-book` from Tradelog.xlsx (via holdings.json) and '
            + 'pot/proposals/. Do not hand-edit: contributions are the only field written here by a human.',
        generated: new Date().toISOString(),
        cashGBP,
        contributions,
        holdings: book,
        proposals,
        open: proposals.filter(x => x.state === 'accepted').map(x => x.id),
        today,
    };
}

if (require.main === module) {
    const out = build();
    fs.writeFileSync(p('pot/positions.json'), JSON.stringify(out, null, 1) + '\n');
    const by = s => out.proposals.filter(x => x.state === s).length;
    const live = out.proposals.filter(x => !x.supersededBy).length;
    const counting = out.proposals.filter(x => x.counts).length;
    console.log(`wrote pot/positions.json: ${Object.keys(out.holdings).length} holding(s), `
        + `${out.proposals.length} proposal(s) — ${by('accepted')} accepted, ${by('open')} open, ${by('expired')} expired`);
    console.log(`  ${live} live decision(s), ${out.proposals.length - live} superseded, `
        + `${counting} scored (the rest are pre-live)`);
    const noFalsifier = out.proposals.filter(x => x.state === 'accepted' && !x.break);
    if (noFalsifier.length) console.log(`  ${noFalsifier.length} accepted proposal(s) carry no break condition: `
        + noFalsifier.map(x => x.id).join(', '));
}

module.exports = { build, parseProposal, potTrades, potHoldings };

// ---------------------------------------------------------------- selftest
if (process.argv.includes('--selftest')) {
    const assert = require('assert');

    // The section regex is the whole file's foundation and it was wrong in a way that returned
    // "" rather than throwing: with the `m` flag, `$` matches every LINE end, so a lazy group
    // ending in `(?=\n## |$)` matched nothing at all. Every field came back null and the book
    // looked merely empty rather than broken.
    const md = ['model: x', '', '# T — Thing', '', '## 1. Order', '',
        '**BUY T on Nasdaq, £100 notional, day', 'limit @ $220.00. Do not chase.**', '',
        '## 3. Falsifier', '**Warning:** margin below the guided 73.5% floor.',
        '**Break:** margin below 70.0%.', '', '## 4. Review date', '',
        '**20 November 2026**, after results.', '', '## 6. The case against', 'x'].join('\n');
    const tmp = require('path').join(require('os').tmpdir(), '2026-08-30-1330-T.md');
    fs.writeFileSync(tmp, md);
    const realRoot = ROOT;
    // parseProposal reads from pot/proposals; point it at the fixture by name instead.
    const parsed = (() => {
        const orig = fs.readFileSync;
        fs.readFileSync = (f, e) => String(f).endsWith('2026-08-30-1330-T.md') ? md : orig(f, e);
        try { return parseProposal('2026-08-30-1330-T.md'); } finally { fs.readFileSync = orig; }
    })();
    assert.strictEqual(parsed.ticker, 'T');
    assert.strictEqual(parsed.side, 'BUY');
    // The sentence's full stop must not be swallowed into the number.
    assert.strictEqual(parsed.limit, 220, `limit parsed as ${parsed.limit}`);
    assert.strictEqual(parsed.reviewBy, '2026-11-20', `reviewBy parsed as ${parsed.reviewBy}`);
    assert.ok(/73\.5/.test(parsed.warning), 'warning tier not read');
    assert.ok(/70\.0/.test(parsed.break), 'break tier not read');
    assert.ok(!/Warning/.test(parsed.break), 'break swallowed the warning');

    // A pre-30-Aug proposal has one unlabelled paragraph. That is a break, not a warning.
    const old = md.replace('**Warning:** margin below the guided 73.5% floor.\n**Break:** margin below 70.0%.',
        'The thesis is false if margin falls below 70.0%.');
    const p2 = (() => {
        const orig = fs.readFileSync;
        fs.readFileSync = () => old;
        try { return parseProposal('x.md'); } finally { fs.readFileSync = orig; }
    })();
    assert.strictEqual(p2.warning, null, 'invented a warning tier that was never written');
    assert.ok(/70\.0/.test(p2.break), 'single-paragraph falsifier lost');

    // Pot trades are separated by the workbook column, and a sold-out line leaves no holding.
    const held = [{ yahoo: 'NVDA', currency: 'USD', trades: [
        { date: '2026-09-01', side: 'BUY', qty: 1, price: 200, pot: '2026-08-30-1330-NVDA' },
        { date: '2026-09-02', side: 'BUY', qty: 3, price: 100 },                       // main book
    ] }, { yahoo: 'GME', currency: 'USD', trades: [
        { date: '2026-09-01', side: 'BUY', qty: 2, price: 10, pot: 'Y' },
        { date: '2026-09-03', side: 'SELL', qty: 2, price: 12, pot: 'Y' },
    ] }];
    const trades = potTrades(held);
    assert.strictEqual(trades.length, 3, 'main-book trades leaked into the pot');
    const book = potHoldings(trades);
    assert.strictEqual(book.NVDA.qty, 1);
    assert.ok(!('GME' in book), 'a closed position is still on the book');

    // Superseding collapses files to decisions, and must never touch an executed thesis.
    {
        const mk = (id, ticker, state) => ({ id, ticker, state });
        const rows = [mk("2026-08-30-2257-NVDA","NVDA","open"), mk("2026-08-28-NVDA","NVDA","open"),
                      mk("2026-08-29-GME","GME","accepted"), mk("2026-08-30-GME","GME","open")];
        const newest = new Map();
        for (const r of rows) { if (r.state === "accepted") continue;
            const seen = newest.get(r.ticker); if (!seen || r.id > seen) newest.set(r.ticker, r.id); }
        const supersededBy = r => r.state !== "accepted" && newest.get(r.ticker) !== r.id ? newest.get(r.ticker) : null;
        assert.strictEqual(supersededBy(rows[0]), null, "newest proposal was superseded");
        assert.strictEqual(supersededBy(rows[1]), "2026-08-30-2257-NVDA", "older one not superseded");
        assert.strictEqual(supersededBy(rows[2]), null, "an EXECUTED thesis must never be superseded");
    }

    console.log('selftest ok');
}
