<#
Creates Windows Scheduled Tasks for cron/worker replacement of MySQL EVENTS.

Tasks created:
1) 3D1.2_AcademicAttendanceWorker
   - Starts at boot
   - Runs continuously every 5 seconds (inside PHP worker loop)
2) 3D1.2_DailyAcademicUpdate
   - Runs daily at 00:05 as safety fallback

Run in elevated PowerShell:
  powershell -ExecutionPolicy Bypass -File .\server-php\scripts\create_cron_worker_tasks.ps1
#>

param(
    [string]$PhpExe = "C:\xampp\php\php.exe",
    [string]$RunAsUser = "SYSTEM",
    [string]$DailyTime = "00:05"
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerScript = Join-Path $scriptDir "academic-attendance-worker.php"
$dailyScript = Join-Path $scriptDir "daily-academic-update.php"

$workerTask = "3D1.2_AcademicAttendanceWorker"
$dailyTask = "3D1.2_DailyAcademicUpdate"
$legacyTask = "3DSchool_GenerateAttendance"

Write-Host "PHP executable: $PhpExe"
Write-Host "Worker script: $workerScript"
Write-Host "Daily script : $dailyScript"
Write-Host "Run as user  : $RunAsUser"
Write-Host "Daily time   : $DailyTime"

if (-not (Test-Path $PhpExe)) {
    Write-Host "ERROR: PHP executable not found: $PhpExe" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $workerScript)) {
    Write-Host "ERROR: Worker script not found: $workerScript" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $dailyScript)) {
    Write-Host "ERROR: Daily script not found: $dailyScript" -ForegroundColor Red
    exit 1
}

# Build command lines. Use cmd /c so schtasks handles quoting reliably.
$workerCmd = "cmd /c `"$PhpExe`" `"$workerScript`" --interval=5"
$dailyCmd = "cmd /c `"$PhpExe`" `"$dailyScript`""

Write-Host ""
Write-Host "Removing legacy task (if present): $legacyTask"
cmd /c "schtasks /Query /TN `"$legacyTask`" >nul 2>&1"
if ($LASTEXITCODE -eq 0) {
    schtasks /Delete /TN $legacyTask /F | Out-Null
    Write-Host "Removed legacy task: $legacyTask"
} else {
    Write-Host "Legacy task not found. Skipping."
}

Write-Host ""
Write-Host "Creating/Updating task: $workerTask"
schtasks /Create /TN $workerTask /TR $workerCmd /SC ONSTART /RU $RunAsUser /RL HIGHEST /F | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to create $workerTask" }

Write-Host ""
Write-Host "Creating/Updating task: $dailyTask"
schtasks /Create /TN $dailyTask /TR $dailyCmd /SC DAILY /ST $DailyTime /RU $RunAsUser /RL HIGHEST /F | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to create $dailyTask" }

Write-Host ""
Write-Host "Applying robust task settings..."
$workerSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
Set-ScheduledTask -TaskName $workerTask -Settings $workerSettings | Out-Null

$dailySettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
Set-ScheduledTask -TaskName $dailyTask -Settings $dailySettings | Out-Null

Write-Host ""
Write-Host "Stopping stale worker instances..."
schtasks /End /TN $workerTask 2>$null | Out-Null
$staleWorkers = Get-CimInstance Win32_Process -Filter "Name='php.exe'" | Where-Object {
    $_.CommandLine -like "*academic-attendance-worker.php*"
}
foreach ($proc in $staleWorkers) {
    try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Write-Host "Stopped stale worker PID: $($proc.ProcessId)"
    } catch {
        Write-Host "Could not stop PID $($proc.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Starting worker task now..."
schtasks /Run /TN $workerTask | Out-Host

Write-Host ""
Write-Host "Done. Tasks are configured and worker was started." -ForegroundColor Green
Write-Host "Verify with:"
Write-Host "  schtasks /Query /TN $workerTask /V /FO LIST"
