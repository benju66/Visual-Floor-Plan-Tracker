<#
Restarts the SitePulse local dev servers (frontend on :3010, backend on :8001).

Kills anything bound to those ports AND any orphaned uvicorn --reload worker
processes (Python `multiprocessing spawn_main` children) that keep the port
alive after their parent reloader is killed -- on Windows these workers
inherit the listening socket and Get-NetTCPConnection keeps reporting the
dead parent PID as the owner, so a plain "kill what netstat shows" miss it.
#>

param(
    [int]$FrontendPort = 3010,
    [int]$BackendPort = 8001
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Stop-PortOwner {
    param([int]$Port)
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            Write-Host "Killing PID $procId listening on port $Port"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Stop-OrphanedMultiprocessingWorkers {
    # Catches python "multiprocessing.spawn" children left behind when only
    # the uvicorn --reload parent (reloader) was killed.
    $orphans = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -match 'multiprocessing\.spawn' }
    foreach ($orphan in $orphans) {
        Write-Host "Killing orphaned multiprocessing worker PID $($orphan.ProcessId)"
        Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "== Stopping frontend (port $FrontendPort) =="
Stop-PortOwner -Port $FrontendPort

Write-Host "== Stopping backend (port $BackendPort) =="
Stop-PortOwner -Port $BackendPort
Stop-OrphanedMultiprocessingWorkers

Start-Sleep -Seconds 1

$stillUp = @($FrontendPort, $BackendPort) | Where-Object {
    Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
}
if ($stillUp) {
    Write-Warning "Ports still occupied after cleanup: $($stillUp -join ', ')"
}

Write-Host "== Starting backend on port $BackendPort =="
$env:FRONTEND_URL = "http://localhost:$FrontendPort"
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$repoRoot\sitepulse-backend'; `$env:FRONTEND_URL='http://localhost:$FrontendPort'; & '$repoRoot\venv\Scripts\uvicorn.exe' main:app --reload --port $BackendPort"
)

Write-Host "== Starting frontend on port $FrontendPort =="
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$repoRoot\sitepulse-next'; npm run dev:3010"
)

Write-Host "Done. Frontend -> http://localhost:$FrontendPort  Backend -> http://localhost:$BackendPort"