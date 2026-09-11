# One full cycle of the pot: the book, the Scan, then Review, Sweep and Deep dive. For Task Scheduler.
#
# The order is a dependency, not a preference. The book is derived from the Tradelog so the Scan
# can compute §6.3-§6.5 from it; the Review judges what is already held BEFORE the Sweep goes
# looking for anything new (pot-design §2); the Deep dive reads both lanes and is the only one
# that may produce a buy order (D14). Out of order, each lane gets yesterday’s evidence.
#   ./pot/run-daily.ps1              # the whole cycle, pushing each lane as it finishes
#   ./pot/run-daily.ps1 -NoPush      # same, commits stay local
#
# WHEN this runs is not in this file. The Task Scheduler entry 'MyStockPortfolio pot daily' fires
# it, and pot-design.md §4.2 is the source of truth for the cadence, the reasoning behind each
# slot, and the weekly-allowance arithmetic that caps it. Change the schedule there and in the
# task; do not add timing logic here. Running this by hand costs a real ~5% of the weekly
# allowance and 20-35 minutes, so prefer run-lane.ps1 -NoPush for testing a single lane.
#
# Exit codes: 0 finished, 1 a lane failed, 3 another run already holds the lock.

param(
    [switch]$NoPush,
    # Threaded to every lane so one cycle never mixes models. See run-lane.ps1 for why it is pinned.
    # Override the per-lane models below for EVERY lane, e.g. -Model gpt-5.6-sol to run a whole
    # cycle cheaply. Empty means each lane uses its own default from .
    [string]$Model = '',
    # Which lanes to run regardless of cadence, e.g. -Force sweep,deepdive. 'all' means every lane.
    #
    # This was a bare switch and that was wrong in a way that cost a cycle. On 10 Sep it was used to
    # get one deep dive, and forced the Review first - a lane not due for two days - which took a
    # quarter of the 5-hour window and left the deep dive to die on the limit at 20:47. Forcing is
    # for "run this lane now"; a switch that means "run everything now" cannot express that.
    [ValidateSet('review', 'sweep', 'deepdive', 'all')]
    [string[]]$Force = @(),
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
# --autostash stays as a net for SMALL incidental dirt (pot/positions.json, which the selftests
# rewrite). It must not be trusted with the four files below. The retry handles origin moving
# between the fetch and the push, which is the common case at several cycles a day.

# CI owns these four: it rewrites every one of them WHOLESALE every fifteen minutes and pushes.
# The cycle rewrites them again mid-run (see the fetch further down) purely so the Deep dive can
# fact-check the names the Sweep just found. That local copy is SCRATCH — never committed, and it
# must never be carried across a rebase.
#
# --autostash used to try, and could not. It shelved them, rebased cleanly, then failed to put
# them back: a wholesale local rewrite against CI's wholesale rewrite overlaps on essentially
# every line, so the pop conflicted and git left BOTH versions jammed into the working tree —
# 558 conflict markers in prices.json on 1 Sep, and none of the four still parsed as JSON.
# The rebase had SUCCEEDED, so the `git rebase --abort` below was a no-op, the wreckage stayed,
# and each retry shelved another copy. Three stashes, a broken tree, and a cycle reporting that
# it had merely "failed to rebase".
#
# So carry the scratch by hand: copy it out, let git have CI's version, copy it back verbatim.
# No merge is attempted, so there is nothing to conflict.
$ciOwned = @('prices.json', 'history.json', 'intraday.json', 'earnings.json')

function Save-Scratch {
    $saved = @{}
    foreach ($f in $ciOwned) {
        if (git status --porcelain -- $f) {
            $tmp = Join-Path $env:TEMP "pot-scratch-$f"
            Copy-Item $f $tmp -Force
            $saved[$f] = $tmp
        }
    }
    if ($saved.Count) { git checkout --quiet -- @($saved.Keys) 2>&1 | Out-Null }
    $saved
}

function Restore-Scratch($saved) {
    if (-not $saved) { return }
    foreach ($kv in $saved.GetEnumerator()) {
        Copy-Item $kv.Value $kv.Key -Force
        Remove-Item $kv.Value -Force -ErrorAction SilentlyContinue
    }
}

function Publish($what) {
    if ($NoPush) { Note "$what committed locally (-Push not set)"; return }
    foreach ($try in 1..3) {
        $scratch = Save-Scratch
        git fetch --quiet origin main 2>&1 | Out-Null
        git rebase --quiet --autostash FETCH_HEAD 2>&1 | Out-Null
        $rebaseOk = $LASTEXITCODE -eq 0
        Restore-Scratch $scratch
        if (-not $rebaseOk) {
            # Abort only a rebase that is actually running. Calling it blindly is what made the
            # 1 Sep failures unreadable: the rebase had finished, so this reported nothing and
            # cleaned nothing while the log said "rebase failed".
            if (Test-Path (Join-Path $Repo '.git/rebase-merge')) { git rebase --abort 2>&1 | Out-Null }
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

# A cycle must never walk away from a half-merged working tree. Both 1 Sep failures left one, and
# both sat there unnoticed until something unrelated tripped over it hours later — a corrupt
# prices.json is invisible until someone parses it. Checked after every Publish, because silence
# is exactly what a healthy Publish also looks like.
function Assert-Merged($what) {
    if (git ls-files --unmerged) {
        Note "$what LEFT UNMERGED PATHS - the working tree is broken:"
        foreach ($f in (git diff --name-only --diff-filter=U)) { Note "    $f" }
        Note '  fix with: git checkout HEAD -- <files>, then rerun. Stopping rather than building on it.'
        exit 1
    }
}

# Is a lane due? Derived from the newest dated artifact it writes, never from a state file somebody
# has to keep in step — the artifact IS the record that the lane ran (A20). No artifact means it has
# never run, or its last run failed before writing, and either way it is due.
#
# Cadence exists because lane cost is dominated by INPUT, not by how much there is to do: a run
# reloads prices, signals, earnings, holdings and its whole brief across a dozen turns whatever it
# finds. On gpt-6-astra each lane run is ~4-5% of the weekly allowance, so frequency IS the budget.
# Which model each lane runs on. The expensive one only where the reasoning is the product.
#
# Measured 11 Sep, and it is the 5-HOUR window that binds rather than the weekly: an astra sweep
# takes ~41 points of a 100-point window and an astra deep dive 37-55 depending on how many names
# it has to research, so a full astra cycle needs 78-96 and whether it fits is close to a coin
# flip. That morning's cycle had a FRESH window (1%) and still died at the deep dive. The deep dive
# runs last, so it is always the lane that pays for what the others spent.
#
# A sol sweep is about 9 points, so this buys back ~32 points of every window. It costs nothing
# where it matters: the quality that justified astra came entirely from the deep dive - RELX moving
# from `financial` to `secular`, Rule 5 engaging, T2 caught on INTU. The Sweep finds names and the
# Review reads records; neither turned in anything astra-shaped.
#
# Review is on sol for the same reason as the Sweep, though Leo named only the other two: leaving it
# on astra would put review+sweep+deepdive back over one window on the days all three are due.
$LANE_MODEL = @{
    'pot/brief-review.md'   = 'gpt-5.6-sol'
    'pot/brief-sweep.md'    = 'gpt-5.6-sol'
    'pot/brief-deepdive.md' = 'gpt-6-astra'
}

# What a lane costs, in points of each window. Measured, per model, from pot/runs.md and the
# rate_limit records in the session logs — see pot-design.md §4.2.
#
#   5-hour   astra sweep 41, astra deepdive 37-55, astra review 27; sol runs about a quarter of that
#   weekly   astra 4/5/5 per lane; sol 1/2/2
#
# The deep dive's range is real variance, not drift: its token count runs 2.75M-5.19M depending on
# how many names need researching. The HIGH end is used here on purpose — a cycle that starts is
# worth finishing, and the failure this exists to prevent is spending the cheap lanes and then
# dying on the expensive one.
$LANE_COST = @{
    'gpt-6-astra'  = @{ review = @{ w = 4; h = 27 }; sweep = @{ w = 5; h = 41 }; deepdive = @{ w = 5; h = 55 } }
    'gpt-5.6-sol'  = @{ review = @{ w = 1; h = 9 };  sweep = @{ w = 2; h = 9 };  deepdive = @{ w = 2; h = 14 } }
}

# Current allowance, read from the newest session log rather than by probing — a probe costs tokens
# to ask whether we can afford tokens.
#
# `resets_at` is what makes this reliable: a reading is only true until its window resets, and
# ignoring that is how a 98% reading got mistaken for "exhausted" when the window had turned over
# ten hours earlier. Past its reset, a window is 0 whatever the file says.
function Get-Allowance {
    $dir = Join-Path $env:USERPROFILE '.codex\sessions'
    $newest = Get-ChildItem $dir -Recurse -Filter 'rollout-*.jsonl' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $newest) { return $null }                       # never run: nothing to go on, proceed
    $text = Get-Content $newest.FullName -Raw -ErrorAction SilentlyContinue
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $read = {
        param($which)
        $m = [regex]::Matches($text, '"' + $which + '":\{"used_percent":([0-9.]+),"window_minutes":([0-9]+),"resets_at":([0-9]+)')
        if (-not $m.Count) { return $null }
        $last = $m[$m.Count - 1]
        if ([int64]$last.Groups[3].Value -le $now) { return 0.0 }   # window has since reset
        return [double]$last.Groups[1].Value
    }
    return @{ hour5 = (& $read 'primary'); weekly = (& $read 'secondary') }
}

# Refuse to start a cycle that cannot finish. The failure this prevents is specific and had
# happened three times by 11 Sep: the cheap lanes run and commit, the deep dive hits the wall, and
# the cycle stops before stamp-and-bundle — so the allowance is spent and no proposal exists.
# Note() writes to the output stream, so every note inside a function becomes part of its RETURN
# value — `$ok = Test-Allowance ...` then captures @('...', $false), and a two-element array is
# TRUE. That is exactly the bug that made every Lane-Due gate pass on 8 Sep, reintroduced here
# three days later while writing the function whose whole job is to refuse. Every Note in a
# value-returning function goes to Out-Null; the log line still lands via Add-Content inside Note.
function Test-Allowance($lanes) {
    $a = Get-Allowance
    if ($null -eq $a -or $null -eq $a.weekly) { Note '  allowance unknown - proceeding'; return $true }
    $w = 0; $h = 0
    foreach ($l in $lanes) {
        $model = $LANE_MODEL["pot/brief-$l.md"]
        $c = $LANE_COST[$model][$l]
        if (-not $c) { continue }
        $w += $c.w; $h += $c.h
    }
    Note ("  allowance: 5-hour {0}% used, weekly {1}% used; this cycle needs ~{2} and ~{3}" -f `
        $a.hour5, $a.weekly, $h, $w) | Out-Null
    $short = @()
    if ($a.hour5 + $h -gt 100) { $short += ("5-hour ({0}% + {1} > 100)" -f $a.hour5, $h) }
    if ($a.weekly + $w -gt 100) { $short += ("weekly ({0}% + {1} > 100)" -f $a.weekly, $w) }
    if (-not $short.Count) { return $true }
    Note ("  NOT ENOUGH ALLOWANCE - skipping this cycle: " + ($short -join '; ')) | Out-Null
    Note '  nothing was run and nothing was spent. The next cycle after the window resets will proceed.' | Out-Null
    return $false
}

# The agent each lane runs on, and what it falls back to when the ChatGPT allowance runs out.
#
# Codex by default. The Deep dive is the ONLY lane that fails over, for two reasons: it is the only
# lane that produces an order, so it is the one worth rescuing; and it is the expensive one, so
# moving it is what actually buys the room. If a sol sweep at ~2 points cannot be afforded the week
# is over regardless, and failing that over would spend a second subscription to little end.
$CLAUDE_MODEL = 'opus'
$FAILOVER_LANE = 'deepdive'

# Decide which agent each lane runs on, or $null to skip the cycle entirely.
#
# Priced on the Codex side only. **The failover is blind**: the Claude CLI exposes no usage or
# limit surface, so there is no way to ask whether Opus can afford this before starting. If it
# cannot the lane fails as it would have anyway, which is no worse than not trying.
function Resolve-Plan($lanes) {
    $plan = @{}
    foreach ($l in $lanes) { $plan[$l] = 'codex' }
    if (Test-Allowance $lanes) { return $plan }
    if ($lanes -notcontains $FAILOVER_LANE) {
        Note '  no lane can fail over - skipping this cycle' | Out-Null
        return $null
    }
    # Re-price without the deep dive: the cheap lanes still have to fit on Codex.
    $rest = @($lanes | Where-Object { $_ -ne $FAILOVER_LANE })
    if ($rest.Count -and -not (Test-Allowance $rest)) {
        Note '  even without the deep dive this cycle does not fit - skipping' | Out-Null
        return $null
    }
    $plan[$FAILOVER_LANE] = 'claude'
    Note ("  ChatGPT allowance is short, so the deep dive runs on Claude $CLAUDE_MODEL instead") | Out-Null
    Note '  (Claude exposes no usage figure, so this is not checked - it may fail for the same reason)' | Out-Null
    return $plan
}

function Lane-Due($dir, $everyDays) {
    # The directory names the lane: pot/reviews -> review, pot/sweeps -> sweep, pot/proposals -> deepdive.
    $lane = @{ 'pot/reviews' = 'review'; 'pot/sweeps' = 'sweep'; 'pot/proposals' = 'deepdive' }[$dir]
    if ($Force -contains 'all' -or ($lane -and $Force -contains $lane)) {
        Note "  $dir forced" | Out-Null
        return $true
    }
    $last = Get-ChildItem (Join-Path $Repo $dir) -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { if ($_.BaseName -match '^(\d{4}-\d{2}-\d{2})') {
            [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null) } } |
        Sort-Object -Descending | Select-Object -First 1
    if (-not $last) { return $true }
    if (((Get-Date).Date - $last).Days -ge $everyDays) { return $true }
    # Note() calls Write-Output, and in PowerShell ANY uncaptured output becomes part of a
    # function's return value. Calling it plainly here made Lane-Due return @("...", $false) —
    # a two-element array, which `if (...)` treats as TRUE. Every gate passed, every lane ran
    # regardless of cadence, and the 8 Sep 06:30 cycle blew the 5-hour window and died at the
    # deep dive. The dry-run that "verified" this printed `... False` and I read the note and
    # the value as two lines instead of one array. Out-Null keeps the log line and drops the
    # pipeline output; Add-Content inside Note still writes the file.
    Note ("  $dir not due - last ran {0}, next due {1}" -f `
        $last.ToString('yyyy-MM-dd'), $last.AddDays($everyDays).ToString('yyyy-MM-dd')) | Out-Null
    return $false
}

function Invoke-Lane($brief) {
    Note "--- $brief"
    # The plan decides the agent; the agent decides which model name is meaningful. Passing a
    # gpt-* name to Claude, or the reverse, is the obvious way to get this subtly wrong.
    $lane = ($brief -replace '.*brief-', '') -replace '.md$', ''
    $laneAgent = if ($PLAN[$lane]) { $PLAN[$lane] } else { 'codex' }
    $laneModel = if ($laneAgent -eq 'claude') { $CLAUDE_MODEL }
        elseif ($Model) { $Model } else { $LANE_MODEL[$brief] }
    Note "    agent: $laneAgent, model: $laneModel" | Out-Null
    $laneArgs = @{ Brief = $brief; Repo = $Repo; Model = $laneModel; Agent = $laneAgent }
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

        Assert-Merged 'scan'
    } else { Note 'scan found nothing new to commit' }

    # ---- 2. Review, and it runs BEFORE the Sweep on purpose (pot-design §2). An agent that has
    # just spent an hour finding exciting new names is not the right agent to judge the thesis it
    # wrote last month. Judge first, discover afterwards.
    # Every 2 days, not every cycle. The ordering above is right and the frequency was not: the lane
    # costs ~4% of the weekly allowance per run because 99.5% of its tokens are INPUT — it reloads
    # prices, signals, earnings, holdings and the whole brief on 14 turns to write 6,000 tokens of
    # judgement. That cost does not fall with an empty book, and at 17 cycles a week it was 68% of
    # the allowance to re-read the same 35 open drafts three times a day and report, correctly,
    # that nothing had changed since breakfast. The review dates it checks against are months out.
    #
    # Due-ness is DERIVED from the newest file in pot/reviews/, not from a state file somebody has
    # to keep in step: the artifact IS the record that the lane ran (A20).
    # Decide the WHOLE plan before running any of it, so the cost can be priced up front. Lane-Due
    # only reads filenames, so asking all three here is free and the answers cannot drift.
    $doReview = Lane-Due 'pot/reviews' 2
    $doSweep = Lane-Due 'pot/sweeps' 1
    $doDeep = $doSweep -or $Force -contains 'deepdive' -or $Force -contains 'all'
    $planned = @()
    if ($doReview) { $planned += 'review' }
    if ($doSweep) { $planned += 'sweep' }
    if ($doDeep) { $planned += 'deepdive' }
    $PLAN = @{}
    if ($planned.Count) {
        $PLAN = Resolve-Plan $planned
        if ($null -eq $PLAN) {
            Remove-Item $lock -Force -ErrorAction SilentlyContinue
            exit 4
        }
    }

    if ($doReview) { Invoke-Lane 'pot/brief-review.md' } else { Note 'review not due' }

    # ---- 3. Sweep. Deliberately before the Scan is refreshed: it is meant to look OUTSIDE
    # what we already track (A14-A16), and it writes any new name into watchlist.json.
    # Daily. The Sweep is not idle the way the review was - 48 names over 27 runs - but the
    # constraint is downstream: the watchlist is 70 names, the last deep dive ranked 23, and 7
    # names have ever been proposed. Adding more names faster does not produce more proposals, it
    # grows a backlog nothing reads.
    $sweptThisCycle = $false
    if ($doSweep) { Invoke-Lane 'pot/brief-sweep.md'; $sweptThisCycle = $true }
    else { Note 'sweep not due' }

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

        Assert-Merged 'scan'
    }

    # ---- 6. Deep dive, the only lane that may produce an order.
    # Once a DAY, not once a cycle: the lane always writes a dated file - a proposal, or the
    # "-none" report when it declines to buy - so pot/proposals is a complete record of when it
    # last ran, and 'no order' costs the same allowance as an order.
    # Paired to the Sweep, not gated on its own calendar. The two belong together: step 5 above
    # exists solely to give the Sweep's new names local data BEFORE this lane judges them, and
    # dating them separately let the Sweep run at 06:30 while the Deep dive waited for tomorrow,
    # so a candidate found today would be ranked against yesterday's data by a run that never saw
    # the sweep that found it. Sweep cadence therefore sets Deep dive cadence - both daily.
    # Forcing the deep dive alone is legitimate: it judges the newest sweep's output, which is what
    # a rerun after a failed cycle needs. The pairing still governs the UNFORCED path.
    if ($doDeep) {
        Invoke-Lane 'pot/brief-deepdive.md'
    } else { Note 'deep dive skipped - no sweep ran this cycle' }

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

        Assert-Merged 'stamps and bundle'
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
