// `npm run dividends` — what IBKR actually paid, net of the tax it withheld, from its Flex Web
// Service: the token and query id live in the gitignored .ibkr-flex, so this runs on Leo's machine
// only and the token never leaves it. Writes the gitignored .ibkr-dividends.json, which
// extract-portfolio.js seals into holdings.json per holding (amounts are never published in the
// clear, D67). `npm run publish` runs it first; without .ibkr-flex it does nothing.
//
// A Flex request covers at most a year, so the history is fetched in 365-day windows from the
// first IBKR trade. A finished window cannot change, so only the last two are fetched again;
// the rest come from the file.
//
// The account behind the token starts later than the Tradelog's IBKR trades: its first activity is
// a deposit on 29 Mar 2024, and IBKR answers 1003 "Statement is not available" for anything before
// it (the 2022-23 trades were on an earlier account). `coverageFrom` records where the record
// starts, so a dividend before it is calculated rather than read as never paid.
const fs = require('fs');
const FLEX = '.ibkr-flex', OUT = '.ibkr-dividends.json';
const BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const DAY = 864e5;
// The cash a holding paid: dividends, the tax withheld from them, payments in lieu, and a bond's
// interest (received, and the accrued interest paid on purchase, which the first coupon repays).
const KEEP = /^(Dividends|Withholding Tax|Payment In Lieu Of Dividends|Bond Interest Received|Bond Interest Paid)$/;

const ymd = d => d.toISOString().slice(0, 10);
const compact = s => s.replace(/-/g, '');
const iso = s => (s || '').replace(/^(\d{4})(\d\d)(\d\d).*/, '$1-$2-$3');

// 365-day windows from `start` to `today`, oldest first.
function windows(start, today) {
    const out = [];
    for (let from = new Date(start + 'T00:00:00Z'); ymd(from) <= today; from = new Date(from.getTime() + 365 * DAY)) {
        const to = new Date(from.getTime() + 364 * DAY);
        out.push({ from: ymd(from), to: ymd(to) < today ? ymd(to) : today });
    }
    return out;
}

// Every CashTransaction in a Flex statement, as attribute objects.
const cashRows = xml => [...xml.matchAll(/<CashTransaction ([^>]*)\/>/g)]
    .map(m => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]])));

// The rows that are what a holding paid.
function parseRows(xml) {
    return cashRows(xml)
        .filter(r => KEEP.test(r.type) && r.symbol)
        .map(r => ({ date: iso(r.dateTime || r.reportDate), exDate: iso(r.exDate) || null, symbol: r.symbol,
            isin: r.isin || null, currency: r.currency, amount: Number(r.amount), type: r.type }));
}

const tag = (x, t) => (x.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];

// The accounts in .ibkr-flex: { accounts: [{ name, token, query }] }, one per IBKR account (each
// account's Flex token and query are its own), or the original single { token, query }. An entry
// with a blank token or query is a template not yet filled in, and is skipped.
function readAccounts(text) {
    const cfg = JSON.parse(text);
    const list = Array.isArray(cfg.accounts) ? cfg.accounts : [{ name: 'main', token: cfg.token, query: cfg.query }];
    return list.filter(a => a && String(a.token || '').trim() && String(a.query || '').trim())
        .map((a, i) => ({ name: a.name || `account${i + 1}`, token: String(a.token).trim(), query: String(a.query).trim() }));
}

async function fetchWindow({ token, query }, w) {
    const H = { 'User-Agent': 'MyStockPortfolio/1.0' };
    const send = await (await fetch(`${BASE}/SendRequest?t=${token}&q=${query}&v=3&fd=${compact(w.from)}&td=${compact(w.to)}`, { headers: H })).text();
    const ref = tag(send, 'ReferenceCode');
    if (tag(send, 'ErrorCode') === '1003') return null;          // before this account existed, or today
    if (!ref) throw new Error(`IBKR refused the request: ${tag(send, 'ErrorMessage') || 'no reference code'}`);
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const st = await (await fetch(`${BASE}/GetStatement?t=${token}&q=${ref}&v=3`, { headers: H })).text();
        // `earliest`: the first activity of any kind, where this account's record begins.
        if (/<FlexQueryResponse/.test(st)) return { rows: parseRows(st),
            earliest: cashRows(st).map(r => iso(r.dateTime || r.reportDate)).filter(Boolean).sort()[0] || null };
        if (!/1019|in progress/i.test(st)) throw new Error(`IBKR statement failed: ${tag(st, 'ErrorMessage') || st.slice(0, 120)}`);
    }
    throw new Error('IBKR statement not ready after a minute');
}

// Every payment row in a .ibkr-dividends.json, across accounts (or the original single-account file).
const allRows = d => (d.accounts ? Object.values(d.accounts).flatMap(a => Object.values(a.windows)) : Object.values(d.windows || {}))
    .flatMap(w => w.rows || []);

async function main() {
    if (!fs.existsSync(FLEX)) { console.log('no .ibkr-flex — IBKR dividends not fetched'); return; }
    const accounts = readAccounts(fs.readFileSync(FLEX, 'utf8'));
    if (!accounts.length) { console.log('no IBKR account in .ibkr-flex has a token and query id yet'); return; }
    const { holdings, full } = require('./vault').readHoldings();
    if (!full) throw new Error('holdings are sealed and no passphrase is set — cannot find the first IBKR trade');
    const first = holdings.flatMap(h => h.trades || []).filter(t => t.platform === 'IB').map(t => t.date).sort()[0];
    if (!first) { console.log('no IBKR trades — nothing to fetch'); return; }
    // Flex serves completed days only: a window ending today is refused like one before the account.
    const today = ymd(new Date(Date.now() - DAY));
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
    const ws = windows(first, today), out = {};
    // Each account over the whole span of the Tradelog's IBKR trades: Flex answers 1003 for the
    // windows outside an account's life, so the same windows serve an old account and a new one.
    for (const acct of accounts) {
        const cached = {}, was = prev.accounts?.[acct.name]?.windows || {};
        for (const [i, w] of ws.entries()) {
            const key = `${w.from}/${w.to}`;
            // Finished windows come from the file; the last two are asked again (late postings, reversals).
            if (i < ws.length - 2 && was[key]) { cached[key] = was[key]; continue; }
            cached[key] = (await fetchWindow(acct, w)) || { unavailable: true };
            console.log(`ok   IBKR ${acct.name} ${key}: ${cached[key].unavailable ? 'not available' : cached[key].rows.length + ' payment row(s)'}`);
            await new Promise(r => setTimeout(r, 2000));             // IBKR throttles rapid requests
        }
        out[acct.name] = { coverageFrom: Object.values(cached).map(w => w.earliest).filter(Boolean).sort()[0] || null, windows: cached };
    }
    // The record starts where the earliest account's does: an older account carried the shares
    // until they moved to the newer one.
    const coverageFrom = Object.values(out).map(a => a.coverageFrom).filter(Boolean).sort()[0] || null;
    fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), from: first, coverageFrom, accounts: out }, null, 1));
    const rows = allRows({ accounts: out });
    console.log(`wrote ${OUT}: ${rows.length} rows from ${accounts.length} account(s), IBKR's record from ${coverageFrom}`);
}

function selftest() {
    const assert = require('assert');
    assert.deepStrictEqual(windows('2024-10-10', '2026-10-08').map(w => w.from + '/' + w.to),
        ['2024-10-10/2025-10-09', '2025-10-10/2026-10-08']);
    assert.deepStrictEqual(windows('2026-10-08', '2026-10-08'), [{ from: '2026-10-08', to: '2026-10-08' }]);
    const xml = '<FlexQueryResponse><CashTransaction currency="EUR" symbol="MC" isin="FR0000121014" dateTime="20251204;202000" exDate="20251202" amount="38.5" type="Dividends" />'
        + '<CashTransaction currency="EUR" symbol="MC" isin="FR0000121014" dateTime="20251204;202000" exDate="20251202" amount="-9.62" type="Withholding Tax" />'
        + '<CashTransaction currency="GBP" symbol="" dateTime="20251204" amount="500" type="Deposits/Withdrawals" /></FlexQueryResponse>';
    assert.deepStrictEqual(parseRows(xml), [
        { date: '2025-12-04', exDate: '2025-12-02', symbol: 'MC', isin: 'FR0000121014', currency: 'EUR', amount: 38.5, type: 'Dividends' },
        { date: '2025-12-04', exDate: '2025-12-02', symbol: 'MC', isin: 'FR0000121014', currency: 'EUR', amount: -9.62, type: 'Withholding Tax' },
    ], 'deposits are not income');
    // .ibkr-flex: the original single account, or a list where a blank entry is a template to fill in.
    assert.deepStrictEqual(readAccounts('{ "token": "t1", "query": "q1" }'), [{ name: 'main', token: 't1', query: 'q1' }]);
    assert.deepStrictEqual(readAccounts(JSON.stringify({ accounts: [{ name: 'current', token: 't1', query: 'q1' },
        { name: 'previous', token: '', query: '', note: 'fill in' }] })), [{ name: 'current', token: 't1', query: 'q1' }]);
    assert.deepStrictEqual(allRows({ accounts: { a: { windows: { w1: { rows: [1, 2] }, w2: { unavailable: true } } }, b: { windows: { w1: { rows: [3] } } } } }), [1, 2, 3]);
    assert.deepStrictEqual(allRows({ windows: { w1: { rows: [1] } } }), [1], 'the single-account file still reads');
    console.log('selftest ok');
}

if (require.main === module) {
    if (process.argv.includes('--selftest')) selftest();
    else main().catch(e => { console.error(`IBKR dividends: ${e.message}`); process.exit(1); });
}
module.exports = { windows, parseRows, readAccounts, allRows };
