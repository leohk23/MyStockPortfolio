# One full cycle of the pot: the book, the Scan, then Review, Sweep and Deep dive. For Task Scheduler.
#
# The order is a dependency, not a preference. The book is derived from the Tradelog so the Scan
# can compute §6.3-§6.5 from it; the Review judges what is already held BEFORE the Sweep goes
# looking for anything new (pot-design §2); the Deep dive reads both lanes and is the only one
# that may produce a buy order (D14). Out of order, each lane gets yesterday’s evidence.
#   ./pot/run-daily.ps1              # the whole cycle, pushing each lane as it finishes
#   ./pot/run-daily.ps1 -NoPush      # same, commits stay local
#
# Exit codes: 0 finished, 1 a lane failed, 3 another run already holds the lock.

param(
    [switch]$NoPush,
    [string]$Repo = 'C:/Users/leohk/MyStockPortfolio'
)

$ErrorActionPreference = 'Continue'
Set-Location $Repo
$log = 'pot/run-log.txt'
function Note($msg) {
    $line = "$((Get-Date).ToUniversalTime().ToString('HH:mm:ss'))  $msg"
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

# A scheduled run must never collide with one Leo started by hand: two agents writing the same
# proposals directory, and two git processes racing to push, is a mess to unpick afterwards.
$lock = Join-Path $Repo 'pot/.daily-lock'
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

    # ---- 0. The pot book, derived from the Tradelog and the proposals. The Scan reads it for
    # §6.3, §6.4 and §6.5, so it has to be current before the Scan runs, not after.
    node pot/positions.js 2>&1 | Select-Object -Last 2 | ForEach-Object { Note "  $_" }

    # ---- 1. Scan, so the Sweep has current levels to check its own figures against.
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

    # Each lane is its own process so a failure stops the cycle rather than poisoning the next.
    #
    # Splat a HASHTABLE, not an array. Splatting @('-Brief', $brief, ...) binds positionally, so
    # run-lane.ps1 received '-Brief' as its $Brief and the path as its $Agent, and refused it for
    # not being 'codex' or 'claude'. The 30 Aug 06:00 run failed this way and still reported
    # success, because a parameter-binding error leaves $LASTEXITCODE untouched from the previous
    # command. Hence the try/catch as well: exit codes alone cannot see this class of failure.
    function Invoke-Lane($brief) {
        Note "--- $brief"
        $laneArgs = @{ Brief = $brief; Repo = $Repo }
        if (-not $NoPush) { $laneArgs.Push = $true }
        $before = (Get-Item (Join-Path $Repo $log)).Length
        try {
            & (Join-Path $Repo 'pot/run-lane.ps1') @laneArgs
        } catch {
            Note "$brief threw: $($_.Exception.Message) - stopping the cycle"
            exit 1
        }
        if ($LASTEXITCODE -ne 0) { Note "$brief exited $LASTEXITCODE - stopping the cycle"; exit 1 }
        # run-lane.ps1 always writes its own header to the log. If the log did not grow, the lane
        # never started, whatever the exit code says.
        if ((Get-Item (Join-Path $Repo $log)).Length -le $before) {
            Note "$brief wrote nothing to the log - it did not run. Stopping the cycle."
            exit 1
        }
    }

    # ---- 2. Review, and it runs BEFORE the Sweep on purpose (pot-design §2). An agent that has
    # just spent an hour finding exciting new names is not the right agent to judge the thesis it
    # wrote last month. Judge first, discover afterwards.
    Invoke-Lane 'pot/brief-review.md'

    # ---- 3. Sweep. Deliberately before the Scan is refreshed: it is meant to look OUTSIDE
    # what we already track (A14-A16), and it writes any new name into watchlist.json.
    Invoke-Lane 'pot/brief-sweep.md'

    # ---- 4. Give the Sweep’s discoveries local data BEFORE the Deep dive judges them.
    #
    # Without this the cycle defeats itself. The Sweep exists to find names we do not carry;
    # the Deep dive must fact-check every figure against prices.json (§7.2) and so throws out
    # anything not in it. On 29 Aug it ranked Haidilao and Scorpio Tankers last, "no local
    # quote, real EPS or P/E bands" - names its own Sweep had raised eleven minutes earlier.
    # One fetch takes about three minutes and gives a new ticker price, EPS and P/E bands,
    # which is everything §7.2 asks for.
    node fetch-prices.js 2>&1 | Select-Object -Last 2 | ForEach-Object { Note "  $_" }
    if ($LASTEXITCODE -ne 0) { Note "fetch-prices exited $LASTEXITCODE - the Deep dive may lack data for new names" }

    # ---- 5. Scan, now covering whatever the Sweep added.
    node signals.js 2>&1 | Select-Object -Last 3 | ForEach-Object { Note "  $_" }
    # Only signals.json is committed. The price files belong to CI, which rewrites them every
    # 15 minutes on weekdays and on every push, so committing our copy races it for nothing:
    # the 29 Aug attempt collided on prices.json, history.json and intraday.json at once. The
    # local fetch above has already done its job by handing the Deep dive current data.
    git add signals.json 2>&1 | Out-Null
    if (git diff --cached --name-only) {
        git commit --quiet -m "scan: $started, covering this cycle's new candidates"
        Note 'scan committed'
        if (-not $NoPush) {
            git fetch --quiet origin main 2>&1 | Out-Null
            git rebase --quiet FETCH_HEAD 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { git rebase --abort 2>&1 | Out-Null; Note 'scan rebase conflicted - left local' }
            else { git push --quiet origin main 2>&1 | Out-Null; Note 'scan pushed' }
        }
    }

    # ---- 6. Deep dive, the only lane that may produce an order.
    Invoke-Lane 'pot/brief-deepdive.md'

    # Drop the local price fetch now it has been read. Leaving it modified would make the next
    # cycle's ff-only pull fail, and CI's copy is the one that should survive.
    git checkout -- prices.json history.json earnings.json intraday.json 2>&1 | Out-Null

    # ---- 7. The report, and the bundle the dashboard Pot tab reads.
    #
    # The comment above used to be a lie: only report.js ran, so pot.json never got rebuilt and
    # the Pot tab served whatever the last manual run left behind.
    node pot/report.js 2>&1 | ForEach-Object { Note "  $_" }
    node pot/bundle.js 2>&1 | ForEach-Object { Note "  $_" }

    # ---- 8. Commit what the report itself produced.
    #
    # report.js stamps provenance onto the lane output AFTER that lane has already committed, so
    # every proposal reaches git headed "model: pending" and the real figures live only on this
    # machine. Unattended, nobody would notice; on 30 Aug the stamps sat uncommitted until a human
    # ran git by hand. Same for pot.json, which is outside the lanes' allowlist and so is reverted
    # by every lane that touches it.
    git add pot.json pot/proposals pot/sweeps pot/reviews 2>&1 | Out-Null
    if (git diff --cached --name-only) {
        git commit --quiet -m "pot: provenance stamps and the app bundle for $started"
        Note 'stamps and bundle committed'
        if (-not $NoPush) {
            git fetch --quiet origin main 2>&1 | Out-Null
            git rebase --quiet FETCH_HEAD 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { git rebase --abort 2>&1 | Out-Null; Note 'stamp rebase conflicted - left local' }
            else { git push --quiet origin main 2>&1 | Out-Null; Note 'stamps and bundle pushed' }
        }
    }
    Note 'cycle complete'
}
finally {
    if ($awake -and -not $awake.HasExited) { Stop-Process -Id $awake.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
exit 0
