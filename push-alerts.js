// Big-move alerts to Leo's phone, as browser push notifications (Web Push).
//
// Run by .github/workflows/prices.yml after each price fetch. Finds every holding, in the main
// book or the AI pot, that has moved 5% or more on the day and has not already been alerted at
// that size, and sends ONE notification listing them. The site has no server, so this workflow
// is the sender: the phone's subscription and the signing key are GitHub secrets.
//
// Dependency-free like fetch-prices.js — CI installs nothing. Web Push needs two things Node's
// crypto already has: an ES256-signed VAPID token (RFC 8292) and aes128gcm payload encryption
// (RFC 8291). `node push-alerts.js --selftest` encrypts a message and decrypts it again.
//
// Env: VAPID_PRIVATE_KEY (the key pair as a JWK, JSON), PUSH_SUBSCRIPTION (the phone's
// subscription, JSON, from the site's bell button). Either missing: logs and exits 0, never
// failing the price job. ALERT_TEST=1 sends a test notification regardless of moves.
//
// Timeliness is the price workflow's: an alert goes out when the workflow runs, which is after
// each push and only every few hours on schedule (BACKLOG.md, "CI and scheduling").
const fs = require('fs');
const crypto = require('crypto');

const THRESHOLD = 0.05;            // Leo, 1 Oct 2026: a holding +-5% in a day, pot holdings too
const STATE = 'alerts-state.json'; // what has been alerted today, so a move alerts once per band
const SUBJECT = 'mailto:leohk23@gmail.com';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ---------------- what to alert ----------------

// Every held listing: the main book's public tickers (holdings.json publishes them, D67) and the
// pot's book. A name in both is reported once, labelled with both.
function heldTickers(holdings, pot) {
    const out = new Map();
    for (const h of (holdings && holdings.holdings) || []) out.set(h.yahoo, new Set(['book']));
    for (const t of Object.keys((pot && pot.holdings) || {})) (out.get(t) || out.set(t, new Set()).get(t)).add('pot');
    return out;
}

// A move alerts when it reaches a NEW 5% band for that listing's trading day: +5% once, then again
// only if it reaches +10%. Keyed by the date of the price itself (`at`), so a quote that has not
// traded since yesterday carries yesterday's key and cannot alert twice.
function newAlerts(quotes, held, state) {
    const alerts = [];
    for (const [t, where] of held) {
        const q = quotes[t];
        const move = q && q['1d'];
        if (move == null || !Number.isFinite(move) || Math.abs(move) < THRESHOLD || !q.at) continue;
        const day = new Date(q.at * 1000).toISOString().slice(0, 10);
        const band = Math.floor(Math.abs(move) / THRESHOLD) * Math.sign(move);
        const key = `${t}|${day}`;
        if (state[key] != null && Math.abs(state[key]) >= Math.abs(band) && Math.sign(state[key]) === Math.sign(band)) continue;
        alerts.push({ ticker: t, move, price: q.price, currency: q.currency, where: [...where].sort(), key, band });
    }
    return alerts.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
}

const pctText = m => `${m >= 0 ? '+' : '−'}${(Math.abs(m) * 100).toFixed(1)}%`;

function message(alerts) {
    const line = a => `${a.ticker} ${pctText(a.move)}${a.where.includes('pot') ? (a.where.includes('book') ? ' (book and pot)' : ' (pot)') : ''}`;
    return {
        title: alerts.length === 1 ? `${line(alerts[0])} today` : `${alerts.length} big moves today`,
        body: alerts.length === 1 ? `Price ${alerts[0].price} ${alerts[0].currency}` : alerts.map(line).join(', '),
        tag: 'moves',
    };
}

// ---------------- Web Push ----------------

// HKDF with a single 32-byte block, which is all RFC 8291 ever asks for.
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

// RFC 8291 aes128gcm: one record, the payload followed by the 0x02 last-record delimiter.
function encrypt(payload, sub) {
    const salt = crypto.randomBytes(16);
    const ecdh = crypto.createECDH('prime256v1');        // a fresh sender key for every message
    const asPublic = ecdh.generateKeys();
    const uaPublic = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
    const shared = ecdh.computeSecret(uaPublic);
    const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    const header = Buffer.alloc(21);
    salt.copy(header, 0);
    header.writeUInt32BE(4096, 16);
    header[20] = asPublic.length;
    return Buffer.concat([header, asPublic, body]);
}

// The receiving side, used only by the selftest to prove encrypt() is right.
function decrypt(buf, uaEcdh, auth) {
    const salt = buf.subarray(0, 16), idlen = buf[20], asPublic = buf.subarray(21, 21 + idlen);
    const shared = uaEcdh.computeSecret(asPublic);
    const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]), 32);
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
    const data = buf.subarray(21 + idlen);
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

// The VAPID public key in the form the browser wants: the uncompressed point, base64url.
const vapidPublic = jwk => b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));

function vapidHeader(endpoint, jwk) {
    const aud = new URL(endpoint).origin;
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
    const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapidPublic(jwk)}`;
}

async function send(sub, jwk, msg) {
    const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
            Authorization: vapidHeader(sub.endpoint, jwk),
            'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
            TTL: '43200', Urgency: 'high',
        },
        body: encrypt(JSON.stringify(msg), sub),
    });
    return res.status;
}

// ---------------- main ----------------

async function main() {
    let jwk, sub;
    try { jwk = JSON.parse(process.env.VAPID_PRIVATE_KEY || ''); sub = JSON.parse(process.env.PUSH_SUBSCRIPTION || ''); }
    catch { console.log('alerts: no VAPID key or phone subscription configured - skipped'); return; }

    if (process.env.ALERT_TEST) {
        const status = await send(sub, jwk, { title: 'Test alert', body: 'Big-move alerts are working.', tag: 'test' });
        console.log(`alerts: test notification sent, push service answered ${status}`);
        return;
    }

    const quotes = (read('prices.json', {}).quotes) || {};
    const held = heldTickers(read('holdings.json', {}), read('pot/positions.json', {}));
    const today = new Date().toISOString().slice(0, 10);
    // Keep only the last week of keys, so the file never grows past a few lines.
    const state = Object.fromEntries(Object.entries(read(STATE, {}))
        .filter(([k]) => k.split('|')[1] >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)));
    const alerts = newAlerts(quotes, held, state);
    if (!alerts.length) { console.log(`alerts: nothing new past ±${THRESHOLD * 100}% (${today})`); fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n'); return; }

    const status = await send(sub, jwk, message(alerts));
    // 201 is delivered to the push service. 404/410: the subscription is gone (site data cleared,
    // permission revoked) - press the bell again and replace the secret. Anything else, keep the
    // state unchanged so the next run tries again.
    if (status >= 200 && status < 300) for (const a of alerts) state[a.key] = a.band;
    console.log(`alerts: ${alerts.map(a => `${a.ticker} ${pctText(a.move)}`).join(', ')} - push service answered ${status}`
        + (status === 404 || status === 410 ? ' (subscription expired: re-subscribe with the bell on the site)' : ''));
    fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
}

function selftest() {
    const assert = require('assert');
    // Encryption round trip against a made-up browser subscription.
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
    const text = JSON.stringify({ title: 'AMD +6.2% today', body: 'Price 611.76 USD' });
    const wire = encrypt(text, sub);
    assert.strictEqual(wire.readUInt32BE(16), 4096, 'record size in the header');
    assert.strictEqual(wire[20], 65, 'key id is the uncompressed sender key');
    assert.strictEqual(decrypt(wire, ua, auth), text, 'the browser side recovers the payload');

    // VAPID token verifies with the public half.
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const [t] = vapidHeader(sub.endpoint, jwk).slice('vapid t='.length).split(', k=');
    const [h, c, s] = t.split('.');
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: crypto.createPublicKey({ key: { ...jwk, d: undefined }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, unb64u(s)), 'VAPID signature verifies');
    assert.strictEqual(JSON.parse(unb64u(c)).aud, 'https://push.example', 'audience is the push service origin');
    assert.strictEqual(unb64u(vapidPublic(jwk)).length, 65, 'public key is an uncompressed point');

    // Selection: threshold, both books, one alert per band per trading day.
    const at = Date.parse('2026-10-01T15:00:00Z') / 1000;
    const quotes = { AMD: { '1d': 0.062, at, price: 611.76, currency: 'USD' }, GOOG: { '1d': 0.049, at },
        'EUZ.DE': { '1d': -0.07, at, price: 11.2, currency: 'EUR' }, NVDA: { '1d': 0.2, at } };
    const held = heldTickers({ holdings: [{ yahoo: 'AMD' }, { yahoo: 'GOOG' }] }, { holdings: { 'EUZ.DE': {}, AMD: {} } });
    const first = newAlerts(quotes, held, {});
    assert.deepStrictEqual(first.map(a => a.ticker), ['EUZ.DE', 'AMD'], 'only held names past 5%, biggest first; NVDA is not held');
    assert.deepStrictEqual(first.find(a => a.ticker === 'AMD').where, ['book', 'pot'], 'a name in both books says so');
    const state = Object.fromEntries(first.map(a => [a.key, a.band]));
    assert.strictEqual(newAlerts(quotes, held, state).length, 0, 'the same move does not alert twice');
    quotes.AMD['1d'] = 0.11;
    assert.deepStrictEqual(newAlerts(quotes, held, state).map(a => a.ticker), ['AMD'], 'reaching the next band alerts again');
    quotes.AMD.at = Date.parse('2026-10-02T15:00:00Z') / 1000; quotes.AMD['1d'] = 0.06;
    assert.deepStrictEqual(newAlerts(quotes, held, state).map(a => a.ticker), ['AMD'],
        'a new trading day starts fresh for AMD; EUZ.DE has not traded since, so its old move stays quiet');
    assert.strictEqual(message(first).title, '2 big moves today');
    assert.ok(message(first).body.includes('EUZ.DE −7.0% (pot)'), 'pot names are labelled');
    console.log('push-alerts.js selftest ok');
}

if (require.main === module) {
    if (process.argv.includes('--selftest')) selftest();
    else main().catch(e => { console.log(`alerts: failed (${e.message}) - prices unaffected`); });
}
module.exports = { newAlerts, heldTickers, encrypt, vapidPublic };
