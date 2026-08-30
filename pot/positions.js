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
    const holdings = read('holdings.json')?.holdings || [];
    const quotes = read('prices.json')?.quotes || {};
    const prev = read('pot/positions.json', {});

    const trades = potTrades(holdings);
    const claimed = new Set(trades.map(t => t.pot).filter(x => x && x !== 'Y'));

    let files = [];
    try { files = fs.readdirSync(p('pot/proposals')).filter(f => f.endsWith('.md')).sort().reverse(); }
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

    const book = potHoldings(trades);
    const contributions = prev.contributions || [];
    const paidIn = contributions.reduce((a, c) => a + (c.amountGBP || 0), 0);
    // Cost is in each trade's own currency; converting needs rates this file does not fetch, so
    // cash is only computed once a rate table is passed in. Until the pot is funded it is 0 and
    // saying so is honest - inventing a converted balance would not be.
    const cashGBP = prev.cashGBP ?? 0;

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
    console.log(`wrote pot/positions.json: ${Object.keys(out.holdings).length} holding(s), `
        + `${out.proposals.length} proposal(s) — ${by('accepted')} accepted, ${by('open')} open, ${by('expired')} expired`);
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

    console.log('selftest ok');
}
