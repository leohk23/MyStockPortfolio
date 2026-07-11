// Builds holdings.json (committed) from the Tradelog tab of "Tradelog.xlsx"
// (gitignored) plus meta.json (committed). Run after trading: `npm run extract`.
//
// The Tradelog is the single source of truth: quantity, average cost, realized gain,
// and per-trade history are all summed from it — the same SUMIFs the workbook's
// Portfolio tab used to do, now done here so that tab no longer feeds the web app.
// meta.json supplies the per-instrument facts that aren't in the Tradelog: the Yahoo
// symbol, company grouping, geography, and purchase currency. Add a meta.json entry
// when you open a position in a new instrument (see README).
const fs = require('fs');
const XLSX = require('xlsx');

const WORKBOOK = 'Tradelog.xlsx';
const META = 'meta.json';

// Tradelog columns (0-indexed). "Non US date" is the trade date; "Exec Time" is the
// bulk-import stamp. "Adjusted Price/Qty" are split-adjusted so they stay comparable to
// today's spot. "Bal Qty"/"Average Purchase Price" are the running position and cost.
const TRADE = { side: 2, symbol: 4, date: 7, adjPrice: 9, adjQty: 11, balanceQty: 12, avgPrice: 14, currency: 15, gainLC: 16, platform: 23, comment: 24 };

// One Tradelog row -> a trade record, or null for header/incomplete rows.
// Comments are deliberately published beside expanded trades at the owner's request.
function parseTrade(r) {
    const date = r[TRADE.date];
    if (!r[TRADE.symbol] || !(date instanceof Date) || r[TRADE.adjPrice] == null || r[TRADE.adjQty] == null) return null;
    const comment = String(r[TRADE.comment] ?? '').trim();
    const platform = String(r[TRADE.platform] ?? '').trim(); // broker: IB, TD, SC, T212; page badges IB as IBKR
    return {
        symbol: String(r[TRADE.symbol]),
        date: date.toISOString().slice(0, 10),
        side: String(r[TRADE.side] || '').toUpperCase().startsWith('S') ? 'SELL' : 'BUY',
        qty: Math.abs(r[TRADE.adjQty] || 0),
        price: r[TRADE.adjPrice],
        balanceQty: r[TRADE.balanceQty] ?? 0,
        avgPrice: r[TRADE.avgPrice] ?? 0,
        currency: String(r[TRADE.currency] || 'USD'),
        ...(platform ? { platform } : {}),
        ...(comment ? { comment } : {}),
    };
}

// Single pass over the Tradelog: trades grouped by symbol (oldest first) and realized
// gain summed per symbol (workbook's "Gain/(Loss)" column, in local currency).
function readTradelog(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
    const bySymbol = new Map();
    const realized = new Map();
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[TRADE.symbol]) continue;
        const key = String(r[TRADE.symbol]);
        realized.set(key, (realized.get(key) || 0) + (Number(r[TRADE.gainLC]) || 0));
        const t = parseTrade(r);
        if (!t) continue;
        const { symbol, ...trade } = t;
        const list = bySymbol.get(symbol) || [];
        list.push(trade);
        bySymbol.set(symbol, list);
    }
    for (const list of bySymbol.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return { bySymbol, realized };
}

// meta.json (instrument facts) + Tradelog aggregates -> one holding per open position.
// Position size and cost come straight from the last trade's running balance/avg cost.
function buildHoldings(meta, bySymbol, realized) {
    const holdings = [];
    for (const [sym, m] of Object.entries(meta)) {
        const trades = bySymbol.get(sym) || [];
        const last = trades.length ? trades[trades.length - 1] : null;
        const qty = last ? last.balanceQty : 0;
        if (!(qty > 0)) continue; // closed or never held
        holdings.push({
            ticker: m.ticker || sym,
            yahoo: m.yahoo,
            group: m.group,
            geography: m.geography || 'Other',
            currency: m.currency,
            qty,
            avgPrice: last.avgPrice,
            costLC: qty * last.avgPrice,        // cost basis in the instrument's currency
            realizedLC: realized.get(sym) || 0,
            trades,
            lastTrade: last,
        });
    }
    return holdings;
}

// Holdings whose Yahoo symbol wasn't in the last successful fetch (prices.json).
// These are the only ones at risk of being silently dropped by the page, so they
// are the only ones worth a network round-trip.
function newSymbols(holdings, known) {
    return holdings.filter(h => !known.has(h.yahoo));
}

// Does Yahoo return a current price for this symbol? Same endpoint fetch-prices uses.
async function yahooPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.replace('^', '%5E')}?range=5d&interval=1d`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return null;
        return (await res.json()).chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    } catch { return null; }
}

// Verify only brand-new symbols against Yahoo before we commit them. A typo'd symbol
// would otherwise pass extraction and then vanish from the site (portfolio.js skips
// holdings with no quote). Normal runs add nothing new, so this makes zero requests.
async function verifyNewSymbols(holdings) {
    let quotes;
    try { quotes = JSON.parse(fs.readFileSync('prices.json', 'utf8')).quotes || {}; }
    catch { return; } // no baseline yet (first ever run) — nothing to diff against
    for (const h of newSymbols(holdings, new Set(Object.keys(quotes)))) {
        const price = await yahooPrice(h.yahoo);
        if (price == null) {
            throw new Error(`new instrument ${h.ticker}: Yahoo symbol "${h.yahoo}" returned no price. Fix its "yahoo" in ${META} (or check your connection) before publishing.`);
        }
        console.log(`  verified new instrument: ${h.ticker} -> ${h.yahoo} (${price})`);
    }
}

async function main() {
    if (!fs.existsSync(WORKBOOK)) {
        throw new Error(`${WORKBOOK} not found. It is gitignored, so this only runs on your machine.`);
    }
    const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
    const wb = XLSX.readFile(WORKBOOK, { cellDates: true });
    if (!wb.Sheets.Tradelog) throw new Error('no "Tradelog" tab in workbook');

    const { bySymbol, realized } = readTradelog(wb.Sheets.Tradelog);

    // Guard the one new failure mode: a position is open in the Tradelog but has no
    // meta.json entry, so it would silently vanish from the app.
    const openMissing = [...bySymbol.entries()]
        .filter(([sym, tr]) => tr[tr.length - 1].balanceQty > 0 && !meta[sym])
        .map(([sym]) => sym);
    if (openMissing.length) {
        throw new Error(`open positions missing from ${META}: ${openMissing.join(', ')}. Add an entry (yahoo, group, geography, currency) and verify the yahoo symbol returns a price.`);
    }

    const holdings = buildHoldings(meta, bySymbol, realized);
    if (holdings.length < 10) throw new Error(`only ${holdings.length} holdings parsed; refusing to overwrite`);

    const dupes = holdings.map(h => h.yahoo).filter((y, i, a) => a.indexOf(y) !== i);
    if (dupes.length) throw new Error(`duplicate Yahoo symbols: ${dupes.join(', ')}`);

    await verifyNewSymbols(holdings); // network only for symbols not already in prices.json

    fs.writeFileSync('holdings.json', JSON.stringify({
        generated: new Date().toISOString(),
        holdings,
    }, null, 1));

    const groups = new Set(holdings.map(h => h.group));
    console.log(`wrote holdings.json: ${holdings.length} instruments in ${groups.size} groups`);
    for (const g of [...groups].sort()) {
        const rows = holdings.filter(h => h.group === g);
        if (rows.length > 1) console.log(`  merged: ${g} <- ${rows.map(r => r.yahoo).join(' + ')}`);
    }
    const noTrade = holdings.filter(h => !h.lastTrade).map(h => h.yahoo);
    if (noTrade.length) console.warn(`  no Tradelog match (last-trade column will be blank): ${noTrade.join(', ')}`);
}

function selftest() {
    const assert = require('assert');

    // parseTrade: side/qty/date normalisation, platform + comment optional.
    const row = [];
    row[TRADE.side] = 'SELL'; row[TRADE.symbol] = 'NVDA';
    row[TRADE.date] = new Date('2025-01-22T00:00:00Z'); row[TRADE.adjPrice] = 147.27;
    row[TRADE.adjQty] = -5; row[TRADE.balanceQty] = 115;
    row[TRADE.avgPrice] = 13.267; row[TRADE.currency] = 'USD';
    row[TRADE.platform] = 'IB'; row[TRADE.comment] = 'Trim & review';
    assert.deepStrictEqual(parseTrade(row), {
        symbol: 'NVDA', date: '2025-01-22', side: 'SELL', qty: 5, price: 147.27,
        balanceQty: 115, avgPrice: 13.267, currency: 'USD', platform: 'IB', comment: 'Trim & review',
    });
    const noPlat = [...row]; noPlat[TRADE.platform] = null;
    assert.strictEqual('platform' in parseTrade(noPlat), false); // blank platform omitted

    // buildHoldings: qty/avgPrice/cost from last trade, realized from the map, closed skipped.
    const bySymbol = new Map([
        ['GOOG', [{ date: '2024-01-01', side: 'BUY', qty: 10, price: 100, balanceQty: 10, avgPrice: 100, currency: 'USD' },
                  { date: '2024-06-01', side: 'BUY', qty: 5, price: 120, balanceQty: 15, avgPrice: 106.67, currency: 'USD' }]],
        ['SOLD', [{ date: '2024-02-01', side: 'SELL', qty: 3, price: 50, balanceQty: 0, avgPrice: 40, currency: 'USD' }]],
    ]);
    const meta = {
        GOOG: { ticker: 'GOOG', yahoo: 'GOOG', group: 'Google', geography: 'US', currency: 'USD' },
        SOLD: { ticker: 'SOLD', yahoo: 'SOLD', group: 'Sold', geography: 'US', currency: 'USD' },
    };
    const holdings = buildHoldings(meta, bySymbol, new Map([['GOOG', 12.5], ['SOLD', -8]]));
    assert.strictEqual(holdings.length, 1); // SOLD (balance 0) dropped
    const h = holdings[0];
    assert.strictEqual(h.qty, 15);
    assert.strictEqual(h.avgPrice, 106.67);
    assert.ok(Math.abs(h.costLC - 15 * 106.67) < 1e-9);
    assert.strictEqual(h.realizedLC, 12.5);
    assert.strictEqual(h.trades.length, 2);

    // newSymbols: only holdings absent from the known (last-fetched) set are "new".
    const hs = [{ yahoo: 'GOOG' }, { yahoo: 'AVGO' }, { yahoo: 'NTO.F' }];
    assert.deepStrictEqual(newSymbols(hs, new Set(['GOOG', 'NTO.F'])).map(x => x.yahoo), ['AVGO']);
    assert.strictEqual(newSymbols(hs, new Set(['GOOG', 'AVGO', 'NTO.F'])).length, 0); // all known -> no checks

    console.log('selftest ok');
}

if (process.argv[2] === '--selftest') selftest();
else main().catch(e => { console.error(e.message); process.exit(1); });
