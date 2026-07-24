// Fetches quotes + FX rates from Yahoo Finance, writes prices.json.
// Run by .github/workflows/prices.yml; also `node fetch-prices.js` locally.
const fs = require('fs');
const { holdings } = require('./holdings.json');
// Stocks watched but not owned. They ride the SAME pipeline (quotes, weekly history, trough
// PE, annual financials) — no second fetch path — but they are deliberately absent from
// navHistory() and from every portfolio total. See buildWatchlist() in portfolio.js.
const watchlist = require('./watchlist.json');
const { cohortMV, twr } = require('./portfolio.js'); // local, dependency-free — CI stays clean

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const DAY = 86400;
const weekEnd = ts => ts + ((5 - new Date(ts * 1000).getUTCDay() + 7) % 7) * DAY;

// Fractional change (0.25 = +25%) from the first close on/after cutoff, to current.
// Fractions, not whole percents: the page formats them, and every other ratio in
// this codebase is a fraction. Rounded to 4dp purely to keep prices.json small.
function pctFrom(timestamps, closes, cutoffTs, current) {
    for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= cutoffTs && closes[i] != null) {
            return Math.round(((current - closes[i]) / closes[i]) * 1e4) / 1e4;
        }
    }
    return null;
}

function movements(timestamps, closes, current, now = Date.now() / 1000) {
    const jan1 = Math.floor(Date.UTC(new Date(now * 1000).getUTCFullYear(), 0, 1) / 1000);
    return {
        '7d': pctFrom(timestamps, closes, now - 7 * DAY, current),
        '1m': pctFrom(timestamps, closes, now - 30 * DAY, current),
        '3m': pctFrom(timestamps, closes, now - 91 * DAY, current),
        '6m': pctFrom(timestamps, closes, now - 182 * DAY, current),
        '1y': pctFrom(timestamps, closes, now - 365 * DAY, current),
        'ytd': pctFrom(timestamps, closes, jan1, current),
    };
}

// One request per ticker: a year of daily closes covers every period column.
// Retries transient failures — CI runs from a shared IP that Yahoo rate-limits,
// and a single hiccup would otherwise silently drop a holding from the dashboard.
async function fetchTicker(ticker, attempts = 3) {
    // Index symbols start with a caret (^GSPC); encode it so the URL stays valid.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.replace('^', '%5E')}?range=1y&interval=1d&events=div`;
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const r = (await res.json()).chart?.result?.[0];
            if (!r?.meta?.regularMarketPrice) throw new Error('no price in response');
            return shape(r);
        } catch (e) {
            lastErr = e;
            if (a < attempts - 1) await new Promise(r => setTimeout(r, 600 * (a + 1)));
        }
    }
    throw lastErr;
}

function shape(r) {
    const price = r.meta.regularMarketPrice;
    const timestamps = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    const divTTM = Object.values(r.events?.dividends || {}).reduce((sum, d) => sum + (d.amount || 0), 0);
    return {
        price,
        // Trust Yahoo over the workbook: .L tickers quote in pence ("GBp"), .T in JPY.
        currency: r.meta.currency || 'USD',
        divTTM: Number(divTTM.toPrecision(6)),
        divYield: price ? Number((divTTM / price).toPrecision(6)) : null,
        ...movements(timestamps, closes, price),
        series: { timestamps, closes }, // stripped before writing; only used to build NAV history
    };
}

// Weekly full-history closes for the long chart ranges (2Y/5Y/All). Weekly keeps the
// file bounded — daily over 10y × 57 tickers would be several MB. Same {currency,series}
// shape as the daily quotes, so alignedCloses/navHistory work on it unchanged.
async function fetchWeekly(ticker, attempts = 3) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.replace('^', '%5E')}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1wk`;
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const r = (await res.json()).chart?.result?.[0];
            if (!r?.timestamp) throw new Error('no history in response');
            if (r.meta?.dataGranularity !== '1wk') throw new Error(`Yahoo returned ${r.meta?.dataGranularity || 'unknown'} history`);
            return { currency: r.meta?.currency || 'USD', series: { timestamps: r.timestamp.map(weekEnd), closes: r.indicators?.quote?.[0]?.close || [] } };
        } catch (e) {
            lastErr = e;
            if (a < attempts - 1) await new Promise(r => setTimeout(r, 600 * (a + 1)));
        }
    }
    throw lastErr;
}

// Yahoo gates EPS behind a crumb+cookie handshake (unlike the chart endpoint above,
// which is why everything else in this file uses only that). Best-effort: a failed
// handshake just means no auto EPS this run — meta.json's manual `eps`/`specialEps`
// (via holdings.json) still drive the PE columns, same as a missing quote does elsewhere.
//
// The crumb endpoint's own Set-Cookie is not sufficient on its own — Yahoo's quote API
// 401s on it. It needs a real session cookie first, from fc.yahoo.com (this is the same
// two-step dance yfinance and other Yahoo scrapers settled on after Yahoo tightened this
// in 2023-24). Both requests below must reuse that one cookie.
async function getCrumb() {
    const sessionRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } });
    const cookie = (sessionRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('no session cookie from fc.yahoo.com');

    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, Cookie: cookie },
    });
    if (!crumbRes.ok) throw new Error(`HTTP ${crumbRes.status}`);
    const crumb = (await crumbRes.text()).trim();
    if (!crumb) throw new Error('no crumb in response');
    return { crumb, cookie };
}

// Pure parse, kept separate from the fetch so it's selftest-able without a network call.
//
// The next results date rides along in the same response — no extra request.
//
// Yahoo's earningsTimestamp is NOT reliably the NEXT one: once a company has reported and the
// following date isn't scheduled yet, it keeps handing back the LAST one (in July 2026 MKS.L
// returns 2026-05-20 and 1113.HK 2026-03-19, both long past). Only a future date is a "next
// results" date; a past one is dropped rather than displayed as if it were upcoming. `now` is a
// parameter so this stays testable.
function parseQuotes(json, now = Date.now()) {
    const eps = {}, earnings = {}, types = {};
    for (const r of json.quoteResponse?.result || []) {
        // EQUITY vs ETF/INDEX/MUTUALFUND/CRYPTOCURRENCY. Rides this batch call for free, and is
        // what lets the caller skip the per-ticker gated fundamentals fetches (annual EPS,
        // ex-div) for anything that isn't an operating company — see nonEquity in main().
        if (r.quoteType) types[r.symbol] = r.quoteType;
        if (typeof r.epsTrailingTwelveMonths === 'number') eps[r.symbol] = r.epsTrailingTwelveMonths;
        const ts = r.earningsTimestamp ?? r.earningsTimestampStart;
        if (typeof ts === 'number' && ts * 1000 > now) {
            earnings[r.symbol] = {
                date: new Date(ts * 1000).toISOString().slice(0, 10),
                // Yahoo flags a guessed date; say so rather than implying it's confirmed.
                ...(r.isEarningsDateEstimate ? { estimate: true } : {}),
            };
        }
    }
    return { eps, earnings, types };
}

// Ex-dividend date, from quoteSummary's calendarEvents. NOT in the batch v7/quote response
// (its exDividendDate is empty and its dividendDate is the pay date, often stale and missing
// outside the US), so this is a PER-TICKER request against the crumb-gated endpoint — the same
// one the PE pipeline leans on. That is exactly why it is cached and only fetched for payers
// whose cached date has passed (see exDivToFetch), not for all 40 payers every run: hammering
// this endpoint risks 401ing the whole EPS/trough handshake for a date few of these holdings
// even pay on.
async function fetchExDiv(ticker, { crumb, cookie }) {
    const sym = ticker.replace('^', '%5E');
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}`
        + `?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } });
    // 404 is a DEFINITIVE "this symbol has no calendarEvents module" — every ETF returns it
    // (VOO, EWJ, ...). Treat it as "no date", a real answer that gets cached, so those never
    // retry. Only a genuine transient (429/5xx/network) throws and is retried next run.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()).quoteSummary?.result?.[0]?.calendarEvents?.exDividendDate?.raw;
    return typeof raw === 'number' ? new Date(raw * 1000).toISOString().slice(0, 10) : null;
}

// Which payers need an ex-div lookup this run. The date changes at most a few times a year, so
// it is cached in prices.json and only refetched when there is a reason to: no cached date, or
// the cached one has already passed (a new one may now be announced). A payer whose next ex-div
// is still in the future is left alone — that is the whole point, keeping this off the gated
// endpoint.
//
// The `exDivChecked` throttle matters: an annual HK/EU payer sits for MONTHS with its last
// ex-div in the past and the next unannounced, so "refetch whenever the cached date is past"
// alone would hit it every run all that time. Capped to one look a day — the same trap, and the
// same fix, as the earnings due-window. `today` is a parameter for the selftest.
function exDivToFetch(prevQuotes, payers, today) {
    return payers.filter(t => {
        const q = prevQuotes[t] || {};
        const needsLook = !q.exDiv || q.exDiv < today;   // ISO dates compare lexically
        return needsLook && q.exDivChecked !== today;    // ...but not twice in one day
    });
}

// Most-recent-quarter end, from quoteSummary's defaultKeyStatistics. This is the quarter the
// REPORTED trailing EPS (the batch quote's epsTrailingTwelveMonths) runs through — and it leads
// the filed fundamentals: for GOOG it reads 2026-06-30 while the timeseries statements still stop
// at Q1'26. Surfaced on the page so the "reported" TTM tag can name its through-quarter. Same
// crumb-gated per-ticker endpoint as ex-div, so it is cached and gated the same way.
async function fetchMrq(ticker, { crumb, cookie }) {
    const sym = ticker.replace('^', '%5E');
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}`
        + `?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } });
    if (res.status === 404) return null;                 // no such module — a real, cacheable "none"
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()).quoteSummary?.result?.[0]?.defaultKeyStatistics?.mostRecentQuarter?.raw;
    return typeof raw === 'number' ? new Date(raw * 1000).toISOString().slice(0, 10) : null;
}

// A quarter end older than this may have been superseded by a newer report, so it's worth a look.
// ~91 days is a quarter; the grace past that covers the reporting lag (results land 1-3 months
// after quarter end). Below it, nothing new can exist — leave the cached value alone.
const MRQ_STALE_DAYS = 120;
// Cold start (no ticker has a cached mrq) would otherwise fire one gated call for every equity in
// a single run — the burst AGENTS.md warns can 401 the whole handshake. Cap it; the daily throttle
// carries the rest to later runs, and steady state is a trickle of 0-2 around earnings.
const MRQ_MAX_PER_RUN = 8;
function mrqToFetch(prevQuotes, equities, today) {
    return equities.filter(t => {
        const q = prevQuotes[t] || {};
        const stale = !q.mrq || (Date.parse(today) - Date.parse(q.mrq)) / 864e5 > MRQ_STALE_DAYS;
        return stale && q.mrqChecked !== today;          // ...but not twice in one day
    }).slice(0, MRQ_MAX_PER_RUN);
}

// Yahoo's fundamentals are in the major currency unit even for tickers whose price
// quote is in a minor unit (pence) — same GBp quirk rateFor() handles for FX.
function epsInQuoteUnits(eps, currency) {
    return (currency === 'GBp' || currency === 'Gbpence') ? eps * 100 : eps;
}

// One batched request for every ticker's trailing EPS — v7/finance/quote allows
// comma-separated symbols, so this is a single round-trip regardless of holding count.
async function fetchEps(tickers, { crumb, cookie }) {
    const symbols = tickers.map(t => t.replace('^', '%5E')).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseQuotes(await res.json());
}

// Annual diluted EPS per fiscal year. Yahoo caps this at ~4 points regardless of the range
// asked for (quarterly gives only ~5, trailing ~11), so 4 fiscal years is the real ceiling
// on free earnings history — the trough below is "cheapest in ~4y", not 5.
// Returns { currency, years }. The currency matters: Yahoo reports fundamentals in the
// company's REPORTING currency, not the quote's. An ADR prices in USD but reports in JPY —
// dividing a USD price by a JPY EPS silently produces nonsense (NTDOY read as +20,000% dear
// before this was caught). The reported EPS already accounts for the ADR share ratio, so a
// plain FX conversion is enough; it was checked against every ADR in the book (all within 1%).
// Retries like fetchTicker does: 56 rapid requests to the endpoint Yahoo gates hardest will
// see the odd 429/timeout, and a bare failure here used to get cached as "this company has no
// earnings" — which is exactly how AAPL and 1211.HK silently lost their PE Low for a week.
// Net income comes along for the ride (same request) because EPS alone cannot be trusted
// across a share-count change — see normaliseEps. Revenue (rev) and net income attributable to
// common shareholders (nic) ride along too, for the financials panel: nic is the "relevant"
// bottom line — it is what EPS is actually struck on, and it excludes the minority interests
// that make a headline net income meaningless for a conglomerate like CKA or 1113.
const FIELDS = {                       // Yahoo timeseries key -> our short name
    annualDilutedEPS: 'eps',
    annualNetIncome: 'ni',
    annualTotalRevenue: 'rev',
    annualNetIncomeCommonStockholders: 'nic',
    // Operating income, for the operating-margin line. Net income catches one-off tax and FX
    // noise; operating margin is the cleaner "is the core business improving" signal. Only the
    // years Yahoo returns carry it (the deep EDGAR/stockanalysis backfill does not), which is
    // fine — operating margin is a recent-trend read, matching the share-count trend beside it.
    annualOperatingIncome: 'opinc',
    // Net income with one-off items (asset sales, and crucially unrealized marks on equity
    // stakes — the thing that makes Alphabet's headline EPS swing) stripped out, after tax.
    // Drives the recurring-earnings Special P/E: see normEpsFrom().
    annualNormalizedIncome: 'norm',
};
// The same accounts one granularity down, so the panel can set the latest reported QUARTER
// beside company guidance (which is usually a quarter) at matching granularity. Yahoo exposes a
// `quarterly*` twin of every annual key, and the timeseries endpoint takes them in the SAME
// comma-separated `type=` list — so this rides the existing per-ticker request at zero extra
// cost against the endpoint Yahoo gates hardest.
const QUARTERLY_FIELDS = {              // Yahoo timeseries key -> our short name
    quarterlyTotalRevenue: 'rev',
    quarterlyOperatingIncome: 'opinc',
    quarterlyNetIncomeCommonStockholders: 'nic',
    quarterlyNetIncome: 'ni',
    quarterlyDilutedEPS: 'eps',
    quarterlyNormalizedIncome: 'norm',   // recurring EPS on the quarter rows (GOOG's Q1'26 was 5.11 filed, 2.67 recurring)
};
// Quarters are fetched for every operating company: the caller only ever hands this function
// non-nonEquity tickers (ETFs/indices are filtered out in main), so there is nothing left to
// gate on. The store, merge and panel already handle any ticker. A company Yahoo has no
// quarters for simply comes back with an empty set.
async function fetchAnnualEps(ticker, { crumb, cookie }, attempts = 3) {
    const now = Math.floor(Date.now() / 1000);
    const sym = ticker.replace('^', '%5E');
    const types = [...Object.keys(FIELDS), ...Object.keys(QUARTERLY_FIELDS)];
    const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${sym}`
        + `?symbol=${sym}&type=${types.join(',')}`
        + `&period1=${now - 8 * 365 * DAY}&period2=${now}&crumb=${encodeURIComponent(crumb)}`;
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const results = (await res.json()).timeseries?.result || [];
            const rows = {}, qrows = {};   // asOfDate -> { eps, ni, rev, nic, opinc }
            let currency = null;
            const collect = (fields, bucket) => {
                for (const r of results) {
                    for (const [key, name] of Object.entries(fields)) {
                        for (const x of r[key] || []) {
                            if (!x?.asOfDate || typeof x.reportedValue?.raw !== 'number') continue;
                            (bucket[x.asOfDate] ||= {})[name] = x.reportedValue.raw;
                            // EPS is per-share and revenue is absolute, but both are filed in the
                            // same reporting currency — any row carrying one settles it.
                            if (x.currencyCode) currency = x.currencyCode;
                        }
                    }
                }
            };
            collect(FIELDS, rows);
            collect(QUARTERLY_FIELDS, qrows);
            // A successful response with no rows is a real answer — ETFs, gold, bitcoin have no
            // earnings. That gets cached. A thrown error does NOT (see the caller).
            //
            // Every row Yahoo sent is kept, whichever fields it carries. Do NOT filter years on
            // any single field: the 4-point cap applies PER FIELD and the windows do not line up
            // — MC.PA returns revenue for 2022-25 but diluted EPS only for 2021-24, while
            // 2638.HK is the exact reverse. Keying on EPS silently dropped LVMH's FY2025 for six
            // months after it was published. Consumers filter for what they need instead: the
            // financials panel takes years with revenue, troughPe() takes years with positive EPS.
            const series = bucket => Object.keys(bucket).sort().map(date => ({ date, ...bucket[date] }));
            return {
                currency,
                years: series(rows),
                // Yahoo caps quarterly at ~5 points per fetch; the store accretes to 8 so the
                // panel can show four quarters each against the same quarter a year earlier (the
                // oldest of the four needs the 8th one back). Empty for a company Yahoo has no
                // quarterly statements for; the panel filters on rev.
                quarters: series(qrows).slice(-8),
            };
        } catch (e) {
            lastErr = e;
            if (a < attempts - 1) await new Promise(r => setTimeout(r, 600 * (a + 1)));
        }
    }
    throw lastErr;
}

// Put every year's EPS on the LATEST year's share basis — the same basis Yahoo's split-adjusted
// price series uses.
//
// Yahoo back-adjusts prices for splits but reports EPS as filed, and it restates inconsistently:
// NVDA's 10:1 was restated, BYD's 2025 bonus issue was not. Left alone, BYD's 2024 EPS (9.22,
// pre-bonus per-share) divided into its post-bonus-adjusted price gave a PE Low of 5.4x instead
// of ~11x — the stock read as +363% dear when it was nearer +50%. Yahoo's split-event list is no
// help either: it reports a 6:1 for BYD that it never applied to the prices.
//
// Net income is immune to all of it, so rebase through it:
//     EPS_norm(t) = netIncome(t) × EPS(anchor) / netIncome(anchor)
// which is netIncome(t) / impliedShares(anchor). For an already-consistent series this is a
// no-op (NVDA: 0.174 -> 0.178).
//
// ponytail: this also absorbs buybacks, which splits-adjusted prices do NOT — so a heavy
// repurchaser reads a few percent cheap at its low (AAPL ~8% over four years). Bounded and
// one-directional, and vastly better than being 3x wrong on a split. Isolating the split
// component would need a trustworthy split feed, which Yahoo is not.
function normaliseEps(years) {
    const anchor = [...years].reverse().find(y => y.eps > 0 && y.ni > 0);
    if (!anchor) return years.map(y => y.eps);          // no usable anchor — use EPS as filed
    return years.map(y => (y.ni != null ? y.ni * anchor.eps / anchor.ni : y.eps));
}

// Days after a fiscal year ends before its EPS counts as public. 90 covers the statutory
// deadline in every market this book touches (US 10-K ≤90d, HK results announcement ≤3mo,
// Japan tanshin ~45d, Korea 90d); most companies announce well inside it, so the model is
// late rather than clairvoyant.
// ponytail: flat lag, not real publication dates — exact filed dates exist only for US EDGAR
// filers; store them in earnings.json if a few weeks' slack ever matters.
const REPORT_LAG_DAYS = 90;
const reportedBy = date =>
    new Date(new Date(date + 'T00:00:00Z').getTime() + REPORT_LAG_DAYS * DAY * 1000)
        .toISOString().slice(0, 10);

// The cheapest multiple the market ever put on this stock's PUBLISHED earnings: each weekly
// close ÷ the latest annual EPS already reported by that date, minimum across history.
//
// Point-in-time on both sides, and both mistakes it guards against are real:
//  - Old low over TODAY'S EPS: a company that has since grown into its earnings (NVDA's 2022
//    low over its 2026 EPS) reads absurdly cheap.
//  - Old low over that year's OWN EPS (the previous model): earnings reported months AFTER the
//    low. Trip.com's Apr-2025 low over FY2025 EPS — figures unknown until Feb 2026 — printed a
//    7.7x trough that was really 14.9x on what investors could actually see.
// A close before the first published year has no multiple and is skipped; once a published
// year's EPS is ≤ 0 there is no meaningful multiple until the next profitable year is out.
//
// Pure, so it is selftest-able. `entry` is { currency, years } from earnings.json; days/closes
// are the weekly history in the quote's currency.
//
// EPS is converted from the reporting currency into the quote's before dividing. Going through
// rateFor for BOTH sides means the GBp/pence case falls out for free (GBp is GBP/100, so a
// GBP-reported EPS scales by 100 into a pence-quoted price) — no special case needed.
// Returns null if we lack an FX rate for either side, rather than a wrong multiple.
function troughPe(entry, days, closes, quoteCurrency, rates) {
    const years = entry?.years || [];
    const fxReport = rateFor(entry?.currency || quoteCurrency, rates);
    const fxQuote = rateFor(quoteCurrency, rates);
    if (!fxReport || !fxQuote) return null;
    const toQuote = fxReport / fxQuote;
    const normalised = normaliseEps(years);   // onto the latest year's share basis

    // What was public when: [publication date, EPS] steps, oldest first. A year with no EPS
    // and no net income (Yahoo's per-field cap) carries no information and is transparent;
    // a published LOSS is kept — it genuinely voids the multiple until the next profit prints.
    const known = years
        .map((y, i) => ({ from: reportedBy(y.date), eps: normalised[i] * toQuote }))
        .filter(k => Number.isFinite(k.eps))
        .sort((a, b) => a.from < b.from ? -1 : 1);

    let best = null;
    for (let i = 0; i < days.length; i++) {
        const c = closes[i];
        if (c == null) continue;
        let e = null;
        for (const k of known) { if (k.from <= days[i]) e = k.eps; else break; }
        if (!(e > 0)) continue;
        const pe = c / e;
        if (best == null || pe < best.peLow) best = { peLow: pe, lowPrice: c, lowEps: e, lowDate: days[i] };
    }
    return best;
}

// Last run's EPS, straight out of the committed prices.json. The crumb handshake is the
// one thing here Yahoo actively gates, and it 401/429s from CI's shared IPs far more than
// from a laptop — without a fallback, one blocked run blanks the whole PE column for
// everyone. Trailing EPS only moves once a quarter, so a stale figure is a fine trade.
function previousEps() {
    try {
        const prev = JSON.parse(fs.readFileSync('prices.json', 'utf8'));
        return Object.fromEntries(Object.entries(prev.quotes || {})
            .filter(([, q]) => typeof q.eps === 'number')
            .map(([t, q]) => [t, q.eps]));
    } catch { return {}; }               // no previous file (first run) — nothing to carry
}

// Last run's quotes, so a cached-but-still-valid ex-div date carries forward without a refetch.
function previousQuotes() {
    try { return JSON.parse(fs.readFileSync('prices.json', 'utf8')).quotes || {}; }
    catch { return {}; }
}

// Annual EPS is reported four times a year, so re-fetching it hourly for every holding is 56
// wasted requests an hour against the one endpoint Yahoo rate-limits hardest. Keep it in the
// repo and refresh only when it ages out — or when a new holding has no history yet.
//
// The *trough* is still recomputed every run (from this store plus the fresh weekly closes),
// which costs nothing and means a new low is picked up the hour it happens.
const EARNINGS = 'earnings.json';
// The backstop sweep, not the main mechanism — see earningsToFetch. A month, not a week: the
// only thing it exists to catch is a restatement of an already-published year, and new fiscal
// years now arrive within a day via the due-window check instead of waiting on this.
const EARNINGS_SWEEP_DAYS = 30;

// Bump when the stored shape changes, to force one full refetch. This is a version and not a
// "does field X exist?" sniff on purpose: a sniff cannot tell "we never fetched this field"
// from "Yahoo has no revenue for this ticker", so the second case would refetch every ticker,
// every run, forever. v2 = + net income (EPS alone can't survive a split — see normaliseEps).
// v3 = + revenue and net income to common, for the financials panel.
// v4 = stopped keying years on EPS, which discarded fiscal years Yahoo HAD sent revenue for
//      (LVMH's FY2025 was missing for six months). Forces one refetch to recover them.
// v5 = + operating income (opinc), for the operating-margin line.
// v6 = + quarterly financials (`quarters`) for the QUARTERLY_TICKERS allowlist, to set the
//      latest reported quarter beside company guidance at matching granularity.
// v7 = quarters for EVERY operating company, not just the allowlist. Forces one refetch so
//      names already stored pick up their quarters instead of waiting on the monthly sweep.
// v8 = + normalized (one-off-stripped) net income, for the recurring-earnings Special P/E.
// v9 = + quarterly normalized income, for recurring EPS on the quarter rows.
const EARNINGS_V = 9;

function loadEarnings() {
    try { return JSON.parse(fs.readFileSync(EARNINGS, 'utf8')); }
    catch { return { v: EARNINGS_V, updated: null, eps: {} }; }   // first run
}

// Yahoo hands back ~4 fiscal years however wide a window you ask for, so 4 is the ceiling on a
// single fetch. But the store lives in the repo: keep the years already seen and the history
// ACCRETES — a 5th year appears next time the fiscal window rolls, instead of dropping off the
// back.
//
// Merged FIELD BY FIELD, not year by year. A fresh value wins wherever Yahoo sent one, so
// restatements propagate (it revised ASML's FY2025 diluted EPS from 26.26 to 24.71 — 26.26
// implied 366M shares, which ASML does not have). But a field Yahoo did NOT send is kept from
// the store, which is the only thing protecting backfilled data: Yahoo's per-field windows do
// not line up, so it will hand back a year carrying EPS alone, and replacing the year wholesale
// would silently delete the revenue backfill-earnings.js put there.
//
// A fetch that comes back empty keeps the old years (an ETF is empty from the start and has
// nothing to keep; a company that suddenly reports nothing is a Yahoo glitch, not a fact).
function mergeSeries(oldRows, freshRows) {
    if (!oldRows?.length) return freshRows;
    const byDate = new Map(oldRows.map(r => [r.date, r]));
    for (const r of freshRows || []) {
        const prev = byDate.get(r.date);
        byDate.set(r.date, prev ? { ...prev, ...r } : r);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function mergeEarnings(old, fresh) {
    if (!old?.years?.length) return fresh;
    const merged = {
        currency: fresh.currency ?? old.currency,
        years: mergeSeries(old.years, fresh.years),
    };
    // Quarters accrete the same way, but bounded — only the last ~6 are ever shown, and unlike
    // annual history there is no reason to keep a five-year tail of stale quarters.
    const quarters = mergeSeries(old.quarters, fresh.quarters);
    if (quarters?.length) merged.quarters = quarters.slice(-8);
    return merged;
}

// Is this company's NEXT fiscal year overdue? The one we hold ends on a known date, so the next
// ends about a year later — and results follow a fiscal year end by roughly one to three months.
//
// Bounded at both ends on purpose. Before the window there is nothing to ask for; after it, the
// answer is not coming: NW0.DE has been missing FY2025 for months and must not burn a request a
// day forever. Outside the window the periodic sweep is the only thing that touches a ticker.
// A fund (no years at all) is never due — no results will ever arrive.
const REPORT_WINDOW_DAYS = [30, 210];
// A quarter's results land sooner than a year's (~1 month vs ~3), and stop being worth asking
// for after ~3. Same bounded-window shape as the annual check. The floor is 20, not 25, because
// Yahoo had GOOG's Q2 2026 statements 24 days after the quarter end — a 25-day floor sat out the
// one day that mattered, and the recurring multiple is only as current as the newest filed quarter.
const QUARTER_WINDOW_DAYS = [20, 100];

// Is the NEXT quarter overdue for a company that actually reports quarterly? Guarded on real
// cadence: the last two stored quarters must be ~a quarter apart. Semi-annual reporters (most
// HK names — CKA, HK Electric) have ~180-day gaps and must NOT be projected a phantom quarter,
// or they would sit "due" every three months waiting for results that never come.
function nextQuarterOverdue(entry, now) {
    const q = entry?.quarters || [];
    if (q.length < 2) return false;                        // can't tell cadence from one point
    const t = q.map(x => Date.parse(x.date + 'T00:00:00Z'));
    if ((t[t.length - 1] - t[t.length - 2]) / 86400e3 > 100) return false;   // not quarterly
    const last = new Date(t[t.length - 1]);
    const nextEnd = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 3, last.getUTCDate());
    const age = (now - nextEnd) / 86400e3;
    return age >= QUARTER_WINDOW_DAYS[0] && age <= QUARTER_WINDOW_DAYS[1];
}

function dueForResults(entry, now) {
    const years = entry?.years || [];
    if (!years.length) return false;
    const last = new Date(years[years.length - 1].date + 'T00:00:00Z');
    const nextEnd = Date.UTC(last.getUTCFullYear() + 1, last.getUTCMonth(), last.getUTCDate());
    const age = (now - nextEnd) / 86400e3;
    if (age >= REPORT_WINDOW_DAYS[0] && age <= REPORT_WINDOW_DAYS[1]) return true;
    return nextQuarterOverdue(entry, now);                 // else: a quarter may be overdue
}

// Which tickers need a fundamentals request this run — per-ticker, not all-or-nothing.
//
// Everything, if the store was written by an older shape, or on the slow sweep. Otherwise only:
//
//  - tickers with NO entry at all — a holding added since the last refresh, or one whose fetch
//    errored and was deliberately not cached. That distinction is the whole point: a transient
//    429 must not be recorded as "this company has no earnings", and retrying it must not drag
//    the other 62 along with it.
//  - tickers actually WAITING ON RESULTS (dueForResults), looked at once a day. Nothing else is
//    asked, because nothing else can have changed: a company whose fiscal year ends in December
//    has nothing new to say in July.
//
// The sweep still exists, at a month rather than a week, because "annual figures never change"
// is not true — Yahoo restates them (ASML's FY2025 EPS moved 26.26 -> 24.71 after publication,
// and the old value was wrong). Nothing else would ever catch that. It is also the backstop for
// anything the due-window logic doesn't anticipate.
const EARNINGS_DUE_RECHECK_DAYS = 1;
function isSweepDue(store, now = Date.now()) {
    return !store.updated
        || store.v !== EARNINGS_V
        || (now - Date.parse(store.updated)) / 86400e3 >= EARNINGS_SWEEP_DAYS;
}
function earningsToFetch(store, tickers, now = Date.now()) {
    if (isSweepDue(store, now)) return tickers;
    return tickers.filter(t => {
        const e = store.eps[t];
        if (!e) return true;
        if (!dueForResults(e, now)) return false;
        return !e.checked
            || (now - Date.parse(e.checked)) / 86400e3 >= EARNINGS_DUE_RECHECK_DAYS;
    });
}

// Recurring EPS: the trailing headline EPS scaled by the latest fiscal year's
// normalized/reported ratio — i.e. headline with its one-offs removed, on the SAME trailing
// period as the headline P/E, so the Special P/E differs from the normal one by exactly the
// one-off adjustment and nothing else. Null unless both the year and the quote are cleanly
// positive (a loss-maker has no meaningful multiple either way), and the ratio is sane.
function normEpsFrom(entry, eps) {
    const years = entry?.years || [];
    const y = [...years].reverse().find(x => x.norm > 0 && x.ni > 0);
    if (!y || !(eps > 0)) return null;
    const ratio = y.norm / y.ni;
    if (ratio < 0.2 || ratio > 5) return null;             // guard against a freak year
    return Number((eps * ratio).toPrecision(6));
}

// Trailing EPS summed from the last four quarterly filings — the fallback for names Yahoo hands
// no epsTrailingTwelveMonths (Korean locals: 000660.KS, 005930.KS). Summed only when all four
// quarters carry EPS and span ~a year, and only when the store's reporting currency matches the
// quote's: the store is in reporting currency, so an ADR whose filings are TWD/KRW must never be
// summed against a USD price. Returns null (honest "–") the moment any quarter's EPS is missing.
function trailingEpsFromQuarters(entry, currency) {
    if (!entry || entry.currency !== currency) return null;
    const q = (entry.quarters || []).filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date));
    if (q.length < 4) return null;
    const last4 = q.slice(-4);
    const days = (Date.parse(last4[3].date) - Date.parse(last4[0].date)) / 864e5;
    if (days < 250 || days > 290) return null;                 // the four must span ~one year

    // Easy path: every quarter carries EPS, just add them up.
    if (last4.every(x => typeof x.eps === 'number'))
        return Number(last4.reduce((a, x) => a + x.eps, 0).toPrecision(6));

    // A quarter's EPS is missing — Yahoo carries no standalone Q4 EPS for Korean filers (SK
    // Hynix, Samsung): it stores the audited ANNUAL instead. Roll that annual forward instead of
    // summing four quarters:
    //     TTM = annual − {earliest n quarters of that fiscal year} + {n quarters past the annual}
    // The `annual − earliest` part reconstructs the missing quarter implicitly, and every term is
    // a Yahoo-reported EPS — no share-count guessing. Only when all the terms it needs have EPS.
    const years = (entry.years || []).filter(y => y.date).sort((a, b) => a.date.localeCompare(b.date));
    const ann = years[years.length - 1];
    if (!ann || typeof ann.eps !== 'number') return null;
    const post = q.filter(x => x.date > ann.date);             // quarters after the annual
    const n = post.length;
    if (n < 1 || n > 3) return null;                           // a full year past → a newer annual should exist
    if (last4[3].date !== post[n - 1].date) return null;       // the annual must be recent (L is its last post-quarter)
    const lead = q.filter(x => x.date <= ann.date).slice(-4).slice(0, n);  // the n quarters rolling out
    const terms = [ann, ...post, ...lead];
    if (lead.length !== n || !terms.every(x => typeof x.eps === 'number')) return null;
    const ttm = ann.eps + post.reduce((a, x) => a + x.eps, 0) - lead.reduce((a, x) => a + x.eps, 0);
    return Number(ttm.toPrecision(6));
}

// Recurring EPS over the last four FILED quarters, summed outright. Preferred over normEpsFrom's
// annual proxy because that one mixes windows: it applies the latest fiscal YEAR's normalized
// ratio to the reported TTM EPS, and the two rarely cover the same quarters. GOOG showed the cost
// — FY2025's comparatively clean ratio against a TTM window carrying a $6.26/share equity gain
// priced it at 18.9x when the recurring multiple was ~31x.
//
// Reporting currency must equal the quote currency: this is an absolute sum, not a unitless ratio,
// so an ADR filing in TWD against a USD price has to fall back to the proxy. Null unless all four
// quarters carry the inputs and span ~a year.
function recurringTtmFrom(entry, currency) {
    if (!entry || entry.currency !== currency) return null;
    const q = (entry.quarters || []).filter(x => x.date && x.rev != null)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (q.length < 4) return null;
    const last4 = q.slice(-4);
    const days = (Date.parse(last4[3].date) - Date.parse(last4[0].date)) / 864e5;
    if (days < 250 || days > 290) return null;
    const rec = last4.map(x => x.norm != null && x.ni && x.eps != null ? x.norm * x.eps / x.ni : null);
    if (rec.some(v => v == null)) return null;
    const sum = rec.reduce((a, v) => a + v, 0);
    return sum > 0 ? Number(sum.toPrecision(6)) : null;   // a loss has no meaningful multiple
}

// The quarter the filed recurring sum runs through — surfaced so the page can name the window.
const lastQuarterDate = entry => {
    const q = (entry?.quarters || []).filter(x => x.date && x.rev != null).map(x => x.date).sort();
    return q.length ? q[q.length - 1] : null;
};

// A checked manual override wins. Otherwise fresh Yahoo EPS is scaled into the quote's unit.
// A carried-forward value is
// ALREADY in quote units (it was scaled when written), so scaling it again would multiply
// a pence ticker by 100 a second time.
function resolveEps(manual, fresh, carried, currency) {
    if (typeof manual === 'number') return manual;
    if (typeof fresh === 'number') return epsInQuoteUnits(fresh, currency);
    return typeof carried === 'number' ? carried : undefined;
}

// GBp (pence) is GBP/100. Everything else needs a real FX rate.
function rateFor(code, rates) {
    if (code === 'GBp' || code === 'Gbpence') return rates.GBP / 100;
    return rates[code];
}

const isoDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// Per-ticker native closes aligned to one shared calendar (exchanges differ).
// Leading days before a ticker's first close are null; interior gaps (holidays,
// half-days) forward-fill. This is the "honest" matrix used to chart a single stock;
// the NAV sum below seeds the leading nulls so a late listing doesn't fake a ramp.
function alignedCloses(tickers, quotes) {
    const days = [...new Set(
        tickers.flatMap(t => quotes[t]?.series.timestamps.map(isoDay) ?? [])
    )].sort();

    const closes = {};
    for (const t of tickers) {
        const { timestamps, closes: cs } = quotes[t].series;
        const byDay = new Map();
        timestamps.forEach((ts, i) => { if (cs[i] != null) byDay.set(isoDay(ts), cs[i]); });
        const arr = [];
        let last = null, seen = false;
        for (const day of days) {
            if (byDay.has(day)) { last = byDay.get(day); seen = true; }
            arr.push(seen ? last : null);
        }
        closes[t] = arr;
    }
    return { days, closes };
}

// What the portfolio was ACTUALLY worth on each day: the Tradelog replayed against the price
// history, so the line starts at the first purchase and steps up as money goes in.
//
// This used to hold TODAY's share count constant across all history, which answered "what would
// this basket have been worth back then" rather than "what did I own". The old comment said to
// replay the Tradelog only once the proxy started misleading — it did: on 2019-12-20 it valued
// the S&P group at $5,723 when the real figure was $593, because it back-projected 25 VUSA.L
// shares that were not bought until 2025. A chart of asset value has to be asset value.
//
// cohortMV does the replay (and holds price flat across data gaps, which is what the old seed
// was for). Still today's FX for every past day — see AGENTS.md invariant 2.
function navHistory(holdings, quotes, rates) {
    const tickers = [...new Set(holdings.map(h => h.yahoo))];
    const { days, closes } = alignedCloses(tickers, quotes);
    const { mv } = cohortMV(days, holdings.map(h => ({
        yahoo: h.yahoo, trades: h.trades || [], quoteCurrency: quotes[h.yahoo].currency,
    })), closes, rates);
    return { days, values: mv.map(v => v == null ? null : Math.round(v)) };
}

const sleep = () => new Promise(r => setTimeout(r, 300)); // ponytail: fixed delay; backoff if Yahoo starts 429ing

// Chart benchmarks: Yahoo symbol -> display name. Rebased to % on the client.
const BENCHMARKS = { '^GSPC': 'S&P 500', '^HSI': 'HSI' };

async function main() {
    // Held + watched. navHistory() below deliberately re-derives its own holdings-only list:
    // a watched stock must never leak into the NAV series.
    const tickers = [...new Set([...holdings.map(h => h.yahoo), ...watchlist.map(w => w.yahoo)])];
    const quotes = {};
    const failed = [];

    for (const t of tickers) {
        try {
            quotes[t] = await fetchTicker(t);
            console.log(`ok   ${t} ${quotes[t].price} ${quotes[t].currency}`);
        } catch (e) {
            failed.push(t);
            console.error(`FAIL ${t}: ${e.message}`);
        }
        await sleep();
    }
    // Refuse to publish a gutted file — better to keep yesterday's prices than show a broken page.
    if (Object.keys(quotes).length < tickers.length * 0.8) {
        throw new Error(`only ${Object.keys(quotes).length}/${tickers.length} tickers fetched; not writing`);
    }

    // Trailing EPS for the PE columns — best-effort; see getCrumb's comment. Never blocks
    // the price write, and never throws past this point. Anything Yahoo doesn't hand us
    // (blocked handshake, or a symbol it has no EPS for) falls back to the last run's value.
    const carried = previousEps();
    const manualEps = Object.fromEntries([...holdings, ...watchlist]
        .filter(x => typeof x.eps === 'number').map(x => [x.yahoo, x.eps]));
    let fresh = {}, earningsDates = {}, quoteTypes = {};
    let auth = null;                 // reused by the trough-multiple step, after weekly history
    try {
        auth = await getCrumb();
        ({ eps: fresh, earnings: earningsDates, types: quoteTypes } = await fetchEps(tickers, auth));
    } catch (e) {
        console.error(`skip eps: ${e.message} — falling back to the previous run's EPS`);
    }
    // Instruments with no fundamentals to fetch, ever: ETFs, indices, crypto trusts. Yahoo's
    // quoteType (free, from the batch call above) settles it. Only a KNOWN non-equity is skipped
    // — an unknown type (Yahoo omitted it, or the handshake failed) falls through to normal
    // handling, so a real company is never silently denied its earnings. This is what keeps the
    // 14 funds/indices out of the annual-EPS sweep and the ETF payers out of the ex-div lookups.
    const nonEquity = new Set(tickers.filter(t => quoteTypes[t] && quoteTypes[t] !== 'EQUITY'));
    let live = 0, stale = 0;
    for (const t of tickers) {
        if (!quotes[t]) continue;
        // Not carried forward like EPS: a stale results date is worse than none, and this one
        // is cheap to refetch (it comes with the EPS request every run anyway).
        if (earningsDates[t]) quotes[t].earnings = earningsDates[t];
        const eps = resolveEps(manualEps[t], fresh[t], carried[t], quotes[t].currency);
        if (eps === undefined) continue;
        quotes[t].eps = eps;
        fresh[t] != null ? live++ : stale++;
    }
    const dated = tickers.filter(t => quotes[t]?.earnings).length;
    console.log(`ok   next results date for ${dated}/${tickers.length} tickers`);
    console.log(`ok   eps for ${live + stale}/${tickers.length} tickers (${live} fresh, ${stale} carried forward)`);

    // Ex-dividend date, for payers only, and only when there's a reason to refetch (see
    // exDivToFetch). Every other payer carries its cached date forward. This deliberately keeps
    // the per-ticker gated calls to a trickle — usually 0-2 a run — rather than 40, because that
    // endpoint is shared with the EPS handshake the PE columns need.
    const prevQuotes = previousQuotes();
    const today = new Date().toISOString().slice(0, 10);
    for (const t of tickers) {                       // carry cache forward; a refetch overwrites
        if (!quotes[t]) continue;
        if (prevQuotes[t]?.exDiv) quotes[t].exDiv = prevQuotes[t].exDiv;
        if (prevQuotes[t]?.exDivChecked) quotes[t].exDivChecked = prevQuotes[t].exDivChecked;
        if (prevQuotes[t]?.mrq) quotes[t].mrq = prevQuotes[t].mrq;
        if (prevQuotes[t]?.mrqChecked) quotes[t].mrqChecked = prevQuotes[t].mrqChecked;
    }
    if (auth) {
        // Payers, minus funds: an ETF distribution is not in calendarEvents (it 404s), so there
        // is nothing to look up for VOO/EWJ/VUSA.L and no reason to spend a gated call finding
        // that out again.
        const payers = tickers.filter(t => quotes[t]?.divYield > 0 && !nonEquity.has(t));
        const due = exDivToFetch(prevQuotes, payers, today);
        if (due.length) console.log(`     ex-div lookup for ${due.length}/${payers.length} payer(s)`);
        for (const t of due) {
            try {
                const date = await fetchExDiv(t, auth);
                if (date) quotes[t].exDiv = date; else delete quotes[t].exDiv;
                quotes[t].exDivChecked = today;      // looked today — don't look again till tomorrow
            } catch (e) {
                console.error(`     ex-div ${t}: ${e.message} — keeping cached`);
            }
            await sleep();
        }
    }
    console.log(`ok   ex-div date for ${tickers.filter(t => quotes[t]?.exDiv).length} payer(s)`);

    // Most-recent-quarter end (the through-quarter of the reported trailing EPS), for equities
    // only and only when the cached one has aged out — same trickle discipline as ex-div.
    if (auth) {
        const equities = tickers.filter(t => quotes[t] && !nonEquity.has(t));
        const due = mrqToFetch(prevQuotes, equities, today);
        if (due.length) console.log(`     mrq lookup for ${due.length}/${equities.length} equit(ies)`);
        for (const t of due) {
            try {
                const date = await fetchMrq(t, auth);
                if (date) quotes[t].mrq = date; else delete quotes[t].mrq;
                quotes[t].mrqChecked = today;
            } catch (e) {
                console.error(`     mrq ${t}: ${e.message} — keeping cached`);
            }
            await sleep();
        }
    }
    console.log(`ok   most-recent-quarter for ${tickers.filter(t => quotes[t]?.mrq).length} equit(ies)`);

    // Annual EPS history: read from the repo, refreshed only when it ages out or a holding is
    // new. Loaded HERE, before the FX block, because each company's REPORTING currency has to
    // be in `rates` — an ADR reports in JPY/CNY while quoting in USD, and without that rate the
    // trough can't be converted (and must not be guessed).
    const store = loadEarnings();
    // Read BEFORE any fetch: `updated` timestamps the last full sweep, so it must not be touched
    // by a targeted due-check. If a daily check moved it, the 30-day sweep would never come due
    // and a restatement would never be seen again.
    const sweeping = isSweepDue(store);
    // A fund has no annual EPS to fetch — not on the monthly sweep, not as a "new" holding. This
    // is the bigger win of the two: it keeps 14 ETFs/indices out of every sweep instead of
    // re-confirming they have no earnings, and stops a newly-added ETF being fetched even once.
    const toFetch = auth ? earningsToFetch(store, tickers).filter(t => !nonEquity.has(t)) : [];
    if (toFetch.length) {
        console.log(`     fetching annual EPS for ${toFetch.length}/${tickers.length} ticker(s)`
            + ` (${sweeping ? 'monthly sweep' : 'awaiting results / new'})`);
        let failed = 0;
        for (const t of toFetch) {
            try {
                const merged = mergeEarnings(store.eps[t], await fetchAnnualEps(t, auth));
                // Stamped per ticker so a company that is due but never delivers (NW0.DE) backs
                // off to one look a day instead of one an hour.
                store.eps[t] = { ...merged, checked: new Date().toISOString() };
            } catch (e) {
                // Deliberately leave the key ABSENT. Caching a failure as an empty result is
                // indistinguishable from a genuine no-earnings ETF, and would freeze the PE Low
                // column empty until the store aged out. Missing = retried next run, alone.
                failed++;
                console.error(`     eps history ${t}: ${e.message} — not cached, will retry next run`);
            }
            await sleep();
        }
        store.v = EARNINGS_V;
        if (sweeping) store.updated = new Date().toISOString();
        fs.writeFileSync(EARNINGS, JSON.stringify(store, null, 1));
        console.log(`wrote ${EARNINGS} (${Object.keys(store.eps).length} tickers`
            + `${failed ? `, ${failed} failed and will retry` : ''})`);
    } else {
        console.log(`ok   annual EPS from ${EARNINGS} (updated ${store.updated || 'never'}, no fetch)`);
    }

    // Every currency in play: what the workbook declares, what Yahoo quotes in, and what each
    // company reports its earnings in (the last one is why CNY/JPY show up for US-listed ADRs).
    const declared = holdings.map(h => h.currency === 'Gbpence' ? 'GBp' : h.currency);
    const reporting = Object.values(store.eps).map(e => e && e.currency).filter(Boolean);
    const needed = [...new Set([...declared, ...Object.values(quotes).map(q => q.currency), ...reporting])]
        .map(c => c === 'GBp' ? 'GBP' : c)
        .filter(c => c !== 'USD');

    const rates = { USD: 1 };
    for (const c of [...new Set(needed)]) {
        try {
            rates[c] = (await fetchTicker(`${c}USD=X`)).price;
            console.log(`ok   ${c}USD=X ${rates[c]}`);
        } catch (e) {
            throw new Error(`missing FX rate for ${c} (${e.message}); not writing`);
        }
        await sleep();
    }

    // Convert each quote to USD here so the page does no currency guessing.
    for (const [t, q] of Object.entries(quotes)) {
        const rate = rateFor(q.currency, rates);
        if (!rate) throw new Error(`no rate for ${q.currency} (${t}); not writing`);
        q.priceUSD = q.price * rate;
    }

    const priced = holdings.filter(h => quotes[h.yahoo]);
    const nav = navHistory(priced, quotes, rates);

    // Benchmark indices for the chart overlay. Best-effort: a failed benchmark just
    // means that toggle has no data, never a broken price file.
    const benchQuotes = {};
    for (const sym of Object.keys(BENCHMARKS)) {
        try {
            benchQuotes[sym] = await fetchTicker(sym);
            console.log(`ok   ${sym} ${benchQuotes[sym].price} (${BENCHMARKS[sym]})`);
        } catch (e) {
            console.error(`skip ${sym}: ${e.message}`);
        }
        await sleep();
    }

    // Per-instrument close history (native currency) for charting a single stock,
    // plus the benchmarks, on one shared calendar. Separate file, loaded by the page
    // only when needed (stock click, benchmark toggle, or long range) so first paint stays lean.
    // Watched stocks need closes too — the deep dive charts them, and the trough multiple is
    // priced off historical lows, so without history they'd show no P/E Low at all. This is the
    // one list they join; navHistory() above and the TWR below stay strictly `priced`.
    const watched = watchlist.filter(w => quotes[w.yahoo]);
    const histTickers = [...new Set([...priced.map(h => h.yahoo), ...watched.map(w => w.yahoo),
        ...Object.keys(benchQuotes)])];
    const dailyHistory = { ...quotes, ...benchQuotes };
    const hist = alignedCloses(histTickers, dailyHistory);
    const weeklyQuotes = {};
    for (const t of histTickers) {
        try {
            weeklyQuotes[t] = await fetchWeekly(t);
            console.log(`ok   ${t} weekly`);
        } catch (e) {
            weeklyQuotes[t] = dailyHistory[t];
            console.error(`fallback ${t} weekly: ${e.message}`);
        }
        await sleep();
    }
    const weeklyTickers = Object.keys(weeklyQuotes);
    const longHist = alignedCloses(weeklyTickers, weeklyQuotes);
    const longNav = navHistory(priced.filter(h => weeklyQuotes[h.yahoo]), weeklyQuotes, rates);
    const round = arr => arr.map(v => v == null ? null : Number(v.toPrecision(6)));
    const closes = {};
    for (const t of Object.keys(hist.closes)) closes[t] = round(hist.closes[t]);
    const longCloses = {};
    for (const t of Object.keys(longHist.closes)) longCloses[t] = round(longHist.closes[t]);
    const benchmarks = {};
    for (const [sym, name] of Object.entries(BENCHMARKS)) {
        if (benchQuotes[sym]) benchmarks[sym] = { name, currency: benchQuotes[sym].currency };
    }
    fs.writeFileSync('history.json', JSON.stringify({
        updated: new Date().toISOString(),
        days: hist.days,
        closes,
        benchmarks,
        long: { days: longHist.days, closes: longCloses, nav: longNav },
    }, null, 1));

    // Trough multiple — cheapest close in each fiscal year over THAT year's earnings. Pure and
    // free: stored EPS + this run's weekly closes, so a fresh low shows up the hour it prints.
    let troughOk = 0, troughMissing = 0;
    for (const t of tickers) {
        if (!quotes[t]) continue;
        const low = troughPe(store.eps[t], longHist.days, longHist.closes[t] || [], quotes[t].currency, rates);
        if (!low) { troughMissing++; continue; }
        Object.assign(quotes[t], {
            peLow: Number(low.peLow.toPrecision(6)),
            lowPrice: Number(low.lowPrice.toPrecision(6)),
            lowEps: Number(low.lowEps.toPrecision(6)),
            lowDate: low.lowDate,
        });
        troughOk++;
    }
    // Names Yahoo gives no trailing EPS (Korean locals) get one summed from the last four
    // quarterly filings, so their trailing P/E and Implied stop reading "–". Runs before the
    // recurring loop below so the derived EPS also seeds a recurring figure where the store allows.
    // Gated on what YAHOO sent, not on whether quotes[t].eps is filled: by this point a derived
    // value from a previous run has already been carried forward as `eps`, so an "is it empty?"
    // test would skip the ticker and quietly drop the epsDerived flag with it — the number would
    // stay on the page but stop admitting where it came from. Recomputing is free (no network).
    let derivedEps = 0;
    for (const t of tickers) {
        if (!quotes[t] || fresh[t] != null || manualEps[t] != null) continue;
        const te = trailingEpsFromQuarters(store.eps[t], quotes[t].currency);
        if (te != null) { quotes[t].eps = te; quotes[t].epsDerived = true; derivedEps++; }
    }
    if (derivedEps) console.log(`ok   trailing EPS summed from quarters for ${derivedEps} ticker(s)`);
    // Recurring EPS for the Special P/E, from the same store. Separate loop so a ticker with no
    // trough (thin price history) still gets one where its earnings support it.
    //
    // The four filed quarters summed outright come first; the annual proxy is the fallback for
    // what that can't cover (an ADR reporting in another currency, or a company whose quarters
    // aren't all in the store yet). This is the SAME rule the deep dive's P/E (recurring) applies,
    // so the table's Special PE and the panel cannot show two different recurring multiples for
    // one stock — which is exactly what they did while the annual proxy stood alone.
    let recFiled = 0;
    for (const t of tickers) {
        if (!quotes[t]) continue;
        const rec = recurringTtmFrom(store.eps[t], quotes[t].currency);
        if (rec != null) { quotes[t].normEps = rec; quotes[t].normEpsThru = lastQuarterDate(store.eps[t]); recFiled++; continue; }
        const ne = normEpsFrom(store.eps[t], quotes[t].eps);
        if (ne != null) quotes[t].normEps = ne;
    }
    console.log(`ok   recurring EPS: ${recFiled} from filed quarters, `
        + `${tickers.filter(t => quotes[t]?.normEps != null).length - recFiled} from the annual proxy`);
    console.log(`ok   trough PE for ${troughOk}/${tickers.length} tickers (${troughMissing} no earnings history)`);

    // Year-to-date time-weighted return for the headline KPIs — computed here because the
    // daily closes live in this process and the page loads only prices.json (not history).
    // Deposits/withdrawals removed, so it's investment performance not money added.
    const YEAR_START = new Date().getUTCFullYear() + '-01-01';
    const twrHold = priced.map(h => ({ yahoo: h.yahoo, trades: h.trades || [], quoteCurrency: quotes[h.yahoo].currency }));
    let ytdStart = 0;
    for (let i = 0; i < hist.days.length; i++) if (hist.days[i] < YEAR_START) ytdStart = i; // last close of last year
    const ytdTwr = filter => {
        const { mv, flow } = cohortMV(hist.days, twrHold, hist.closes, rates, filter);
        const t = twr(mv.slice(ytdStart), flow.slice(ytdStart));
        for (let i = t.length - 1; i >= 0; i--) if (t[i] != null) return Number(t[i].toPrecision(4));
        return null;
    };
    const performance = {
        ytdTotal: ytdTwr(null),
        ytdNew: ytdTwr(t => t.date >= YEAR_START && t.side !== 'SELL'),
    };

    for (const q of Object.values(quotes)) delete q.series; // raw closes would 10x the file

    fs.writeFileSync('prices.json', JSON.stringify({
        updated: new Date().toISOString(),
        rates,
        quotes,
        nav,
        performance,
        failed,
    }, null, 1));
    const kb = f => (fs.statSync(f).size / 1024).toFixed(0);
    console.log(`wrote prices.json (${Object.keys(quotes).length} tickers, ${failed.length} failed, ${nav.days.length} nav days, ${kb('prices.json')}KB)`);
    console.log(`wrote history.json (${Object.keys(closes).length} series, ${Object.keys(benchmarks).length} benchmarks, ${kb('history.json')}KB)`);
}

function selftest() {
    const assert = require('assert');
    const now = 1000 * DAY;
    const ts = [now - 10 * DAY, now - 5 * DAY, now - 1 * DAY];
    const closes = [50, 80, 90];
    // Fractions, not whole percents: 100 vs the 80 at the 7d cutoff = +0.25
    assert.strictEqual(pctFrom(ts, closes, now - 7 * DAY, 100), 0.25);
    // 1y cutoff precedes everything; falls back to the 50 = +100%
    assert.strictEqual(pctFrom(ts, closes, now - 365 * DAY, 100), 1);
    // a fall is negative, not a magnitude
    assert.strictEqual(pctFrom(ts, closes, now - 7 * DAY, 40), -0.5);
    // cutoff after every sample = no data
    assert.strictEqual(pctFrom(ts, closes, now, 100), null);
    // nulls are skipped, not treated as zero
    assert.strictEqual(pctFrom(ts, [null, 80, 90], now - 365 * DAY, 100), 0.25);
    assert.strictEqual(pctFrom([], [], now, 100), null);

    assert.strictEqual(rateFor('GBp', { GBP: 2 }), 0.02);
    assert.strictEqual(rateFor('Gbpence', { GBP: 2 }), 0.02);
    // Yahoo's EPS is in pounds even for a pence-quoted ticker; PE = price/eps needs both
    // in the same unit, so this must match price's unit, not pass the pounds figure through.
    assert.strictEqual(epsInQuoteUnits(0.12, 'GBp'), 12);
    assert.strictEqual(epsInQuoteUnits(3.1, 'USD'), 3.1);

    // resolveEps: a checked manual override wins; fresh Yahoo EPS gets scaled; carried is already
    // in quote units and must NOT be scaled again (that would 100x a pence ticker twice).
    assert.strictEqual(resolveEps(0.98, 9, 8, 'USD'), 0.98);               // manual wins
    assert.strictEqual(resolveEps(undefined, 0.12, 999, 'GBp'), 12);       // fresh, scaled once
    assert.strictEqual(resolveEps(undefined, undefined, 12, 'GBp'), 12);   // carried as-is
    assert.strictEqual(resolveEps(undefined, undefined, undefined, 'USD'), undefined);

    // normEpsFrom: headline EPS scaled by the latest year's normalized/reported ratio.
    const normEntry = { years: [{ date: '2024-12-31', norm: 90, ni: 100 }, { date: '2025-12-31', norm: 112, ni: 132 }] };
    assert.ok(Math.abs(normEpsFrom(normEntry, 10.81) - 10.81 * 112 / 132) < 1e-4);  // GOOG-like: below headline
    assert.strictEqual(normEpsFrom(normEntry, 0), null);                 // no headline EPS -> no recurring
    assert.strictEqual(normEpsFrom({ years: [{ date: '2025-12-31', norm: -5, ni: -4 }] }, 3), null); // loss year skipped
    assert.strictEqual(normEpsFrom({ years: [{ date: '2025-12-31', ni: 100 }] }, 5), null);          // no norm field
    assert.strictEqual(normEpsFrom({ years: [{ date: '2025-12-31', norm: 5, ni: 100 }] }, 5), null); // ratio 0.05 too extreme
    assert.strictEqual(normEpsFrom({ years: [] }, 5), null);

    // recurringTtmFrom: the four filed quarters summed outright, GOOG's real shape. Yahoo's annual
    // proxy priced this at 18.9x; the filed sum is what gets it to ~31x.
    const goog = { currency: 'USD', quarters: [
        { date: '2025-09-30', rev: 1, eps: 2.87, ni: 34979000000, norm: 26462165000 },
        { date: '2025-12-31', rev: 1, eps: 2.82, ni: 34455000000, norm: 32438805123 },
        { date: '2026-03-31', rev: 1, eps: 5.11, ni: 62578000000, norm: 32708508190 },
        { date: '2026-06-30', rev: 1, eps: 9.11, ni: 112193000000, norm: 32232249000 }] };
    assert.ok(Math.abs(recurringTtmFrom(goog, 'USD') - 10.11) < 0.02);   // vs 10.47 from SEC filings
    assert.strictEqual(recurringTtmFrom(goog, 'TWD'), null);             // ADR: absolute sum needs one currency
    assert.strictEqual(lastQuarterDate(goog), '2026-06-30');
    const short = { currency: 'USD', quarters: goog.quarters.slice(1) };
    assert.strictEqual(recurringTtmFrom(short, 'USD'), null);            // only three quarters
    const holed = JSON.parse(JSON.stringify(goog)); delete holed.quarters[2].norm;
    assert.strictEqual(recurringTtmFrom(holed, 'USD'), null);            // a quarter with no norm -> "–"
    const loss = JSON.parse(JSON.stringify(goog));
    loss.quarters.forEach(x => { x.norm = -x.norm; });
    assert.strictEqual(recurringTtmFrom(loss, 'USD'), null);             // loss-making: no multiple

    // trailingEpsFromQuarters: sum four clean quarters, in the quote's currency only.
    const q4 = c => ({ currency: c, quarters: [
        { date: '2025-03-31', eps: 10 }, { date: '2025-06-30', eps: 20 },
        { date: '2025-09-30', eps: 30 }, { date: '2025-12-31', eps: 40 }] });
    assert.strictEqual(trailingEpsFromQuarters(q4('KRW'), 'KRW'), 100);           // four quarters summed
    assert.strictEqual(trailingEpsFromQuarters(q4('TWD'), 'USD'), null);          // ADR: reporting != quote, refuse
    const hole = q4('KRW'); delete hole.quarters[2].eps;
    assert.strictEqual(trailingEpsFromQuarters(hole, 'KRW'), null);               // missing a quarter's EPS -> "–"
    assert.strictEqual(trailingEpsFromQuarters({ currency: 'KRW', quarters: q4('KRW').quarters.slice(1) }, 'KRW'), null); // only 3
    const wide = q4('KRW'); wide.quarters[3].date = '2026-06-30';
    assert.strictEqual(trailingEpsFromQuarters(wide, 'KRW'), null);               // span too long -> not a trailing year

    // Roll the annual forward when a quarter's EPS is missing (real SK Hynix shape: no Q4 EPS).
    const hynix = { currency: 'KRW', years: [{ date: '2025-12-31', eps: 60378 }], quarters: [
        { date: '2025-03-31', eps: 11411 }, { date: '2025-06-30', eps: 9580 },
        { date: '2025-09-30', eps: 17850 }, { date: '2025-12-31' /* no eps */ },
        { date: '2026-03-31', eps: 56670 }] };
    assert.strictEqual(trailingEpsFromQuarters(hynix, 'KRW'), 105637);            // 60378 - 11411 + 56670
    assert.strictEqual(trailingEpsFromQuarters({ ...hynix, years: [] }, 'KRW'), null); // no annual to roll -> "–"
    const staleAnn = { ...hynix, years: [{ date: '2024-12-31', eps: 28419 }] };   // annual a full year behind
    assert.strictEqual(trailingEpsFromQuarters(staleAnn, 'KRW'), null);           // 5 quarters past -> refuse, not a clean roll

    // earningsToFetch: per-ticker, not all-or-nothing.
    const fresh7 = new Date(Date.now() - 3 * 86400e3).toISOString();
    const old7 = new Date(Date.now() - 40 * 86400e3).toISOString();   // past the monthly sweep
    const ok = { currency: 'USD', years: [] };
    const T = ['A', 'B'];
    const v = EARNINGS_V;
    assert.deepStrictEqual(earningsToFetch({ v, updated: null, eps: {} }, T), T);            // never fetched
    assert.deepStrictEqual(earningsToFetch({ v, updated: old7, eps: { A: ok, B: ok } }, T), T); // aged out
    assert.deepStrictEqual(earningsToFetch({ v, updated: fresh7, eps: { A: ok, B: ok } }, T), []); // nothing to do
    // A week old is no longer a sweep: annual figures do not change weekly, and new fiscal years
    // now arrive through the due-window below instead of by re-asking all 63 every 7 days.
    const week = new Date(Date.now() - 8 * 86400e3).toISOString();
    assert.deepStrictEqual(earningsToFetch({ v, updated: week, eps: { A: ok, B: ok } }, T), []);
    // Only the ticker with no entry is fetched — a new holding, or one whose last fetch errored
    // and was deliberately not cached. Retrying it must not drag the other 55 along.
    assert.deepStrictEqual(earningsToFetch({ v, updated: fresh7, eps: { A: ok } }, T), ['B']);
    // An empty-but-present entry is a real answer (ETFs have no earnings) and is NOT refetched.
    assert.deepStrictEqual(
        earningsToFetch({ v, updated: fresh7, eps: { A: ok, B: { currency: null, years: [] } } }, T), []);
    // An older shape forces one full refresh however fresh it is, so new fields actually appear.
    // A per-ticker sniff can't do this job: it cannot tell "never fetched revenue" from "Yahoo
    // has no revenue for this ticker", so the latter would refetch everything, every run.
    assert.deepStrictEqual(earningsToFetch({ v: v - 1, updated: fresh7, eps: { A: ok, B: ok } }, T), T);
    assert.deepStrictEqual(earningsToFetch({ updated: fresh7, eps: { A: ok, B: ok } }, T), T); // unversioned

    // dueForResults: only ask when the next fiscal year is actually overdue.
    const NOW = Date.UTC(2026, 6, 17);                       // 17 Jul 2026
    const withYear = date => ({ currency: 'USD', years: [{ date, eps: 1 }] });
    // FY2025 held, next ends Dec 2026 — nothing to ask for in July.
    assert.strictEqual(dueForResults(withYear('2025-12-31'), NOW), false);
    // FY2024 held: next ended Dec 2025, ~200 days ago and still missing. Worth a look.
    assert.strictEqual(dueForResults(withYear('2024-12-31'), NOW), true);
    // Just ended — inside the reporting lag, nobody has filed yet.
    assert.strictEqual(dueForResults(withYear('2025-07-01'), NOW), false);
    // Given up on: 2 years overdue is not arriving, and must not cost a request a day forever.
    assert.strictEqual(dueForResults(withYear('2023-12-31'), NOW), false);
    // A fund has no results to wait for.
    assert.strictEqual(dueForResults({ currency: null, years: [] }, NOW), false);

    // Quarter-aware: FY held and not annually due, but a quarterly reporter whose next quarter
    // (Mar->Jun 30) is now ~1mo overdue IS due. Same name without the quarter cadence is not.
    // Last REPORTED quarter is Mar 2026, so the next (Jun 30) is what we wait on. Annual is not
    // due at any of these dates (FY2025 held, next ends Dec 2026), isolating the quarter path.
    const qEntry = (...ds) => ({ currency: 'USD', years: [{ date: '2025-12-31', eps: 1 }], quarters: ds.map(d => ({ date: d })) });
    const quarterly = qEntry('2025-12-31', '2026-03-31');
    assert.strictEqual(dueForResults(quarterly, Date.UTC(2026, 6, 10)), false);  // 10 Jul — inside lag
    assert.strictEqual(dueForResults(quarterly, Date.UTC(2026, 7, 15)), true);   // 15 Aug — overdue
    assert.strictEqual(dueForResults(quarterly, Date.UTC(2026, 10, 1)), false);  // 01 Nov — given up
    // Semi-annual reporter (~180-day gap): no phantom quarter projected, ever.
    assert.strictEqual(dueForResults(qEntry('2025-06-30', '2025-12-31'), Date.UTC(2026, 7, 15)), false);
    // One quarter only: cadence unknown, quarter path stays silent.
    assert.strictEqual(dueForResults(qEntry('2026-03-31'), Date.UTC(2026, 7, 15)), false);

    // The due window drives the fetch list, and a daily stamp keeps a stuck ticker cheap.
    const due = { currency: 'USD', years: [{ date: '2024-12-31', eps: 1 }] };
    const notDue = { currency: 'USD', years: [{ date: '2025-12-31', eps: 1 }] };
    const store = u => ({ v, updated: fresh7, eps: { A: due, B: notDue }, ...u });
    assert.deepStrictEqual(earningsToFetch(store(), ['A', 'B'], NOW), ['A']);
    // Checked today already: don't ask again this hour.
    const checkedToday = { ...due, checked: new Date(NOW - 3600e3).toISOString() };
    assert.deepStrictEqual(
        earningsToFetch({ v, updated: fresh7, eps: { A: checkedToday, B: notDue } }, ['A', 'B'], NOW), []);
    // Checked two days ago: look again.
    const checkedOld = { ...due, checked: new Date(NOW - 2 * 86400e3).toISOString() };
    assert.deepStrictEqual(
        earningsToFetch({ v, updated: fresh7, eps: { A: checkedOld, B: notDue } }, ['A', 'B'], NOW), ['A']);

    // mergeEarnings: the repo store outlives Yahoo's ~4-year window.
    const y = (date, eps) => ({ date, eps });
    // A year that has rolled off Yahoo's window is kept, so the history grows past 4.
    assert.deepStrictEqual(
        mergeEarnings({ currency: 'USD', years: [y('2021-12-31', 1), y('2022-12-31', 2)] },
            { currency: 'USD', years: [y('2022-12-31', 2), y('2023-12-31', 3)] }),
        { currency: 'USD', years: [y('2021-12-31', 1), y('2022-12-31', 2), y('2023-12-31', 3)] });
    // A restatement of a year we already hold overwrites it — fresh wins. This is why the
    // monthly sweep still exists (ASML's FY2025 EPS moved 26.26 -> 24.71 after publication).
    assert.deepStrictEqual(
        mergeEarnings({ currency: 'USD', years: [y('2022-12-31', 9)] },
            { currency: 'USD', years: [y('2022-12-31', 3)] }).years,
        [y('2022-12-31', 3)]);
    // ...but merged FIELD by field. Yahoo's per-field windows don't line up, so it hands back a
    // year carrying EPS alone; replacing the year wholesale would delete the revenue the
    // backfill put there. Fresh eps wins, backfilled rev/nic survive.
    assert.deepStrictEqual(
        mergeEarnings(
            { currency: 'HKD', years: [{ date: '2021-12-31', rev: 100, nic: 10 }] },
            { currency: 'HKD', years: [{ date: '2021-12-31', eps: 5 }] }).years,
        [{ date: '2021-12-31', rev: 100, nic: 10, eps: 5 }]);
    // And the reverse: a backfilled top line lands on a year Yahoo only gave EPS for.
    assert.deepStrictEqual(
        mergeEarnings(
            { currency: 'HKD', years: [{ date: '2025-12-31', eps: 2, ni: 20 }] },
            { currency: 'HKD', years: [{ date: '2025-12-31', eps: 2.5 }] }).years,
        [{ date: '2025-12-31', eps: 2.5, ni: 20 }]);
    // An empty fetch never erases history (glitch), but an ETF stays legitimately empty.
    assert.deepStrictEqual(
        mergeEarnings({ currency: 'USD', years: [y('2022-12-31', 2)] }, { currency: null, years: [] }),
        { currency: 'USD', years: [y('2022-12-31', 2)] });

    // Quarters accrete and merge field-by-field just like years, but are capped at the last 8.
    const qtr = (date, rev) => ({ date, rev });
    const nineQ = Array.from({ length: 9 }, (_, i) => qtr(`2024-${String(i + 1).padStart(2, '0')}-01`, i));
    assert.deepStrictEqual(
        mergeEarnings(
            { currency: 'USD', years: [y('2024-12-31', 1)], quarters: [qtr('2024-09-30', 40)] },
            { currency: 'USD', years: [y('2024-12-31', 1)], quarters: [{ date: '2024-09-30', opinc: 8 }, qtr('2024-12-31', 45)] }
        ).quarters,
        [{ date: '2024-09-30', rev: 40, opinc: 8 }, qtr('2024-12-31', 45)]);
    assert.strictEqual(
        mergeEarnings({ currency: 'USD', years: [y('2024-12-31', 1)], quarters: [] },
            { currency: 'USD', years: [y('2024-12-31', 1)], quarters: nineQ }).quarters.length, 8);
    // mergeEarnings never invents a quarters key when neither side has one (a company Yahoo
    // has no quarterly statements for stays keyless, even though fetch now asks for quarters).
    assert.strictEqual('quarters' in
        mergeEarnings({ currency: 'USD', years: [y('2024-12-31', 1)] },
            { currency: 'USD', years: [y('2024-12-31', 1)] }), false);
    assert.deepStrictEqual(
        mergeEarnings({ currency: null, years: [] }, { currency: null, years: [] }),
        { currency: null, years: [] });

    // normaliseEps: rebase every year onto the latest year's share basis via net income.
    // A consistent series is left alone (net income and EPS move together).
    assert.deepStrictEqual(
        normaliseEps([{ eps: 2, ni: 200 }, { eps: 3, ni: 300 }]).map(v => Math.round(v * 1e6) / 1e6),
        [2, 3]);
    // A 3:1 bonus issue Yahoo never restated: the older year's EPS is on the pre-bonus share
    // count (9 on 100 shares) while the latest is post-bonus (4 on 300). Profit merely grew
    // 900 -> 1200, so the older year belongs at 3 per share, not 9. This is the BYD case.
    assert.deepStrictEqual(
        normaliseEps([{ eps: 9, ni: 900 }, { eps: 4, ni: 1200 }]), [3, 4]);
    // No net income anywhere (or no positive anchor) -> fall back to EPS as filed, never NaN.
    assert.deepStrictEqual(normaliseEps([{ eps: 5 }, { eps: 6 }]), [5, 6]);
    assert.deepStrictEqual(normaliseEps([{ eps: -1, ni: -50 }]), [-1]);
    assert.deepStrictEqual(normaliseEps([]), []);

    // troughPe: each close over the latest EPS PUBLISHED by that date; cheapest ratio wins.
    // FY2023 eps 4 public 2024-03-30; FY2024 eps 5 public 2025-03-31; FY2025 eps 6 public
    // 2026-03-31 (fiscal end + 90d).
    const fx = { USD: 1, GBP: 2, JPY: 0.0062 };
    const days = ['2024-02-01', '2024-09-01', '2025-04-11', '2025-09-01'];
    const px   = [        44,           48,           50,           90];
    const usd = { currency: 'USD', years: [
        { date: '2023-12-31', eps: 4 }, { date: '2024-12-31', eps: 5 }, { date: '2025-12-31', eps: 6 }] };
    const tr = troughPe(usd, days, px, 'USD', fx);
    // The Trip.com regression, both halves: the 2025-04-11 close is priced off FY2024's 5
    // (50/5 = 10), NOT FY2025's 6 — those figures were 10 months away. And 2024-02-01's 44
    // predates ANY published year (44/4 = 11 would beat 10), so it is skipped, not priced
    // off earnings from the future.
    assert.strictEqual(tr.peLow, 10);
    assert.strictEqual(tr.lowPrice, 50);
    assert.strictEqual(tr.lowEps, 5);
    assert.strictEqual(tr.lowDate, '2025-04-11');
    // The trough is the cheapest MULTIPLE, not the cheapest price: a later, higher close over
    // newly published higher earnings can be the real low (55/6 = 9.17 beats 50/5 = 10).
    const tr2 = troughPe(usd, [...days, '2026-06-01'], [...px, 55], 'USD', fx);
    assert.ok(Math.abs(tr2.peLow - 55 / 6) < 1e-9);
    assert.strictEqual(tr2.lowDate, '2026-06-01');
    // A published loss voids the multiple from its publication on — it must not fall back to
    // the older profit (1/4 = 0.25 must NOT win), and a history that is all-loss has none.
    const lossy = { currency: 'USD', years: [{ date: '2023-12-31', eps: 4 }, { date: '2024-12-31', eps: -2 }] };
    assert.strictEqual(troughPe(lossy, ['2024-09-01', '2025-09-01'], [48, 1], 'USD', fx).peLow, 12);
    assert.strictEqual(troughPe({ currency: 'USD', years: [{ date: '2024-12-31', eps: -2 }] }, days, px, 'USD', fx), null);
    // A year Yahoo sent without EPS or net income (per-field cap) is transparent, not a void:
    // closes after it still price off the older published figure.
    assert.strictEqual(troughPe(
        { currency: 'USD', years: [{ date: '2023-12-31', eps: 4 }, { date: '2024-12-31', rev: 9e9 }] },
        ['2025-09-01'], [48], 'USD', fx).peLow, 12);
    // No earnings history at all (ETFs, gold, bitcoin) -> null, never NaN.
    assert.strictEqual(troughPe({ currency: 'USD', years: [] }, days, px, 'USD', fx), null);
    assert.strictEqual(troughPe(undefined, days, px, 'USD', fx), null);

    // An ADR quotes in USD but REPORTS in JPY. Dividing the USD price by the raw JPY EPS is
    // the bug that made NTDOY read as +20,000% dear; the EPS must be converted first.
    // 500 JPY EPS -> $3.10, so the post-publication low of 50 is a 16.1x multiple, not 0.1x.
    const adr = troughPe({ currency: 'JPY', years: [{ date: '2024-12-31', eps: 500 }] }, days, px, 'USD', fx);
    assert.ok(Math.abs(adr.lowEps - 3.1) < 1e-9);
    assert.ok(Math.abs(adr.peLow - 50 / 3.1) < 1e-9);
    // Pence falls out of the same FX path with no special case: GBp is GBP/100, so a
    // GBP-reported EPS of 0.5 becomes 50p against a pence-quoted price. 50 / 50 = 1.0x.
    assert.strictEqual(troughPe({ currency: 'GBP', years: [{ date: '2024-12-31', eps: 0.5 }] }, days, px, 'GBp', fx).peLow, 1);
    // No FX rate for the reporting currency -> null, never a wrong multiple.
    assert.strictEqual(troughPe({ currency: 'CNY', years: [{ date: '2024-12-31', eps: 5 }] }, days, px, 'USD', fx), null);
    const shaped = shape({
        meta: { regularMarketPrice: 100, currency: 'USD' }, timestamp: [],
        indicators: { quote: [{ close: [] }] },
        events: { dividends: { a: { amount: 1.25 }, b: { amount: 0.75 } } },
    });
    assert.strictEqual(shaped.divTTM, 2);
    assert.strictEqual(shaped.divYield, 0.02);

    // parseQuotes skips symbols with no EPS (indices, some ETFs) rather than writing null.
    const QNOW = Date.UTC(2026, 6, 17);
    const future = Date.UTC(2026, 6, 30) / 1000, past = Date.UTC(2026, 4, 20) / 1000;
    assert.deepStrictEqual(
        parseQuotes({ quoteResponse: { result: [{ symbol: 'AAPL', epsTrailingTwelveMonths: 6.5 }, { symbol: '^GSPC' }] } }, QNOW),
        { eps: { AAPL: 6.5 }, earnings: {}, types: {} }
    );
    // quoteType rides along, used to skip fundamentals for non-equities. Even a bogus ETF EPS
    // (VOO reports one) is captured, so the caller keys "operating company?" on type, not EPS.
    assert.deepStrictEqual(
        parseQuotes({ quoteResponse: { result: [
            { symbol: 'AAPL', quoteType: 'EQUITY', epsTrailingTwelveMonths: 6.5 },
            { symbol: 'VOO', quoteType: 'ETF', epsTrailingTwelveMonths: 25.5 },
            { symbol: '^GSPC', quoteType: 'INDEX' },
        ] } }, QNOW).types,
        { AAPL: 'EQUITY', VOO: 'ETF', '^GSPC': 'INDEX' });
    // A future date is the next results date...
    assert.deepStrictEqual(
        parseQuotes({ quoteResponse: { result: [{ symbol: 'AAPL', earningsTimestamp: future }] } }, QNOW).earnings,
        { AAPL: { date: '2026-07-30' } });
    // ...but Yahoo keeps returning the LAST one once a company has reported and the next is not
    // scheduled (MKS.L in July 2026 returns May 2026). That is not upcoming, so it is dropped.
    assert.deepStrictEqual(
        parseQuotes({ quoteResponse: { result: [{ symbol: 'MKS.L', earningsTimestamp: past }] } }, QNOW).earnings, {});
    // earningsTimestampStart stands in when the exact timestamp is missing (1113.HK).
    assert.deepStrictEqual(
        parseQuotes({ quoteResponse: { result: [{ symbol: 'X', earningsTimestampStart: future }] } }, QNOW).earnings,
        { X: { date: '2026-07-30' } });
    // A guessed date is flagged, not passed off as confirmed.
    assert.deepStrictEqual(
        parseQuotes({ quoteResponse: { result: [{ symbol: 'X', earningsTimestamp: future, isEarningsDateEstimate: true }] } }, QNOW).earnings,
        { X: { date: '2026-07-30', estimate: true } });

    // exDivToFetch: only look when there's a reason, and never twice a day.
    const T2 = '2026-07-17';
    // A future cached date needs no lookup.
    assert.deepStrictEqual(exDivToFetch({ A: { exDiv: '2026-09-01' } }, ['A'], T2), []);
    // No cached date at all -> look.
    assert.deepStrictEqual(exDivToFetch({}, ['A'], T2), ['A']);
    // A passed date -> look (the next may now be announced)...
    assert.deepStrictEqual(exDivToFetch({ A: { exDiv: '2026-05-01' } }, ['A'], T2), ['A']);
    // ...unless already looked today: the annual-payer trap, capped to one look a day.
    assert.deepStrictEqual(
        exDivToFetch({ A: { exDiv: '2026-05-01', exDivChecked: T2 } }, ['A'], T2), []);
    // Checked yesterday -> look again today.
    assert.deepStrictEqual(
        exDivToFetch({ A: { exDiv: '2026-05-01', exDivChecked: '2026-07-16' } }, ['A'], T2), ['A']);
    // Today IS the ex-div date -> not past yet, no lookup.
    assert.deepStrictEqual(exDivToFetch({ A: { exDiv: T2 } }, ['A'], T2), []);

    // mrqToFetch: look only when the cached quarter has aged past the reporting-lag grace, once a
    // day, and never more than the cold-start cap in one run.
    const M = '2026-07-24';
    assert.deepStrictEqual(mrqToFetch({}, ['A'], M), ['A']);                          // no cache -> look
    assert.deepStrictEqual(mrqToFetch({ A: { mrq: '2026-06-30' } }, ['A'], M), []);   // 24 days old -> fresh, skip
    assert.deepStrictEqual(mrqToFetch({ A: { mrq: '2026-03-01' } }, ['A'], M), ['A']); // 145 days old -> stale, look
    assert.deepStrictEqual(                                                            // ...but not twice a day
        mrqToFetch({ A: { mrq: '2026-03-01', mrqChecked: M } }, ['A'], M), []);
    assert.deepStrictEqual(                                                            // checked yesterday -> look again
        mrqToFetch({ A: { mrq: '2026-03-01', mrqChecked: '2026-07-23' } }, ['A'], M), ['A']);
    assert.strictEqual(mrqToFetch({}, Array.from({ length: 20 }, (_, i) => 'T' + i), M).length, MRQ_MAX_PER_RUN); // burst cap
    // Exchanges timestamp the same weekly bar on different UTC days; align both to Friday.
    assert.strictEqual(isoDay(weekEnd(Date.parse('2021-07-11') / 1000)), '2021-07-16');
    assert.strictEqual(isoDay(weekEnd(Date.parse('2021-07-12') / 1000)), '2021-07-16');

    // NAV: two holdings, one priced in HKD, over three trading days. Quantity comes from the
    // TRADES now, not a qty field — navHistory replays the Tradelog rather than back-projecting
    // today's share count.
    const d = ['2026-01-05', '2026-01-06', '2026-01-07'].map(s => Date.parse(s) / 1000);
    const buy = (date, qty, price, currency = 'USD') => ({ date, side: 'BUY', qty, price, currency });
    const q = {
        A: { currency: 'USD', series: { timestamps: d, closes: [10, 11, 12] } },
        B: { currency: 'HKD', series: { timestamps: d, closes: [100, 100, 100] } },
    };
    const hold = [
        { yahoo: 'A', trades: [buy('2026-01-05', 2, 10)] },
        { yahoo: 'B', trades: [buy('2026-01-05', 1, 100, 'HKD')] },
    ];
    const nav = navHistory(hold, q, { USD: 1, HKD: 0.1 });
    assert.deepStrictEqual(nav.values, [30, 32, 34]); // 2*close + 100*0.1

    // The point of the replay: nothing owned yet means nothing on the chart, and the line steps
    // up when you buy. The old proxy drew today's shares back to the start of history — it put
    // the S&P group at $5,723 in Dec 2019 when the real figure was $593.
    const later = navHistory([{ yahoo: 'A', trades: [buy('2026-01-06', 2, 11)] }], q, { USD: 1 });
    assert.deepStrictEqual(later.values, [0, 22, 24]);

    // A gap (holiday) forward-fills rather than dropping the holding to zero.
    const gap = { A: { currency: 'USD', series: { timestamps: d, closes: [10, null, 12] } } };
    assert.deepStrictEqual(
        navHistory([{ yahoo: 'A', trades: [buy('2026-01-05', 1, 10)] }], gap, { USD: 1 }).values,
        [10, 10, 12]);

    // A holding whose history starts late is held flat at its first close, so it adds a
    // constant instead of a fake ramp from zero. Full date range is preserved.
    const late = {
        A: { currency: 'USD', series: { timestamps: d, closes: [10, 10, 10] } },
        B: { currency: 'USD', series: { timestamps: d.slice(2), closes: [5] } },
    };
    const back = navHistory([
        { yahoo: 'A', trades: [buy('2026-01-05', 1, 10)] },
        { yahoo: 'B', trades: [buy('2026-01-05', 1, 5)] },
    ], late, { USD: 1 });
    assert.strictEqual(back.days.length, 3);
    assert.deepStrictEqual(back.values, [15, 15, 15]);

    // alignedCloses keeps leading nulls honest (no backfill) so a single-stock chart
    // starts at the IPO, while interior holiday gaps forward-fill.
    const aligned = alignedCloses(['A', 'B'], late);
    assert.deepStrictEqual(aligned.days.length, 3);
    assert.deepStrictEqual(aligned.closes.A, [10, 10, 10]);
    assert.deepStrictEqual(aligned.closes.B, [null, null, 5]); // null before B's first close
    assert.deepStrictEqual(alignedCloses(['A'], gap).closes.A, [10, 10, 12]);

    console.log('selftest ok');
}

if (process.argv[2] === '--selftest') selftest();
else main().catch(e => { console.error(e.message); process.exit(1); });
