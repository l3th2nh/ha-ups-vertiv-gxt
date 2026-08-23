<#
.SYNOPSIS
  Dang ky Ups-Monitor thanh Scheduled Task chay nen duoi quyen SYSTEM.
  Chay tu luc khoi dong may, khong can dang nhap, tu khoi dong lai neu chet.
.EXAMPLE
  # Cai dat (chay PowerShell voi quyen Administrator)
  .\Install-UpsMonitor.ps1
.EXAMPLE
  .\Install-UpsMonitor.ps1 -Status
.EXAMPLE
  .\Install-UpsMonitor.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$Status,
  [string]$TaskName = 'UPS Monitor (Vertiv GXT3000)'
)

$ErrorActionPreference = 'Stop'
$ScriptPath = Join-Path $PSScriptRoot 'Ups-Monitor.ps1'
$ConfigPath = Join-Path $PSScriptRoot 'ups-config.psd1'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ------------------------------------------------------------------ status ---
if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) {
    Write-Host "Task '$TaskName' CHUA duoc cai dat." -ForegroundColor Yellow
    return
  }
  $i = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task     : $TaskName"        -ForegroundColor Cyan
  Write-Host "State    : $($t.State)"
  Write-Host "LastRun  : $($i.LastRunTime)"
  Write-Host "LastResult: $($i.LastTaskResult)  (0 = OK, 267009 = dang chay)"
  Write-Host "NextRun  : $($i.NextRunTime)"
  $log = Join-Path $PSScriptRoot 'logs\ups-monitor.log'
  if (Test-Path $log) {
    Write-Host "`n--- 15 dong log cuoi ---" -ForegroundColor Cyan
    Get-Content $log -Tail 15
  }
  return
}

if (-not (Test-Admin)) {
  throw 'Can quyen Administrator. Mo PowerShell bang "Run as administrator" roi chay lai.'
}

# --------------------------------------------------------------- uninstall ---
if ($Uninstall) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Da go task '$TaskName'." -ForegroundColor Green
  } else {
    Write-Host "Task '$TaskName' khong ton tai." -ForegroundColor Yellow
  }
  return
}

# ----------------------------------------------------------------- install ---
if (-not (Test-Path $ScriptPath)) { throw "Khong tim thay $ScriptPath" }
if (-not (Test-Path $ConfigPath)) { throw "Khong tim thay $ConfigPath" }

# Canh bao neu chua dien thong tin MQTT
$cfg = Import-PowerShellDataFile -Path $ConfigPath
if ($cfg.Mqtt.Enabled -and [string]::IsNullOrWhiteSpace($cfg.Mqtt.Username)) {
  Write-Host 'CANH BAO: Mqtt.Username trong ups-config.psd1 dang de trong.' -ForegroundColor Yellow
  Write-Host '          Giam sat + tat may van chay, nhung se khong day duoc len Home Assistant.' -ForegroundColor Yellow
}

# Siet quyen doc file config vi no chua mat khau MQTT
try {
  $me = "$env:USERDOMAIN\$env:USERNAME"
  & icacls.exe $ConfigPath /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' "${me}:(F)" | Out-Null
  Write-Host 'Da siet ACL cho ups-config.psd1 (chi SYSTEM + Administrators doc duoc).' -ForegroundColor Green
} catch {
  Write-Host "Khong siet duoc ACL config: $($_.Exception.Message)" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
  '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $ScriptPath)

$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup)
)
# Trigger watchdog: cu 10 phut kich lai; neu task dang chay thi bi bo qua
# (MultipleInstances = IgnoreNew), nen thuc chat la co che tu hoi sinh.
$wd = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
        -RepetitionInterval (New-TimeSpan -Minutes 10)
$triggers += $wd

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host 'Da go ban cu truoc khi cai lai.' -ForegroundColor DarkGray
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Principal $principal `
  -Description 'Giam sat UPS Vertiv GXT-3000MTPLUS230 qua USB-HID, tu tat may khi sap het pin, day du lieu len Home Assistant qua MQTT.' | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host "Da cai dat: $TaskName" -ForegroundColor Green
Write-Host "State     : $($t.State)"
Write-Host ''
Write-Host 'Lenh huu ich:' -ForegroundColor Cyan
Write-Host '  .\Install-UpsMonitor.ps1 -Status      # xem trang thai + log'
Write-Host '  .\Install-UpsMonitor.ps1 -Uninstall   # go bo'
Write-Host '  Get-Content .\logs\ups-monitor.log -Tail 30 -Wait   # xem log truc tiep'
