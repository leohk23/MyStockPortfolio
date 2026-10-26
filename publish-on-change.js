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
const CYCLE_LOCK = 'pot/.daily-lock', CYCLE_MS = 3 * 60 * 60 * 1000;   // the longest cycle took 83 minutes

const log = msg => fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);

// 'unchanged' | 'settling' | 'publish', from the file's stat and what was last published.
// Whole seconds: OneDrive rewrote the timestamp without its fraction (…28.877 became …28.000) and the
// same save was published twice on 14 Oct 2026.
function decide(stat, state, now) {
    const sec = ms => Math.floor(ms / 1000);
    if (state && sec(state.mtimeMs) === sec(stat.mtimeMs) && state.size === stat.size) return 'unchanged';
    if (now - stat.mtimeMs < SETTLE_MS) return 'settling';
    return 'publish';
}

// Is a pot cycle running? run-daily.ps1 holds pot/.daily-lock ("<pid> started <iso>Z") for its whole
// run, and a publish must not land inside it: a lane that sees HEAD move and holdings.json change
// cannot tell that from a lane tampering with git, so D91 discards everything it wrote. That threw
// away the 23 Oct 12:09 Deep dive on Claude when this published a 12:06 save at 12:15. The save
// waits for the next run instead, at most one cycle late. A lock whose process has gone, or older
// than any cycle, is a crashed run and does not hold anything up. PowerShell writes it with a BOM.
// The line of a failed publish's stderr that says what went wrong. The last three lines were logged
// until 26 Oct 2026, and they are the tail of a stack trace: "} |  | Node.js v22.16.0", four times
// over, while the actual cause ("open positions missing from meta.json: SUPR") sat at the top.
function failureLine(stderr) {
    const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const said = lines.filter(l => /missing|refus|not found|cannot|could not|error:/i.test(l) && !/^at |^node:|Node\.js v/.test(l));
    return (said.length ? said.slice(0, 2) : lines.slice(-3)).join(' | ');
}

const lockLine = text => String(text || '').trim().replace(/^\D+/, '');   // drops the BOM, or any junk before the pid
function cycleRunning(lockText, now, alive) {
    const m = /^(\d+) started (\S+)/.exec(lockLine(lockText));
    if (!m || !(now - Date.parse(m[2]) < CYCLE_MS)) return false;
    return alive(Number(m[1]));
}
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function main() {
    const workbook = fs.existsSync('.tradelog-path') ? fs.readFileSync('.tradelog-path', 'utf8').trim() : 'Tradelog.xlsx';
    if (!fs.existsSync(workbook)) { log(`workbook not found: ${workbook}`); return; }
    const stat = fs.statSync(workbook);
    const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
    const verdict = decide(stat, state, Date.now());
    if (verdict !== 'publish') return;                       // the common case: silent
    const cycle = fs.existsSync(CYCLE_LOCK) ? fs.readFileSync(CYCLE_LOCK, 'utf8') : null;
    if (cycleRunning(cycle, Date.now(), pidAlive)) { log(`a pot cycle is running (${lockLine(cycle)}); publishing after it`); return; }
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
        log(`publish failed, will retry next run: ${failureLine((e.stderr || e.message || '').toString())}`);
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
    assert.strictEqual(decide({ mtimeMs: 1791952468000, size: 100 }, { mtimeMs: 1791952468876.73, size: 100 }, now), 'unchanged',
        'the same save with its fraction of a second dropped by OneDrive');
    assert.strictEqual(decide(saved, { mtimeMs: saved.mtimeMs - 1, size: 100 }, now), 'publish');
    assert.strictEqual(decide({ mtimeMs: now - 30 * 1000, size: 101 }, { mtimeMs: 1, size: 100 }, now), 'settling', 'still syncing: wait');

    // A running pot cycle holds the publish back; a dead or ancient one does not.
    const up = () => true, gone = () => false;
    const lock = String.fromCharCode(0xfeff) + '4242 started 2026-10-14T11:30:00Z\r\n';
    assert.strictEqual(cycleRunning(lock, now, up), true, 'live cycle, BOM and CRLF as PowerShell writes them');
    assert.strictEqual(cycleRunning(lock, now, gone), false, 'its process has gone: a crashed cycle');
    assert.strictEqual(cycleRunning('4242 started 2026-10-14T08:00:00Z', now, up), false, 'older than any cycle');
    assert.strictEqual(cycleRunning(null, now, up), false, 'no lock');
    assert.strictEqual(cycleRunning('garbage', now, up), false, 'unreadable lock');
    assert.strictEqual(pidAlive(process.pid), true);

    // The failure line names the cause, not the stack trace's last brace.
    const stderr = 'C:\\x\\extract-portfolio.js:340\n    throw new Error(msg);\n    ^\n\nError: open positions missing from meta.json: SUPR. Add an entry.\n'
        + '    at main (C:\\x\\extract-portfolio.js:340:11)\n}\n\nNode.js v22.16.0\n';
    assert.strictEqual(failureLine(stderr), 'Error: open positions missing from meta.json: SUPR. Add an entry.');
    assert.strictEqual(failureLine('a\nb\nc\nd'), 'b | c | d', 'nothing recognisable: the last three lines, as before');
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : main();
module.exports = { decide, cycleRunning };
