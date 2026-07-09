// Reads "Master Cashflow.xlsx" (gitignored) -> holdings.json (committed).
// Run this yourself after trading: `npm run extract`. CI never sees the workbook.
//
// Source is the Portfolio tab, one row per instrument. Grouping1 is the
// consolidation key that puts BYD's HK line and its ADR on one row, matching
// the workbook's "Other Summary" pivot.
const fs = require('fs');
const XLSX = require('xlsx');

const WORKBOOK = 'Master Cashflow.xlsx';
const HEADER_ROW = 2; // 0-indexed; rows 0-1 are title/date banners

// Portfolio tab column indexes. Positional because several headers repeat ("Q", "Cost").
const COL = {
    currency: 0, exchangeTicker: 2, lookup: 3, ticker: 4, group: 6, geography: 7,
    qty: 8, divTTM: 11, avgPrice: 36, realized: 44, costLC: 46,
};

// Tradelog tab. "Exec Time" is the bulk-import stamp, not the trade date — "Non US date" is.
// "Adjusted Price" is split-adjusted, so it stays comparable to today's spot; raw "Price" is not.
const TRADE = { side: 2, qty: 3, symbol: 4, date: 7, adjPrice: 9, currency: 15 };

// Yahoo suffix by exchange prefix. Anything not listed falls through to the
// currency guess below, which is why every result gets verified against Yahoo.
const HK = /^(HKG|XHKG)$/;
const PARIS = /^(XPAR|EPA)$/;
const US = /^(NASDAQ|XNAS|NYSE|XNYS|NYSEARCA|ARCX|OTCPK|OTCM|BATS)$/;

// Instruments whose exchange prefix lies or is missing. Verified against Yahoo;
// see README before adding one.
const OVERRIDES = {
    NTO: 'NTO.F',    // Nintendo, Frankfurt. Prefixed OTCM: but priced in EUR.
    WDEF: 'WDEF.PA', // Euronext Paris, not London.
    R1VL: 'R1VL.L',  // LSE USD line.
    CSUK: 'CSUK.L',
    SPOL: 'SPOL.L',
    MKS: 'MKS.L',
    VUSA: 'VUSA.L',
    NW0: 'NW0.DE',
};

function yahooSymbol({ ticker, exchangeTicker, currency }) {
    if (OVERRIDES[ticker]) return OVERRIDES[ticker];
    const exchange = (exchangeTicker.split(':')[0] || '').toUpperCase();
    if (HK.test(exchange)) return ticker.padStart(4, '0') + '.HK'; // 1 -> 0001.HK
    if (PARIS.test(exchange)) return ticker + '.PA';
    if (US.test(exchange)) return ticker.replace('.', '-');        // BRK.B -> BRK-B
    if (currency === 'GBP' || currency === 'Gbpence') return ticker + '.L';
    return ticker.replace('.', '-');
}

// "QUALCOMM INCORPORATED (XNAS:QCOM)" -> "QUALCOMM INCORPORATED"
function cleanGroup(name) {
    return String(name).replace(/\s*\([^)]*:[^)]*\)\s*$/, '').trim();
}

// Most recent trade per Tradelog symbol. Comments column is deliberately not read —
// it holds trade rationale, and the published repo is public.
function lastTrades(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
    const latest = new Map();
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const symbol = r[TRADE.symbol];
        const date = r[TRADE.date];
        const price = r[TRADE.adjPrice];
        if (!symbol || !(date instanceof Date) || price == null) continue;
        const prev = latest.get(String(symbol));
        if (prev && prev.raw >= date) continue;
        latest.set(String(symbol), {
            raw: date,
            date: date.toISOString().slice(0, 10),
            side: String(r[TRADE.side] || '').toUpperCase(),
            qty: Math.abs(r[TRADE.qty] || 0),
            price,
            currency: String(r[TRADE.currency] || 'USD'),
        });
    }
    for (const t of latest.values()) delete t.raw;
    return latest;
}

function extract(sheet, trades) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
    const holdings = [];
    for (let i = HEADER_ROW + 1; i < rows.length; i++) {
        const r = rows[i];
        const ticker = r[COL.ticker];
        const group = r[COL.group];
        const qty = r[COL.qty];
        if (!ticker || !group || !(qty > 0)) continue; // closed positions and pivot rows
        if (/grand total/i.test(String(group))) break;

        holdings.push({
            ticker: String(ticker),
            yahoo: yahooSymbol({
                ticker: String(ticker),
                exchangeTicker: String(r[COL.exchangeTicker] ?? ''),
                currency: String(r[COL.currency]),
            }),
            group: cleanGroup(group),
            geography: String(r[COL.geography] ?? 'Other'),
            currency: String(r[COL.currency]),
            qty,
            avgPrice: r[COL.avgPrice] ?? null,
            costLC: r[COL.costLC] ?? 0,       // cost basis in the instrument's currency
            realizedLC: r[COL.realized] ?? 0,
            divTTM: r[COL.divTTM] ?? 0,
            lastTrade: trades.get(String(r[COL.lookup] ?? ticker)) ?? null,
        });
    }
    return holdings;
}

function main() {
    if (!fs.existsSync(WORKBOOK)) {
        throw new Error(`${WORKBOOK} not found. It is gitignored, so this only runs on your machine.`);
    }
    const wb = XLSX.readFile(WORKBOOK, { cellDates: true });
    if (!wb.Sheets.Portfolio) throw new Error('no "Portfolio" tab in workbook');
    if (!wb.Sheets.Tradelog) throw new Error('no "Tradelog" tab in workbook');

    const trades = lastTrades(wb.Sheets.Tradelog);
    const holdings = extract(wb.Sheets.Portfolio, trades);
    if (holdings.length < 10) throw new Error(`only ${holdings.length} holdings parsed; refusing to overwrite`);

    const dupes = holdings.map(h => h.yahoo).filter((y, i, a) => a.indexOf(y) !== i);
    if (dupes.length) throw new Error(`duplicate Yahoo symbols: ${dupes.join(', ')}`);

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
    const y = (ticker, exchangeTicker, currency = 'USD') => yahooSymbol({ ticker, exchangeTicker, currency });
    assert.strictEqual(y('1', 'XHKG:1'), '0001.HK');      // zero-padded to 4
    assert.strictEqual(y('1113', 'HKG:1113'), '1113.HK');
    assert.strictEqual(y('BRK.B', 'XNYS:BRK.B'), 'BRK-B'); // dot -> dash
    assert.strictEqual(y('MC', 'XPAR:MC', 'EUR'), 'MC.PA');
    assert.strictEqual(y('RMS', 'EPA:RMS', 'EUR'), 'RMS.PA');
    assert.strictEqual(y('NTO', 'OTCM:NTO', 'EUR'), 'NTO.F'); // override beats US prefix
    assert.strictEqual(y('BYDDY', 'OTCPK:BYDDY'), 'BYDDY');
    assert.strictEqual(y('AMD', ':AMD'), 'AMD');           // blank exchange
    assert.strictEqual(cleanGroup('QUALCOMM INCORPORATED (XNAS:QCOM)'), 'QUALCOMM INCORPORATED');
    assert.strictEqual(cleanGroup('Google'), 'Google');
    assert.strictEqual(cleanGroup("L'Oreal"), "L'Oreal");   // parens-free names untouched
    console.log('selftest ok');
}

if (process.argv[2] === '--selftest') selftest();
else main();
