# Runs one agent lane unattended, for Windows Task Scheduler.
#
# The agent is given a brief and nothing else. Everything around it — pulling fresh CI data,
# deciding what may be committed, pushing — is deterministic PowerShell, because an agent that
# can write files is fine and an agent that can push whatever it likes is a different risk.
#
#   .\pot\run-lane.ps1 -Brief pot\brief-smoke.md                 # run, commit locally
#   .\pot\run-lane.ps1 -Brief pot\brief-sweep.md -Push           # ...and publish
#   .\pot\run-lane.ps1 -Brief pot\brief-smoke.md -Agent claude
#
# Exit codes: 0 ran (whether or not it changed anything), 1 the agent failed, 2 git failed.

param(
    [string]$Brief = 'pot\brief-smoke.md',
    [ValidateSet('codex', 'claude')][string]$Agent = 'codex',
    # Deep dive only: the name Leo picked. Selection is his, so it is an argument, never something
    # the agent decides for itself — see the top of pot\brief-deepdive.md for why.
    [string]$Ticker,
    [switch]$Push,
    [string]$Repo = 'C:\Users\leohk\MyStockPortfolio'
)

$ErrorActionPreference = 'Continue'
Set-Location $Repo
$started = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$log = 'pot\run-log.txt'
function Note($msg) {
    $line = "$((Get-Date).ToUniversalTime().ToString('HH:mm:ss'))  $msg"
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}
Add-Content -Path $log -Value "`n=== $started  $Agent  $Brief ===" -Encoding utf8

# Fresh CI data first — the whole point of the free lane is that the agent reads current numbers.
# ff-only: a scheduled task must never be the thing that resolves a merge.
git pull --ff-only --quiet origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Note 'git pull failed (diverged, ahead, or offline) - continuing on local data'; }

# Only these paths may change. Anything else the agent touches is reverted below, not committed.
$allowed = @('pot/*', 'watchlist.json')

# Whatever was already modified before the agent started is NOT the agent's doing, and must
# survive. The revert below exists to stop a stray agent edit reaching a commit; on 30 Aug it
# instead threw away an hour of uncommitted work in signals.js that a human had in progress,
# because it could not tell the two apart. Now it can: only files that were clean going in are
# candidates for reverting.
$dirtyBefore = @(git status --porcelain | ForEach-Object { $_.Substring(3) })

$prompt = if ($Ticker) { "Follow the instructions in $Brief for $Ticker" }
          else { "Follow the instructions in $Brief" }
Note "prompt: $prompt"

if ($Agent -eq 'codex') {
    codex exec --cd $Repo --sandbox workspace-write `
        --output-last-message pot\last-message.txt $prompt 2>&1 |
        Select-Object -Last 3 | ForEach-Object { Note "  $_" }
} else {
    claude -p $prompt --permission-mode acceptEdits `
        --output-format text 2>&1 | Select-Object -Last 3 | ForEach-Object { Note "  $_" }
}
if ($LASTEXITCODE -ne 0) { Note "agent exited $LASTEXITCODE"; exit 1 }

# Revert anything outside the allowlist before staging, so a stray edit cannot ride along.
$stray = git status --porcelain | ForEach-Object { $_.Substring(3) } |
    Where-Object { $p = $_; -not ($allowed | Where-Object { $p -like $_ }) -and $dirtyBefore -notcontains $p }
if ($stray) {
    Note "reverting $($stray.Count) file(s) outside the allowlist: $($stray -join ', ')"
    git checkout -- $stray 2>&1 | Out-Null
    # A revert that fails must not be shrugged off: the point of the allowlist is that nothing
    # outside it reaches a commit, and carrying on regardless commits exactly what it was there to
    # stop. A zero-byte file named U+00B7, committed by accident on 28 Aug from a mangled shell
    # redirect, was enough to break the checkout and take the whole revert down with it.
    if ($LASTEXITCODE -ne 0) { Note "revert failed - refusing to commit files this lane may not have written"; exit 2 }
}

git add -- pot watchlist.json 2>&1 | Out-Null
$staged = git diff --cached --name-only
if (-not $staged) { Note 'no changes — nothing to commit'; exit 0 }

Note "committing: $($staged -join ', ')"
git commit --quiet -m "pot: $Agent ran $(Split-Path $Brief -Leaf) at $started"
if ($LASTEXITCODE -ne 0) { Note 'git commit failed'; exit 2 }

if ($Push) {
    # The prices CI commits every 15 minutes and a lane takes ten, so origin has almost always moved
    # by the time we get here — every run on 29 Aug failed its push for exactly this reason. Rebase
    # our one commit onto the remote first, which shrinks the race from ten minutes to a second.
    #
    # Only pot/ and watchlist.json are ever staged here, and the CI only ever touches the data JSONs,
    # so there is nothing to collide over in practice. If that ever stops being true, abandon the
    # rebase: an unattended task must not leave a conflicted tree for the next run to trip over.
    # --autostash, because the tree is usually dirty here and that is not an error. The daily
    # cycle runs fetch-prices between the lanes, leaving prices.json, history.json, earnings.json
    # and intraday.json modified; plain rebase refuses to start on unstaged changes, and the
    # runner reported that refusal as a CONFLICT - so every cycle on 31 Aug looked like it had hit
    # a merge it could not resolve when nothing had actually diverged.
    git fetch --quiet origin main 2>&1 | Out-Null
    git rebase --quiet --autostash FETCH_HEAD 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        git rebase --abort 2>&1 | Out-Null
        Note 'rebase onto origin/main failed - aborted, commit stays local'
        exit 0
    }
    git push --quiet origin main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Note 'git push failed - commit is local, will go with the next run' }
    else { Note 'pushed' }
} else {
    Note 'committed locally (-Push not set)'
}
exit 0
