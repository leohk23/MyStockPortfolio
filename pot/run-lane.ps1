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
if ($LASTEXITCODE -ne 0) { Note 'git pull failed (diverged or offline) — continuing on local data'; }

# Only these paths may change. Anything else the agent touches is reverted below, not committed.
$allowed = @('pot/*', 'watchlist.json')

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
    Where-Object { $p = $_; -not ($allowed | Where-Object { $p -like $_ }) }
if ($stray) {
    Note "reverting $($stray.Count) file(s) outside the allowlist: $($stray -join ', ')"
    git checkout -- $stray 2>&1 | Out-Null
}

git add -- pot watchlist.json 2>&1 | Out-Null
$staged = git diff --cached --name-only
if (-not $staged) { Note 'no changes — nothing to commit'; exit 0 }

Note "committing: $($staged -join ', ')"
git commit --quiet -m "pot: $Agent ran $(Split-Path $Brief -Leaf) at $started"
if ($LASTEXITCODE -ne 0) { Note 'git commit failed'; exit 2 }

if ($Push) {
    git push --quiet origin main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Note 'git push failed — commit is local, will go with the next run' }
    else { Note 'pushed' }
} else {
    Note 'committed locally (-Push not set)'
}
exit 0
