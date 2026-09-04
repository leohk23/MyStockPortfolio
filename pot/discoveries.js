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

const laneOf = subject => /brief-sweep/.test(subject) ? 'sweep'
    : /brief-deepdive/.test(subject) ? 'deepdive'
        : /brief-review/.test(subject) ? 'review'
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
        for (const t of names) {
            if (found.has(t)) continue;      // first appearance wins: that is the commit that added it
            found.set(t, { date: iso.slice(0, 10), lane: laneOf(rest.join('\t')) });
        }
    }
    return found;
}

module.exports = { discoveries };
