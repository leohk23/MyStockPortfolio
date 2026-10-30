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
//   withdrawn the Deep dive's second reader took it back before Leo saw it (D95)
//   obsolete  written before the pot was funded and never bought (D97): free to be proposed again
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
const CCY = /(?:US\$|HK\$|£|GBP|\$|USD|CHF|HKD|€|EUR|¥|JPY)/;

// A day limit is the only part of an order that can go stale on its own. Proposals phrase it
// "day limit @ $220.00", "limit $102.40" or "limit €26.03 per share"; requiring "day limit" read
// none of the last two, so 13 of 20 scored rows could never expire (Review, 8 Oct 2026). The
// decimals are matched explicitly so a sentence's full stop is not swallowed: "@ $220.00."
// captured as "220.00." and Number() turned it into NaN.
function limitOf(order) {
    const m = String(order || '').match(new RegExp('\\blimit(?:\\s+price)?(?:\\s+of)?\\s*@?\\s*\\**\\s*'
        + CCY.source + '?\\s*(\\d[\\d,]*(?:\\.\\d+)?)', 'i'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
}

const WITHDRAWN = /\*\*Withdrawn by the second reader:?\*\*[:\s]*([^\n]+)/i;   // D95

// D99: a proposal sits at pot/proposals/ while current and in archive/ once dead; its id is its file
// name either way, so a Tradelog `Pot` cell and every positions.json reference survive a move.
const ARCHIVE = 'pot/proposals/archive';
const proposalPath = file => fs.existsSync(p('pot/proposals/' + file)) ? p('pot/proposals/' + file) : p(ARCHIVE + '/' + file);

function parseProposal(file) {
    let md;
    try { md = fs.readFileSync(proposalPath(file), 'utf8'); } catch { return null; }
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
    const limit = limitOf(order);
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
        limit,
        // Two tiers since 30 Aug. Older proposals carry one unlabelled paragraph; keep it as the
        // break, because that is what a single-threshold falsifier always meant.
        warning: line(falsifier, 'Warning'),
        break: line(falsifier, 'Break') || (falsifier && !/\*\*Warning/i.test(falsifier)
            ? falsifier.replace(/\s+/g, ' ').trim() : null),
        reviewBy,
        // Why a name is proposed again inside its two weeks (D93): new results or a filing, or a
        // changed case. A cheaper limit needs no line; the arithmetic below checks it.
        reproposed: (md.match(/\*\*Re-proposed:?\*\*[:\s]*([^\n]+)/i) || [])[1]?.trim() || null,
        // D95: the examiner took it back before it reached Leo. The file and its text are kept.
        withdrawn: (md.match(WITHDRAWN) || [])[1]?.trim() || null,
        // P6's one risk, with its label: written "(`financial`)" or "(financial)" (117 proposals).
        // To the end of its paragraph, not its line: some proposals wrap it, and BN.PA's read
        // "...so the +3% to +5%" when cut at the newline.
        dominantRisk: (m => m ? { category: m[1].toLowerCase(), text: m[2].replace(/\s+/g, ' ').trim() } : null)(
            md.match(/\*\*Dominant risk \(`?([a-z]+)`?\):?\*\*[:\s]*([\s\S]*?)(?=\n\s*\n|\n\*\*|\n## |\n```|(?![\s\S]))/i)),
        // D94: how this proposal answers the risks earlier proposals of the same name named.
        earlierRisks: (md.match(/\*\*Earlier risks:?\*\*[:\s]*([\s\S]*?)(?=\n\*\*|\n## |\n```|(?![\s\S]))/i) || [])[1]
            ?.replace(/\s+/g, ' ').trim() || null,
    };
}

// ---------------------------------------------------------------- earlier risks (D94)
//
// The Deep dive found Halma's real risk on 16 Oct: one hyperscaler, 20% of group revenue, and a
// falsifier on photonics growth. Each later run started from scratch (D15 tells it to ignore earlier
// drafts), framed the risk as cash against acquisitions, searched only that, and by 23 Oct the
// proposal did not mention the customer at all. A finding one run makes has to bind the next.
//
// So a proposal for a name proposed before must answer every DISTINCT dominant risk an earlier
// proposal named, one per label (financial, competitive, secular, accounting, regulatory): still
// the dominant one, demoted and why, or retired and on what evidence. Every label, not just the last
// proposal's, because answering only the last one lets one weak run break the chain: 24 Oct would
// have answered 23 Oct, which never mentioned photonics. This collects them, newest text per label
// with the falsifier its proposal wrote, and marks a proposal whose **Earlier risks:** block leaves
// a label out. The judgement inside the answer is the lane's; only its presence is checked.
function riskHistory(proposals, rejected = new Set()) {
    const byTicker = new Map(), missing = new Map();
    for (const p of [...proposals].sort((a, b) => a.id.localeCompare(b.id))) {
        const risks = byTicker.get(p.ticker) || new Map();
        if (p.written >= REPROPOSE_FROM && risks.size) {
            const said = (p.earlierRisks || '').toLowerCase();
            const gaps = [...risks].filter(([c]) => !new RegExp('\\b' + c + '\\b').test(said));
            if (gaps.length) missing.set(p.id, gaps.map(([category, r]) => ({ category, id: r.id })));
        }
        // Its falsifier is that proposal's own `warning` and `break`, in `proposals` beside this:
        // copying the text here added 35KB to a file every Deep dive turn resends.
        if (p.dominantRisk) risks.set(p.dominantRisk.category, { text: p.dominantRisk.text, id: p.id });
        byTicker.set(p.ticker, risks);
    }
    const history = {};
    for (const [ticker, risks] of byTicker) {
        if (risks.size && !rejected.has(ticker)) history[ticker] = [...risks].map(([category, r]) => ({ category, ...r }));
    }
    return { history, missing };
}

// ---------------------------------------------------------------- the re-proposal rule (D93)
//
// 156 proposals to 23 Oct 2026, 10 acted on: MWA was proposed 34 times, BN.PA 13 (every one
// expired), YUMC 13 before Leo rejected it, and the last fortnight was 27 proposals on 6 names. Each
// repeat is a full Deep dive re-arguing a name Leo has already seen. So, Leo's numbers: for TWO WEEKS
// after a name's last buy proposal, a fresh one needs a limit at least 5% below that one, or new
// results or a filing since, or a changed case, stated in a `**Re-proposed:**` line. Otherwise the
// ranking says STANDS and points at the proposal already written. Ranking itself stays blind (D15).
//
// Worked out here rather than by the lane, because it is arithmetic on limits in each listing's own
// units (pence for London) and a lane doing it by hand is how a 100x slips in. The lane reads
// `cooldown`; the report flags a proposal that broke the rule. Only proposals written from the day
// the rule began are judged: the history before it was written under D15 and is not a breach.
const REPROPOSE_DAYS = 14, REPROPOSE_DROP = 0.05, REPROPOSE_FROM = '2026-10-26';
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// A reason that is not price must name what changed; "price" alone is checked against the bar.
const REASON = /result|filing|10-[KQ]|20-F|annual report|interim|guidance|announce|case|thesis|falsifier/i;

function reproposalRule(proposals, today, rejected = new Set()) {
    // A proposal the second reader withdrew never reached Leo, so it opens no window (D95).
    const buys = proposals.filter(p => p.side === 'BUY' && p.state !== 'withdrawn').sort((a, b) => a.id.localeCompare(b.id));
    const last = new Map(), breaches = new Map();
    for (const p of buys) {
        const q = last.get(p.ticker);
        if (q && p.written < addDays(q.written, REPROPOSE_DAYS) && p.written >= REPROPOSE_FROM) {
            const bar = q.limit != null ? Number((q.limit * (1 - REPROPOSE_DROP)).toFixed(4)) : null;
            const cheaper = bar != null && p.limit != null && p.limit <= bar;
            if (!cheaper && !(p.reproposed && REASON.test(p.reproposed))) breaches.set(p.id, { after: q.id, bar });
        }
        last.set(p.ticker, p);
    }
    const cooldown = {};
    for (const [ticker, q] of last) {
        const until = addDays(q.written, REPROPOSE_DAYS);
        if (today >= until || rejected.has(ticker)) continue;
        cooldown[ticker] = { last: q.id, limit: q.limit, until,
            below: q.limit != null ? Number((q.limit * (1 - REPROPOSE_DROP)).toFixed(4)) : null };
    }
    return { cooldown, breaches };
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

// Through rateFor, not rates[ccy]: prices.json has no GBp key — pence is GBP/100, and only that
// helper knows it. Without it the pot's first London trade (1 AZN.L at 12,484p on 18 Sep) could not
// be converted, fell into `unconverted`, and the balance carried forward unchanged — £280.73 with
// £124.84 already spent, which is the exact error the carry-forward exists to avoid.
function gbpFrom(amt, ccy, rates) {
    if (!rates) return null;
    const { rateFor } = require('../portfolio.js');
    const from = rateFor(ccy, rates), gbp = rateFor('GBP', rates);
    return from > 0 && gbp > 0 ? amt * from / gbp : null;
}

// Paid in, less every pot purchase, plus every sale, in GBP at today's rates. Every pot TRADE, not
// the book's: potHoldings deletes a name sold outright, and walking the book dropped that round
// trip's proceeds from cash, so the first full exit would have left the pot short by the whole sale.
// Null cash, with the culprits named, when any currency cannot be converted.
function cashFrom(paidIn, trades, rates) {
    let spent = 0;
    const unconverted = [];
    for (const t of trades) {
        const gbp = gbpFrom((t.side === 'SELL' ? -1 : 1) * t.qty * t.price, t.currency, rates);
        if (gbp == null) unconverted.push(t.currency); else spent += gbp;
    }
    return { cash: unconverted.length ? null : Math.round((paidIn - spent) * 100) / 100, unconverted };
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
    // Both folders: D99 keeps what is current at the top and moves the rest to archive/, but the
    // history still feeds D93, D94 and the paper page, and an id is the file's name wherever it sits.
    const listed = d => { try { return fs.readdirSync(p(d)); } catch { return []; } };
    files = [...listed('pot/proposals'), ...listed(ARCHIVE)]
        .filter(f => f.endsWith('.md') && !f.endsWith('-ranking.md') && f !== 'README.md').sort().reverse();

    // Leo's rejections (pot/reject.js, D83): a company he has said no to is not awaiting anything.
    const rejectedBy = new Map();
    for (const r of read('pot/rejections.json', [])) for (const t of r.listings || [r.ticker]) rejectedBy.set(t, r);

    const proposals = files.map(file => {
        const parsed = parseProposal(file);
        if (!parsed) return null;
        const id = file.replace(/\.md$/, '');
        const trade = trades.find(t => t.pot === id);
        const rejected = rejectedBy.get(parsed.ticker);
        let state = 'open';
        if (trade) state = 'accepted';                      // a bought name stays bought, rejected or not
        else if (parsed.withdrawn) state = 'withdrawn';     // D95: never reached Leo
        else if (rejected) state = 'rejected';
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
            ...(!trade && rejected ? { rejected: { date: rejected.date, reason: rejected.reason } } : {}),
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
        p.counts = !p.supersededBy && p.phase === 'live' && p.state !== 'withdrawn';
        // D97: written before the pot had money, under rules that have since moved, and never
        // bought. Not awaiting Leo, and not a rejection either: the name is free to be proposed
        // again. NVDA and RSGN.SW from 31 Aug had sat "open" for two months on limits still in reach.
        if (p.state === 'open' && p.phase === 'pre-live') p.state = 'obsolete';
    }
    const { cooldown, breaches } = reproposalRule(proposals, today, new Set(rejectedBy.keys()));
    for (const p of proposals) if (breaches.has(p.id)) p.reproposalBreach = breaches.get(p.id);
    const { history: earlierRisks, missing } = riskHistory(proposals, new Set(rejectedBy.keys()));
    for (const p of proposals) {
        if (missing.has(p.id)) p.earlierRisksMissing = missing.get(p.id);
        delete p.dominantRisk;       // carried by `earlierRisks` once per name, not once per proposal
        delete p.earlierRisks;
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
    const { cash, unconverted } = cashFrom(paidIn, trades, rates);
    // A currency prices.json cannot price must not silently vanish from the balance. Fall back to
    // carrying the previous number and say so, rather than reporting a total that is quietly wrong.
    const cashGBP = cash == null ? (prev.cashGBP ?? paidIn) : cash;
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
        // D93: names proposed in the last two weeks. Proposing one again needs a limit at or
        // below `below` (in the listing's own units), or a **Re-proposed:** line naming new
        // results, a filing or a changed case. From `until` it is free again.
        cooldown,
        // D94: per name, every dominant risk an earlier proposal named, newest text per label; its
        // falsifier is that proposal's `warning`/`break` above. A new proposal answers each label
        // in **Earlier risks:**.
        earlierRisks,
        today,
    };
}

if (require.main === module && !process.argv.includes('--selftest')) {   // npm test must not rewrite the book
    const out = build();
    fs.writeFileSync(p('pot/positions.json'), JSON.stringify(out, null, 1) + '\n');
    const by = s => out.proposals.filter(x => x.state === s).length;
    const live = out.proposals.filter(x => !x.supersededBy).length;
    const counting = out.proposals.filter(x => x.counts).length;
    console.log(`wrote pot/positions.json: ${Object.keys(out.holdings).length} holding(s), `
        + `${out.proposals.length} proposal(s) — ${by('accepted')} accepted, ${by('open')} open, ${by('expired')} expired, ${by('rejected')} rejected, ${by('withdrawn')} withdrawn, ${by('obsolete')} obsolete`);
    console.log(`  ${live} live decision(s), ${out.proposals.length - live} superseded, `
        + `${counting} scored (the rest are pre-live)`);
    const noFalsifier = out.proposals.filter(x => x.state === 'accepted' && !x.break);
    if (noFalsifier.length) console.log(`  ${noFalsifier.length} accepted proposal(s) carry no break condition: `
        + noFalsifier.map(x => x.id).join(', '));
}

module.exports = { build, parseProposal, potTrades, potHoldings, ARCHIVE };

// ---------------------------------------------------------------- selftest
if (process.argv.includes('--selftest')) {
    const assert = require('assert');

    // Money in, money out: every currency the pot can trade must convert, pence included.
    {
        const rates = { USD: 1, GBP: 1.3347, HKD: 0.1285 };
        assert.strictEqual(Math.round(gbpFrom(12484, 'GBp', rates) * 100) / 100, 124.84, 'GBp is GBP/100');
        assert.strictEqual(Math.round(gbpFrom(101.97, 'USD', rates) * 100) / 100, 76.4);
        assert.strictEqual(gbpFrom(100, 'JPY', rates), null, 'a currency with no rate converts to null, not zero');
        assert.strictEqual(gbpFrom(100, 'GBP', rates), 100);
    }

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
    assert.strictEqual(limitOf('**BUY 7 whole ordinary shares of Bureau Veritas, limit €26.03 per share.**'), 26.03);
    assert.strictEqual(limitOf('**BUY 1 share of TW on Nasdaq, limit $102.40.**'), 102.4);
    assert.strictEqual(limitOf('30 shares at today\'s FX), limit @ US$18.40.'), 18.4);
    assert.strictEqual(limitOf('BUY 100 shares, limit price of ¥5,315 on Tokyo.'), 5315);
    assert.strictEqual(limitOf('under the 0.5% fee limit, then limit HK$12.5'), 12.5, 'a limit with no price is not the limit');
    assert.strictEqual(limitOf('BUY at market'), null);
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
    // ...but its round trip stays in cash: 500 - 200 (NVDA) - 20 + 24 (GME bought, then sold).
    // Walking the book instead of the trades read 300, losing the £24 the sale brought in.
    assert.strictEqual(cashFrom(500, trades, { USD: 1, GBP: 1 }).cash, 304, 'a sold-out name dropped out of cash');
    assert.strictEqual(cashFrom(500, trades, { GBP: 1 }).cash, null, 'an unconvertible trade must not read as spent-nothing');

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

    // D93: two weeks, 5% below the last limit, or a stated reason.
    {
        const P = (id, limit, extra = {}) => ({ id, ticker: id.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, ''),
            written: id.slice(0, 10), side: 'BUY', limit, reproposed: null, ...extra });
        const { cooldown, breaches } = reproposalRule([
            P('2026-10-27-0900-BN.PA', 61),                      // first: free
            P('2026-10-28-0900-BN.PA', 60.5),                    // 0.8% lower, no reason: breach
            P('2026-10-29-0900-BN.PA', 57.4),                    // 5% below 60.5 (57.475): allowed
            P('2026-10-30-0900-BN.PA', 57.4, { reproposed: 'price moved' }),           // "price" is not a reason
            P('2026-10-31-0900-BN.PA', 57.4, { reproposed: 'Q3 results on 30 Oct beat the falsifier' }),
            P('2026-10-27-0900-HLMA.L', 3276), P('2026-11-10-0900-HLMA.L', 3270),     // day 14: free again
            P('2026-10-12-0900-MWA', 22), P('2026-10-13-0900-MWA', 21.9),             // both before the rule: not judged
            P('2026-10-27-0900-AZN.L', 12136, { side: 'SELL' }), P('2026-10-28-0900-AZN.L', 12100, { side: 'SELL' }),
        ], '2026-11-02', new Set(['YUMC']));
        assert.deepStrictEqual([...breaches.keys()], ['2026-10-28-0900-BN.PA', '2026-10-30-0900-BN.PA']);
        assert.deepStrictEqual(breaches.get('2026-10-28-0900-BN.PA'), { after: '2026-10-27-0900-BN.PA', bar: 57.95 });
        assert.deepStrictEqual(cooldown['BN.PA'], { last: '2026-10-31-0900-BN.PA', limit: 57.4, until: '2026-11-14', below: 54.53 });
        assert.strictEqual(cooldown['HLMA.L'].last, '2026-11-10-0900-HLMA.L', 'a free re-proposal starts a new window');
        assert.ok(!cooldown['AZN.L'], 'sells are not covered: §5 governs them');
        assert.ok(!cooldown['MWA'], 'window over by 2 Nov');
        // A proposal from before the rule still opens a window: the rule bites from its first day.
        assert.deepStrictEqual([...reproposalRule([P('2026-10-22-0900-BN.PA', 60.82), P('2026-10-26-0900-BN.PA', 60.1)],
            '2026-10-26').breaches.keys()], ['2026-10-26-0900-BN.PA']);
        // Pence stay pence: the bar is in the listing's own units.
        assert.strictEqual(reproposalRule([P('2026-10-27-0900-HLMA.L', 3276)], '2026-10-28').cooldown['HLMA.L'].below, 3112.2);
        assert.ok(!reproposalRule([P('2026-10-27-0900-YUMC', 40)], '2026-10-28', new Set(['YUMC'])).cooldown.YUMC, 'rejected: out, not cooling');
    }

    // D95: a withdrawn proposal is recognised, opens no two-week window, and is not scored.
    {
        const md = 'model: x\n**Withdrawn by the second reader:** one customer is 20% of revenue and the draft never weighed it.\n# HLMA.L';
        assert.strictEqual((md.match(WITHDRAWN) || [])[1], 'one customer is 20% of revenue and the draft never weighed it.');
        assert.strictEqual(('model: x\n# HLMA.L'.match(WITHDRAWN) || [])[1], undefined);
        const W = (id, limit, state) => ({ id, ticker: 'BN.PA', written: id.slice(0, 10), side: 'BUY', limit, state });
        const r = reproposalRule([W('2026-10-27-0900-BN.PA', 61, 'withdrawn'), W('2026-10-28-0900-BN.PA', 60.9, 'open')], '2026-10-29');
        assert.strictEqual(r.breaches.size, 0, 'a withdrawn proposal opens no window');
        assert.strictEqual(r.cooldown['BN.PA'].last, '2026-10-28-0900-BN.PA');
    }

    // D94: every earlier label answered, not just the last proposal's.
    {
        const R = (id, category, extra = {}) => ({ id, ticker: id.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, ''), written: id.slice(0, 10),
            dominantRisk: category ? { category, text: category + ' risk' } : null, earlierRisks: null, warning: 'w', break: 'b', ...extra });
        const { history, missing } = riskHistory([
            R('2026-10-16-0558-HLMA.L', 'financial'),
            R('2026-10-16-1208-HLMA.L', 'competitive'),                              // the one that mattered
            R('2026-10-23-0918-HLMA.L', 'financial'),                                // before the rule: not judged
            R('2026-10-27-0900-HLMA.L', 'financial', { earlierRisks: 'Financial: still dominant, cash deficit is real.' }),
            R('2026-10-28-0900-HLMA.L', 'financial', { earlierRisks: 'financial stands; competitive demoted: orders from the customer rose 30%.' }),
            R('2026-10-27-0900-NEW', 'secular'),                                     // first proposal: nothing to answer
        ]);
        assert.deepStrictEqual([...missing.keys()], ['2026-10-27-0900-HLMA.L'], 'competitive was dropped');
        assert.deepStrictEqual(missing.get('2026-10-27-0900-HLMA.L'), [{ category: 'competitive', id: '2026-10-16-1208-HLMA.L' }]);
        assert.deepStrictEqual(history['HLMA.L'].map(r => r.category + ' ' + r.id),
            ['financial 2026-10-28-0900-HLMA.L', 'competitive 2026-10-16-1208-HLMA.L'], 'newest text per label, the old label kept');
        assert.deepStrictEqual(history['HLMA.L'][1], { category: 'competitive', text: 'competitive risk', id: '2026-10-16-1208-HLMA.L' },
            'points at its proposal, whose falsifier is in `proposals`');
        assert.ok(!riskHistory([R('2026-10-27-0900-HLMA.L', 'financial')], new Set(['HLMA.L'])).history['HLMA.L'], 'rejected: no history kept');
    }

    console.log('selftest ok');
}
