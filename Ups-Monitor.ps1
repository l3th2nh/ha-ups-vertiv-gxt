<#
.SYNOPSIS
  Giam sat UPS Vertiv GXT-3000MTPLUS230 qua USB-HID, tu tat may khi sap het pin,
  day du lieu len Home Assistant qua MQTT (auto-discovery), nhan lenh tat/khoi
  dong lai may tu xa, va bat/tat o cam lap trinh duoc P1.
.PARAMETER Once
  Doc mot lan roi thoat (de kiem tra nhanh).
.PARAMETER DryRun
  Chay day du logic nhung KHONG bao gio thuc su tat may - chi ghi log.
.PARAMETER NoMqtt
  Bo qua MQTT du config bat.
#>
[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$DryRun,
  [switch]$NoMqtt,
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$DEG = [string][char]0x00B0

if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'ups-config.psd1' }
$Cfg = Import-PowerShellDataFile -Path $ConfigPath

. (Join-Path $PSScriptRoot 'UpsHid.ps1')
. (Join-Path $PSScriptRoot 'MqttLite.ps1')

# ---------------------------------------------------------------- logging ----
$LogDir = $Cfg.Log.Directory
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir 'ups-monitor.log'

function Write-Log {
  param([string]$Message, [ValidateSet('INFO','WARN','ERROR','ALERT')][string]$Level = 'INFO')
  $line = '{0} [{1,-5}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt $Cfg.Log.MaxSizeMB * 1MB)) {
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      Move-Item $LogFile (Join-Path $LogDir "ups-monitor-$stamp.log") -Force
      Get-ChildItem $LogDir -Filter 'ups-monitor-*.log' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $Cfg.Log.KeepFiles | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
  $color = switch ($Level) { 'ERROR' { 'Red' } 'ALERT' { 'Magenta' } 'WARN' { 'Yellow' } default { 'Gray' } }
  Write-Host $line -ForegroundColor $color
}

# ------------------------------------------------------------------- mqtt ----
$script:Mqtt = $null
$script:LastPing = Get-Date
$script:LastOutlet = $null
$UseMqtt = $Cfg.Mqtt.Enabled -and (-not $NoMqtt)
$Base       = $Cfg.Mqtt.BaseTopic
$TState     = "$Base/state"
$TAvail     = "$Base/availability"
$TCmd       = "$Base/cmd"
$TOutletSet = "$Base/outlet/set"

function Test-OutletControlEnabled {
  $rc = $Cfg.RemoteControl
  return ($rc -and $rc.Enabled -and $rc.AllowOutletControl)
}

function Get-SensorEntities {
  @(
    @{ Kind = 'sensor'; Key = 'battery_percent'; Name = 'Battery';          Unit = '%';          Dc = 'battery';     Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'runtime_minutes'; Name = 'Runtime';          Unit = 'min';        Dc = 'duration';    Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'load_percent';    Name = 'Load';             Unit = '%';          Dc = $null;         Sc = 'measurement'; Icon = 'mdi:gauge' }
    @{ Kind = 'sensor'; Key = 'load_watts';      Name = 'Load Power';       Unit = 'W';          Dc = 'power';       Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'input_voltage';   Name = 'Input Voltage';    Unit = 'V';          Dc = 'voltage';     Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'output_voltage';  Name = 'Output Voltage';   Unit = 'V';          Dc = 'voltage';     Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'battery_voltage'; Name = 'Battery Voltage';  Unit = 'V';          Dc = 'voltage';     Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'input_freq';      Name = 'Input Frequency';  Unit = 'Hz';         Dc = 'frequency';   Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'output_freq';     Name = 'Output Frequency'; Unit = 'Hz';         Dc = 'frequency';   Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'output_current';  Name = 'Output Current';   Unit = 'A';          Dc = 'current';     Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'temperature';     Name = 'Temperature';      Unit = ($DEG + 'C'); Dc = 'temperature'; Sc = 'measurement'; Icon = $null }
    @{ Kind = 'sensor'; Key = 'mode_text';       Name = 'Status';           Unit = $null;        Dc = $null;         Sc = $null;         Icon = 'mdi:power-plug' }
    @{ Kind = 'binary_sensor'; Key = 'on_battery';  Name = 'On Battery'; Unit = $null; Dc = 'problem'; Sc = $null; Icon = $null }
    @{ Kind = 'binary_sensor'; Key = 'has_warning'; Name = 'Fault';      Unit = $null; Dc = 'problem'; Sc = $null; Icon = $null }
  )
}

function Get-ButtonEntities {
  $b = @()
  if (-not $Cfg.RemoteControl -or -not $Cfg.RemoteControl.Enabled) { return $b }
  if ($Cfg.RemoteControl.AllowShutdown) {
    $b += @{ Key = 'pc_shutdown'; Name = 'PC Shutdown'; Payload = 'shutdown'; Icon = 'mdi:power' }
  }
  if ($Cfg.RemoteControl.AllowRestart) {
    $b += @{ Key = 'pc_restart'; Name = 'PC Restart'; Payload = 'restart'; Icon = 'mdi:restart' }
  }
  $b += @{ Key = 'cancel_shutdown'; Name = 'Cancel Shutdown'; Payload = 'cancel'; Icon = 'mdi:cancel' }
  return $b
}

function Get-DeviceBlock {
  @{
    ids  = @($Cfg.Ups.Id)
    name = $Cfg.Ups.Name
    mdl  = $Cfg.Ups.Model
    mf   = $Cfg.Ups.Maker
    sw   = '00072.07'
  }
}

function Connect-Mqtt {
  if (-not $UseMqtt) { return $false }
  try { if ($script:Mqtt) { $script:Mqtt.Dispose() } } catch { }
  $m = New-Object MqttLite
  $ok = $m.Connect($Cfg.Mqtt.Host, $Cfg.Mqtt.Port, $Cfg.Mqtt.ClientId,
    $Cfg.Mqtt.Username, $Cfg.Mqtt.Password, $TAvail, 'offline', 60, 5000)
  if (-not $ok) {
    Write-Log "MQTT ket noi that bai: $($m.LastError)" 'WARN'
    $script:Mqtt = $null
    return $false
  }
  $script:Mqtt = $m
  $script:LastPing = Get-Date
  $m.Publish($TAvail, 'online', $true) | Out-Null
  Publish-Discovery

  if ($Cfg.RemoteControl -and $Cfg.RemoteControl.Enabled) {
    $m.Subscribe($TCmd, 0) | Out-Null
    # Xoa lenh retained con sot lai (neu co) de tranh chay lap khi ket noi lai.
    $m.Publish($TCmd, '', $true) | Out-Null
    Write-Log "Da subscribe topic dieu khien: $TCmd"
  }
  if (Test-OutletControlEnabled) {
    $m.Subscribe($TOutletSet, 0) | Out-Null
    $m.Publish($TOutletSet, '', $true) | Out-Null
    Write-Log "Da subscribe topic o cam P1: $TOutletSet"
  }
  Write-Log "MQTT da ket noi toi $($Cfg.Mqtt.Host):$($Cfg.Mqtt.Port)"
  return $true
}

function Publish-Discovery {
  if (-not $script:Mqtt) { return }
  $dev = Get-DeviceBlock
  $n = 0

  foreach ($e in Get-SensorEntities) {
    $payload = [ordered]@{
      name         = $e.Name
      uniq_id      = "$($Cfg.Ups.Id)_$($e.Key)"
      obj_id       = "ups_$($e.Key)"          # ep entity_id thanh sensor.ups_<key>
      stat_t       = $TState
      val_tpl      = "{{ value_json.$($e.Key) }}"
      avty_t       = $TAvail
      pl_avail     = 'online'
      pl_not_avail = 'offline'
      dev          = $dev
    }
    if ($e.Unit) { $payload['unit_of_meas'] = $e.Unit }
    if ($e.Dc) { $payload['dev_cla'] = $e.Dc }
    if ($e.Sc) { $payload['stat_cla'] = $e.Sc }
    if ($e.Icon) { $payload['ic'] = $e.Icon }
    if ($e.Kind -eq 'binary_sensor') { $payload['pl_on'] = 'ON'; $payload['pl_off'] = 'OFF' }

    $topic = "$($Cfg.Mqtt.DiscoveryPrefix)/$($e.Kind)/$($Cfg.Ups.Id)/$($e.Key)/config"
    $script:Mqtt.Publish($topic, ($payload | ConvertTo-Json -Depth 6 -Compress), $true) | Out-Null
    $n++
  }

  foreach ($b in Get-ButtonEntities) {
    $payload = [ordered]@{
      name         = $b.Name
      uniq_id      = "$($Cfg.Ups.Id)_$($b.Key)"
      obj_id       = "ups_$($b.Key)"
      cmd_t        = $TCmd
      pl_prs       = $b.Payload
      avty_t       = $TAvail
      pl_avail     = 'online'
      pl_not_avail = 'offline'
      ic           = $b.Icon
      dev          = $dev
    }
    $topic = "$($Cfg.Mqtt.DiscoveryPrefix)/button/$($Cfg.Ups.Id)/$($b.Key)/config"
    $script:Mqtt.Publish($topic, ($payload | ConvertTo-Json -Depth 6 -Compress), $true) | Out-Null
    $n++
  }

  # Cong tac o cam lap trinh duoc P1 (QSK1 / SKON1 / SKOFF1)
  if (Test-OutletControlEnabled) {
    $payload = [ordered]@{
      name         = 'Programmable Outlet P1'
      uniq_id      = "$($Cfg.Ups.Id)_outlet_p1"
      obj_id       = 'ups_outlet_p1'
      stat_t       = $TState
      val_tpl      = '{{ value_json.outlet_p1 }}'
      cmd_t        = $TOutletSet
      pl_on        = 'ON'
      pl_off       = 'OFF'
      stat_on      = 'ON'
      stat_off     = 'OFF'
      avty_t       = $TAvail
      pl_avail     = 'online'
      pl_not_avail = 'offline'
      ic           = 'mdi:power-socket-de'
      dev          = $dev
    }
    $topic = "$($Cfg.Mqtt.DiscoveryPrefix)/switch/$($Cfg.Ups.Id)/outlet_p1/config"
    $script:Mqtt.Publish($topic, ($payload | ConvertTo-Json -Depth 6 -Compress), $true) | Out-Null
    $n++
  }

  Write-Log "Da gui HA auto-discovery cho $n entity"
}

function Publish-State {
  param($S, [string]$OutletP1)
  if (-not $script:Mqtt) { return }
  # 3000VA x PF 0.80 = 2400W cong suat thuc toi da
  $watts = [math]::Round(2400.0 * $S.LoadPercent / 100.0, 0)
  $doc = [ordered]@{
    timestamp       = $S.Timestamp.ToString('s')
    mode            = $S.Mode
    mode_text       = $S.ModeText
    on_battery      = $(if ($S.OnBattery) { 'ON' } else { 'OFF' })
    has_warning     = $(if ($S.HasWarning) { 'ON' } else { 'OFF' })
    battery_percent = $S.BatteryPercent
    runtime_minutes = $S.RuntimeMinutes
    load_percent    = $S.LoadPercent
    load_watts      = $watts
    input_voltage   = $S.InputVoltage
    output_voltage  = $S.OutputVoltage
    battery_voltage = $S.BatteryVoltage
    input_freq      = $S.InputFreq
    output_freq     = $S.OutputFreq
    output_current  = $S.OutputCurrent
    temperature     = $S.TemperatureC
    status_bits     = $S.StatusBits
    outlet_p1       = $(if ($OutletP1) { $OutletP1 } else { 'unknown' })
  }
  if (-not $script:Mqtt.Publish($TState, ($doc | ConvertTo-Json -Compress), $true)) {
    Write-Log "MQTT publish loi: $($script:Mqtt.LastError) - se ket noi lai" 'WARN'
    $script:Mqtt = $null
  }
}

# --------------------------------------------------------------- ups read ----
function Read-UpsWithRetry {
  param([int]$Tries = 3)
  for ($i = 1; $i -le $Tries; $i++) {
    try {
      $s = Get-UpsStatus
      if ($s) { return $s }
    } catch { }
    Start-Sleep -Milliseconds 400
  }
  return $null
}

# --------------------------------------------------------------- shutdown ----
function Test-ShutdownCondition {
  param($S)
  $sd = $Cfg.Shutdown
  if (-not $S.OnBattery) { return $null }

  if ($sd.BatteryVoltageBelow -gt 0 -and $S.BatteryVoltage -le $sd.BatteryVoltageBelow) {
    return "dien ap pin $($S.BatteryVoltage)V (nguong <= $($sd.BatteryVoltageBelow)V)"
  }
  if ($sd.BatteryPercentBelow -gt 0 -and $S.BatteryPercent -le $sd.BatteryPercentBelow) {
    return "pin con $($S.BatteryPercent)% (nguong <= $($sd.BatteryPercentBelow)%)"
  }
  if ($sd.RuntimeMinutesBelow -gt 0 -and $S.RuntimeMinutes -le $sd.RuntimeMinutesBelow) {
    return "UPS bao con $($S.RuntimeMinutes) phut (nguong <= $($sd.RuntimeMinutesBelow) phut)"
  }
  if ($sd.OnBatterySecondsAbove -gt 0 -and $script:OnBatterySince) {
    $dur = [int]((Get-Date) - $script:OnBatterySince).TotalSeconds
    if ($dur -ge $sd.OnBatterySecondsAbove) {
      return "da chay pin lien tuc $dur giay (nguong >= $($sd.OnBatterySecondsAbove) giay)"
    }
  }
  return $null
}

function Invoke-UpsShutdown {
  param([string]$Reason)
  $grace = [int]$Cfg.Shutdown.GraceSeconds
  $msg = "UPS sap het pin: $Reason. May se tat sau $grace giay."
  Write-Log "TAT MAY: $Reason" 'ALERT'
  if ($script:Mqtt) { $script:Mqtt.Publish("$Base/shutdown_reason", $Reason, $true) | Out-Null }
  if ($DryRun) {
    Write-Log '[DryRun] Bo qua lenh tat may that.' 'WARN'
    return $true
  }
  try {
    & shutdown.exe '/s' '/f' '/t' "$grace" '/c' $msg
    Write-Log "Da phat lenh shutdown, dem nguoc $grace giay (dien co lai se tu huy)." 'ALERT'
    return $true
  } catch {
    Write-Log "Phat lenh shutdown that bai: $($_.Exception.Message)" 'ERROR'
    return $false
  }
}

function Stop-PendingShutdown {
  Write-Log 'Dien luoi da co lai -> HUY lenh tat may.' 'ALERT'
  if (-not $DryRun) {
    try { & shutdown.exe '/a' 2>&1 | Out-Null } catch { }
  }
  if ($script:Mqtt) { $script:Mqtt.Publish("$Base/shutdown_reason", '', $true) | Out-Null }
}

# --------------------------------------------------------- remote control ----
function Invoke-RemoteCommand {
  param([string]$Payload)

  $cmd = "$Payload".Trim().ToLower()
  if ([string]::IsNullOrWhiteSpace($cmd)) { return }
  Write-Log "Nhan lenh tu xa qua MQTT: '$cmd'" 'ALERT'

  # Xoa ngay retained (neu co) de khong chay lai o lan ket noi sau
  if ($script:Mqtt) { $script:Mqtt.Publish($TCmd, '', $true) | Out-Null }

  if (-not $Cfg.RemoteControl -or -not $Cfg.RemoteControl.Enabled) {
    Write-Log 'RemoteControl dang tat -> bo qua lenh.' 'WARN'
    return
  }
  $g = [int]$Cfg.RemoteControl.GraceSeconds

  switch ($cmd) {
    'shutdown' {
      if (-not $Cfg.RemoteControl.AllowShutdown) { Write-Log 'AllowShutdown = false -> tu choi.' 'WARN'; return }
      if ($DryRun) { Write-Log '[DryRun] Bo qua shutdown tu xa.' 'WARN'; return }
      & shutdown.exe '/s' '/f' '/t' "$g" '/c' "Tat may theo lenh tu Home Assistant (sau $g giay)."
      Write-Log "Da phat lenh TAT MAY tu xa, dem nguoc $g giay." 'ALERT'
    }
    'restart' {
      if (-not $Cfg.RemoteControl.AllowRestart) { Write-Log 'AllowRestart = false -> tu choi.' 'WARN'; return }
      if ($DryRun) { Write-Log '[DryRun] Bo qua restart tu xa.' 'WARN'; return }
      & shutdown.exe '/r' '/f' '/t' "$g" '/c' "Khoi dong lai theo lenh tu Home Assistant (sau $g giay)."
      Write-Log "Da phat lenh KHOI DONG LAI tu xa, dem nguoc $g giay." 'ALERT'
    }
    'cancel' {
      if ($DryRun) { Write-Log '[DryRun] Bo qua cancel.' 'WARN'; return }
      try { & shutdown.exe '/a' 2>&1 | Out-Null } catch { }
      $script:ShutdownIssued = $false
      Write-Log 'Da HUY lenh tat/khoi dong lai dang cho.' 'ALERT'
    }
    default { Write-Log "Lenh khong hieu: '$cmd'" 'WARN' }
  }
}

function Invoke-OutletCommand {
  param([string]$Payload)

  $want = "$Payload".Trim().ToUpper()
  if ([string]::IsNullOrWhiteSpace($want)) { return }
  if ($script:Mqtt) { $script:Mqtt.Publish($TOutletSet, '', $true) | Out-Null }

  if (-not (Test-OutletControlEnabled)) {
    Write-Log 'AllowOutletControl dang tat -> bo qua lenh o cam.' 'WARN'
    return
  }
  if ($want -ne 'ON' -and $want -ne 'OFF') {
    Write-Log "Lenh o cam khong hieu: '$want'" 'WARN'
    return
  }

  Write-Log "Nhan lenh o cam P1: $want" 'ALERT'
  if ($DryRun) { Write-Log '[DryRun] Bo qua lenh o cam.' 'WARN'; return }

  $r = Set-UpsOutlet -State $want -Number 1
  if ($r.Accepted) {
    Write-Log "O cam P1 -> $want  ($($r.Command) tra ve $($r.Reply))" 'ALERT'
  } else {
    Write-Log "UPS TU CHOI lenh o cam: $($r.Command) tra ve $($r.Reply)" 'WARN'
  }

  # Doc lai trang thai that va day len HA ngay de cong tac khong bi lech
  Start-Sleep -Milliseconds 800
  $script:LastOutlet = Get-UpsOutlet 1
  if ($script:Mqtt -and $script:LastState) { Publish-State $script:LastState $script:LastOutlet }
}

# Thay cho Start-Sleep: vua cho, vua lang nghe lenh MQTT, vua giu keepalive.
function Wait-WithCommands {
  param([int]$Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ($script:Mqtt) {
      $remainMs = [int]((($deadline - (Get-Date)).TotalMilliseconds))
      if ($remainMs -le 0) { break }
      $slice = [Math]::Min(1000, [Math]::Max(100, $remainMs))
      if ($script:Mqtt.TryReadMessage($slice)) {
        $topic = $script:Mqtt.LastTopic
        $body = $script:Mqtt.LastPayload
        if ($topic -eq $TOutletSet) { Invoke-OutletCommand $body }
        elseif ($topic -eq $TCmd) { Invoke-RemoteCommand $body }
        else { Write-Log "Bo qua message tu topic la: $topic" 'WARN' }
      } elseif (-not $script:Mqtt.IsConnected) {
        Write-Log "Mat ket noi MQTT: $($script:Mqtt.LastError)" 'WARN'
        $script:Mqtt = $null
        continue
      }
      if (((Get-Date) - $script:LastPing).TotalSeconds -ge 30) {
        if ($script:Mqtt.Ping()) { $script:LastPing = Get-Date }
        else { Write-Log 'Ping MQTT that bai -> se ket noi lai' 'WARN'; $script:Mqtt = $null }
      }
    } else {
      Start-Sleep -Milliseconds 500
    }
  }
}

# ------------------------------------------------------------------- main ----
Write-Log '===== Ups-Monitor khoi dong ====='
Write-Log "Config: $ConfigPath | DryRun=$DryRun | MQTT=$UseMqtt"
$sdc = $Cfg.Shutdown
Write-Log ('Nguong tat may: pin<={0}%  battV<={1}V  runtime<={2}phut  onbattery>={3}s  confirm={4} lan  grace={5}s  enabled={6}' -f
  $sdc.BatteryPercentBelow, $sdc.BatteryVoltageBelow, $sdc.RuntimeMinutesBelow,
  $sdc.OnBatterySecondsAbove, $sdc.ConfirmReadings, $sdc.GraceSeconds, $sdc.Enabled)
Write-Log ("Dieu khien o cam P1: {0}" -f $(if (Test-OutletControlEnabled) { 'BAT' } else { 'TAT' }))

if ($UseMqtt) { Connect-Mqtt | Out-Null }

$script:OnBatterySince = $null
$script:ConfirmCount = 0
$script:ShutdownIssued = $false
$script:LastState = $null
$commsFail = 0
$lastMode = ''

try {
  while ($true) {
    $s = Read-UpsWithRetry

    if ($null -eq $s) {
      $commsFail++
      Write-Log "Khong doc duoc UPS (lan thu $commsFail)" 'WARN'
      if ($commsFail -eq 3 -and $script:Mqtt) { $script:Mqtt.Publish($TAvail, 'offline', $true) | Out-Null }
      if ($Once) { break }
      Wait-WithCommands $Cfg.Poll.NormalSeconds
      continue
    }
    $script:LastState = $s

    if ($commsFail -gt 0) {
      Write-Log "Da doc lai duoc UPS sau $commsFail lan loi"
      $commsFail = 0
      if ($script:Mqtt) { $script:Mqtt.Publish($TAvail, 'online', $true) | Out-Null }
    }

    if ($s.Mode -ne $lastMode) {
      $prev = if ($lastMode) { $lastMode } else { '?' }
      Write-Log ('Chuyen che do: {0} -> {1} ({2})' -f $prev, $s.Mode, $s.ModeText) 'ALERT'
      $lastMode = $s.Mode
    }

    # Trang thai o cam P1 - UPS tu ngat no sau mot khoang chay pin
    $outlet = Get-UpsOutlet 1
    if ($outlet -and $outlet -ne $script:LastOutlet) {
      if ($script:LastOutlet) {
        Write-Log "O cam lap trinh P1 doi trang thai: $($script:LastOutlet) -> $outlet" 'ALERT'
      }
      $script:LastOutlet = $outlet
    }

    if ($s.OnBattery) {
      if (-not $script:OnBatterySince) {
        $script:OnBatterySince = Get-Date
        Write-Log ('MAT DIEN LUOI - chay pin. Pin {0}%, {1}V, con {2} phut, tai {3}%' -f
          $s.BatteryPercent, $s.BatteryVoltage, $s.RuntimeMinutes, $s.LoadPercent) 'ALERT'
      }
    } else {
      if ($script:OnBatterySince) {
        $dur = [int]((Get-Date) - $script:OnBatterySince).TotalSeconds
        Write-Log "Dien luoi da phuc hoi sau $dur giay chay pin." 'ALERT'
        $script:OnBatterySince = $null
      }
      $script:ConfirmCount = 0
      if ($script:ShutdownIssued) {
        Stop-PendingShutdown
        $script:ShutdownIssued = $false
      }
    }

    if ($UseMqtt -and -not $script:Mqtt) { Connect-Mqtt | Out-Null }
    Publish-State $s $script:LastOutlet

    if ($Cfg.Shutdown.Enabled -and -not $script:ShutdownIssued) {
      $reason = Test-ShutdownCondition $s
      if ($reason) {
        $script:ConfirmCount++
        Write-Log "Dieu kien tat may thoa ($($script:ConfirmCount)/$($Cfg.Shutdown.ConfirmReadings)): $reason" 'WARN'
        if ($script:ConfirmCount -ge $Cfg.Shutdown.ConfirmReadings) {
          if (Invoke-UpsShutdown $reason) { $script:ShutdownIssued = $true }
        }
      } else {
        $script:ConfirmCount = 0
      }
    }

    if ($Once) {
      $s | Format-List | Out-String | Write-Host
      "O cam P1 : $script:LastOutlet" | Write-Host
      break
    }

    $wait = if ($s.OnBattery) { $Cfg.Poll.OnBatterySeconds } else { $Cfg.Poll.NormalSeconds }
    Wait-WithCommands $wait
  }
} finally {
  if ($script:Mqtt) {
    try {
      $script:Mqtt.Publish($TAvail, 'offline', $true) | Out-Null
      $script:Mqtt.Dispose()
    } catch { }
  }
  Write-Log '===== Ups-Monitor ket thuc ====='
}
