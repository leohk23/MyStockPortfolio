// A UK gilt's live quote, by ISIN: the London Stock Exchange's own bid and offer, relayed by
// onvista.de. Shared by fetch-prices.js (the price bot) and extract-portfolio.js (which checks a
// new gilt before publishing and writes its meta.json entry). Dependency-free, like the bot.
//
// Why onvista. The bot read the exchange's instrument endpoint directly until it began refusing
// scripts on 22 Oct 2026: every run since logged "HTTP 403" and kept T31 at that evening's price.
// onvista carries every gilt by ISIN with the London Stock Exchange as a venue, delayed 15
// minutes, and its bid and offer are the exchange's book: T31's spread reads 0.30 there, as it
// did on the exchange. backfill-gilts.js already reads onvista's history for the same reason.
// Undocumented, so a changed shape throws, and the bot keeps the last price and its closes.
//
// The price is the MID of bid and offer, the basis of every close already stored. onvista's
// `last` is the last trade, often at the bid or offer, and is used only when the book is one-sided.
'use strict';
const assert = require('assert');

const OV = 'https://api.onvista.de/api/v1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// 4.875 -> '4 7/8', 0.125 -> '0 1/8', 4 -> '4': the way the exchange and the DMO write a coupon.
function couponText(c) {
    const whole = Math.floor(c), eighths = Math.round((c - whole) * 8);
    if (Math.abs(c - whole - eighths / 8) > 1e-9) return String(c);
    if (!eighths) return String(whole);
    const g = eighths % 2 ? 1 : eighths % 4 ? 2 : 4;
    return `${whole} ${eighths / g}/${8 / g}`;
}

// One onvista bond snapshot as a gilt quote, or a throw saying what was wrong with it.
function parseGilt(s, isin) {
    if (s?.instrument?.isin !== isin) throw new Error(`onvista returned ${s?.instrument?.isin || 'nothing'} for ${isin}`);
    const q = (s.quoteList?.list || []).find(x => x.market?.codeExchange === 'LSE' && x.isoCurrency === 'GBP');
    if (!q) throw new Error('no London Stock Exchange GBP venue on onvista');
    if (q.unitType !== 'PCT') throw new Error(`not a price per £100 nominal (${q.unitType})`);
    const book = q.bid > 0 && q.ask >= q.bid;
    const mid = book ? Number(((q.bid + q.ask) / 2).toFixed(4)) : q.last;
    if (!(mid > 1 && mid < 300)) throw new Error(`implausible price ${mid}`);
    const stamp = book ? [q.datetimeBid, q.datetimeAsk].filter(Boolean).sort().pop() : q.datetimeLast;
    const issuer = s.bondsIssuer || {};
    const maturity = String(s.bondsBaseData?.datetimeMaturity || '').slice(0, 10) || null;
    // A fixed coupon only. An index-linked gilt's is variable, and onvista gives it already uplifted
    // (0.186 for a 0 1/8% linker), so it is left null, as the exchange's name made it before.
    const coupon = s.bondsDetails?.idTypeCoupon === 1 && Number.isFinite(s.bondsDetails?.coupon) ? s.bondsDetails.coupon : null;
    const gilt = issuer.isoCountry === 'GB' && issuer.idTypeIssuer === 1 && isin.startsWith('GB');
    const [y, m, d] = (maturity || '').split('-');
    return {
        isin, gilt, coupon, maturity, issuer: issuer.name || null,
        // The exchange's own style, which couponOf in fetch-prices also reads.
        name: gilt && coupon != null && maturity ? `${couponText(coupon)}% TREASURY GILT ${d}/${m}/${y.slice(2)}` : s.instrument.name,
        mid, bid: q.bid ?? null, offer: q.ask ?? null, last: q.last ?? null, basis: book ? 'mid' : 'last trade',
        at: stamp ? Date.parse(stamp) : null,
    };
}

async function giltQuote(isin, attempts = 3) {
    if (!ISIN.test(String(isin))) throw new Error(`not an ISIN: ${isin}`);
    let lastErr;
    for (let a = 0; a < attempts; a++) {
        try {
            const res = await fetch(`${OV}/bonds/ISIN:${isin}/snapshot`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status} from onvista`);
            return parseGilt(await res.json(), isin);
        } catch (e) {
            lastErr = e;
            if (/onvista returned|no London|not a price|implausible/.test(e.message)) break;   // a wrong answer, not a flaky one
            if (a < attempts - 1) await new Promise(r => setTimeout(r, 600 * (a + 1)));
        }
    }
    throw lastErr;
}

function selftest() {
    assert.strictEqual(couponText(4.875), '4 7/8');
    assert.strictEqual(couponText(0.125), '0 1/8');
    assert.strictEqual(couponText(4), '4');
    assert.strictEqual(couponText(4.5), '4 1/2');
    assert.strictEqual(couponText(3.75), '3 3/4');
    assert.strictEqual(couponText(1.1), '1.1', 'not in eighths: as a decimal');
    // The shape onvista returned for the 4 7/8% gilt of 2036 on 28 Oct 2026, trimmed.
    const snap = {
        instrument: { isin: 'GB00BWBR1N39', name: 'Großbritannien LS-Treasury Stock 2026(36)' },
        bondsIssuer: { name: 'Großbritannien und Nord-Irland, Vereinigtes Königreich', isoCountry: 'GB', idTypeIssuer: 1 },
        bondsDetails: { coupon: 4.875, idTypeCoupon: 1, nameTypeCoupon: 'Fest' },
        bondsBaseData: { datetimeMaturity: '2036-07-31T12:00:00.000+00:00' },
        quoteList: { list: [
            { market: { codeExchange: 'STU' }, isoCurrency: 'EUR', bid: 110, ask: 111, unitType: 'PCT' },
            { market: { codeExchange: 'LSE' }, isoCurrency: 'GBP', bid: 96.18, ask: 96.58, last: 96.32199, unitType: 'PCT',
                datetimeBid: '2026-10-28T09:52:24.539+00:00', datetimeAsk: '2026-10-28T09:52:24.539+00:00', datetimeLast: '2026-10-28T09:27:25.723+00:00' },
        ] },
    };
    const g = parseGilt(snap, 'GB00BWBR1N39');
    assert.deepStrictEqual([g.mid, g.basis, g.coupon, g.maturity, g.gilt, g.name], [96.38, 'mid', 4.875, '2036-07-31', true, '4 7/8% TREASURY GILT 31/07/36'],
        'the London venue, never Stuttgart; the mid, never the last trade');
    assert.strictEqual(g.at, Date.parse('2026-10-28T09:52:24.539Z'), 'struck when the book was');
    const lse = snap.quoteList.list[1];
    const oneSided = parseGilt({ ...snap, quoteList: { list: [{ ...lse, ask: null }] } }, 'GB00BWBR1N39');
    assert.deepStrictEqual([oneSided.mid, oneSided.basis], [96.32199, 'last trade'], 'a one-sided book: the last trade, and it says so');
    assert.throws(() => parseGilt(snap, 'GB00BPSNBF73'), /returned GB00BWBR1N39/, 'a different ISIN is refused');
    assert.throws(() => parseGilt({ ...snap, quoteList: { list: [snap.quoteList.list[0]] } }, 'GB00BWBR1N39'), /no London/);
    assert.throws(() => parseGilt({ ...snap, quoteList: { list: [{ ...lse, unitType: 'EUR' }] } }, 'GB00BWBR1N39'), /per £100/);
    assert.throws(() => parseGilt({ ...snap, quoteList: { list: [{ ...lse, bid: 0.9618, ask: 0.9658, last: 0.96 }] } }, 'GB00BWBR1N39'), /implausible/);
    const linker = parseGilt({ ...snap, bondsDetails: { coupon: 0.18606625, idTypeCoupon: 2 } }, 'GB00BWBR1N39');
    assert.deepStrictEqual([linker.coupon, linker.name], [null, 'Großbritannien LS-Treasury Stock 2026(36)'], 'index-linked: no coupon, onvista\'s name');
    assert.strictEqual(parseGilt({ ...snap, bondsIssuer: { isoCountry: 'DE', idTypeIssuer: 1 } }, 'GB00BWBR1N39').gilt, false, 'not the UK: not a gilt');
    console.log('gilt-quote selftest ok');
}

if (require.main === module) {
    if (process.argv[2] === '--selftest') selftest();
    else giltQuote(process.argv[2]).then(q => console.log(q), e => { console.error(e.message); process.exit(1); });
}
module.exports = { giltQuote, parseGilt, couponText, ISIN };
