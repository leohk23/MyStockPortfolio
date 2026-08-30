#!/usr/bin/env node
// The free lane. `npm run signals`.
//
// Every [auto] rule in strategy.md, evaluated over data CI has already fetched. No LLM, no network,
// no auth, no cost — so it can run on every CI pass forever. Its job is that nothing in the known
// universe goes unnoticed; the expensive lanes are gated behind it (pot-design.md §2).
//
// Writes signals.json. That file is also this script's MEMORY: results dates vanish from
// prices.json once they pass (fetch-prices keeps only future ones), so "X reported since the last
// scan" can only be seen by diffing against what the previous run recorded.
//
// The most valuable output is an empty one. "Nothing fired" is information, and it is why every
// run also records which rules checked clean and which could not run at all — a dead scan and a
// quiet scan look identical otherwise.

const fs = require('fs');

// Every threshold in strategy.md's rules-at-a-glance, in one place. Change them there first.
const RULES = {
    valuationPctile: 0.10,    // §6.1  in the cheapest 10% of its own five-year history
    drawdown7d: -0.15,        // §6.2  −15% in 7 days
    drawdown1m: -0.25,        // §6.2  ...or −25% in 30
    dryPowderFirst: 750,      // §6.4  £750 uninvested, then...
    dryPowderStep: 250,       // §6.4  ...every £250 after
    vixFire: 40,              // §11.1 standing order: VIX close ≥ 40
    vixInstrument: 'VUAG.L',  // §11.1 Vanguard S&P 500 UCITS ETF USD Accumulation
    // §6.6 the market-reaction proxy for breaking news. Set from the distribution, not taste:
    // a VIX jump this size is the top ~1.5% of days since 1990 and an S&P fall this size the
    // worst ~1.5% since 1970. Together they fire about 4.9 days a year.
    newsVixJump: 0.20,
    newsSpxDrop: -0.025,
};

// 1st, 2nd, 3rd, 4th — because "2th pctile" in a valuation report undermines every other number
// on the page.
const ordinal = n => n + ([, 'st', 'nd', 'rd'][n % 100 >> 3 ^ 1 && n % 10] || 'th');
const iso = d => d.toISOString().slice(0, 10);
const read = (f, fallback = null) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

// ---------------------------------------------------------------- rules (pure, so testable)

// §6.1 — cheap against its OWN history, not against the market's.
//
// ponytail: the current multiple is price ÷ trailing EPS, while the band low was struck on
// normalised ANNUAL EPS (see troughPe). The two bases differ by up to a quarter's growth, so a
// name can sit a whisker either side of the line for that reason alone. Tightening it would mean
// recomputing the bands on trailing EPS, which loses the point-in-time property that makes them
// honest. Being approximately right about "is this near its floor?" is the job here.
// The one-off trap, found by the first real Sweep rather than by me. Trailing EPS includes
// exceptional gains, so a company that booked a large one can look cheap on a multiple nobody
// could earn twice. Of the first twelve hits, TWO were false for this reason: Alphabet read −6%
// below its floor and is +86% above it on recurring earnings; Amazon read −29% and is +39%. Both
// were investment gains, not trade.
//
// Flagged, never suppressed. The floor itself was struck on filed annual EPS, which carries its
// own one-offs, so "recurring vs a headline floor" is not a clean comparison either — suppressing
// on it would hide genuine cheapness. The Deep dive gets told, and decides.
//
// Two detectors, because they cover different ground. Yahoo's normalized income catches the US
// names; it is absent for Hong Kong (0006.HK reports normEps identical to eps), so the second
// asks whether trailing EPS has run far ahead of the last audited year — 0006.HK's is 2.9x its
// last filed annual, which is what a disposal looks like from the outside.
const ONE_OFF_EPS_JUMP = 2.0;
function oneOffRisk(quote, entry, floor, band) {
    const rpe = quote.normEps > 0 ? quote.price / quote.normEps : null;
    if (rpe != null && quote.normEps !== quote.eps) {
        const rv = rpe / floor - 1;
        return rv > band
            ? { why: 'recurring earnings put it above its floor', recurringPe: rpe, recurringVsFloor: rv }
            : null;
    }
    // No normalized figure to compare against — fall back to the audited annual.
    const filed = [...(entry?.years || [])].reverse().find(y => y.eps > 0);
    if (!filed) return null;
    const jump = quote.eps / filed.eps;
    return jump >= ONE_OFF_EPS_JUMP
        ? { why: `trailing EPS is ${jump.toFixed(1)}x the last filed year (${filed.date.slice(0, 4)})`, epsJump: jump }
        : null;
}

// Where today's multiple sits in the stock's OWN five-year distribution — not how close it is to
// a single cheapest week.
//
// A minimum is one observation, and often one panicked week about a company that no longer exists
// in that form. Apple's cheapest was 8.9x in April 2013; a floor nobody expects to see again
// cannot tell you whether today is cheap. A percentile uses every week in the window instead:
// Nvidia sits at the 0th percentile of its own five years — cheaper than any week in it — which
// says far more than a trough from 2011, and Apple at the 87th says it is dear by its own recent
// standards, which the all-time low actively hides.
//
// The minimum is still reported alongside, because "how cheap has it actually got" is worth
// knowing once the better question has been asked.
function nearOwnFloor(quote, pctile = RULES.valuationPctile, entry = null) {
    const window = quote?.peWindow || '5y';
    const h = quote?.peHistory?.[window];
    if (!h || typeof quote.pePctile !== 'number') return null;
    if (!(quote.eps > 0) || !(quote.price > 0) || !(h.low > 0)) return null;
    if (quote.pePctile > pctile) return null;
    const pe = quote.price / quote.eps;
    // The one-off check has to move onto the same footing. Comparing recurring earnings against
    // the five-year MINIMUM fired on almost every hit, because a name only reaches the cheapest
    // decile when it is already near that minimum. The question is the same one the signal asks:
    // on recurring earnings, is it still in the cheap quarter of its own history?
    const oneOff = oneOffRisk(quote, entry, h.p25, 0);
    return { pe, pctile: quote.pePctile, window, weeks: h.weeks,
        floor: h.low, floorDate: h.lowDate, p5: h.p5, median: h.median,
        vsFloor: pe / h.low - 1, ...(oneOff ? { oneOff } : {}) };
}

// §6.2 — fell hard, fast. Either window qualifies on its own.
function fellHard(quote, r = RULES) {
    const hits = [];
    if (quote?.['7d'] <= r.drawdown7d) hits.push({ window: '7d', move: quote['7d'] });
    if (quote?.['1m'] <= r.drawdown1m) hits.push({ window: '1m', move: quote['1m'] });
    return hits.length ? hits : null;
}

// §6.4 — cash piling up with nothing done. Fires at £750, then on each further £250, and only
// once per step: `alerted` is the last level already reported.
function dryPowder(cash, alerted = 0, r = RULES) {
    if (!(cash >= r.dryPowderFirst)) return null;
    const steps = Math.floor((cash - r.dryPowderFirst) / r.dryPowderStep);
    const level = r.dryPowderFirst + steps * r.dryPowderStep;
    return level > alerted ? { cash, level } : null;
}

// §11.1 — the standing order. No re-arm (D11): it fires on every qualifying close, and the Scan
// emits an instruction rather than a signal, because there is no judgement left in it (A7).
function vixStandingOrder(vix, r = RULES) {
    if (!(vix?.price >= r.vixFire)) return null;
    return { close: vix.price, threshold: r.vixFire, instrument: r.vixInstrument };
}

// §6.6 — the proxy. It catches the market's REACTION, not the news; the Sweep says what happened.
function marketShock(vix, spxMove, r = RULES) {
    const hits = [];
    if (vix?.['1d'] >= r.newsVixJump) hits.push({ what: 'VIX jump', move: vix['1d'] });
    if (spxMove <= r.newsSpxDrop) hits.push({ what: 'S&P fall', move: spxMove });
    return hits.length ? hits : null;
}

// §6.3 — reported since the last scan. Only visible by diffing: a date that was in the future last
// run and is now gone (or has moved on to the next period) means the results landed.
function reportedSince(previousDue, quotes, today) {
    const out = [];
    for (const [t, was] of Object.entries(previousDue || {})) {
        if (was > today) continue;                       // still in the future, nothing to see
        const now = quotes[t]?.earnings?.date;
        if (!now || now > was) out.push({ ticker: t, reported: was, next: now || null });
    }
    return out;
}

// Is our trailing EPS behind the company's own reporting?
//
// Both sides of a multiple have to be current, and the denominator is the one that goes quietly
// stale: Yahoo's trailing EPS lags a quarter or more, and nothing on the page says so. NVDA is the
// case that surfaced it — our `mrq` is 26 Apr 2026 while Q2 was reported in August, and on the
// cached EPS it reads 5% ABOVE its own floor where on the real figure it is 13% below. Same price,
// opposite conclusion.
//
// Detected from cadence rather than from a fixed age, because a semi-annual filer four months past
// its last quarter is perfectly current while a quarterly one is a period behind. The cadence
// comes from the gaps between filed quarters; with fewer than two, no claim is made.
//
// The sharp version, using something we already know: the NEXT results date. One reporting period
// before it is the PREVIOUS results date, and if that has passed while our newest quarter is older
// still, a set of results has been published that we have not picked up.
//
// NVDA: next results 2026-11-17, cycle 92 days, so it last reported around 2026-08-17 — in the
// past, and four months after the 2026-04-26 quarter our EPS runs to. Stale, provably.
//
// An earlier attempt allowed a whole period plus 90 days after `mrq`, which was so generous it
// never fired: NVDA files about 30 days after a quarter ends, not 90. Inferring backwards from a
// date the company itself has published beats guessing forwards from one it has not.
// The measure is the IMPLIED REPORTING LAG, not a comparison of dates in different units.
//
// If our data is current, `mrq` is the period the company most recently reported, and the next
// report covers the period after it — so `next results − mrq` should come to one period plus a
// normal reporting lag. When that arithmetic demands an implausible lag, the only explanation is
// that our `mrq` is one or more periods behind:
//
//   GOOG   next 2026-11-17 − mrq 2026-06-30 = 140d − 91d period = 49d lag.  Normal. Current.
//   NVDA   next 2026-11-17 − mrq 2026-04-26 = 205d − 91d period = 114d lag. Impossible for a
//                                             filer that reports in ~30. One period behind.
//
// An earlier version compared the inferred last REPORT DATE against `mrq`, a PERIOD END — of
// course a report comes after the period it covers, so it flagged 48 of 83 tickers, most of them
// perfectly current. Comparing two things measured in different units is how that happens.
const MAX_PLAUSIBLE_LAG_DAYS = 75;
// Only where we KNOW the window. `epsThru` is set by fetch-prices when it replaces Yahoo's figure
// with one summed from filed quarters — so it is the window of the number actually in use.
//
// Yahoo's own `mrq` is not a substitute, and NVDA is the proof: after the replacement bug was
// fixed its EPS is Yahoo's fresh post-Q2 7.91 while `mrq` still reads 2026-04-26. Flagging on that
// called a current figure stale. Where the window is unknown, say nothing — an unfounded warning
// is worse than none, which is the same rule the rest of this repo follows about numbers.
function epsStale(quote, entry, today) {
    const next = quote?.earnings?.date;
    const through = quote?.epsThru;
    const qs = (entry?.quarters || []).map(q => q.date).filter(Boolean).sort();
    if (!through || !next || next <= today || qs.length < 2) return null;
    const gaps = qs.slice(1).map((d, i) => (Date.parse(d) - Date.parse(qs[i])) / 86400e3);
    const period = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (!(period > 30)) return null;
    const impliedLag = (Date.parse(next) - Date.parse(through)) / 86400e3 - period;
    if (impliedLag <= MAX_PLAUSIBLE_LAG_DAYS) return null;
    const behind = Math.max(1, Math.round(impliedLag / period));
    return { mrq: quote.mrq, behind, period: Math.round(period), impliedLag: Math.round(impliedLag),
        why: `the trailing EPS in use is summed to ${through}; with the next results on ${next} and a `
            + `${Math.round(period)}-day cycle, that implies a ${Math.round(impliedLag)}-day reporting `
            + `lag — about ${behind} period${behind === 1 ? '' : 's'} of earnings we do not have` };
}

// World breadth, as a macro fact rather than a buy list.
//
// The 47 country funds are a MONITOR — Leo was explicit — so this produces no signal on any
// individual market. What it produces is a state of the world nothing else here can say: how many
// national markets are near their own peak, and how many are still far below it. Our macro block
// carries six equity indices; this carries forty-odd countries, and "9 of 43 need to double to
// regain their high" is a regime, not a stock tip.
const DEEP_BELOW_ATH = 0.5;      // must rise 50%+ to regain its peak
const NEAR_ATH = 0.05;           // within 5% of it
function worldBreadth(countries) {
    const live = Object.values(countries || {}).filter(c => !c.dead && !c.gone && typeof c.fromAth === 'number');
    if (live.length < 5) return null;
    const sorted = [...live].sort((a, b) => b.fromAth - a.fromAth);
    const deep = sorted.filter(c => c.fromAth >= DEEP_BELOW_ATH);
    const near = sorted.filter(c => c.fromAth <= NEAR_ATH);
    const dead = Object.values(countries).filter(c => c.dead || c.gone);
    return {
        counted: live.length,
        nearHigh: near.length, deepBelow: deep.length,
        medianFromAth: sorted[Math.floor(sorted.length / 2)].fromAth,
        deepest: sorted.slice(0, 5).map(c => ({ country: c.country, yahoo: c.yahoo, fromAth: c.fromAth, athDay: c.athDay })),
        strongest: near.slice(-5).reverse().map(c => ({ country: c.country, yahoo: c.yahoo, fromAth: c.fromAth })),
        // Worth surfacing because a monitor built on a wound-up fund quietly reports its last
        // price forever, and the spreadsheet this came from has been doing exactly that.
        notTrading: dead.map(c => ({ country: c.country, yahoo: c.yahoo, lastSeen: c.lastSeen || null })),
        says: `${near.length} of ${live.length} country markets are within 5% of their own all-time high `
            + `and ${deep.length} still need 50% or more to regain theirs; the median market must rise `
            + `${(sorted[Math.floor(sorted.length / 2)].fromAth * 100).toFixed(0)}%`,
    };
}

// ---------------------------------------------------------------- macro, made deterministic
//
// Harvested from what the Sweep actually did with the macro block on 28 Aug 2026. Its useful
// inferences were not readings of single numbers — they were all RELATIONS between two series,
// and a relation is arithmetic. Computing them here means the next Sweep is handed the inference
// rather than re-deriving it, and it costs nothing.
//
// Four patterns, each taken from a real line it wrote:
//
//  real      "Copper +47% with the dollar nearly flat points at demand, not currency."
//            A commodity's move net of the dollar's. Big and positive = a real move.
//  cooling   "WTI +45% YTD but −9% over three months; the long move remains large, the recent
//            move is cooling." Long and short windows disagreeing in sign.
//  inGBP     "Nikkei +55% while USD/JPY +9% — flatters an operating rebound but erodes a GBP
//            investor's return." A foreign index move as a sterling holder actually received it.
//  mixed     "Gold +30% over a year but −14% over six months; these are reversals, not one clean
//            signal." Enough disagreement across windows that no direction can be claimed.
//
// ponytail: inGBP composes two percentage moves rather than dividing index levels by an FX rate,
// which is right to a second-order term (the cross-product of two moves). Over a year of ±50% that
// is a percentage point or two — irrelevant to "did the currency eat the gain?", and the exact
// version would need level history for every pair, which is a different fetch.
const MACRO_REAL_MIN = 0.15;      // net of the dollar, below this it is noise
const MACRO_COOLING_MIN = 0.05;   // a 3m move must contradict by this much to count
const CCY_FOR = { '^N225': 'USDJPY=X', '^HSI': 'USDHKD=X', '^STOXX50E': 'EURUSD=X', '^FTSE': null };

// §6.5 — every open thesis, every week (D10). Deliberately NOT "those whose review date has
// passed": Leo was asked and chose to sweep them all, so a review date is a prompt to look
// harder rather than permission to ignore the rest.
//
// This half is arithmetic only. It answers what changed and how far the position is from the
// numbers its thesis named; whether the falsifier has actually tripped needs the filing, and
// that is the LLM lane's job. Everything here is handed over so the agent never has to look
// up a price it could have been given.
function reviewDue(pot, quotes, today) {
    const open = (pot?.proposals || []).filter(p => p.state === 'accepted');
    return open.map(p => {
        const q = quotes[p.ticker] || {};
        const held = (pot.holdings || {})[p.ticker];
        const entry = p.executed?.price ?? null;
        const since = entry && q.price ? q.price / entry - 1 : null;
        return {
            rule: '6.5 thesis review',
            id: p.id, ticker: p.ticker, where: p.ticker,
            since, price: q.price ?? null, entry,
            qty: held?.qty ?? null,
            reviewBy: p.reviewBy || null,
            // Past its own date is not a different rule, it is a louder version of this one.
            overdue: p.reviewBy ? p.reviewBy <= today : false,
            // Handed over verbatim. The agent must check what was agreed, not re-derive it.
            warning: p.warning || null,
            break: p.break || null,
            noFalsifier: !p.break,
            resultsOn: q.earnings?.date || null,
        };
    });
}

function macroNotes(macro, gbp) {
    if (!macro || !Object.keys(macro).length) return null;
    const dxy = macro['DX-Y.NYB']?.['1y'];
    const out = [];
    for (const [sym, m] of Object.entries(macro)) {
        const y = m['1y'], q = m['3m'], h = m['6m'];
        const note = { sym, name: m.name, group: m.group };
        if (m.group === 'Commodity' && typeof y === 'number' && typeof dxy === 'number') {
            note.real = y - dxy;
            if (Math.abs(note.real) >= MACRO_REAL_MIN) {
                note.says = `${(note.real * 100).toFixed(0)}% net of the dollar — a real move, not currency`;
            }
        }
        if (typeof y === 'number' && typeof q === 'number'
            && Math.sign(y) !== Math.sign(q) && Math.abs(q) >= MACRO_COOLING_MIN) {
            note.cooling = q;
            note.says = `${(y * 100).toFixed(0)}% over a year but ${(q * 100).toFixed(0)}% over three months — cooling`;
        }
        if (typeof y === 'number' && typeof h === 'number' && typeof q === 'number'
            && new Set([Math.sign(y), Math.sign(h), Math.sign(q)]).size === 2) {
            note.mixed = true;
        }
        // A foreign index as a sterling holder received it: the local move, less the currency's
        // move against the dollar, less the dollar's move against sterling.
        const pair = CCY_FOR[sym];
        if (m.group === 'Equity' && typeof y === 'number' && typeof gbp === 'number') {
            const fx = pair ? macro[pair]?.['1y'] : 0;
            if (typeof fx === 'number') {
                // USDJPY/USDHKD are quoted USD-per-unit-inverted, so a rise is a WEAKER local
                // currency and costs the sterling holder; EURUSD is the other way round.
                const drag = /^USD/.test(pair || '') ? -fx : fx;
                note.inGBP = y + drag - gbp;
                if (Math.abs(note.inGBP - y) >= 0.05) {
                    note.says = `${(y * 100).toFixed(0)}% locally is ${(note.inGBP * 100).toFixed(0)}% to a sterling holder`;
                }
            }
        }
        if (note.says || note.mixed) out.push(note);
    }
    return out.length ? out : null;
}

// The S&P's one-day move. It is a benchmark, so it lives in history.json rather than in quotes.
function spxDailyMove(history) {
    const c = history?.closes?.['^GSPC'] || [];
    const seen = c.filter(v => v != null);
    return seen.length < 2 ? null : seen[seen.length - 1] / seen[seen.length - 2] - 1;
}

// ---------------------------------------------------------------- the scan

function scan(state, today) {
    const { prices, history, held, potPositions, previous } = state;
    const quotes = prices.quotes || {};
    const label = t => (held.has(t) ? 'HELD' : 'watchlist');
    const fired = [], instructions = [], quiet = [], blocked = [];

    const valuation = [];
    for (const [t, q] of Object.entries(quotes)) {
        const entry = state.earnings?.eps?.[t];
        const hit = nearOwnFloor(q, RULES.valuationPctile, entry);
        if (!hit) continue;
        // A stale denominator can flip the answer, so it rides with the signal rather than being
        // something the reader has to remember to check.
        const stale = epsStale(q, entry, today);
        valuation.push({ rule: '6.1 valuation', ticker: t, where: label(t), ...hit,
            ...(stale ? { epsStale: stale } : {}) });
    }
    valuation.sort((a, b) => a.vsFloor - b.vsFloor);
    valuation.length ? fired.push(...valuation) : quiet.push('6.1 valuation');

    const drops = [];
    for (const [t, q] of Object.entries(quotes)) {
        const hit = fellHard(q);
        if (hit) drops.push({ rule: '6.2 drawdown', ticker: t, where: label(t), hits: hit });
    }
    drops.length ? fired.push(...drops) : quiet.push('6.2 drawdown');

    // §6.3 is scoped to what the POT holds, so it stays blocked rather than quiet until there is
    // a pot. Blocked and quiet are different states and must not be conflated.
    if (!potPositions) {
        blocked.push({ rule: '6.3 results', why: 'the pot holds nothing yet (pot/positions.json absent)' });
        blocked.push({ rule: '6.4 dry powder', why: 'no pot cash balance to read yet' });
        blocked.push({ rule: '6.5 thesis review', why: 'no pot book yet (run npm run pot-book)' });
    } else {
        const potTickers = new Set(Object.keys(potPositions.holdings || {}));
        const rep = reportedSince(previous?.resultsDue, quotes, today)
            .filter(r => potTickers.has(r.ticker));
        rep.length ? fired.push(...rep.map(r => ({ rule: '6.3 results', ...r })))
                   : quiet.push('6.3 results');
        const dp = dryPowder(potPositions.cashGBP, previous?.dryPowderAlerted || 0);
        dp ? fired.push({ rule: '6.4 dry powder', ...dp }) : quiet.push('6.4 dry powder');
        const rev = reviewDue(potPositions, quotes, today);
        rev.length ? fired.push(...rev) : quiet.push('6.5 thesis review');
    }

    const vix = quotes['^VIX'];
    const spx = spxDailyMove(history);
    if (!vix) blocked.push({ rule: '6.6 / 11.1', why: '^VIX not in prices.json' });
    else {
        const shock = marketShock(vix, spx);
        shock ? fired.push({ rule: '6.6 news proxy', hits: shock }) : quiet.push('6.6 news proxy');
        const order = vixStandingOrder(vix);
        if (order) instructions.push({ rule: '11.1 standing order',
            action: `BUY ${order.instrument} with all available pot cash`, ...order });
        else quiet.push('11.1 standing order');
    }

    // Carried into the next run so §6.3 has something to diff against.
    const resultsDue = {};
    for (const [t, q] of Object.entries(quotes)) if (q.earnings?.date) resultsDue[t] = q.earnings.date;

    return {
        generated: new Date().toISOString(),
        pricesAt: prices.updated || null,
        vix: vix ? { close: vix.price, day: vix['1d'] } : null,
        spxDay: spx,
        fired, instructions, quiet, blocked, resultsDue,
        world: worldBreadth(prices.countries),
        macro: macroNotes(prices.macro, prices.macro?.['GBPUSD=X']?.['1y']),
        dryPowderAlerted: fired.find(f => f.rule === '6.4 dry powder')?.level
            ?? previous?.dryPowderAlerted ?? 0,
    };
}

// ---------------------------------------------------------------- run / selftest

function main() {
    const prices = read('prices.json');
    if (!prices) { console.error('no prices.json — run npm run fetch first'); process.exit(1); }
    const state = {
        prices,
        history: read('history.json'),
        earnings: read('earnings.json', { eps: {} }),
        held: new Set((read('holdings.json', { holdings: [] }).holdings || []).map(h => h.yahoo)),
        potPositions: read('pot/positions.json'),
        previous: read('signals.json'),
    };
    const out = scan(state, iso(new Date()));
    fs.writeFileSync('signals.json', JSON.stringify(out, null, 1));

    const pct = n => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
    console.log(`signals @ ${out.generated.slice(0, 16).replace('T', ' ')}  (prices ${(out.pricesAt || '?').slice(0, 16).replace('T', ' ')})`);
    if (out.vix) console.log(`  VIX ${out.vix.close} (${pct(out.vix.day)})   S&P ${out.spxDay == null ? '–' : pct(out.spxDay)}`);
    for (const i of out.instructions) console.log(`\n  ** INSTRUCTION — ${i.action}\n     ${i.rule}: VIX closed ${i.close}, threshold ${i.threshold}`);
    const by = out.fired.reduce((a, f) => ((a[f.rule] = a[f.rule] || []).push(f), a), {});
    for (const [rule, list] of Object.entries(by)) {
        console.log(`\n  ${rule} — ${list.length}`);
        for (const f of list.slice(0, 8)) {
            if (f.pctile != null) console.log(`     ${(f.ticker + ' ').padEnd(10)} PE ${f.pe.toFixed(1)} = ${ordinal(Math.round(f.pctile*100))} pctile of ${f.window} (low ${f.floor.toFixed(1)} ${f.floorDate}, median ${f.median.toFixed(1)})  ${f.where}${f.oneOff ? '  ONE-OFF? ' + f.oneOff.why : ''}${f.epsStale ? '  STALE EPS' : ''}`);
            else if (f.hits) console.log(`     ${(f.ticker || '').padEnd(10)} ${f.hits.map(h => `${h.window || h.what} ${pct(h.move)}`).join(', ')}  ${f.where || ''}`);
            else console.log(`     ${JSON.stringify(f)}`);
        }
        if (list.length > 8) console.log(`     …and ${list.length - 8} more`);
    }
    if (out.quiet.length) console.log(`\n  quiet: ${out.quiet.join(', ')}`);
    if (out.blocked.length) for (const b of out.blocked) console.log(`  blocked: ${b.rule} — ${b.why}`);
    console.log(`\nwrote signals.json (${out.fired.length} fired, ${out.instructions.length} instruction${out.instructions.length === 1 ? '' : 's'})`);
}

function selftest() {
    const assert = require('assert');

    // §6.1 — a percentile of the stock's OWN five-year distribution, not a distance to one week.
    const H = { peWindow: '5y', peHistory: { '5y':
        { low: 20, lowDate: '2022-10-07', p5: 22, median: 30, weeks: 260 } } };
    const at = p => ({ ...H, price: 200, eps: 10, pePctile: p });
    assert.ok(nearOwnFloor(at(0.04)), 'inside the cheapest 10% fires');
    assert.strictEqual(nearOwnFloor(at(0.11)), null, 'outside it does not');
    assert.strictEqual(nearOwnFloor(at(0.10)).pctile, 0.10, 'the boundary is inclusive');
    // The minimum rides along: "how cheap has it actually got" is still worth knowing, it is just
    // not the question that should decide anything.
    const fired = nearOwnFloor(at(0));
    assert.strictEqual(fired.floor, 20);
    assert.strictEqual(fired.floorDate, '2022-10-07');
    assert.strictEqual(fired.window, '5y');
    assert.ok(Math.abs(fired.vsFloor) < 1e-9, 'PE 20 against a floor of 20 sits level with it');
    // Absences are absences, never a signal: no history, no percentile, a loss, no price.
    assert.strictEqual(nearOwnFloor({ price: 200, eps: 10, pePctile: 0 }), null);
    assert.strictEqual(nearOwnFloor({ ...H, price: 200, eps: 10 }), null);
    assert.strictEqual(nearOwnFloor({ ...H, price: 200, eps: -1, pePctile: 0 }), null);
    assert.strictEqual(nearOwnFloor({ ...H, price: 0, eps: 10, pePctile: 0 }), null);
    assert.strictEqual(nearOwnFloor(undefined), null);

    // §6.2 — either window on its own, and both reported when both trip.
    assert.strictEqual(fellHard({ '7d': -0.14, '1m': -0.24 }), null);
    assert.strictEqual(fellHard({ '7d': -0.15, '1m': 0 }).length, 1);
    assert.strictEqual(fellHard({ '7d': -0.30, '1m': -0.40 }).length, 2);

    // §6.4 — the ladder, and each rung only once.
    assert.strictEqual(dryPowder(700), null);
    assert.strictEqual(dryPowder(750).level, 750);
    assert.strictEqual(dryPowder(999).level, 750);
    assert.strictEqual(dryPowder(1000).level, 1000);
    assert.strictEqual(dryPowder(1000, 1000), null);      // already told you at this level
    assert.strictEqual(dryPowder(1250, 1000).level, 1250);

    // §11.1 — no re-arm, so the only question is the close itself.
    assert.strictEqual(vixStandingOrder({ price: 39.9 }), null);
    assert.strictEqual(vixStandingOrder({ price: 40 }).instrument, 'VUAG.L');
    assert.strictEqual(vixStandingOrder({ price: 82.7 }).close, 82.7);

    // §6.6 — either leg, and neither below its threshold.
    assert.strictEqual(marketShock({ '1d': 0.19 }, -0.024), null);
    assert.strictEqual(marketShock({ '1d': 0.25 }, 0).length, 1);
    assert.strictEqual(marketShock({ '1d': 0 }, -0.03).length, 1);
    assert.strictEqual(marketShock({ '1d': 0.25 }, -0.03).length, 2);
    assert.strictEqual(marketShock({ '1d': 0.1 }, null), null);   // no S&P move is not a fall

    // §6.3 — a date that has passed and is gone means it reported; one still ahead does not.
    const T = '2026-08-28';
    assert.deepStrictEqual(
        reportedSince({ AAA: '2026-08-27', BBB: '2026-09-30' }, { AAA: {}, BBB: { earnings: { date: '2026-09-30' } } }, T),
        [{ ticker: 'AAA', reported: '2026-08-27', next: null }]);
    // Rolled forward to the next period counts as reported, and carries the new date.
    assert.deepStrictEqual(
        reportedSince({ AAA: '2026-08-27' }, { AAA: { earnings: { date: '2026-11-20' } } }, T),
        [{ ticker: 'AAA', reported: '2026-08-27', next: '2026-11-20' }]);
    assert.deepStrictEqual(reportedSince(null, {}, T), []);

    // spxDailyMove ignores the nulls the aligned series carries for non-trading days.
    assert.ok(Math.abs(spxDailyMove({ closes: { '^GSPC': [100, null, 110] } }) - 0.1) < 1e-9);
    assert.strictEqual(spxDailyMove({ closes: {} }), null);


    // epsStale: the implied reporting lag, not a comparison of dates in different units.
    const T2 = '2026-08-28';
    const quarterly = { quarters: [{ date: '2025-10-31' }, { date: '2026-01-31' }, { date: '2026-04-30' }] };
    // NVDA: next results 2026-11-17 against an EPS running only to 2026-04-26 implies a 114-day
    // reporting lag on a ~91-day cycle. Impossible; it is a period behind.
    const nvda = epsStale({ epsThru: '2026-04-26', earnings: { date: '2026-11-17' } }, quarterly, T2);
    assert.ok(nvda, 'NVDA is a period behind and must be flagged');
    assert.strictEqual(nvda.behind, 1);
    assert.ok(nvda.impliedLag > 100);
    // GOOG-shaped: next 2026-10-28 against 2026-06-30 implies a 29-day lag. Perfectly normal.
    assert.strictEqual(epsStale({ epsThru: '2026-06-30', earnings: { date: '2026-10-28' } }, quarterly, T2), null);
    // The regression this replaced: comparing the inferred report DATE to a period END flagged
    // every current company, because a report always comes after the period it covers.
    assert.strictEqual(epsStale({ epsThru: '2026-06-30', earnings: { date: '2026-11-17' } }, quarterly, T2), null);
    // Two periods behind counts as two.
    assert.strictEqual(epsStale({ epsThru: '2026-01-31', earnings: { date: '2026-11-17' } }, quarterly, T2).behind, 2);
    // No claim without the inputs: no next date, no quarters, or a past date.
    assert.strictEqual(epsStale({ epsThru: '2026-04-26' }, quarterly, T2), null);
    assert.strictEqual(epsStale({ epsThru: '2026-04-26', earnings: { date: '2026-11-17' } }, { quarters: [] }, T2), null);
    assert.strictEqual(epsStale({ epsThru: '2026-04-26', earnings: { date: '2026-01-01' } }, quarterly, T2), null);

// macroNotes: the Sweep's own inferences, computed. Each case below is a line it actually
    // wrote on 28 Aug 2026, turned into arithmetic.
    const M = {
        'DX-Y.NYB': { name: 'Dollar index', group: 'Currency', '1y': 0.019 },
        'GBPUSD=X': { name: 'GBP/USD', group: 'Currency', '1y': 0.002 },
        'USDJPY=X': { name: 'USD/JPY', group: 'Currency', '1y': 0.091 },
        'HG=F': { name: 'Copper', group: 'Commodity', '1y': 0.47, '6m': 0.13, '3m': 0.10 },
        'CL=F': { name: 'Crude', group: 'Commodity', '1y': 0.30, '6m': 0.12, '3m': -0.094 },
        'GC=F': { name: 'Gold', group: 'Commodity', '1y': 0.30, '6m': -0.145, '3m': 0.02 },
        '^N225': { name: 'Nikkei', group: 'Equity', '1y': 0.555, '6m': 0.2, '3m': 0.1 },
    };
    const notes = macroNotes(M, M['GBPUSD=X']['1y']);
    const by = Object.fromEntries(notes.map(n => [n.sym, n]));
    // "Copper +47% with the dollar nearly flat points at demand, not currency."
    assert.ok(Math.abs(by['HG=F'].real - (0.47 - 0.019)) < 1e-9);
    assert.ok(/net of the dollar/.test(by['HG=F'].says));
    // "WTI +30% over a year but −9% over three months — the recent move is cooling."
    assert.strictEqual(by['CL=F'].cooling, -0.094);
    assert.ok(/cooling/.test(by['CL=F'].says));
    // "Gold +30% over a year but −14.5% over six months — reversals, not one clean signal."
    assert.strictEqual(by['GC=F'].mixed, true);
    // "Nikkei +55% locally, but the yen weakened 9% against a dollar flat to sterling."
    assert.ok(Math.abs(by['^N225'].inGBP - (0.555 - 0.091 - 0.002)) < 1e-9);
    assert.ok(/sterling holder/.test(by['^N225'].says));
    // A move too small to be worth saying anything about produces no note at all.
    assert.strictEqual(macroNotes({ 'DX-Y.NYB': { group: 'Currency', '1y': 0.02 },
        'HG=F': { name: 'C', group: 'Commodity', '1y': 0.10, '6m': 0.05, '3m': 0.03 } }, 0), null);
    assert.strictEqual(macroNotes(null, 0), null);
    assert.strictEqual(macroNotes({}, 0), null);

    // Blocked and quiet are different states: with no pot, 6.3/6.4 are blocked, never "clean".
    const s = scan({ prices: { quotes: {} }, history: null, held: new Set(),
        potPositions: null, previous: null }, T);
    assert.ok(s.blocked.some(b => b.rule === '6.3 results'));
    assert.ok(!s.quiet.includes('6.3 results'));
    assert.ok(s.blocked.some(b => b.rule === '6.6 / 11.1'));   // no ^VIX in this fixture

    console.log('selftest ok');
}

if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) main();
module.exports = { nearOwnFloor, oneOffRisk, epsStale, macroNotes, worldBreadth, fellHard, dryPowder, vixStandingOrder, marketShock, reportedSince, scan, RULES };
