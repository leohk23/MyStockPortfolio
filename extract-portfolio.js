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
const { giltQuote, ISIN: GILT_ISIN } = require('./gilt-quote.js');

// The workbook: the path in the gitignored .tradelog-path, which is Leo's live master on OneDrive,
// synced to this laptop (publish-on-change.js publishes it when it changes), else a Tradelog.xlsx
// copy in the repo. Either way only its Tradelog tab is read.
const WORKBOOK = (() => {
    try { return fs.readFileSync('.tradelog-path', 'utf8').trim() || 'Tradelog.xlsx'; } catch { return 'Tradelog.xlsx'; }
})();
const META = 'meta.json';

// Tradelog columns (0-indexed). "Non US date" is the trade date; "Exec Time" is the
// bulk-import stamp. "Adjusted Price/Qty" are split-adjusted so they stay comparable to
// today's spot. "Bal Qty"/"Average Purchase Price" are the running position and cost.
//
// Column 25, `Pot`, is how a trade says it belongs to the AI pot rather than the main book
// (strategy §10). Leo records the decision where he already records everything else, so the
// pot needs no second ledger to keep in step with this one.
//
// Put the PROPOSAL ID in the cell - the filename without .md, e.g. 2026-08-30-1330-NVDA -
// so the trade is tied to the exact thesis it executes. Four NVDA proposals exist; a bare
// "Y" could not say which one this trade was testing, and the Review lane has to check a
// position against the falsifier that was actually agreed. A bare Y is still accepted for a
// pot trade with no proposal behind it, such as the §11.1 VIX standing order.
//
// The column is optional. Until it exists every trade reads as main-book, which is correct.
const TRADE = { side: 2, symbol: 4, rawPrice: 5, date: 7, adjPrice: 9, adjQty: 11, balanceQty: 12, avgPrice: 14, currency: 15, gainLC: 16, platform: 23, comment: 24, pot: 25 };

// The workbook prices its Japanese holdings off the US ADR, because its data provider has no
// Tokyo coverage. So those rows record the price in USD as `=3976/rngUSDJPY` with Currency
// "USD", even though the trade was ¥3,976 on the Tokyo line. That has to stay — Excel's own
// reporting depends on it — so the app recovers the real figure instead.
//
// The yen price is the formula's numerator. The scale factor is derived from the cell ITSELF
// (numerator ÷ cached value) rather than read off the Forex tab, because rngUSDJPY is a LIVE
// rate (`=_FV(...,"Price")`): Excel recomputes the USD value on every refresh, so the recovery
// must be exact for whatever rate happened to be in force when the file was last saved.
//
// Every USD-derived figure on the row was computed from that same USD price, so adjusted price,
// average cost and realized gain all rescale by the same factor and the trade lands in JPY
// whole. No match (the other 380-odd rows) means no rescale — Tradelog values pass through.
const LOCAL_PRICE = /^\s*([\d.]+)\s*\/\s*rngUSD([A-Z]{3})\s*$/;

function localPriceScale(sheet, row, recordedCurrency) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: TRADE.rawPrice })];
    const m = cell?.f?.match(LOCAL_PRICE);
    if (!m || !(cell.v > 0)) return null;
    const currency = m[2];
    if (currency === recordedCurrency) return null;   // already recorded in its own currency
    return { currency, scale: Number(m[1]) / cell.v };
}

// One Tradelog row -> a trade record, or null for header/incomplete rows.
// Comments are deliberately published beside expanded trades at the owner's request.
//
// Numbers are validated as finite, not merely present. Several Tradelog columns are Excel
// formulas, and a broken one yields an error cell ("#REF!", "#VALUE!") — xlsx hands that
// through as a string, which Math.abs() would silently turn into NaN and publish. Adj Qty and
// Gain/(Loss) reach through an external-workbook link, so this is a live risk, not a
// hypothetical: lose the link and every quantity in the app goes quietly wrong.
// A trade date is a calendar day, not an instant. xlsx (cellDates) builds it at LOCAL
// midnight, so toISOString() would shift it into the previous day anywhere east of UTC
// (BST put 2026-07-21 back to the 20th). Read the local parts it was built from.
const ymdLocal = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function parseTrade(r, row, local = null) {
    const date = r[TRADE.date];
    if (!r[TRADE.symbol] || !(date instanceof Date) || r[TRADE.adjPrice] == null || r[TRADE.adjQty] == null) return null;

    for (const field of ['adjPrice', 'adjQty', 'balanceQty', 'avgPrice']) {
        const v = r[TRADE[field]];
        if (v != null && !Number.isFinite(Number(v))) {
            throw new Error(`Tradelog row ${row ?? '?'} (${r[TRADE.symbol]}): ${field} is "${v}", not a number. `
                + `An Excel formula is broken — most likely the external link to the Master Cashflow workbook. `
                + `Fix the workbook before publishing; refusing to write a bad holdings.json.`);
        }
    }
    const comment = String(r[TRADE.comment] ?? '').trim();
    const platform = String(r[TRADE.platform] ?? '').trim(); // broker: IB, TD, SC, T212; page badges IB as IBKR
    const pot = String(r[TRADE.pot] ?? '').trim();          // proposal id, or Y, or empty
    const k = local ? local.scale : 1;   // USD -> the price's real currency (see LOCAL_PRICE)
    return {
        symbol: String(r[TRADE.symbol]),
        date: ymdLocal(date),
        side: String(r[TRADE.side] || '').toUpperCase().startsWith('S') ? 'SELL' : 'BUY',
        qty: Math.abs(r[TRADE.adjQty] || 0),
        price: r[TRADE.adjPrice] * k,
        balanceQty: r[TRADE.balanceQty] ?? 0,      // a share count — never rescaled
        avgPrice: (r[TRADE.avgPrice] ?? 0) * k,
        currency: local ? local.currency : String(r[TRADE.currency] || 'USD'),
        ...(platform ? { platform } : {}),
        ...(pot ? { pot } : {}),
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
        const gain = r[TRADE.gainLC];
        if (gain != null && !Number.isFinite(Number(gain))) {
            throw new Error(`Tradelog row ${i + 1} (${key}): Gain/(Loss) is "${gain}", not a number. `
                + `An Excel formula is broken — most likely the external link to the Master Cashflow workbook.`);
        }
        // Realized gain was computed off the same USD price, so it rescales with it.
        const local = localPriceScale(sheet, i, String(r[TRADE.currency] || ''));
        realized.set(key, (realized.get(key) || 0) + (Number(gain) || 0) * (local ? local.scale : 1));
        const t = parseTrade(r, i + 1, local);
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
            // Optional PE inputs — see AGENTS.md. Omitted when unset so they don't bloat
            // holdings.json for the (most) instruments that don't use them.
            eps: m.eps,
            specialEps: m.specialEps,
            specialEpsLabel: m.specialEpsLabel,
            // Ordinary shares represented by ONE ADR (0.25 = 1 ADR is a quarter of a share).
            // Yahoo scales per-share figures to the ADR while reporting revenue and income at
            // company level, so the deep dive uses this to put the filed statements back on the
            // underlying's basis. Set it only for a true depositary receipt.
            adrShares: m.adrShares,
            // The home listing that files this company's statements, where this instrument is a
            // depositary receipt or a foreign secondary line (NTDOY and NTO.F both -> 7974.T).
            // Fundamentals and the results date are read from it, so one company has one dataset
            // however many of its lines you happen to hold.
            primary: m.primary,
            // A gilt's ISIN. Yahoo lists no gilts, so fetch-prices prices one from the London
            // order book by ISIN (gilt-quote.js), and `yahoo` is then just its key. A gilt is
            // recorded in the Tradelog under its ISIN, so the meta.json key is one.
            isin: m.isin || (GILT_ISIN.test(sym) ? sym : undefined),
            // Its exchange code (T31), where known: the bot priced gilts by it until 22 Oct 2026.
            lse: m.lse,
            // An iShares bond fund's page path (id/slug), where its weighted average yield to
            // maturity is published — see fetchIsharesYtm.
            ishares: m.ishares,
            // Splits as facts, [{ date, ratio }], because Yahoo's own list cannot be relied on
            // (it withdrew TKOMY's real 15:1 a day after publishing it). See unsplit in fetch-prices.
            splits: m.splits,
            // Trough-multiple valuation: the cheapest this traded in living memory, and what
            // it was earning then. Manually recorded — a 5y low is a judgement, not a lookup.
            lowPrice: m.lowPrice,
            lowEps: m.lowEps,
            lowDate: m.lowDate,
            lowGrowth: m.lowGrowth,
            growth: m.growth,
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

// ---------------------------------------------------------------- a new holding's meta.json entry
//
// Leo, 26 Oct 2026: SUPR was bought, had no meta.json entry, and every publish for a night was
// refused. The refusal is right (a position the app cannot price must not vanish silently), but the
// entry can be found rather than typed, provided a wrong guess cannot slip through. So a missing
// entry is filled only when exactly one listing passes every check:
//   - it comes from the watchlist (where most holdings start), or is the Tradelog symbol on the
//     exchange its trade currency implies: pence -> .L, HKD -> a 4-digit .HK, JPY -> .T, ...;
//   - Yahoo quotes it in the trade's currency (pence and pounds count as one, scaled);
//   - its price is within 40% of what Leo last paid, which catches a wrong exchange, wrong units
//     and a different share class.
// Anything else is refused as before, saying why. A symbol that is an ISIN is a gilt, and goes to
// resolveGilt instead.
const SUFFIXES = { GBp: ['.L'], GBP: ['.L'], HKD: ['.HK'], JPY: ['.T'], USD: [''], KRW: ['.KS', '.KQ'],
    EUR: ['.PA', '.AS', '.DE', '.MI', '.MC', '.BR', '.HE', '.IR', '.LS', '.F', '.VI'], CHF: ['.SW'], CAD: ['.TO'],
    AUD: ['.AX'], SGD: ['.SI'], TWD: ['.TW'], IDR: ['.JK'], SEK: ['.ST'], DKK: ['.CO'], NOK: ['.OL'] };
// Venues that quote almost every large European company in euros as well as its home exchange. A
// dry run over the book on 26 Oct 2026 refused LVMH, L'Oreal, Hermes and Bureau Veritas because
// Vienna fitted beside Paris, and resolved Nintendo to Vienna where the holding is Frankfurt's line.
// Used only when no home-exchange listing fits; two of them fitting is refused, never guessed.
const SECONDARY = new Set(['.F', '.VI']);
const GEOGRAPHY = { '.L': 'Europe', '.PA': 'Europe', '.AS': 'Europe', '.DE': 'Europe', '.MI': 'Europe', '.MC': 'Europe',
    '.BR': 'Europe', '.HE': 'Europe', '.IR': 'Europe', '.LS': 'Europe', '.VI': 'Europe', '.SW': 'Europe', '.ST': 'Europe',
    '.CO': 'Europe', '.OL': 'Europe', '.HK': 'Old Hongkong', '.T': 'Japan', '.KS': 'Korea', '.KQ': 'Korea',
    '.SI': 'SEA', '.JK': 'SEA', '': 'US' };
const tradeCurrency = c => (c === 'Gbpence' ? 'GBp' : c);
const pence = c => c === 'GBp' || c === 'Gbpence';
const root = s => String(s).toUpperCase().split('.')[0].replace(/^0+(?=\d)/, '');
const suffixOf = y => (y.match(/(\.[A-Z]+)$/i) || ['', ''])[1].toUpperCase();
const cleanName = n => String(n || '').trim()
    .replace(/[, ]+(plc|p\.l\.c\.|s\.a\.|sa|inc\.?|corporation|corp\.?|limited|ltd\.?|ag|n\.v\.|nv|se|tbk|co\.,? ltd\.?)$/i, '')
    .replace(/[, ]+(plc|inc\.?|ltd\.?|limited)$/i, '');

// Yahoo's currency, price and name for a symbol, from the chart call fetch-prices makes.
async function yahooQuote(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return null;
        const m = (await res.json()).chart?.result?.[0]?.meta;
        return m?.regularMarketPrice ? { currency: m.currency, price: m.regularMarketPrice, name: m.longName || m.shortName } : null;
    } catch { return null; }
}

// { entry } or { why }. `quoteOf` is yahooQuote, or a stand-in in the selftest.
async function resolveMeta(sym, trades, watchlist, quoteOf, today = new Date().toISOString().slice(0, 10)) {
    if (GILT_ISIN.test(sym)) return { why: 'an ISIN: resolveGilt, not a Yahoo listing' };
    const buys = trades.filter(t => t.side !== 'SELL');
    const paid = buys[buys.length - 1] || trades[trades.length - 1];
    const ccy = tradeCurrency(paid.currency);
    const fromWatch = watchlist.filter(w => root(w.yahoo) === root(sym));
    const base = /^\d+$/.test(root(sym)) ? root(sym).padStart(ccy === 'KRW' ? 6 : 4, '0') : String(sym).toUpperCase();
    const built = sym.includes('.') ? [sym] : (SUFFIXES[ccy] || []).map(s => base + s);
    const tried = [...new Set([...fromWatch.map(w => w.yahoo), ...built])];
    const pass = [];
    for (const y of tried) {
        const q = await quoteOf(y);
        if (!q) continue;
        const same = q.currency === ccy || (pence(q.currency) && pence(ccy)) || (q.currency === 'GBP' && pence(ccy)) || (pence(q.currency) && ccy === 'GBP');
        if (!same) continue;
        const scaled = q.price * (q.currency === 'GBP' && pence(ccy) ? 100 : pence(q.currency) && ccy === 'GBP' ? 0.01 : 1);
        const ratio = scaled / paid.price;
        if (!(ratio > 0.6 && ratio < 1 / 0.6)) continue;
        pass.push({ y, q, watch: fromWatch.find(w => w.yahoo === y) });
        if (pass[pass.length - 1].watch) break;          // the watchlist's own listing settles it
    }
    const home = pass.filter(p => !SECONDARY.has(suffixOf(p.y)));
    const pick = pass.find(p => p.watch) || (home.length === 1 ? home[0] : !home.length && pass.length === 1 ? pass[0] : null);
    if (!pick) {
        return { why: pass.length ? `${pass.length} listings fit (${pass.map(p => p.y).join(', ')}), add the right one by hand`
            : `no listing quoted in ${ccy} near the ${paid.price} paid (tried ${tried.join(', ') || 'nothing'})` };
    }
    const w = pick.watch || {};
    const entry = {
        ticker: sym, yahoo: pick.y, group: w.name || cleanName(pick.q.name) || sym,
        geography: w.geography || GEOGRAPHY[suffixOf(pick.y)] || 'Other', currency: ccy,
    };
    for (const k of ['eps', 'specialEps', 'specialEpsLabel', 'primary', 'adrShares']) if (w[k] != null) entry[k] = w[k];
    // meta.json is public: the note says how the entry was found, never what was paid (D67).
    entry.auto = `${today}: ${pick.watch ? 'from the watchlist' : 'from the Tradelog symbol and its currency'}; `
        + `Yahoo quotes ${pick.y} in ${pick.q.currency}, within 40% of the trade price`;
    return { entry, check: `${pick.y} at ${pick.q.currency} ${pick.q.price} against ${paid.price} paid` };
}

// A gilt recorded under its ISIN (28 Oct 2026; until then always refused). onvista's London Stock
// Exchange quote names it, prices it and says who issued it, so the entry is filled only for a UK
// government bond, quoted in pounds per £100 within 40% of the price paid: a Qty entered as the
// nominal rather than nominal ÷ 100 puts the price a hundred times out. The ticker is UKT and the
// maturity year (UKT36). The exchange's own code (T31) can no longer be looked up, so it is not
// guessed, and two gilts maturing in the same year are refused. `yahoo` is the ticker plus .L,
// the key every price and close is stored under: the ticker can be renamed by hand, the key never.
async function resolveGilt(isin, trades, taken, giltOf = giltQuote, today = new Date().toISOString().slice(0, 10)) {
    const buys = trades.filter(t => t.side !== 'SELL');
    const paid = buys[buys.length - 1] || trades[trades.length - 1];
    if (tradeCurrency(paid.currency) !== 'GBP') return { why: `an ISIN traded in ${paid.currency}, not pounds: add it by hand` };
    let g;
    try { g = await giltOf(isin); } catch (e) { return { why: `an ISIN with no London Stock Exchange quote on onvista (${e.message}): add it by hand` }; }
    if (!g.gilt) return { why: `an ISIN, but not a UK government bond (${g.issuer || 'issuer unknown'}): add it by hand` };
    const ratio = g.mid / paid.price;
    if (!(ratio > 0.6 && ratio < 1 / 0.6)) {
        return { why: `a gilt quoted at ${g.mid} per £100 against ${paid.price} paid: in the Tradelog, Qty is the nominal ÷ 100 and Price is per £100` };
    }
    const yy = String(g.maturity || '').slice(2, 4);
    const ticker = `UKT${yy}`;
    if (!/^\d\d$/.test(yy)) return { why: 'a gilt with no maturity date on onvista: add it by hand' };
    if (taken.has(ticker) || taken.has(`${ticker}.L`)) return { why: `${ticker} is taken, a second gilt maturing in 20${yy}: add it by hand` };
    const entry = {
        ticker, yahoo: `${ticker}.L`, isin, group: 'UK Gilts', geography: 'Europe', currency: 'GBP',
        // meta.json is public: how the entry was found, never what was paid (D67).
        auto: `${today}: ${g.name}, found by its ISIN on onvista.de's London Stock Exchange quote; `
            + 'a UK government issue, priced in pounds per £100 within 40% of the trade price',
    };
    return { entry, check: `${isin} = ${g.name}, ${g.basis} ${g.mid} against ${paid.price} paid` };
}

// Verify only brand-new symbols against Yahoo before we commit them. A typo'd symbol
// would otherwise pass extraction and then vanish from the site (portfolio.js skips
// holdings with no quote). Normal runs add nothing new, so this makes zero requests.
async function verifyNewSymbols(holdings) {
    let quotes;
    try { quotes = JSON.parse(fs.readFileSync('prices.json', 'utf8')).quotes || {}; }
    catch { return; } // no baseline yet (first ever run) — nothing to diff against
    for (const h of newSymbols(holdings, new Set(Object.keys(quotes)))) {
        // A gilt the same way the bot will price it: the London order book, by ISIN.
        const price = h.isin ? (await giltQuote(h.isin).catch(() => null))?.mid : await yahooPrice(h.yahoo);
        if (price == null) {
            throw new Error(h.isin
                ? `new gilt ${h.ticker}: no London Stock Exchange price for ISIN ${h.isin} on onvista. Check the ISIN (or your connection) before publishing.`
                : `new instrument ${h.ticker}: Yahoo symbol "${h.yahoo}" returned no price. Fix its "yahoo" in ${META} (or check your connection) before publishing.`);
        }
        console.log(`  verified new instrument: ${h.ticker} -> ${h.isin ? 'ISIN ' + h.isin : h.yahoo} (${price})`);
    }
}

// IBKR's payment rows onto holdings. IBKR's symbols are its own (1 for 0001.HK, 5332.T, MC for
// MC.PA, and MOHd for an LVMH interim line), so: the exact ticker or Yahoo symbol, then the same
// symbol without its exchange suffix or leading zeros, then any row sharing the ISIN of one already
// matched. Rows for a position no longer held are reported, never forced onto a holding.
// `isinTo` maps a Tradelog symbol that IS an ISIN to its Yahoo symbol: IBKR names a bond by its
// description ("UKT 4 10/22/31"), so a gilt recorded under its ISIN is found by that alone.
// Each row becomes [payDate, exDate, amount, currency, type].
function matchReceipts(rows, holdings, isinTo = {}) {
    const base = s => String(s).split('.')[0].replace(/^0+(?=\d)/, '').toUpperCase();
    const find = sym => holdings.find(h => h.ticker === sym || h.yahoo === sym)
        || (c => (c.length === 1 ? c[0] : null))(holdings.filter(h => base(h.ticker) === base(sym) || base(h.yahoo) === base(sym)));
    const byIsin = {};
    for (const r of rows) { const h = find(r.symbol); if (h && r.isin) byIsin[r.isin] = h; }
    const byYahoo = {}, unmatched = new Set();
    for (const r of rows) {
        const h = find(r.symbol) || byIsin[r.isin] || holdings.find(x => x.yahoo === isinTo[r.isin]);
        if (!h) { unmatched.add(r.symbol); continue; }
        (byYahoo[h.yahoo] = byYahoo[h.yahoo] || []).push([r.date, r.exDate, r.amount, r.currency, r.type]);
    }
    return { byYahoo, unmatched: [...unmatched].sort() };
}

async function main() {
    if (!fs.existsSync(WORKBOOK)) {
        throw new Error(`${WORKBOOK} not found. It is gitignored, so this only runs on your machine.`);
    }
    const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
    // cellFormula: the Japanese rows hide their real yen price inside the price formula, and the
    // cached value alone is a USD figure that drifts with a live FX rate. See LOCAL_PRICE.
    const wb = XLSX.readFile(WORKBOOK, { cellDates: true, cellFormula: true, sheets: ['Tradelog'] });
    if (!wb.Sheets.Tradelog) throw new Error('no "Tradelog" tab in workbook');

    const { bySymbol, realized } = readTradelog(wb.Sheets.Tradelog);

    // Guard the one new failure mode: a position is open in the Tradelog but has no
    // meta.json entry, so it would silently vanish from the app.
    const openMissing = [...bySymbol.entries()]
        .filter(([sym, tr]) => tr[tr.length - 1].balanceQty > 0 && !meta[sym])
        .map(([sym]) => sym);
    // Filled automatically where exactly one listing passes the checks in resolveMeta; refused, as
    // before, if any cannot be: nothing is written unless every missing entry is found.
    if (openMissing.length) {
        let watchlist = [];
        try { const w = JSON.parse(fs.readFileSync('watchlist.json', 'utf8')); watchlist = Array.isArray(w) ? w : w.items || []; } catch { /* none */ }
        const found = [], refused = [];
        const taken = new Set(Object.values(meta).flatMap(e => [e.ticker, e.yahoo]));
        for (const sym of openMissing) {
            const r = GILT_ISIN.test(sym) ? await resolveGilt(sym, bySymbol.get(sym), taken)
                : await resolveMeta(sym, bySymbol.get(sym), watchlist, yahooQuote);
            if (r.entry) { found.push({ ...r.entry, check: r.check }); taken.add(r.entry.ticker); taken.add(r.entry.yahoo); }
            else refused.push(`${sym} (${r.why})`);
        }
        if (refused.length) {
            throw new Error(`open positions missing from ${META}: ${refused.join('; ')}. Add an entry (yahoo, group, geography, currency) by hand`
                + (found.length ? `; these were found and will be added once that is done: ${found.map(e => e.ticker + ' -> ' + e.yahoo).join(', ')}` : '') + '.');
        }
        for (const { check, ...e } of found) {
            meta[e.ticker] = e;
            console.log(`  added to ${META}: ${e.ticker} -> ${e.yahoo}, "${e.group}", ${e.geography}, ${e.currency} (${check})`);
        }
        fs.writeFileSync(META, JSON.stringify(meta, null, 2) + '\n');
    }

    const holdings = buildHoldings(meta, bySymbol, realized);
    if (holdings.length < 10) throw new Error(`only ${holdings.length} holdings parsed; refusing to overwrite`);

    const dupes = holdings.map(h => h.yahoo).filter((y, i, a) => a.indexOf(y) !== i);
    if (dupes.length) throw new Error(`duplicate Yahoo symbols: ${dupes.join(', ')}`);

    await verifyNewSymbols(holdings); // network only for symbols not already in prices.json

    // What IBKR actually paid each holding (`npm run dividends`, ibkr-dividends.js), sealed with
    // the rest below: amounts. Optional — without the file nothing is attached.
    if (fs.existsSync('.ibkr-dividends.json')) {
        const ib = JSON.parse(fs.readFileSync('.ibkr-dividends.json', 'utf8'));
        const isinTo = Object.fromEntries(Object.entries(meta).filter(([k]) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(k)).map(([k, m]) => [k, m.yahoo]));
        const { byYahoo, unmatched } = matchReceipts(require('./ibkr-dividends.js').allRows(ib), holdings, isinTo);
        // Every holding with IBKR shares gets the record's start, paid or not: no rows inside the
        // record means nothing was paid there, not that it is unknown.
        for (const h of holdings) if (byYahoo[h.yahoo] || h.trades.some(t => t.platform === 'IB'))
            h.received = { from: ib.coverageFrom, rows: byYahoo[h.yahoo] || [] };
        console.log(`  IBKR receipts: ${Object.keys(byYahoo).length} holding(s), record from ${ib.coverageFrom}`
            + (unmatched.length ? `; not held now or unmatched: ${unmatched.join(', ')}` : ''));
    }

    // Public half + sealed half (vault.js, D67). seal() throws without a passphrase, so a missing
    // key refuses the write instead of publishing quantities in the clear.
    const { seal, open, publicRow } = require('./vault');
    const pub = holdings.map(publicRow);
    const groups = new Set(holdings.map(h => h.group));
    // Nothing new: leave the file exactly as it is. The seal is re-randomised on every write and
    // `generated` moves, so rewriting identical holdings made a commit and a CI run out of nothing,
    // which publish-on-change.js did whenever OneDrive merely touched the workbook (14 Oct 2026).
    let same = false;
    try {
        const prev = JSON.parse(fs.readFileSync('holdings.json', 'utf8'));
        same = JSON.stringify(prev.holdings) === JSON.stringify(pub)
            && JSON.stringify(open(prev.sealed)) === JSON.stringify({ holdings });
    } catch { /* no file, or a sealed half this key cannot open: write it fresh */ }
    if (same) {
        console.log(`holdings.json unchanged: ${holdings.length} instruments in ${groups.size} groups`);
        return;
    }
    fs.writeFileSync('holdings.json', JSON.stringify({
        generated: new Date().toISOString(),
        note: 'Tickers and groupings only. Quantities, costs and trades are in `sealed` (vault.js).',
        holdings: pub,
        sealed: seal({ holdings }),
    }, null, 1));

    console.log(`wrote holdings.json: ${holdings.length} instruments in ${groups.size} groups`);
    for (const g of [...groups].sort()) {
        const rows = holdings.filter(h => h.group === g);
        if (rows.length > 1) console.log(`  merged: ${g} <- ${rows.map(r => r.yahoo).join(' + ')}`);
    }
    const noTrade = holdings.filter(h => !h.lastTrade).map(h => h.yahoo);
    if (noTrade.length) console.warn(`  no Tradelog match (last-trade column will be blank): ${noTrade.join(', ')}`);
}

async function selftest() {
    const assert = require('assert');

    // parseTrade: side/qty/date normalisation, platform + comment optional.
    const row = [];
    row[TRADE.side] = 'SELL'; row[TRADE.symbol] = 'NVDA';
    // Local midnight, exactly as xlsx hands dates over — a UTC instant here would pass in
    // London and fail in New York, hiding the very bug ymdLocal exists to prevent.
    row[TRADE.date] = new Date(2025, 0, 22); row[TRADE.adjPrice] = 147.27;
    row[TRADE.adjQty] = -5; row[TRADE.balanceQty] = 115;
    row[TRADE.avgPrice] = 13.267; row[TRADE.currency] = 'USD';
    row[TRADE.platform] = 'IB'; row[TRADE.comment] = 'Trim & review';
    assert.deepStrictEqual(parseTrade(row), {
        symbol: 'NVDA', date: '2025-01-22', side: 'SELL', qty: 5, price: 147.27,
        balanceQty: 115, avgPrice: 13.267, currency: 'USD', platform: 'IB', comment: 'Trim & review',
    });
    const noPlat = [...row]; noPlat[TRADE.platform] = null;
    assert.strictEqual('platform' in parseTrade(noPlat), false); // blank platform omitted

    // A broken Excel formula must be loud. Adj Qty and Gain/(Loss) resolve through an
    // external-workbook link; if it breaks, xlsx hands back "#REF!" as a string and
    // Math.abs() would quietly publish NaN quantities for every trade.
    const broken = [...row]; broken[TRADE.adjQty] = '#REF!';
    assert.throws(() => parseTrade(broken, 367), /adjQty is "#REF!", not a number/);
    const badPrice = [...row]; badPrice[TRADE.adjPrice] = '#VALUE!';
    assert.throws(() => parseTrade(badPrice, 12), /adjPrice is "#VALUE!"/);
    // A legitimate numeric string still parses — xlsx sometimes hands numbers back as text.
    const asText = [...row]; asText[TRADE.adjQty] = '-5';
    assert.strictEqual(parseTrade(asText).qty, 5);

    // localPriceScale: the real 5332 row. Excel stores `=3976/rngUSDJPY` with Currency "USD"
    // because its data provider cannot price Tokyo, so it reports the ADR. The yen price is the
    // numerator; the scale comes from the cell itself, so it is exact whatever the live rate is.
    const sheet = { F1: { f: '3976/rngUSDJPY', v: 3976 / 162.39 } };
    const scaled = localPriceScale(sheet, 0, 'USD');
    assert.strictEqual(scaled.currency, 'JPY');
    assert.ok(Math.abs(scaled.scale - 162.39) < 1e-6);
    // Rows already recorded in their own currency are left alone, as are plain typed prices.
    assert.strictEqual(localPriceScale({ F1: { f: '3976/rngUSDJPY', v: 24.48 } }, 0, 'JPY'), null);
    assert.strictEqual(localPriceScale({ F1: { v: 12.5 } }, 0, 'USD'), null);
    assert.strictEqual(localPriceScale({}, 0, 'USD'), null);

    // Applying it: price and average cost rescale into JPY, quantities never do, and the
    // currency follows the recovered one rather than the workbook's "USD".
    const jp = [];
    jp[TRADE.side] = 'BUY'; jp[TRADE.symbol] = '5332';
    jp[TRADE.date] = new Date(2025, 1, 21);
    jp[TRADE.adjPrice] = 3976 / 162.39; jp[TRADE.adjQty] = 100;
    jp[TRADE.balanceQty] = 100; jp[TRADE.avgPrice] = 3979.18 / 162.39;
    jp[TRADE.currency] = 'USD';
    const out = parseTrade(jp, 341, { currency: 'JPY', scale: 162.39 });
    assert.strictEqual(out.currency, 'JPY');
    assert.ok(Math.abs(out.price - 3976) < 1e-6);        // the yen price, recovered
    assert.ok(Math.abs(out.avgPrice - 3979.18) < 1e-6);  // IBKR's avg for this position
    assert.strictEqual(out.balanceQty, 100);             // a share count, untouched
    assert.strictEqual(out.qty, 100);

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

    // IBKR's symbols onto holdings: exact, then without suffix or leading zeros, then by ISIN.
    const held = [{ ticker: '1', yahoo: '0001.HK' }, { ticker: '5332', yahoo: '5332.T' }, { ticker: 'MC', yahoo: 'MC.PA' }];
    const r = (symbol, isin, amount) => ({ date: '2025-12-04', exDate: '2025-12-02', symbol, isin, amount, currency: 'EUR', type: 'Dividends' });
    const m = matchReceipts([r('1', 'KY1', 1), r('5332.T', 'JP1', 2), r('MC', 'FR1', 3), r('MOHd', 'FR1', 4), r('SOLD', 'XX1', 5)], held);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(m.byYahoo).map(([k, v]) => [k, v.map(x => x[2])])),
        { '0001.HK': [1], '5332.T': [2], 'MC.PA': [3, 4] }, 'MOHd joins MC by ISIN');
    assert.deepStrictEqual(m.unmatched, ['SOLD'], 'a position no longer held is reported, not forced onto one');
    const gilt = matchReceipts([r('UKT 4 10/22/31', 'GB00BPSNBF73', -18.58)], [...held, { ticker: 'T31', yahoo: 'T31.L' }], { GB00BPSNBF73: 'T31.L' });
    assert.deepStrictEqual(Object.keys(gilt.byYahoo), ['T31.L'], 'a bond IBKR names by description is found by the ISIN it was recorded under');

    // resolveMeta: a new holding's entry, found only when one listing passes every check.
    const quotes = {
        'SUPR.L': { currency: 'GBp', price: 83.5, name: 'Supermarket Income REIT plc' },
        '0388.HK': { currency: 'HKD', price: 410, name: 'Hong Kong Exchanges and Clearing Limited' },
        'BVI.PA': { currency: 'EUR', price: 28.99, name: 'Bureau Veritas SA' },
        'BVI.DE': { currency: 'EUR', price: 29.1, name: 'Bureau Veritas SA' },
        'MC.PA': { currency: 'EUR', price: 600, name: 'LVMH Moet Hennessy Louis Vuitton SE' },
        'MC.VI': { currency: 'EUR', price: 601, name: 'LVMH Moet Hennessy Louis Vuitton SE' },
        'NTO.F': { currency: 'EUR', price: 60, name: 'Nintendo Co., Ltd.' },
        'NTO.VI': { currency: 'EUR', price: 60.2, name: 'Nintendo Co., Ltd.' },
        'XYZ': { currency: 'USD', price: 5, name: 'Something Inc.' },
    };
    const quoteOf = async y => quotes[y] || null;
    const paidAt = (price, currency) => [{ side: 'BUY', price, currency }];
    const watch = [{ yahoo: 'SUPR.L', name: 'Supermarket Income REIT', geography: 'Europe', specialEps: 5.7, specialEpsLabel: 'EPRA' }];
    let res = await resolveMeta('SUPR', paidAt(80.65, 'Gbpence'), watch, quoteOf, '2026-10-26');
    const { auto, ...supr } = res.entry;
    assert.deepStrictEqual(supr, { ticker: 'SUPR', yahoo: 'SUPR.L', group: 'Supermarket Income REIT', geography: 'Europe',
        currency: 'GBp', specialEps: 5.7, specialEpsLabel: 'EPRA' }, 'from the watchlist, its recurring EPS carried over');
    assert.ok(!/80\.65/.test(auto) && /80\.65/.test(res.check), 'the price paid stays in the local log, never in public meta.json');
    res = await resolveMeta('388', paidAt(400, 'HKD'), [], quoteOf);
    assert.deepStrictEqual([res.entry.yahoo, res.entry.group, res.entry.geography], ['0388.HK', 'Hong Kong Exchanges and Clearing', 'Old Hongkong'],
        'padded to four digits, name cleaned');
    assert.ok(/2 listings fit/.test((await resolveMeta('BVI', paidAt(28, 'EUR'), [], quoteOf)).why), 'two home-exchange euro listings fit: refused');
    assert.strictEqual((await resolveMeta('MC', paidAt(590, 'EUR'), [], quoteOf)).entry.yahoo, 'MC.PA', 'Vienna beside Paris: Paris');
    assert.ok(/2 listings fit/.test((await resolveMeta('NTO', paidAt(59, 'EUR'), [], quoteOf)).why), 'only secondary venues, two of them: refused');
    assert.ok(/no listing/.test((await resolveMeta('XYZ', paidAt(50, 'USD'), [], quoteOf)).why), 'ten times off: wrong listing or units, refused');
    assert.strictEqual((await resolveMeta('SUPR', paidAt(0.8065, 'GBP'), [], quoteOf)).entry.yahoo, 'SUPR.L', 'pounds against a pence quote');
    assert.ok(/ISIN/.test((await resolveMeta('GB00BPSNBF73', paidAt(95, 'GBP'), [], quoteOf)).why), 'an ISIN is not a Yahoo listing');
    // A gilt by ISIN (resolveGilt), against stand-ins for gilt-quote.js.
    const gilts = {
        GB00BWBR1N39: { gilt: true, mid: 96.38, basis: 'mid', maturity: '2036-07-31', name: '4 7/8% TREASURY GILT 31/07/36' },
        DE0001102580: { gilt: false, mid: 88, maturity: '2032-02-15', issuer: 'Deutschland, Bundesrepublik' },
        GB00BPSNBF73: { gilt: true, mid: 95.5, maturity: '2031-10-22', name: '4% TREASURY GILT 22/10/31' },
    };
    const giltOf = async i => { if (!gilts[i]) throw new Error('no London Stock Exchange GBP venue on onvista'); return gilts[i]; };
    const taken = new Set(['T31', 'T31.L']);
    res = await resolveGilt('GB00BWBR1N39', paidAt(96.25, 'GBP'), taken, giltOf, '2026-10-28');
    const { auto: giltAuto, ...ukt36 } = res.entry;
    assert.deepStrictEqual(ukt36, { ticker: 'UKT36', yahoo: 'UKT36.L', isin: 'GB00BWBR1N39', group: 'UK Gilts', geography: 'Europe', currency: 'GBP' },
        'a UK gilt by ISIN: filled, under the UK Gilts group T31 is in');
    assert.ok(!/96\.25/.test(giltAuto) && /96\.25/.test(res.check), 'the price paid stays out of public meta.json');
    assert.ok(/nominal/.test((await resolveGilt('GB00BWBR1N39', paidAt(0.9625, 'GBP'), taken, giltOf)).why), 'per £1, not per £100: refused, saying why');
    assert.ok(/not a UK government/.test((await resolveGilt('DE0001102580', paidAt(88, 'GBP'), taken, giltOf)).why), 'a Bund: refused');
    assert.ok(/not pounds/.test((await resolveGilt('GB00BWBR1N39', paidAt(96, 'EUR'), taken, giltOf)).why), 'bought in euros: refused');
    assert.ok(/no London/.test((await resolveGilt('GB0000000009', paidAt(96, 'GBP'), taken, giltOf)).why), 'not quoted: refused');
    assert.ok(/taken/.test((await resolveGilt('GB00BWBR1N39', paidAt(96, 'GBP'), new Set(['UKT36']), giltOf)).why), 'two maturing in one year: refused');
    console.log('selftest ok');
}

// Guarded, so another script can require the helpers without running an extract.
if (require.main === module) {
    if (process.argv[2] === '--selftest') selftest().catch(e => { console.error(e); process.exit(1); });
    else main().catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { resolveMeta, resolveGilt, yahooQuote, readTradelog };
