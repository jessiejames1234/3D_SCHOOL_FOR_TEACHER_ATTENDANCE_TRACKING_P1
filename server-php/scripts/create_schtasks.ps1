<#
Deprecated wrapper kept for backward compatibility.

This script previously created a weekly task for generate-weekly-attendance.php.
The project now uses the worker-based task setup in create_cron_worker_tasks.ps1.
#>

param(
    [string]$PhpExe = "C:\xampp\php\php.exe",
    [string]$RunAsUser = "SYSTEM",
    [string]$DailyTime = "00:05"
)

$ErrorActionPreference = "Stop"

$newScript = Join-Path $PSScriptRoot "create_cron_worker_tasks.ps1"
if (-not (Test-Path $newScript)) {
    Write-Host "ERROR: Cannot find $newScript" -ForegroundColor Red
    exit 1
}

Write-Host "create_schtasks.ps1 is deprecated."
Write-Host "Running create_cron_worker_tasks.ps1 instead..."

& $newScript -PhpExe $PhpExe -RunAsUser $RunAsUser -DailyTime $DailyTime
exit $LASTEXITCODE
