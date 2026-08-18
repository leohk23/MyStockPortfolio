// fetch-hk-board.js — when will our Hong Kong names announce results?
//
//   npm run hkboard
//
// Yahoo publishes no forward results date for most HK issuers. It is not a data hole on their
// side so much as a reporting-calendar one: on 18 Aug 2026 every HK name in this book read
// "not scheduled", while the exchange itself was carrying the exact date in a filed announcement.
//
// SOURCE: HKEXnews, the exchange's own disclosure site. Under Main Board Listing Rule 13.43 an
// issuer must announce the date of the board meeting that approves results **at least 7 clear
// business days in advance**. In practice this book's names file 13-17 days ahead. That makes this
// a date the COMPANY has announced, not a projection — strictly better than anything Yahoo has.
//
// Three steps, because the exchange splits the fact across two places:
//   1. activestock_sehk_e.json  — static; maps 01113 to HKEX's internal stockId 124341.
//   2. titleSearchServlet.do    — the endpoint behind their own search form. Announcement
//                                 METADATA only: who filed, when, and a link to the PDF.
//   3. the PDF itself           — the only place the meeting date is written.
//
// RUN DAILY AT MOST, and never from the price loop. These notices appear twice a year per company;
// polling an Akamai-fronted regulator's site every 15 minutes would be pointless and rude. The
// price pipeline reads the FILE this writes and never calls HKEXnews itself.
//
// Honest about the risk, because AGENTS.md is: titleSearchServlet.do is undocumented, unversioned
// and not offered as an interface — the same class of source as stockanalysis.com. Its failure
// mode is safe (a changed shape returns zero rows, which means no date, which is what the calendar
// already shows). The dangerous step is the PDF parse, which could in principle return a WRONG
// date, so that is where the guards are.

const fs = require('fs');

const OUT = 'hk-board.json';
const HOST = 'https://www1.hkexnews.hk';
const STOCK_LIST = `${HOST}/ncms/script/eds/activestock_sehk_e.json`;
const SERVLET = `${HOST}/search/titleSearchServlet.do`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MyStockPortfolio/1.0 (personal portfolio tool)';

// Headline categories, from their own tiertwo_e.json.
const T1_ANNOUNCEMENTS = '10000';
const T2_BOARD_MEETING = '13150';   // "Date of Board Meeting"
const T2_DELAY = '13200';           // "Delay in Results Announcement"
const T2_INTERIM_RESULTS = '13400'; // "Interim Results" — the half-year statements themselves

const OUT_INTERIM = 'hk-interim.json';
// A half year is rarely less than a twentieth or more than 1.5x its own full year. That band is
// wide on purpose: it is not a plausibility test on the business, it is a UNITS-and-column test.
// The failures worth catching are order-of-magnitude (a note number read as a value, cents read as
// dollars) and column-order (prior read as current), and both blow straight through it.
const HALF_OF_YEAR = [0.05, 1.5];

// How far back to look for a notice. A results board meeting is called ~2 weeks out and companies
// report twice (HK) to four times a year, so 150 days always spans the latest one without dragging
// in the previous cycle's.
const LOOKBACK_DAYS = 150;
// A meeting cannot precede the notice announcing it — that floor is the guard that matters, since
// the other date in every one of these filings is the PERIOD END, which is always in the past.
// The ceiling only has to exclude the next cycle: HKEX filed its 19 Aug notice on 12 June, 68 days
// ahead, so a month is far too tight.
const NOTICE_TO_MEETING_DAYS = [0, 120];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = MONTHS.join('|');
const WD = WEEKDAYS.join('|');

// Both date orders appear, and the weekday sits on either side of the date:
//   "Thursday, 13th August, 2026"   CK Asset, CK Hutchison, CLP, Power Assets, HK Electric, HKEX
//   "August 18, 2026 (Tuesday)"     Xiaomi
//   "Wednesday, June 24, 2026"      Trip.com
// Ordinal suffixes and every comma are optional in both.
const DMY = new RegExp(`(?:(${WD})\\s*,?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON}),?\\s+(20\\d\\d)`, 'i');
const MDY = new RegExp(`(?:(${WD})\\s*,?\\s*)?(${MON})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)`
    + `(?:\\s*\\((${WD})\\))?`, 'i');

// First date in the window, whichever order it is written in, with the weekday if one is stated.
function parseDate(window) {
    const dmy = DMY.exec(window), mdy = MDY.exec(window);
    // Whichever appears first. MDY is checked on ties because "August 18, 2026" also contains no
    // leading day number, so a DMY match at the same index would be a misread.
    const useMdy = mdy && (!dmy || mdy.index <= dmy.index);
    const m = useMdy ? mdy : dmy;
    if (!m) return null;
    const [day, monthName, year, weekday] = useMdy
        ? [m[3], m[2], m[4], m[1] || m[5]]
        : [m[2], m[3], m[4], m[1]];
    const month = MONTHS.findIndex(x => x.toLowerCase() === monthName.toLowerCase());
    if (month < 0) return null;
    return { date: `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`, weekday };
}

const sleep = (ms = 400) => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function getJSON(url, attempts = 3) {
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            lastErr = e;
            if (a < attempts - 1) await sleep(800 * (a + 1));
        }
    }
    throw lastErr;
}

// The servlet answers with JSON whose `result` is itself a JSON *string* — parsed twice, which is
// the tell that this is internal plumbing rather than a designed API. A wrong or absent category
// yields a VALID EMPTY envelope rather than an error, so "no rows" never proves "nothing filed".
async function search(stockId, t2code, fromDate, toDate) {
    const p = new URLSearchParams({
        stockId: String(stockId), t1code: T1_ANNOUNCEMENTS, t2Gcode: '3', t2code,
        fromDate, toDate, market: 'SEHK', searchType: '1', documentType: '-1', category: '0',
        sortDir: '0', sortByOptions: 'DateTime', rowRange: '50', title: '', lang: 'EN',
    });
    const env = await getJSON(`${SERVLET}?${p}`);
    const rows = JSON.parse(env.result || '[]');
    // DATE_TIME is "30/07/2026 17:30" local Hong Kong time.
    return rows.map(r => ({
        title: r.TITLE,
        filed: r.DATE_TIME.slice(6, 10) + '-' + r.DATE_TIME.slice(3, 5) + '-' + r.DATE_TIME.slice(0, 2),
        link: r.FILE_LINK,
        type: r.FILE_TYPE,
    })).sort((a, b) => b.filed.localeCompare(a.filed));
}

// Minimal PDF text extraction: inflate each FlateDecode stream and take the string literals out of
// the text-showing operators. No dependency — these announcements are one or two pages of prose.
//
// Deliberately NOT a PDF renderer. It cannot read a scanned page or a CID-keyed font, and when it
// fails it returns little or nothing, which the caller turns into "no date" rather than a guess.
function pdfText(buf) {
    const zlib = require('zlib');
    const out = [];
    let i = 0;
    while ((i = buf.indexOf('stream', i)) !== -1) {
        let s = i + 6;
        if (buf[s] === 13) s++;
        if (buf[s] === 10) s++;
        const e = buf.indexOf('endstream', s);
        if (e === -1) break;
        let chunk = buf.slice(s, e);
        try { chunk = zlib.inflateSync(chunk); } catch { i = e + 9; continue; }
        const txt = chunk.toString('latin1');
        for (const m of txt.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
            out.push(m[0].slice(1, -1).replace(/\\([()\\])/g, '$1'));
        }
        i = e + 9;
    }
    return stripLangTags(out.join('')).replace(/\s+/g, ' ').trim();
}

// Marked-content language tags (en-US, en-GB, zh-TW) leak out of the literals and land MID-WORD,
// splitting "Thursday, 13th August" into halves no pattern would match. They are glued to the text
// on both sides — "en-GBHong Kong", "on Thursday, en-US13th August" — and often repeated
// ("zh-TWzh-TWzh-TW"), so neither \b anchor can be used: there is no word boundary between "US"
// and "13", nor between one tag and the next. Matching the exact tag shape instead, with the
// region left case-SENSITIVE, is what stops "en-GBHong" from eating into "Hong".
const stripLangTags = s => s.replace(/(?:en|zh)-[A-Z]{2}/g, ' ');

// Pull the MEETING date out of the announcement's prose.
//
// Anchored on the sentence that announces the meeting, never on "the first date in the document":
// every one of these filings also states the period it covers ("for the six months ended 30th
// June, 2026"), which is always in the PAST and is exactly what an unanchored parse would return.
//
// Where the document names the weekday — most do — it is checked against the date. That is a free
// integrity test on the parse: a mis-read day or month almost never lands on the stated weekday.
// `today` is a parameter, same reason parseQuotes takes `now` in fetch-prices.js: the staleness
// check below is a policy about the clock, and a function whose result changes at midnight cannot
// be tested against a fixture.
function meetingDate(text, filed, today = iso(new Date())) {
    // Some issuers approve results at the meeting and PUBLISH them the next day. Trip.com's notice
    // says the board meets Wednesday 24 June and "will announce the Results on Thursday, June 25"
    // — and the date you want on a calendar is the one the figures actually appear. So the
    // publication sentence is looked for FIRST, and the meeting is the fallback.
    const publish = text.search(/will (?:announce|publish|release)[^.]{0,80}?\bon\b/i);
    const meets = text.search(/will be held|will be convened|has been convened|will hold a meeting|is scheduled to be held/i);
    const at = publish !== -1 ? publish : meets;
    if (at === -1) return { date: null, why: 'no sentence announcing a meeting' };
    // The announcing sentence, not the whole document.
    const found = parseDate(text.slice(at, at + 500))
        // A publication sentence with no date in it is not a reason to give up on the meeting.
        || (publish !== -1 && meets !== -1 ? parseDate(text.slice(meets, meets + 500)) : null);
    if (!found) return { date: null, why: 'no date in the announcing sentence' };
    const { date, weekday } = found;
    if (Number.isNaN(Date.parse(date))) return { date: null, why: `unparseable date ${date}` };

    // Stated weekday must match the date it is attached to.
    if (weekday) {
        const actual = WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
        if (actual.toLowerCase() !== weekday.toLowerCase()) {
            return { date: null, why: `document says ${weekday}, ${date} is a ${actual}` };
        }
    }
    // A meeting cannot precede its own notice, and one a long way out is not this cycle's.
    const gap = daysBetween(filed, date);
    const [lo, hi] = NOTICE_TO_MEETING_DAYS;
    if (gap < lo || gap > hi) return { date: null, why: `${gap} days after the notice, outside ${lo}-${hi}` };
    // A date already in the past is last cycle's — the notice is stale, not upcoming.
    if (date < today) return { date: null, why: `${date} has already passed` };

    // Category 13150 is "Date of Board Meeting" generally — a board can meet for things that are
    // not results. Require the document to say so.
    if (!/results/i.test(text)) return { date: null, why: 'the notice does not mention results' };

    // Which period the results cover, where the filing says so. Labelling only — never used to
    // derive the date. Both orders again: "six months ended 30th June, 2026" and "ended June 30, 2026".
    // Commas are IN the span, not a terminator: "30th June, 2026" and "June 30, 2026" both carry one.
    const p = /(?:six months|half[- ]year|year|three months|nine months|quarter)\s+end(?:ed|ing)\s+([^.;]{4,28}?20\d\d)/i.exec(text);
    const period = p ? parseDate(p[1])?.date ?? null : null;
    return { date, period, weekdayChecked: !!weekday };
}

// ---- half-year EPS, from the results announcement itself ------------------------------------
//
// A different document from the board-meeting notice: that one is a single page saying a meeting
// will happen, this is the 30-100 page statement published on the day. Same site, same access,
// one category code apart.
//
// Why bother: Yahoo publishes NOTHING sub-annual for a semi-annual reporter — not on the local
// line, not on the ADR, not in any quoteSummary module — so these names sit on a figure up to
// twelve months old, and interim.json is filled in by hand.
//
// The trap that makes this harder than the date is the NOTE REFERENCE. Every statement line reads
// "Revenue 2 42,856 42,854" — label, note pointer, current period, prior period — and a parser
// that takes "the first number after the label" reports revenue of 2. What saves EPS specifically
// is that the figures carry a CURRENCY PREFIX and the note number does not:
//
//   CLP           "Earnings per share, basic and diluted 7 HK$2.37 HK$2.23"
//   Power Assets  "Earnings per share Basic and diluted 9 $6.90 $1.43"
//   CK Asset      "Earnings per shareHK$2.48HK$1.80"          (no spaces at all)
//
// So the pattern skips anything that is not a $, then demands two $-prefixed numbers in a row.
// Parenthesised figures are losses, which HK statements write as "(0.15)" rather than "-0.15".
const EPS_LINE = /Earnings per share[^$]{0,60}?(?:HK)?\$\s?\(?([\d,]+(?:\.\d+)?)\)?\s*(?:HK)?\$\s?(\(?[\d,]+(?:\.\d+)?\)?)/i;

// Nothing separates a figure from whatever follows it in extracted PDF text, and what follows the
// LAST figure on the line is the column header: CK Asset's "HK$2.48HK$1.80" runs straight into
// "2026 2025 HK$ Million", so a greedy decimal reads 1.802026. The value barely moves, which is
// exactly why it is dangerous — the reconciliation check waves it through.
//
// Two decimals is the convention in every HK statement here (2.37, 2.23, 6.90, 1.43, 2.48, 1.80).
// So: two decimals is clean; three is a genuinely finer figure and kept; anything longer is only
// accepted when the surplus is precisely a glued four-digit year, and is otherwise REFUSED as
// ambiguous rather than silently truncated to something plausible.
function ungluedDecimal(s) {
    const m = /^(\d[\d,]*)\.(\d+)$/.exec(s);
    if (!m) return s;
    const [, whole, dec] = m;
    if (dec.length <= 3) return s;
    if (dec.length === 6 && /^(?:19|20)\d\d$/.test(dec.slice(2))) return `${whole}.${dec.slice(0, 2)}`;
    return null;                      // unreadable, and a guess here is worse than no figure
}
// Not every issuer puts EPS in the statement table. CK Hutchison states it in prose, with the
// comparative in brackets after the period rather than in a second column:
//
//   "earnings per share were HK$7.00 for the six months ended 30 June 2026 (30 June 2025 - HK$0.22)"
//
// Same two figures, same order, and still both currency-prefixed. Neither run may cross a full
// stop or another $, which keeps it from stitching together two unrelated sentences.
const EPS_PROSE = /earnings per share[^.$]{0,40}?(?:HK)?\$([\d,]+(?:\.\d+)?)[^.$]{0,80}?\([^)$]{0,40}(?:HK)?\$([\d,]+(?:\.\d+)?)\)/i;

const num = s => {
    const neg = s.startsWith('(');
    const cleaned = ungluedDecimal(s.replace(/[(),]/g, ''));
    if (cleaned == null) return null;
    const v = Number(cleaned);
    return Number.isFinite(v) ? (neg ? -v : v) : null;
};

// Both halves, current first. Returning the PRIOR one is the point, not a bonus: it is the only
// figure in the document that can be checked against something already in the store.
function interimEps(text) {
    const m = EPS_LINE.exec(text) || EPS_PROSE.exec(text);
    if (!m) return { eps: null, why: 'no earnings-per-share line with two currency-prefixed figures' };
    const eps = num(m[1]), prior = num(m[2]);
    if (eps == null || prior == null) return { eps: null, why: 'unreadable figures on the EPS line' };
    return { eps, prior };
}

// Which half-year does this announcement cover?
function interimPeriod(text) {
    const p = /(?:six months|half[- ]year)\s+end(?:ed|ing)\s+([^.;]{4,28}?20\d\d)/i.exec(text);
    return p ? parseDate(p[1])?.date ?? null : null;
}

// The check that makes this publishable rather than merely extracted.
//
// The announcement prints last year's half beside this year's. We already hold last year's FULL
// year in earnings.json, and a half year has to be a sensible fraction of the year that contains
// it. So the document validates itself against data that came from somewhere else entirely: if the
// PRIOR column reconciles, the parse found the right line, read the right units and had the columns
// the right way round — and only then is the CURRENT column worth keeping.
function reconcile(eps, prior, priorEnd, entry) {
    if (!entry?.years?.length) return { ok: false, why: 'no annual history to check against' };
    if (!priorEnd) return { ok: false, why: 'could not read which period the prior column covers' };
    // The fiscal year that CONTAINS that prior half — it ends within twelve months after it.
    const fy = entry.years.find(y => y.date > priorEnd && daysBetween(priorEnd, y.date) <= 370);
    if (!fy) return { ok: false, why: `no filed year covering the half to ${priorEnd}` };
    if (!(fy.eps > 0)) return { ok: false, why: `filed year ${fy.date} has no positive EPS to check against` };
    const ratio = prior / fy.eps;
    const [lo, hi] = HALF_OF_YEAR;
    if (!(ratio >= lo && ratio <= hi)) {
        return { ok: false, why: `prior half ${prior} is ${ratio.toFixed(2)}x the filed ${fy.date} year `
            + `(${fy.eps}) — outside ${lo}-${hi}, so the line, the units or the column order is wrong` };
    }
    return { ok: true, against: fy.date, fyEps: fy.eps, ratio: Number(ratio.toFixed(3)) };
}

async function main() {
    // HK listings we care about: held, watched, or the home listing behind a receipt. ETFs and
    // indices are dropped — prices.json records `type` for non-equities, and a tracker fund files
    // no results.
    const holdings = JSON.parse(fs.readFileSync('holdings.json', 'utf8')).holdings;
    const watchlist = JSON.parse(fs.readFileSync('watchlist.json', 'utf8'));
    const quotes = JSON.parse(fs.readFileSync('prices.json', 'utf8')).quotes;
    const wanted = [...new Set([...holdings, ...watchlist]
        .flatMap(x => [x.yahoo, x.primary]).filter(t => t && t.endsWith('.HK')))]
        .filter(t => !quotes[t]?.type)
        .sort();
    if (!wanted.length) { console.log('no HK equities to look up'); return; }

    const today = new Date();
    const from = new Date(today.getTime() - LOOKBACK_DAYS * 864e5);
    const yyyymmdd = d => iso(d).replace(/-/g, '');

    console.log(`looking up ${wanted.length} HK listing(s) on HKEXnews\n`);
    const stocks = await getJSON(STOCK_LIST);
    // Their codes are zero-padded to five: 1113.HK is "01113".
    const idOf = {};
    for (const s of stocks) idOf[s.c] = s.i;

    const results = {};
    let found = 0, refused = 0;
    for (const ticker of wanted) {
        const code = ticker.replace('.HK', '').padStart(5, '0');
        const id = idOf[code];
        if (!id) { console.log(`  ${ticker.padEnd(9)} not on the active list — skipped`); continue; }

        let notices, delays;
        try {
            notices = await search(id, T2_BOARD_MEETING, yyyymmdd(from), yyyymmdd(today));
            await sleep();
            delays = await search(id, T2_DELAY, yyyymmdd(from), yyyymmdd(today));
        } catch (e) {
            console.error(`  ${ticker.padEnd(9)} search failed: ${e.message}`);
            continue;
        }
        await sleep();
        if (!notices.length) { console.log(`  ${ticker.padEnd(9)} no board-meeting notice in ${LOOKBACK_DAYS}d`); continue; }

        const notice = notices[0];
        // A postponement filed AFTER the notice supersedes it. Without this a cancelled date would
        // sit on the calendar looking like the company's own word, which is worse than no date.
        const delay = delays.find(d => d.filed >= notice.filed);
        if (delay) {
            console.log(`  ${ticker.padEnd(9)} REFUSED — "${delay.title}" filed ${delay.filed} supersedes the notice`);
            refused++;
            continue;
        }

        let text;
        try {
            const res = await fetch(HOST + notice.link, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            text = pdfText(Buffer.from(await res.arrayBuffer()));
        } catch (e) {
            console.error(`  ${ticker.padEnd(9)} could not read ${notice.link}: ${e.message}`);
            refused++;
            await sleep();
            continue;
        }
        await sleep();

        const got = meetingDate(text, notice.filed);
        if (!got.date) {
            console.log(`  ${ticker.padEnd(9)} REFUSED — ${got.why} (${notice.link})`);
            refused++;
            continue;
        }
        results[ticker] = {
            date: got.date,
            ...(got.period ? { period: got.period } : {}),
            announced: notice.filed,
            title: notice.title,
            notice: HOST + notice.link,
        };
        found++;
        console.log(`  ${ticker.padEnd(9)} ${got.date}`
            + `${got.period ? ` for the period to ${got.period}` : ''}`
            + `  (announced ${notice.filed}${got.weekdayChecked ? ', weekday checked' : ''})`);
    }

    // ---- second pass: half-year EPS out of the results announcements ------------------------
    //
    // Deliberately a SEPARATE output from the dates. interim.json wants rev + nic + eps together
    // and check-interim.js refuses a period filed half-empty ("omit the period rather than filing
    // it half-empty"), which is the right rule — so EPS alone is written here as a proposal, to be
    // read and promoted deliberately, never merged into the hand-kept file behind your back.
    const store = (() => {
        try { return JSON.parse(fs.readFileSync('earnings.json', 'utf8')).eps || {}; }
        catch { return {}; }
    })();
    const interim = {};
    let epsOk = 0, epsNo = 0;
    console.log('\nhalf-year EPS from the results announcements:');
    for (const ticker of wanted) {
        const id = idOf[ticker.replace('.HK', '').padStart(5, '0')];
        if (!id) continue;
        let filings;
        try {
            filings = await search(id, T2_INTERIM_RESULTS, yyyymmdd(from), yyyymmdd(today));
        } catch (e) {
            console.error(`  ${ticker.padEnd(9)} search failed: ${e.message}`);
            continue;
        }
        await sleep();
        if (!filings.length) { console.log(`  ${ticker.padEnd(9)} no interim results filed in ${LOOKBACK_DAYS}d`); continue; }

        const doc = filings[0];
        let text;
        try {
            const res = await fetch(HOST + doc.link, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            text = pdfText(Buffer.from(await res.arrayBuffer()));
        } catch (e) {
            console.error(`  ${ticker.padEnd(9)} could not read ${doc.link}: ${e.message}`);
            epsNo++;
            await sleep();
            continue;
        }
        await sleep();

        const got = interimEps(text);
        if (got.eps == null) { console.log(`  ${ticker.padEnd(9)} REFUSED — ${got.why}`); epsNo++; continue; }
        const end = interimPeriod(text);
        // The prior column covers the same half one year earlier.
        const priorEnd = end ? `${+end.slice(0, 4) - 1}${end.slice(4)}` : null;
        const check = reconcile(got.eps, got.prior, priorEnd, store[ticker]);
        if (!check.ok) { console.log(`  ${ticker.padEnd(9)} REFUSED — ${check.why}`); epsNo++; continue; }

        interim[ticker] = {
            end, eps: got.eps, priorEnd, priorEps: got.prior,
            currency: store[ticker]?.currency || null,
            published: doc.filed,
            source: HOST + doc.link,
            reconciled: `prior half ${got.prior} is ${check.ratio}x the filed ${check.against} year (${check.fyEps})`,
        };
        epsOk++;
        console.log(`  ${ticker.padEnd(9)} ${end} EPS ${got.eps} (prior half ${got.prior}, `
            + `${check.ratio}x the filed ${check.against} year — reconciled)`);
    }
    fs.writeFileSync(OUT_INTERIM, JSON.stringify({
        _source: 'Half-year EPS read from each company\'s own interim results announcement on '
            + 'HKEXnews. A PROPOSAL, not page data: interim.json wants rev + nic + eps together and '
            + 'check-interim.js rightly refuses a period filed half-empty, so nothing here is merged '
            + 'automatically. Every entry carries the prior-year half printed alongside it in the '
            + 'same document, and was only written because that prior figure reconciled against the '
            + 'filed full year already in earnings.json — which is what proves the parser found the '
            + 'right line, read the right units, and had the two columns the right way round.',
        updated: new Date().toISOString(),
        results: interim,
    }, null, 1) + '\n');
    console.log(`\nwrote ${OUT_INTERIM} (${epsOk} reconciled, ${epsNo} refused)`);

    fs.writeFileSync(OUT, JSON.stringify({
        _source: 'HKEXnews (www1.hkexnews.hk), the exchange\'s own disclosure site. Board-meeting '
            + 'notices are filed under Main Board Listing Rule 13.43, at least 7 clear business days '
            + 'before the meeting — so these are dates the company has announced, not projections. '
            + 'Each entry links the filing it came from.',
        updated: new Date().toISOString(),
        results,
    }, null, 1) + '\n');
    console.log(`\nwrote ${OUT} (${found} announced date(s), ${refused} refused, ${wanted.length} looked up)`);
}

function selftest() {
    const assert = require('assert');
    // Pinned clock: these are fixtures, not a live feed.
    const T = '2026-06-01';

    // The real shape of CK Asset's notice, after pdfText: the period end appears BEFORE nothing
    // and AFTER the meeting date, and an unanchored parse would still have to choose between them.
    const cka = 'DATE OF BOARD MEETING The board of directors (the Board) of CK Asset Holdings '
        + 'Limited (the Company) hereby announces that a meeting of the Board of the Company will '
        + 'be held in Hong Kong on Thursday, 13th August, 2026, for the purpose of, among other '
        + 'matters, approving the release of the interim results of the Company and its '
        + 'subsidiaries for the six months ended 30th June, 2026 and considering the payment of an '
        + 'interim dividend.';
    const r = meetingDate(cka, '2026-07-30', T);
    assert.strictEqual(r.date, '2026-08-13');       // the meeting, not the period
    assert.strictEqual(r.period, '2026-06-30');
    assert.strictEqual(r.weekdayChecked, true);

    // Plain form, no ordinal, no weekday (CLP's wording).
    assert.strictEqual(meetingDate(
        'a meeting of the Board will be held on 6 August 2026 to approve the interim results '
        + 'for the six months ended 30 June 2026', '2026-07-20', T).date, '2026-08-06');

    // Month-first, weekday trailing in brackets — Xiaomi's wording, verbatim.
    const xiaomi = meetingDate('hereby announces that a meeting of the Board of the Company will be '
        + 'held on August 18, 2026 (Tuesday) for the purposes of, among other matters, considering '
        + 'and approving the unaudited consolidated interim results of the Company and its '
        + 'subsidiaries for the six months ended June 30, 2026', '2026-07-17', T);
    assert.strictEqual(xiaomi.date, '2026-08-18');
    assert.strictEqual(xiaomi.period, '2026-06-30');
    // ...and the trailing weekday is still checked, not just skipped.
    assert.strictEqual(meetingDate('a meeting will be held on August 18, 2026 (Friday) to approve '
        + 'the interim results', '2026-07-17', T).date, null);

    // Month-first with a LEADING weekday — Trip.com's wording.
    assert.strictEqual(meetingDate('the board will hold a meeting on Wednesday, June 24, 2026 '
        + 'to approve the financial results', '2026-06-11', T).date, '2026-06-24');

    // Publication after the meeting: Trip.com approves on the 24th and publishes on the 25th, and
    // the 25th is the date the figures appear. Prefer it.
    const trip = meetingDate('the board of directors will hold a meeting on Wednesday, June 24, '
        + '2026 for the purposes of approving the financial results for the three months ended '
        + 'March 31, 2026 (the Results) and its publication. The Company will announce the Results '
        + 'on Thursday, June 25, 2026, before the trading hours of the Hong Kong Stock Exchange.',
        '2026-06-11', T);
    assert.strictEqual(trip.date, '2026-06-25');

    // A publication sentence carrying no date must fall back to the meeting, not refuse.
    assert.strictEqual(meetingDate('a meeting will be held on 6 August 2026 to approve results. '
        + 'The Company will publish them on its website in due course.', '2026-07-20', T).date, '2026-08-06');

    // 68 days ahead is real (HKEX filed 12 June for 19 August) and must not be rejected as noise.
    assert.strictEqual(meetingDate('a meeting of the Board of Directors will be held on Wednesday, '
        + '19 August 2026, for the purpose of approving the interim results', '2026-06-12', T).date,
        '2026-08-19');

    // The guard that matters most: a document whose FIRST date is the period end must still yield
    // the meeting date, because the search is anchored on the announcing sentence.
    assert.strictEqual(meetingDate(
        'The results for the year ended 31 December 2025 are referred to below. The Board will be '
        + 'held on 12 August 2026 to approve them.', '2026-07-30', T).date, '2026-08-12');

    // A stated weekday that does not match the date is a mis-parse — refuse, never publish.
    const wrong = meetingDate('a meeting will be held on Monday, 13 August 2026 to approve results',
        '2026-07-30');
    assert.strictEqual(wrong.date, null);
    assert.match(wrong.why, /Monday/);

    // A meeting cannot precede its own notice.
    assert.strictEqual(meetingDate('will be held on 1 July 2026 to approve results', '2026-07-30', T).date, null);
    // ...nor sit a year out: that is the NEXT cycle, or a mis-read year.
    assert.strictEqual(meetingDate('will be held on 13 August 2027 to approve results', '2026-07-30', T).date, null);

    // A board meeting that is not about results is not a results date.
    assert.strictEqual(meetingDate(
        'a meeting of the Board will be held on 13 August 2026 to consider a change of auditor',
        '2026-07-30').date, null);

    // Nothing to anchor on, and no date in the sentence: both refuse with a reason, never a guess.
    assert.strictEqual(meetingDate('The company announces its results in due course.', '2026-07-30', T).date, null);
    assert.strictEqual(meetingDate('a meeting will be held shortly to approve results', '2026-07-30', T).date, null);

    // Language tags glue themselves to the text on both sides, and repeat. All three shapes below
    // are verbatim from the filings; the first two are why neither \b anchor works.
    const clean = s => stripLangTags(s).replace(/\s+/g, ' ').trim();
    assert.strictEqual(clean('on Thursday, en-US13th August'), 'on Thursday, 13th August');
    assert.strictEqual(clean('en-GBHong Kong Exchanges'), 'Hong Kong Exchanges');
    assert.strictEqual(clean('CK ASSET zh-TWzh-TWzh-TWen-US LIMITED'), 'CK ASSET LIMITED');
    // ...and a real sentence still survives intact once they are gone.
    assert.strictEqual(
        meetingDate(clean('a meeting will be held on en-USThursday, en-US13th August, 2026 '
            + 'to approve the interim results'), '2026-07-30', T).date,
        '2026-08-13');

    // ---- interim EPS ------------------------------------------------------------------------
    // All three wordings are verbatim from the August 2026 announcements, note numbers included.
    assert.deepStrictEqual(interimEps('Earnings per share, basic and diluted 7 HK$2.37 HK$2.23'),
        { eps: 2.37, prior: 2.23 });                       // CLP — note 7 must not be read as a value
    assert.deepStrictEqual(interimEps('Earnings per share Basic and diluted 9 $6.90 $1.43'),
        { eps: 6.90, prior: 1.43 });                       // Power Assets — note 9
    assert.deepStrictEqual(interimEps('Earnings per shareHK$2.48HK$1.80'),
        { eps: 2.48, prior: 1.80 });                       // CK Asset — no spaces at all
    // ...and CK Asset's real text, where the column header runs straight into the last figure.
    // 1.802026 is 1.80 followed by the year, and it must come back as 1.80, not 1.802026 — a
    // difference too small for the reconciliation check to notice, which is the whole problem.
    assert.deepStrictEqual(interimEps('Earnings per shareHK$2.48HK$1.802026 2025 HK$ Million'),
        { eps: 2.48, prior: 1.80 });
    // Three decimals is a real figure, not glue, and is kept as filed.
    assert.deepStrictEqual(interimEps('Earnings per share 2 HK$0.123 HK$0.118'),
        { eps: 0.123, prior: 0.118 });
    // A long decimal that is NOT a glued year is unreadable — refuse rather than truncate to
    // something that looks right.
    assert.strictEqual(interimEps('Earnings per share HK$2.48 HK$1.804812').eps, null);
    assert.strictEqual(ungluedDecimal('1.802026'), '1.80');
    assert.strictEqual(ungluedDecimal('1.80'), '1.80');
    assert.strictEqual(ungluedDecimal('0.123'), '0.123');
    assert.strictEqual(ungluedDecimal('1.804812'), null);
    // A loss is written in brackets, not with a minus.
    assert.deepStrictEqual(interimEps('Earnings per share, basic 4 HK$1.20 HK$(0.15)'),
        { eps: 1.20, prior: -0.15 });
    // Thousands separators survive.
    assert.deepStrictEqual(interimEps('Earnings per share 3 $1,234.50 $1,100.00'),
        { eps: 1234.5, prior: 1100 });
    // No currency prefix means no way to tell a note number from a figure — refuse.
    assert.strictEqual(interimEps('Earnings per share, basic and diluted 7 2.37 2.23').eps, null);
    assert.strictEqual(interimEps('Revenue 2 42,856 42,854').eps, null);

    // CK Hutchison's prose form, verbatim — comparative in brackets, not a second column.
    assert.deepStrictEqual(interimEps('earnings per share were HK$7.00 for the six months ended '
        + '30 June 2026 (30 June 2025 - HK$0.22). Dividend The Board of Directors'),
        { eps: 7.00, prior: 0.22 });
    // The table form still wins where a document has both, since it is the audited statement line.
    assert.deepStrictEqual(interimEps('Earnings per share, basic and diluted 7 HK$2.37 HK$2.23. '
        + 'Separately, earnings per share were HK$9.99 for the period (30 June 2025 - HK$8.88).'),
        { eps: 2.37, prior: 2.23 });
    // Prose must not stitch two unrelated sentences together across a full stop.
    assert.strictEqual(interimEps('earnings per share were HK$7.00 for the period. '
        + 'Dividends (last year - HK$0.22) were paid.').eps, null);

    assert.strictEqual(interimPeriod('for the six months ended 30 June 2026'), '2026-06-30');
    assert.strictEqual(interimPeriod('for the six months ended June 30, 2026'), '2026-06-30');

    // reconcile: CLP's prior half (2.23) against a filed 2025 year of 4.42 — about half, so the
    // parse is trustworthy and the current half may be kept.
    const clp = { currency: 'HKD', years: [{ date: '2025-12-31', eps: 4.42 }] };
    assert.strictEqual(reconcile(2.37, 2.23, '2025-06-30', clp).ok, true);
    // The failure this exists for: the note number read as the value. 7 against a 4.42 year is
    // 1.58x — nonsense for a half year, and caught.
    assert.strictEqual(reconcile(2.37, 7, '2025-06-30', clp).ok, false);
    // Cents mistaken for dollars is 100x out and cannot slip through either.
    assert.strictEqual(reconcile(237, 223, '2025-06-30', clp).ok, false);
    // No annual history, no check — so no publication.
    assert.strictEqual(reconcile(2.37, 2.23, '2025-06-30', { years: [] }).ok, false);
    // A filed year that is a loss gives nothing to reconcile against.
    assert.strictEqual(reconcile(2.37, 2.23, '2025-06-30',
        { years: [{ date: '2025-12-31', eps: -1 }] }).ok, false);
    // A year too far from the half to contain it is not a match.
    assert.strictEqual(reconcile(2.37, 2.23, '2025-06-30',
        { years: [{ date: '2027-12-31', eps: 4.42 }] }).ok, false);

    console.log('selftest ok');
}

if (process.argv[2] === '--selftest') selftest();
else main().catch(e => { console.error(e.message); process.exit(1); });
