<#
  install-news-schedule.ps1 — register the daily news pipeline with Task Scheduler.

  The pipeline renders images on the RTX 5090s at 10.0.0.52, which are LAN-only.
  UAT (207.244.228.8) and production (94.72.120.231) cannot reach them, so this
  is a scheduled task on a LAN host rather than a tick inside server.js. Those
  VPSes only read the finished result from cdn.jubileeverse.com.

  Two triggers, both running the same command:

    02:00 local  the main run. Publishes the day's articles and images.
    hourly       top-up. Once the article target is met the run publishes no
                 new stories; it only fills in images an earlier run could not
                 finish (busy GPU, deadline, scanner offline). Skip-if-present
                 makes a no-op run cost almost nothing, and it means one bad
                 night is not a lost day.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\install-news-schedule.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install-news-schedule.ps1 -Target 60
    powershell -ExecutionPolicy Bypass -File scripts\install-news-schedule.ps1 -Remove

  Re-run this after changing -Target: the task stores the argument, so an
  already-registered task keeps publishing the count it was registered with.

  The task runs as the current user so it inherits the network drive and the
  WinRM rights the safety scanner needs. Register it while logged in as the
  account that will own it.
#>
param(
  [string]$TaskName = 'JubileeVerse Daily News',
  [int]$Target = 60,
  [string]$DailyAt = '02:00',
  [switch]$NoHourlyTopUp,
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

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH; install Node or run this from a shell that has it.' }

# -NoLogo keeps the task history readable. Working directory must be the server
# folder so the script finds .env and lib/.
$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$script`" --target $Target" `
  -WorkingDirectory $serverDir

$triggers = @( New-ScheduledTaskTrigger -Daily -At $DailyAt )

if (-not $NoHourlyTopUp) {
  # Repeat every hour for a day, starting an hour after the main run. The
  # pipeline's own target check makes these cheap no-ops once the day is full.
  $topUp = New-ScheduledTaskTrigger -Once -At ([datetime]::Today.AddHours(3)) `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 23)
  $triggers += $topUp
}

# The pipeline's own --deadline (3 min/article, so 3h at a 60-article target)
# is what should end a long run: it abandons the remaining image wave cleanly
# and leaves the day publishable. Task Scheduler's limit is the outer backstop
# and must stay clear of it, or a healthy run gets killed mid-upload.
$limitHours = [Math]::Max(3, [Math]::Ceiling($Target * 3 / 60.0) + 2)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours $limitHours)

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description "Publishes ~$Target faith-based news articles and 3 AI images each to Cloudflare R2 daily. Hourly runs top up missing images only." | Out-Null

Write-Output "Registered '$TaskName'"
Write-Output "  node    : $node"
Write-Output "  script  : $script"
Write-Output "  target  : $Target articles/day"
Write-Output "  daily   : $DailyAt"
Write-Output "  max run : $limitHours h (task limit; the pipeline's own deadline ends work sooner)"
if (-not $NoHourlyTopUp) { Write-Output "  top-up  : hourly from 03:00 (images only once the target is met)" }
Write-Output ""
Write-Output "Verify : Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Output "Run now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Remove : powershell -File scripts\install-news-schedule.ps1 -Remove"
