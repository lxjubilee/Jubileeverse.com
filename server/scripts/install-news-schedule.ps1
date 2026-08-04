<#
  install-news-schedule.ps1 — register the daily news pipeline with Task Scheduler.

  Four runs a day, six hours apart, each publishing up to -MaxNew articles and
  stopping once the day's -Target is met:

    00:00  06:00  12:00  18:00   (local time)

  Why four runs rather than one: a news site that publishes its whole day at
  02:00 is stale by lunchtime. Spreading the same 60 articles across the day
  means the top of the feed is never more than six hours old.

  Why the two limits are separate: -Target is the DAY total and -MaxNew is the
  per-RUN cap. Neither expresses the schedule alone. With only -Target 15 the
  first run publishes 15 and the other three find the target met and do nothing;
  with only -Target 60 there is no per-run cap and the first run tries to
  publish the whole day. The pipeline takes both and uses
  min(maxNew, target - alreadyPublishedToday).

  A missed run is not made up for. The next run still caps at -MaxNew, so a
  failed 06:00 means the day ends at 45 rather than 60. That is deliberate: a
  catch-up run would double both the load on the outlets we source from and the
  model spend, at the exact moment something is already wrong.

  Once the day's target is met, a run publishes no new stories — it only
  re-resolves pictures for articles an earlier run could not illustrate.
  Skip-if-present makes a no-op run cost almost nothing.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\install-news-schedule.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install-news-schedule.ps1 -Target 60 -MaxNew 15
    powershell -ExecutionPolicy Bypass -File scripts\install-news-schedule.ps1 -Remove

  Re-run this after changing -Target or -MaxNew: the task stores the arguments,
  so an already-registered task keeps publishing the counts it was registered
  with. (The live task was registered at --target 30 long after the code default
  moved to 60, and stayed there.)

  RUN THIS ON THE PIPELINE HOST. The task's paths are local to the machine that
  owns them — the repo lives at D:\Shares\Websites\jubileeverse.com there and is
  merely mapped elsewhere — so registering it from a workstation would point the
  action at paths that host cannot see.

  -RunAs defaults to Preserve, which keeps whatever principal the existing task
  already uses. Changing the security context of a working production task is
  something you have to ask for by name.

  Safety: the new definition is proven under a staging name, the current task is
  exported as a rollback point, and only then is the live task UPDATED IN PLACE
  with Set-ScheduledTask. It is never unregistered first. An earlier version did
  delete-then-create, and a malformed argument left the machine with no
  scheduled task at all until someone noticed.

  KEEP EVERY STRING LITERAL IN THIS FILE ASCII-ONLY. The file has no BOM, so
  Windows PowerShell 5.1 decodes it as Windows-1252, where the third byte of a
  UTF-8 em dash becomes a curly close-quote - which PowerShell honours as a
  string delimiter. One em dash inside a -Description ended the string early,
  turned the rest of the line into code, and made the whole script unparseable.
  Non-ASCII inside a # comment is harmless, because a comment ends at the line
  break either way; inside quotes it is fatal and silent.
#>
param(
  [string]$TaskName = 'JubileeVerse Daily News',
  [int]$Target = 60,
  [int]$MaxNew = 15,
  [string[]]$RunAt = @('00:00', '06:00', '12:00', '18:00'),
  [ValidateSet('Preserve', 'System', 'CurrentUser')]
  [string]$RunAs = 'Preserve',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$serverDir = Split-Path -Parent $PSScriptRoot
$script    = Join-Path $serverDir 'scripts\publish-daily-news.js'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed scheduled task '$TaskName'."
  } else {
    Write-Output "No scheduled task named '$TaskName'."
  }
  return
}

if (-not (Test-Path $script)) { throw "Cannot find $script" }
if ($MaxNew -lt 1)   { throw "-MaxNew must be at least 1" }
if ($Target -lt $MaxNew) { throw "-Target ($Target) is below -MaxNew ($MaxNew); the later runs would never publish" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH; install Node or run this from a shell that has it.' }

# Working directory must be the server folder so the script finds .env and lib/.
$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$script`" --target $Target --max-new $MaxNew" `
  -WorkingDirectory $serverDir

# One trigger per slot rather than a -Once trigger with a repetition interval.
# The repeating form is anchored to the day it was registered, so it drifts
# relative to the PST day the pipeline partitions its folders by; fixed daily
# triggers stay put.
$triggers = @()
foreach ($at in $RunAt) { $triggers += New-ScheduledTaskTrigger -Daily -At $at }

# The pipeline's own --deadline is what should end a long run: it stops cleanly
# and leaves the day publishable. Task Scheduler's limit is the outer backstop
# and must stay clear of it, but also well inside the six-hour gap — a run still
# holding the single-writer lock when the next one fires costs a whole slot.
$limitHours = 2

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours $limitHours)

# Who the task runs as.
#
# Default is Preserve, and that default matters: this script unregisters and
# re-registers, so anything it does not deliberately carry over is silently
# rewritten. The live task runs as SYSTEM, while the obvious code here would
# have re-registered it S4U under whoever ran the installer — and an S4U
# principal has no network credentials, which for a pipeline whose entire job
# is fetching RSS feeds and uploading to R2 is a broken task that still reports
# success. Changing the security context of a working production task is now
# something you have to ask for by name.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

# Resolve to three plain values first, and build the principal from them in one
# place afterwards. A `switch` used as an expression returns EVERYTHING the
# chosen branch emits, so a stray Write-Output inside a branch silently makes
# $principal an array — which Register-ScheduledTask rejects only after the old
# task has already been unregistered, leaving no scheduled task at all.
$userId = 'SYSTEM'; $logon = 'ServiceAccount'; $level = 'Highest'
$note = ''

if ($RunAs -eq 'CurrentUser') {
  $userId = "$env:USERDOMAIN\$env:USERNAME"; $logon = 'S4U'; $level = 'Limited'
} elseif ($RunAs -eq 'Preserve' -and $existing) {
  $userId = $existing.Principal.UserId
  $logon  = $existing.Principal.LogonType
  $level  = $existing.Principal.RunLevel
  $note   = "Preserving the existing principal: $userId ($logon, $level)"
}
# Otherwise SYSTEM: what this pipeline has always run as in practice, and the
# one principal guaranteed to hold the network access the run needs.

if ($note) { Write-Output $note }
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType $logon -RunLevel $level

$runsPerDay = $RunAt.Count
$description = "Publishes up to $MaxNew faith-based news articles per run, $runsPerDay times a day (up to $Target/day), each with the original news image from its source outlet, to Cloudflare R2."

# ── Read back and check, rather than trusting the write ──────────────────────

<#
  .SYNOPSIS
    Assert a registered task really is the one we meant to create.

  Reads the task back out of the scheduler instead of inspecting the objects we
  passed in. A malformed argument is accepted by the cmdlet and only becomes
  visible in what actually got stored — which is precisely the failure this
  whole rewrite exists to survive.
#>
function Test-NewsTask {
  param([string]$Name, [string]$ExpectedArgs, [string]$ExpectedDir, [string]$ExpectedUser, [int]$ExpectedTriggers)

  $problems = @()
  $t = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $t) { return @("task '$Name' is not registered") }

  if (@($t.Actions).Count -ne 1) {
    $problems += "expected 1 action, found $(@($t.Actions).Count)"
  } else {
    $a = $t.Actions[0]
    if ($a.Arguments -ne $ExpectedArgs) { $problems += "arguments are '$($a.Arguments)', expected '$ExpectedArgs'" }
    if ($a.WorkingDirectory -ne $ExpectedDir) { $problems += "working directory is '$($a.WorkingDirectory)', expected '$ExpectedDir'" }
    if (-not (Test-Path $a.Execute)) { $problems += "executable '$($a.Execute)' does not exist" }
  }

  $trig = @($t.Triggers)
  if ($trig.Count -ne $ExpectedTriggers) { $problems += "expected $ExpectedTriggers triggers, found $($trig.Count)" }
  # The hourly top-up lived in a repetition interval. Its absence is the whole
  # point of the new cadence, so it is asserted rather than assumed.
  $repeating = @($trig | Where-Object { $_.Repetition.Interval })
  if ($repeating.Count) { $problems += "$($repeating.Count) trigger(s) still carry a repetition interval" }
  $disabled = @($trig | Where-Object { -not $_.Enabled })
  if ($disabled.Count) { $problems += "$($disabled.Count) trigger(s) are disabled" }

  if ($t.Principal.UserId -notlike "*$ExpectedUser*") {
    $problems += "principal is '$($t.Principal.UserId)', expected '$ExpectedUser'"
  }
  if ($t.Settings.MultipleInstances -ne 'IgnoreNew') {
    $problems += "multiple-instance policy is '$($t.Settings.MultipleInstances)', expected IgnoreNew"
  }
  return $problems
}

$expectedArgs = "`"$script`" --target $Target --max-new $MaxNew"

# ── 1. Prove the definition registers, on a name nothing depends on ──────────
#
# Task Scheduler will not hold two tasks under one name, so the definition is
# proven under a staging name first. Registered DISABLED: it carries the real
# triggers, and a staging copy that fired would run the pipeline twice.
$stagingName = "$TaskName (staging)"
if (Get-ScheduledTask -TaskName $stagingName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $stagingName -Confirm:$false
}

$stagingSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours $limitHours) `
  -Disable

try {
  Register-ScheduledTask `
    -TaskName $stagingName `
    -Action $action `
    -Trigger $triggers `
    -Settings $stagingSettings `
    -Principal $principal `
    -Description "STAGING VALIDATION - safe to delete. $description" -ErrorAction Stop | Out-Null
} catch {
  throw "The new definition could not be registered, so '$TaskName' was left untouched. $($_.Exception.Message)"
}

$stagingProblems = Test-NewsTask -Name $stagingName -ExpectedArgs $expectedArgs `
  -ExpectedDir $serverDir -ExpectedUser $userId -ExpectedTriggers $runsPerDay
Unregister-ScheduledTask -TaskName $stagingName -Confirm:$false

if ($stagingProblems.Count) {
  throw ("The new definition failed validation, so '$TaskName' was left untouched:`n  - " +
         ($stagingProblems -join "`n  - "))
}
Write-Output "Validated the new definition under '$stagingName' (now removed)."

# ── 2. Keep a rollback point ─────────────────────────────────────────────────
$backup = $null
if ($existing) {
  try {
    $backup = Join-Path $serverDir ("logs\news\task-backup-{0}.xml" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $backup) | Out-Null
    [System.IO.File]::WriteAllText($backup, (Export-ScheduledTask -TaskName $TaskName))
    Write-Output "Backed the current task up to $backup"
  } catch {
    $backup = $null
    Write-Warning "Could not export a backup of the existing task: $($_.Exception.Message)"
  }
}

# ── 3. Apply — updating in place, never deleting first ───────────────────────
#
# Set-ScheduledTask replaces the definition of a task that keeps existing
# throughout. The earlier unregister-then-register left no task at all for the
# few minutes between the two, and when the register failed it left none
# permanently. There is no window here: the task is either the old definition
# or the new one.
if ($existing) {
  try {
    Set-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $triggers `
      -Settings $settings `
      -Principal $principal -ErrorAction Stop | Out-Null

    # The description is a second call on purpose. Set-ScheduledTask has no
    # -Description parameter, and piping the task object to set it selects the
    # -InputObject parameter set, which cannot also take -Action. Left alone,
    # the description keeps advertising whatever counts first registered the
    # task, which is exactly the sort of quiet drift this script exists to stop.
    $live = Get-ScheduledTask -TaskName $TaskName
    if ($live.Description -ne $description) {
      $live.Description = $description
      $live | Set-ScheduledTask -ErrorAction Stop | Out-Null
    }
  } catch {
    throw "Updating '$TaskName' failed; it still holds its previous definition. $($_.Exception.Message)"
  }
} else {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description $description | Out-Null
}

# ── 4. Check what is actually live, and roll back if it is wrong ─────────────
$liveProblems = Test-NewsTask -Name $TaskName -ExpectedArgs $expectedArgs `
  -ExpectedDir $serverDir -ExpectedUser $userId -ExpectedTriggers $runsPerDay

if ($liveProblems.Count) {
  if ($backup) {
    Write-Warning "The live task failed validation; restoring from $backup"
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    Register-ScheduledTask -TaskName $TaskName -Xml ([System.IO.File]::ReadAllText($backup)) -Force | Out-Null
  }
  throw ("'$TaskName' did not validate after the update:`n  - " + ($liveProblems -join "`n  - "))
}

Write-Output "Registered '$TaskName'"
Write-Output "  node     : $node"
Write-Output "  script   : $script"
Write-Output "  schedule : $($RunAt -join ', ')  ($runsPerDay runs/day)"
Write-Output "  per run  : up to $MaxNew new articles"
Write-Output "  per day  : up to $Target articles"
Write-Output "  runs as  : $($principal.UserId) ($($principal.LogonType), $($principal.RunLevel))"
Write-Output "  max run  : $limitHours h (task limit; the pipeline's own deadline ends work sooner)"
Write-Output ""
Write-Output "Verify : Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Output "Run now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Remove : powershell -File scripts\install-news-schedule.ps1 -Remove"
