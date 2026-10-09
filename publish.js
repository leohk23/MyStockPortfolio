// `npm run publish` — one command from "I traded" to a live site.
// Regenerates holdings.json from the workbook, commits it, syncs with the hourly
// bot's commits, and pushes. Written in node (not a shell one-liner) so it behaves
// the same in PowerShell, cmd, and bash.
const { execSync } = require('child_process');
const run = c => execSync(c, { stdio: 'inherit' });
const quiet = c => { try { execSync(c, { stdio: 'ignore' }); return true; } catch { return false; } };

// What IBKR actually paid (dividends net of its withholding), sealed into holdings.json by the
// extract below. Best-effort: IBKR being down must not stop a Tradelog publish, and the last
// fetched record stays in place.
if (!quiet('node ibkr-dividends.js')) console.log('IBKR dividends not refreshed — publishing with the last record.');
// Date any watchlist name added since the last run (the watchlist table sorts on it).
run('node watchlist-added.js');
run('node extract-portfolio.js');       // Tradelog + meta.json -> holdings.json (throws if workbook missing)
// meta.json too, in case you added an instrument; watchlist.json in case you added a name to watch
run('git add holdings.json meta.json watchlist.json');

// `git diff --staged --quiet` exits non-zero when there IS something staged.
if (quiet('git diff --staged --quiet')) {
    console.log('holdings.json unchanged — nothing to commit.');
} else {
    run(`git commit -m "positions: ${new Date().toISOString().slice(0, 10)}"`);
}

// The hourly Action commits prices.json to main, so pull its commits before pushing.
run('git pull --rebase --autostash');
run('git push');                        // no-op if nothing new; otherwise triggers a fresh price fetch + deploy
console.log('\nPushed. The site will re-price and redeploy within a minute.');
