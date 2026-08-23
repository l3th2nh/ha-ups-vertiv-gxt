<#
.SYNOPSIS
  Dang ky Ups-Monitor thanh Scheduled Task chay nen duoi quyen SYSTEM.
  Chay tu luc khoi dong may, khong can dang nhap, tu khoi dong lai neu chet.

  Script TU XIN QUYEN ADMIN neu chua co (hien hop thoai UAC).

.EXAMPLE
  .\Install-UpsMonitor.ps1
.EXAMPLE
  .\Install-UpsMonitor.ps1 -Status      # xem trang thai (khong can admin)
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
$LogPath    = Join-Path $PSScriptRoot 'logs\ups-monitor.log'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ------------------------------------------------------------------ status ---
# Xem trang thai khong can quyen admin -> xu ly truoc khi kiem tra quyen.
if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) {
    # BAY: task chay duoi SYSTEM KHONG doc duoc tu phien thuong. "Khong thay"
    # o day KHONG co nghia la chua cai. Phai xem bang chung that: log co dang
    # duoc ghi khong. Dung ket luan tu mot cong cu bi gioi han quyen.
    if (-not (Test-Admin)) {
      Write-Host 'Chua nang quyen nen KHONG doc duoc task chay duoi SYSTEM.' -ForegroundColor Yellow
      Write-Host 'Dieu do KHONG co nghia la task chua duoc cai.' -ForegroundColor Yellow
      Write-Host ''
      if (Test-Path $LogPath) {
        $age = [int]((Get-Date) - (Get-Item $LogPath).LastWriteTime).TotalMinutes
        Write-Host "Bang chung thuc te: log sua lan cuoi cach day $age phut." -ForegroundColor Cyan
        Write-Host '  (agent chi ghi log khi co su kien, nen im lang la binh thuong)' -ForegroundColor DarkGray
      }
      Write-Host ''
      Write-Host 'Muon xem chac chan: mo PowerShell bang "Run as administrator"' -ForegroundColor Cyan
      Write-Host 'roi chay lai lenh nay.' -ForegroundColor Cyan
    } else {
      Write-Host "Task '$TaskName' CHUA duoc cai dat." -ForegroundColor Yellow
      Write-Host 'Chay:  .\Install-UpsMonitor.ps1' -ForegroundColor Yellow
    }
  } else {
    $i = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task       : $TaskName" -ForegroundColor Cyan
    Write-Host "State      : $($t.State)"
    Write-Host "LastRunTime: $($i.LastRunTime)"
    Write-Host "LastResult : $($i.LastTaskResult)  (0 = OK, 267009 = dang chay)"
    Write-Host "NextRunTime: $($i.NextRunTime)"
  }
  if (Test-Path $LogPath) {
    Write-Host "`nLog sua lan cuoi: $((Get-Item $LogPath).LastWriteTime)" -ForegroundColor Cyan
    Write-Host '--- 15 dong cuoi ---' -ForegroundColor Cyan
    Get-Content $LogPath -Tail 15
  }
  return
}

# --------------------------------------------------------- tu nang quyen ---
if (-not (Test-Admin)) {
  Write-Host ''
  Write-Host '  Viec nay can quyen Administrator (de dang ky task chay duoi SYSTEM).' -ForegroundColor Yellow
  Write-Host '  Dang mo mot cua so PowerShell nang quyen - bam Yes o hop thoai UAC.' -ForegroundColor Yellow
  Write-Host ''

  $argList = @(
    '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$PSCommandPath`""
  )
  if ($Uninstall) { $argList += '-Uninstall' }

  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList
    Write-Host '  Da mo cua so moi. Xem ket qua o cua so do.' -ForegroundColor Green
  } catch {
    Write-Host ''
    Write-Host '  Ban da tu choi hop thoai UAC (hoac UAC bi chan).' -ForegroundColor Red
    Write-Host '  Cach thu cong: bam chuot phai vao Windows PowerShell ->' -ForegroundColor Red
    Write-Host '  "Run as administrator", roi chay lai lenh nay.' -ForegroundColor Red
  }
  return
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

# Canh bao neu dang co ban chay tay: hai tien trinh cung hoi UPS se dan xen
# lenh tren cung mot thiet bi HID -> phan hoi co the bi lan.
$manual = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'Ups-Monitor\.ps1' -and $_.ProcessId -ne $PID })
if ($manual.Count -gt 0) {
  Write-Host ''
  Write-Host "  CANH BAO: dang co $($manual.Count) tien trinh Ups-Monitor.ps1 chay tay." -ForegroundColor Yellow
  Write-Host '  Hai ban cung hoi UPS se dan xen lenh tren cung thiet bi HID.' -ForegroundColor Yellow
  foreach ($m in $manual) { Write-Host "    PID $($m.ProcessId)" -ForegroundColor DarkYellow }
  $ans = Read-Host '  Dong cac tien trinh do lai? (Y/n)'
  if ($ans -ne 'n' -and $ans -ne 'N') {
    foreach ($m in $manual) {
      try { Stop-Process -Id $m.ProcessId -Force -ErrorAction Stop; Write-Host "    Da dong PID $($m.ProcessId)" -ForegroundColor Green }
      catch { Write-Host "    Khong dong duoc PID $($m.ProcessId): $($_.Exception.Message)" -ForegroundColor Red }
    }
    Start-Sleep -Seconds 2
  }
}

$cfg = Import-PowerShellDataFile -Path $ConfigPath
if ($cfg.Mqtt.Enabled -and [string]::IsNullOrWhiteSpace($cfg.Mqtt.Username)) {
  Write-Host 'CANH BAO: Mqtt.Username trong ups-config.psd1 dang de trong.' -ForegroundColor Yellow
  Write-Host '          Giam sat + tat may van chay, nhung khong day duoc len Home Assistant.' -ForegroundColor Yellow
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

# Trigger 1: khi may khoi dong. Cho 30 giay de card mang + DNS san sang;
# neu khong, MQTT se timeout lien tuc trong khoang dau (vo hai nhung ban log).
$tStart = New-ScheduledTaskTrigger -AtStartup
$tStart.Delay = 'PT30S'

# Trigger 2: watchdog. Cu 10 phut kich lai; neu task dang chay thi bi bo qua
# (MultipleInstances = IgnoreNew), nen thuc chat la co che tu hoi sinh.
$tWatch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 10) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

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

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($tStart, $tWatch) `
  -Settings $settings -Principal $principal `
  -Description 'Giam sat UPS Vertiv GXT-3000MTPLUS230 qua USB-HID, tu tat may khi sap het pin, day du lieu len Home Assistant qua MQTT.' | Out-Null

Start-ScheduledTask -TaskName $TaskName

# ------------------------------------------------------------- kiem chung ---
# Khong tin vao viec "khong bao loi la xong": phai thay task chay THAT
# va log co dong moi thi moi ket luan thanh cong.
Write-Host ''
Write-Host 'Dang kiem chung...' -ForegroundColor Cyan

$before = if (Test-Path $LogPath) { (Get-Item $LogPath).LastWriteTime } else { [datetime]::MinValue }
$ok = $false
foreach ($i in 1..20) {
  Start-Sleep -Seconds 1
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t -and $t.State -eq 'Running') {
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).LastWriteTime -gt $before) { $ok = $true; break }
  }
}

$t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$i = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue

Write-Host ''
if ($ok) {
  Write-Host '  ==> CAI DAT THANH CONG' -ForegroundColor Green
  Write-Host '      Task dang chay VA da ghi them vao log.' -ForegroundColor Green
} elseif ($t -and $t.State -eq 'Running') {
  Write-Host '  ==> Task DANG CHAY nhung chua thay log moi.' -ForegroundColor Yellow
  Write-Host '      Doi them chut roi chay:  .\Install-UpsMonitor.ps1 -Status' -ForegroundColor Yellow
} else {
  Write-Host '  ==> CO VAN DE: task khong o trang thai Running.' -ForegroundColor Red
  Write-Host "      State = $($t.State) | LastResult = $($i.LastTaskResult)" -ForegroundColor Red
}

Write-Host ''
Write-Host "Task   : $TaskName"
Write-Host "State  : $($t.State)"
Write-Host "Chay tu: khoi dong may (tre 30 giay) + watchdog moi 10 phut"
Write-Host ''
Write-Host 'Lenh huu ich:' -ForegroundColor Cyan
Write-Host '  .\Install-UpsMonitor.ps1 -Status      # xem trang thai + log'
Write-Host '  .\Install-UpsMonitor.ps1 -Uninstall   # go bo'
Write-Host '  Get-Content .\logs\ups-monitor.log -Tail 30 -Wait'
Write-Host ''
