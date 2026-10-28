[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$NoBrowser,
    [switch]$Lan
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$frontendDir = Join-Path $repoRoot 'frontend'
$runtimeLogs = Join-Path $repoRoot 'logs'
$frontendUrl = 'http://localhost:3000'
$bindAddress = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

function Get-Listener([int]$Port) {
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-Backend {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8600/api/health' -TimeoutSec 3
        return $health.status -eq 'ok'
    } catch { return $false }
}

function Test-Frontend {
    try {
        $page = Invoke-WebRequest "$frontendUrl/login" -UseBasicParsing -TimeoutSec 5
        return $page.StatusCode -eq 200 -and $page.Content -match 'Lab Server Control Center'
    } catch { return $false }
}

function Start-ServiceProcess([string]$Executable, [string[]]$Arguments, [string]$Directory, [string]$Name) {
    # Start-Process joins arguments into a Windows command line; quote paths with spaces explicitly.
    $quotedArguments = $Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $outFile = Join-Path $runtimeLogs "$Name-$stamp.log"
    $errFile = Join-Path $runtimeLogs "$Name-$stamp-error.log"
    $process = Start-Process -FilePath $Executable -ArgumentList $quotedArguments `
        -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    Write-Host "$Name started (PID $($process.Id)). Log: $outFile"
    return $process
}

function Wait-ServiceReady([System.Diagnostics.Process]$Process, [scriptblock]$Probe, [string]$Name) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        if (& $Probe) { return }
        $Process.Refresh()
        if ($Process.HasExited) { throw "$Name exited. See logs in $runtimeLogs" }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "$Name did not become ready within 90 seconds. It may still be starting; see $runtimeLogs"
}

try {
    $backendRunning = @(Get-Listener 8600).Count -gt 0
    $frontendRunning = @(Get-Listener 3000).Count -gt 0
    $nodePath = $null
    $pythonPath = Join-Path $backendDir '.venv\Scripts\python.exe'

    if ($backendRunning -and -not (Test-Backend)) {
        throw 'Port 8600 is occupied but the backend health check failed. No process was stopped.'
    }
    if (-not $backendRunning -and -not (Test-Path -LiteralPath $pythonPath)) {
        throw 'Backend environment missing. Run uv sync in the backend folder first.'
    }
    if (-not $frontendRunning) {
        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        if (-not (Test-Path -LiteralPath (Join-Path $frontendDir 'node_modules\next\package.json'))) {
            throw 'Frontend dependencies missing. Run npm install in the frontend folder first.'
        }
    }
    if ($frontendRunning -and -not (Test-Frontend)) {
        throw 'Port 3000 is occupied but does not respond as this app. No process was stopped.'
    }

    Write-Host "Backend: $(if ($backendRunning) { 'already running; keep existing connections' } else { 'ready to start' })"
    Write-Host "Frontend: $(if ($frontendRunning) { 'already running; will reuse' } else { 'ready to start' })"
    if ($CheckOnly) { Write-Host 'Check complete. No services were started or stopped.'; exit 0 }

    New-Item -ItemType Directory -Path $runtimeLogs -Force | Out-Null
    if (-not $backendRunning) {
        # No auto-reload: saving backend code must not unexpectedly terminate terminal sessions.
        $backendProcess = Start-ServiceProcess $pythonPath @('-m', 'uvicorn', 'app.main:app', '--host', $bindAddress, '--port', '8600') $backendDir 'backend'
        Wait-ServiceReady $backendProcess { Test-Backend } 'Backend'
    }
    if (-not $frontendRunning) {
        $frontendProcess = Start-ServiceProcess $nodePath @('scripts/serve.cjs', 'dev', '--hostname', $bindAddress) $frontendDir 'frontend'
        Wait-ServiceReady $frontendProcess { Test-Frontend } 'Frontend'
    } else {
        Write-Host 'Existing frontend was not restarted. Logging/filter changes take effect on its next restart.'
    }
    Write-Host "Ready: $frontendUrl"
    Write-Host "Access logs: $frontendDir\logs"
    if (-not $NoBrowser) { Start-Process $frontendUrl }
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
