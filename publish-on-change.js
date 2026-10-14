// `node publish-on-change.js` — publishes the Tradelog when Leo's live workbook changes, so an edit
// made anywhere (Excel on the laptop, Excel Online, the phone) reaches the site without running
// `npm run publish` by hand. Task Scheduler runs it every 15 minutes ("MyStockPortfolio tradelog
// watch"); the workbook is the path in .tradelog-path, a OneDrive file kept synced to this laptop.
//
// It does nothing unless the file's modified time or size moved since the last successful publish
// (.tradelog-published). A change younger than SETTLE_MS is left for the next run, so a save still
// syncing down from OneDrive is never read half-written. A failed publish is not recorded, so the
// next run tries again. Everything it does goes to publish-on-change.log; all three are gitignored.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

process.chdir(__dirname);
const STATE = '.tradelog-published', LOG = 'publish-on-change.log', LOCK = '.publish-on-change.lock';
const SETTLE_MS = 2 * 60 * 1000;          // a save must be this still before it is read
const LOCK_MS = 15 * 60 * 1000;           // a lock older than this is a crashed run, not a live one

const log = msg => fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);

// 'unchanged' | 'settling' | 'publish', from the file's stat and what was last published.
function decide(stat, state, now) {
    if (state && state.mtimeMs === stat.mtimeMs && state.size === stat.size) return 'unchanged';
    if (now - stat.mtimeMs < SETTLE_MS) return 'settling';
    return 'publish';
}

function main() {
    const workbook = fs.existsSync('.tradelog-path') ? fs.readFileSync('.tradelog-path', 'utf8').trim() : 'Tradelog.xlsx';
    if (!fs.existsSync(workbook)) { log(`workbook not found: ${workbook}`); return; }
    const stat = fs.statSync(workbook);
    const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
    const verdict = decide(stat, state, Date.now());
    if (verdict !== 'publish') return;                       // the common case: silent
    if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < LOCK_MS) { log('a publish is still running; skipped'); return; }
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    if (branch !== 'main') { log(`on branch ${branch}, not main; not publishing`); return; }
    const unmerged = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' }).trim();
    if (unmerged) { log(`the repo has unmerged files (${unmerged.split('\n').join(', ')}); resolve them, then it publishes`); return; }
    fs.writeFileSync(LOCK, String(process.pid));
    try {
        log(`${path.basename(workbook)} changed (saved ${new Date(stat.mtimeMs).toISOString()}); publishing`);
        const out = execSync('node publish.js', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        log(out.split('\n').filter(l => /wrote holdings|IBKR|positions:|unchanged|Pushed|verified/.test(l)).map(l => '  ' + l.trim()).join('\n') || '  done');
        fs.writeFileSync(STATE, JSON.stringify({ mtimeMs: stat.mtimeMs, size: stat.size, published: new Date().toISOString() }));
    } catch (e) {
        log(`publish failed, will retry next run: ${(e.stderr || e.message || '').toString().split('\n').filter(Boolean).slice(-3).join(' | ')}`);
        process.exitCode = 1;
    } finally {
        fs.rmSync(LOCK, { force: true });
    }
}

function selftest() {
    const assert = require('assert');
    const now = Date.parse('2026-10-14T12:00:00Z');
    const saved = { mtimeMs: now - 10 * 60 * 1000, size: 100 };
    assert.strictEqual(decide(saved, { mtimeMs: saved.mtimeMs, size: 100 }, now), 'unchanged');
    assert.strictEqual(decide(saved, null, now), 'publish', 'never published: publish');
    assert.strictEqual(decide(saved, { mtimeMs: saved.mtimeMs - 1, size: 100 }, now), 'publish');
    assert.strictEqual(decide({ mtimeMs: now - 30 * 1000, size: 101 }, { mtimeMs: 1, size: 100 }, now), 'settling', 'still syncing: wait');
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : main();
module.exports = { decide };
