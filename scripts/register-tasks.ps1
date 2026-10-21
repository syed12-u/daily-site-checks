<#
.SYNOPSIS
  Registers the Windows scheduled tasks for daily-site-checks on the always-on machine.

  - "DailySiteChecks Daily"   06:00 every day   -> node src/run-per-site.js (one Teams card per site)
  - "DailySiteChecks Hourly"  every hour        -> node src/uptime.js

  Run from an elevated PowerShell in the project folder:
    powershell -ExecutionPolicy Bypass -File scripts\register-tasks.ps1

  Remove with:  scripts\register-tasks.ps1 -Remove
  Notes:
  - Keep the project OUTSIDE OneDrive on the runner; Files On-Demand and sync
    conflicts break scheduled runs.
  - Tasks run as the current user with S4U logon (no stored password, runs when
    not logged in). Network HTTP access works; mapped drives do not.
#>
param(
  [switch]$Remove,
  [string]$DailyTime = '06:00',
  [string]$NodePath = (Get-Command node).Source
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$names = @('DailySiteChecks Daily', 'DailySiteChecks Hourly')
if ($Remove) {
  foreach ($n in $names) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $n -Confirm:$false
      Write-Host "Removed $n"
    }
  }
  return
}

function New-Action([string]$script, [string]$log) {
  $cmd = "Set-Location '$root'; & '$NodePath' '$script' *>> '$log'"
  New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$cmd`"" -WorkingDirectory $root
}

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

# Daily full run
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
Register-ScheduledTask -TaskName $names[0] -Action (New-Action 'src\run-per-site.js' (Join-Path $logs 'daily.log')) `
  -Trigger $dailyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$($names[0])' at $DailyTime daily"

# Hourly uptime ping, starting at the next full hour
$start = (Get-Date).Date.AddHours((Get-Date).Hour + 1)
$hourlyTrigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName $names[1] -Action (New-Action 'src\uptime.js' (Join-Path $logs 'hourly.log')) `
  -Trigger $hourlyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$($names[1])' hourly from $start"

Write-Host "Logs: $logs"
Write-Host "Test now:  Start-ScheduledTask -TaskName '$($names[1])'"
