# Launch 10-20 concurrent bulk article generation workers for JubileeVerse
# Windows PowerShell version

param(
    [int]$NumWorkers = 15
)

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LogsDir = Join-Path $ProjectRoot "logs"
$WorkerScript = Join-Path $ProjectRoot "workers" "bulk-subcategory-generation.js"

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

Write-Host "📦 Bulk Article Generation Worker Launcher"
Write-Host "==========================================="
Write-Host ""
Write-Host "Launching $NumWorkers workers..."
Write-Host "Logs will be saved to: $LogsDir"
Write-Host ""

$jobs = @()

for ($i = 1; $i -le $NumWorkers; $i++) {
    $LogFile = Join-Path $LogsDir "worker-$i.log"

    # Stagger startup by 100ms to avoid overload
    $DelayMs = ($i - 1) * 100

    Write-Host "Worker $i: Starting in ${DelayMs}ms (PID will be shown after start)..."

    # Start job in background
    $job = Start-Job -ScriptBlock {
        param($workingDir, $workerScript, $workerId, $logFile)

        Set-Location $workingDir

        # Add timestamp to log
        Add-Content -Path $logFile -Value "[$(Get-Date)] Worker $workerId starting..."

        # Run the worker
        & node $workerScript 2>&1 | Add-Content -Path $logFile
    } -ArgumentList $ProjectRoot, $WorkerScript, $i, $LogFile

    $jobs += $job
    Write-Host "Worker $i: Job ID=$($job.Id), log=$LogFile"
}

Write-Host ""
Write-Host "✓ Launched $NumWorkers workers"
Write-Host "Monitor progress:"
Write-Host "  Get-Content -Path logs\worker-1.log -Wait"
Write-Host ""
Write-Host "Waiting for all workers to complete..."

# Wait for all jobs to complete
$jobs | Wait-Job | Out-Null

Write-Host ""
Write-Host "✓ All workers completed!"
Write-Host ""
Write-Host "Summary:"
$jobs | ForEach-Object {
    $result = $_ | Receive-Job
    if ($result) {
        Write-Host "Job $($_.Id): Completed"
    }
}

# Cleanup
$jobs | Remove-Job
