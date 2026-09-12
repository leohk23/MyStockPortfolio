#!/usr/bin/env node
// Seals what the public repo must not show in the clear: quantities, costs, trades, and any value
// series built from them. `node vault.js --selftest`.
//
// The repo is public because Actions minutes are free only there (~28 CI runs a day at ~4 min is
// ~3,400 min/month against 2,000 on a private repo). So the files stay where they are and the
// sensitive half of them is ciphertext. Tickers, groupings and percentage weights stay public
// (D67) — CI fetches by ticker, and the lanes reason on weights, never on amounts.
//
// AES-256-GCM under a key stretched from Leo's passphrase with PBKDF2-SHA256. The format is exactly
// what the browser's WebCrypto produces (tag appended to the ciphertext), so index.html opens the
// same blobs without a library. One fixed salt for the whole app: a salt defends against
// precomputation across MANY users, this app has one, and a fixed salt lets the page derive the
// key once instead of once per blob — three blobs at 600k iterations is a noticeable pause.
//
// The passphrase comes from HOLDINGS_KEY (a GitHub secret in CI) or the gitignored `.holdings-key`
// on the laptop. It never goes in the repo. Set both with tools/set-holdings-key.ps1.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SALT = 'MyStockPortfolio/holdings/v1';   // must match index.html
const ITER = 600000;                            // OWASP 2023 figure for PBKDF2-SHA256; must match index.html
const KEY_FILE = path.join(__dirname, '.holdings-key');

const derive = pass => crypto.pbkdf2Sync(pass, SALT, ITER, 32, 'sha256');
let cached = null;                              // one derivation per process, same as the page
const keyFor = pass => (cached?.pass === pass ? cached.key : (cached = { pass, key: derive(pass) }).key);

function passphrase() {
    if (process.env.HOLDINGS_KEY) return process.env.HOLDINGS_KEY.trim();
    try { return fs.readFileSync(KEY_FILE, 'utf8').trim() || null; } catch { return null; }
}

function seal(value, pass = passphrase()) {
    if (!pass) throw new Error('no passphrase: set HOLDINGS_KEY or create .holdings-key (tools/set-holdings-key.ps1)');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', keyFor(pass), iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final(), c.getAuthTag()]);
    return { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}

function open(sealed, pass = passphrase()) {
    if (!sealed || !pass) return null;
    const buf = Buffer.from(sealed.ct, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(pass), Buffer.from(sealed.iv, 'base64'));
    d.setAuthTag(buf.subarray(buf.length - 16));
    try { return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')); }
    catch { throw new Error('holdings passphrase is wrong (the sealed data would not authenticate)'); }
}

// holdings.json with the sealed half opened when a passphrase is available. `full` says which you
// got: a script that needs quantities must check it rather than read undefined as zero.
function readHoldings(file = path.join(__dirname, 'holdings.json')) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!doc.sealed) return { ...doc, full: true };                  // legacy plain file
    const inside = open(doc.sealed);
    return inside ? { ...doc, holdings: inside.holdings, full: true } : { ...doc, full: false };
}

// The public half of a holding: enough to fetch a quote and group a row, nothing that sizes it.
const PUBLIC_FIELDS = ['ticker', 'yahoo', 'group', 'geography', 'currency'];
const publicRow = h => Object.fromEntries(PUBLIC_FIELDS.filter(k => k in h).map(k => [k, h[k]]));

module.exports = { seal, open, passphrase, readHoldings, publicRow };

if (require.main === module && process.argv.includes('--selftest')) {
    const assert = require('assert');
    const p = 'correct horse';
    const blob = seal({ holdings: [{ yahoo: 'X', qty: 7 }] }, p);
    assert.deepStrictEqual(open(blob, p), { holdings: [{ yahoo: 'X', qty: 7 }] });
    assert.throws(() => open(blob, 'wrong'), /passphrase is wrong/);
    assert.notStrictEqual(seal(1, p).iv, seal(1, p).iv, 'fresh IV every seal');
    assert.deepStrictEqual(publicRow({ ticker: 'A', yahoo: 'A', qty: 3, trades: [] }), { ticker: 'A', yahoo: 'A' });
    // Tampering is caught, not decrypted into garbage.
    const bad = { ...blob, ct: Buffer.from(Buffer.from(blob.ct, 'base64').map((b, i) => i === 0 ? b ^ 1 : b)).toString('base64') };
    assert.throws(() => open(bad, p));
    console.log('selftest ok');
}
