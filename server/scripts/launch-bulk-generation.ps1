# Launch multiple bulk article generation workers in parallel
# Usage: .\scripts\launch-bulk-generation.ps1 -NumWorkers 15
# Or: .\scripts\launch-bulk-generation.ps1

param(
    [int]$NumWorkers = 15
)

$LogDir = "logs"
$WorkerScript = "workers/bulk-subcategory-generation.js"

# Create logs directory
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Launching $NumWorkers bulk generation workers" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Get API key from environment or .env
if (-not $env:ANTHROPIC_API_KEY) {
    # Try to load from .env
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match '^\s*ANTHROPIC_API_KEY\s*=\s*(.+)$') {
                $env:ANTHROPIC_API_KEY = $matches[1]
            }
        }
    }
}

if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host "ERROR: ANTHROPIC_API_KEY not set in environment or .env file" -ForegroundColor Red
    exit 1
}

$env:DB_HOST = $env:DB_HOST ?? "localhost"
$env:DB_PORT = $env:DB_PORT ?? "5433"
$env:DB_NAME = $env:DB_NAME ?? "jubileeverse"
$env:DB_USER = $env:DB_USER ?? "postgres"
$env:DB_PASSWORD = $env:DB_PASSWORD ?? ""

# Start workers
$processes = @()
for ($i = 1; $i -le $NumWorkers; $i++) {
    Write-Host "Starting worker $i of $NumWorkers..." -ForegroundColor Green

    $logFile = Join-Path $LogDir "worker-$i.log"
    $proc = Start-Process -FilePath "node" `
                         -ArgumentList $WorkerScript `
                         -RedirectStandardOutput $logFile `
                         -RedirectStandardError $logFile `
                         -WindowStyle Hidden `
                         -PassThru `
                         -EnvironmentVariables @{
                             WORKER_ID = "worker-$i"
                             ANTHROPIC_API_KEY = $env:ANTHROPIC_API_KEY
                             DB_HOST = $env:DB_HOST
                             DB_PORT = $env:DB_PORT
                             DB_NAME = $env:DB_NAME
                             DB_USER = $env:DB_USER
                             DB_PASSWORD = $env:DB_PASSWORD
                         }

    $processes += $proc
    Start-Sleep -Milliseconds 1000
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Launched $NumWorkers workers" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Monitor progress with:" -ForegroundColor Yellow
Write-Host "  Get-Content -Path logs/bulk-subcategory-generation.log -Wait" -ForegroundColor Gray
Write-Host ""
Write-Host "Monitor individual workers with:" -ForegroundColor Yellow
Write-Host "  Get-Content -Path logs/worker-1.log -Wait" -ForegroundColor Gray
Write-Host "  Get-Content -Path logs/worker-2.log -Wait" -ForegroundColor Gray
Write-Host ""
Write-Host "Wait for all workers to complete..." -ForegroundColor Yellow

# Wait for all processes
$processes | ForEach-Object {
    $_.WaitForExit()
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "All workers completed!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
