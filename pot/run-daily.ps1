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


# Both helpers are defined BEFORE the try that calls them. PowerShell does not hoist functions:
# defined after their first call site, `Publish` simply did not exist yet, and the 1 Sep 06:00
# cycle aborted on the first scan push having written book and scan but no lane - reporting
# success the whole way, because the script ended `exit 0` regardless. Keep definitions above
# first use, and keep the exit code honest below.

# Each lane is its own process so a failure stops the cycle rather than poisoning the next.
#
# Splat a HASHTABLE, not an array. Splatting @('-Brief', $brief, ...) binds positionally, so
# run-lane.ps1 received '-Brief' as its $Brief and the path as its $Agent, and refused it for
# not being 'codex' or 'claude'. The 30 Aug 06:00 run failed this way and still reported
# success, because a parameter-binding error leaves $LASTEXITCODE untouched from the previous
# command. Hence the try/catch as well: exit codes alone cannot see this class of failure.
# Publish what is committed, retrying past the CI race.
#
# A single fetch-rebase-push looked reliable and was not: the 31 Aug 21:00 cycle committed
# its bundle, lost one rebase, and stopped - so the two proposals it had just written sat on
# this machine while the site served a build from five hours earlier. Nothing reported a
# problem, because the cycle had genuinely finished.
#
# --autostash handles the dirty tree the mid-cycle fetch leaves. The retry handles origin
# moving between the fetch and the push, which is the common case at five cycles a day.
function Publish($what) {
    if ($NoPush) { Note "$what committed locally (-Push not set)"; return }
    foreach ($try in 1..3) {
        git fetch --quiet origin main 2>&1 | Out-Null
        git rebase --quiet --autostash FETCH_HEAD 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            git rebase --abort 2>&1 | Out-Null
            Note "$what rebase failed (attempt $try)"
            Start-Sleep -Seconds 5
            continue
        }
        git push --quiet origin main 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Note "$what pushed"; return }
        Note "$what push rejected (attempt $try) - refetching"
        Start-Sleep -Seconds 5
    }
    Note "$what STILL LOCAL after 3 attempts - it will go with the next cycle"
}

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

$completed = $false
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
        Publish 'scan'
    } else { Note 'scan found nothing new to commit' }

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
        Publish 'scan'
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
        Publish 'stamps and bundle'
    }
    Note 'cycle complete'
    $completed = $true
}
catch {
    # Without this the 1 Sep 06:00 abort wrote NOTHING after 'scan committed': a terminating error
    # unwound straight past the log to the finally. Anything that kills the cycle now says so in
    # the log, with the line it died on.
    Note "cycle ABORTED: $($_.Exception.Message)"
    Note "  at $($_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber) - $($_.InvocationInfo.Line.Trim())"
}
finally {
    if ($awake -and -not $awake.HasExited) { Stop-Process -Id $awake.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
# The exit code has to mean something. It was a flat `exit 0`, so Task Scheduler recorded the
# 1 Sep abort as a success and nothing surfaced it — the lanes' own `exit 1` paths were the only
# way this script could ever report failure. A cycle that did not reach 'cycle complete' is a
# failed cycle, whatever it managed on the way.
if ($completed) { exit 0 }
Note 'cycle did NOT complete - exiting 1'
exit 1
