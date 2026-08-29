# One full cycle of the pot: Scan, then Sweep, then Deep dive. For Windows Task Scheduler.
#
# The order is a dependency, not a preference. The Scan writes signals.json from the latest CI
# prices; the Sweep looks outside it; the Deep dive reads BOTH and is the only lane that may
# produce an order (D14). Running them out of order gives the Deep dive yesterday's evidence.
#
#   .\pot\run-daily.ps1              # the whole cycle, pushing each lane as it finishes
#   .\pot\run-daily.ps1 -NoPush      # same, commits stay local
#
# Exit codes: 0 finished, 1 a lane failed, 3 another run already holds the lock.

param(
    [switch]$NoPush,
    [string]$Repo = 'C:\Users\leohk\MyStockPortfolio'
)

$ErrorActionPreference = 'Continue'
Set-Location $Repo
$log = 'pot\run-log.txt'
function Note($msg) {
    $line = "$((Get-Date).ToUniversalTime().ToString('HH:mm:ss'))  $msg"
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

# A scheduled run must never collide with one Leo started by hand: two agents writing the same
# proposals directory, and two git processes racing to push, is a mess to unpick afterwards.
$lock = Join-Path $Repo 'pot\.daily-lock'
if (Test-Path $lock) {
    $held = Get-Content $lock -ErrorAction SilentlyContinue
    $alive = $held -and (Get-Process -Id ([int]($held -split ' ')[0]) -ErrorAction SilentlyContinue)
    if ($alive) { Note "another run is in progress ($held) - skipping this cycle"; exit 3 }
    Note "clearing a stale lock ($held)"
}
"$PID started $((Get-Date).ToUniversalTime().ToString('s'))Z" | Set-Content $lock -Encoding utf8

try {
    $started = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    Add-Content -Path $log -Value "`n===== daily cycle $started =====" -Encoding utf8

    # Keep the machine awake for the duration. The 29 Aug deep dive ran 83 minutes of wall clock
    # for ten minutes of work because the laptop slept underneath it; unattended, nobody notices.
    $awake = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-Command',
        '$s=[void][Console]::In; Add-Type -Name P -Namespace W -MemberDefinition ' +
        '''[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);''; ' +
        '[W.P]::SetThreadExecutionState(0x80000001); while($true){Start-Sleep 60}')

    # ---- 1. Scan. Free, deterministic, and the Deep dive reads its output.
    git pull --ff-only --quiet origin main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Note 'git pull failed (diverged, ahead, or offline) - continuing on local data' }
    node signals.js 2>&1 | Select-Object -Last 3 | ForEach-Object { Note "  $_" }
    if ($LASTEXITCODE -ne 0) { Note "signals.js exited $LASTEXITCODE" }
    git add signals.json 2>&1 | Out-Null
    if (git diff --cached --name-only) {
        git commit --quiet -m "scan: $started"
        Note 'scan committed'
        if (-not $NoPush) {
            git fetch --quiet origin main 2>&1 | Out-Null
            git rebase --quiet FETCH_HEAD 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { git rebase --abort 2>&1 | Out-Null; Note 'scan rebase conflicted - left local' }
            else { git push --quiet origin main 2>&1 | Out-Null; Note 'scan pushed' }
        }
    } else { Note 'scan found nothing new to commit' }

    # ---- 2 and 3. The two agent lanes, in dependency order.
    foreach ($brief in @('pot\brief-sweep.md', 'pot\brief-deepdive.md')) {
        Note "--- $brief"
        $args = @('-Brief', $brief, '-Repo', $Repo)
        if (-not $NoPush) { $args += '-Push' }
        & (Join-Path $Repo 'pot\run-lane.ps1') @args
        if ($LASTEXITCODE -ne 0) { Note "$brief exited $LASTEXITCODE - stopping the cycle"; exit 1 }
    }

    # ---- 4. The report is what Leo actually opens in the morning.
    node pot\report.js 2>&1 | ForEach-Object { Note "  $_" }
    Note 'cycle complete'
}
finally {
    if ($awake -and -not $awake.HasExited) { Stop-Process -Id $awake.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
exit 0
