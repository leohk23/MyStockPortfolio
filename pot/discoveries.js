// Where each watchlist name came from, derived from git.
//
// Shared by pot/report.js (which marks Sweep finds on the paper-performance page) and
// pot/bundle.js (which ships the labels to the dashboard). One implementation on purpose: the
// week this was written, run-daily.ps1 and run-lane.ps1 carried the same publish logic twice, one
// copy was fixed, the other silently kept breaking the repo for another day.
//
// Derived, never declared. A `found:` field in watchlist.json would have to be written by the
// agent that found the name, and A20 settles that argument: provenance comes from the log, not
// from what an agent says about itself. The commit that first carries a ticker is the one that
// found it, and its subject names the brief that ran.
//
// Only two lanes have ever added a name: the Sweep, and Leo by hand. The Deep dive proposes from
// what is already on the list (A3 puts a proposed name there, but every name it has proposed was
// already present), so `deepdive` is recognised here and has so far never appeared.
const { execSync } = require('child_process');

// What the commit TOUCHED decides the lane, not what its subject says.
//
// Subject-matching was wrong and Leo caught it: AMRC showed as hand-added and he had never added
// it. The commit was `48c3491 World tab fixes, and the reading test worked` — Leo's own message
// about UI work, which also carried `pot/sweeps/2026-08-29.md` and the four names that sweep had
// found. A lane's own commits announce themselves in the subject, but the moment a human bundles a
// lane's output into an unrelated commit the subject stops describing the change. The artifact
// does not: a sweep output file in the commit means a sweep produced what it added.
//
// Seven names were misattributed this way — CHRT.L, ROK, EPI-A.ST, RSGN.SW, AMRC, BME.L, LRE.L —
// all of them Sweep finds credited to Leo, which is the wrong direction to be wrong in: it made
// the Sweep look less productive than it is and told him he had added names he had not.
const laneOf = (subject, files) => /(^|\n)pot\/sweeps\/.+\.md$/m.test(files) || /brief-sweep/.test(subject) ? 'sweep'
    : /(^|\n)pot\/proposals\/.+\.md$/m.test(files) || /brief-deepdive/.test(subject) ? 'deepdive'
        : /(^|\n)pot\/reviews\/.+\.md$/m.test(files) || /brief-review/.test(subject) ? 'review'
            : 'hand';

// -> Map(ticker -> { date: 'YYYY-MM-DD', lane }). Empty on any git failure: a label is a nicety,
// and nothing that reads this may break because a checkout is shallow or absent.
function discoveries(cwd = process.cwd()) {
    const sh = c => execSync(c, { cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString();
    let log;
    try { log = sh('git log --reverse --format=%H%x09%cI%x09%s -- watchlist.json'); }
    catch { return new Map(); }
    const found = new Map();
    for (const line of log.trim().split('\n')) {
        const [sha, iso, ...rest] = line.split('\t');
        if (!sha || !iso) continue;
        let names;
        // A commit where the file was absent, or malformed mid-edit. Skipping it means the next
        // commit that carries a ticker gets the credit, which is the right answer anyway.
        try { names = JSON.parse(sh(`git show ${sha}:watchlist.json`)).map(w => w.yahoo); }
        catch { continue; }
        const fresh = names.filter(t => !found.has(t));   // first appearance wins: that commit added it
        if (!fresh.length) continue;
        // Only fetched for commits that actually added something, so this stays one extra git call
        // per addition rather than one per commit in the file's whole history.
        let files = '';
        try { files = sh(`git show --name-only --format= ${sha}`); } catch { /* subject only, then */ }
        const lane = laneOf(rest.join('\t'), files);
        for (const t of fresh) found.set(t, { date: iso.slice(0, 10), lane });
    }
    return found;
}

module.exports = { discoveries };
