<#
.SYNOPSIS
  Giam sat UPS Vertiv GXT-3000MTPLUS230 qua USB-HID:
    - Doc toan bo thong so, day len Home Assistant qua MQTT auto-discovery
    - Ghi NHAT KY su kien mat dien / co dien lai (luu ra file, day len HA)
    - Tu tat may an toan khi sap het pin
  Mac dinh KHONG bat dieu khien tu xa (xem RemoteControl trong config).
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
$LogFile    = Join-Path $LogDir 'ups-monitor.log'
$EventsFile = Join-Path $LogDir 'power-events.json'

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

# ------------------------------------------------------- nhat ky su kien -----
# Moi lan mat dien la mot ban ghi. Luu ra file JSON de song sot qua reboot.
$MaxEvents = if ($Cfg.Events -and $Cfg.Events.KeepCount) { [int]$Cfg.Events.KeepCount } else { 50 }
$script:Events  = @()
$script:Current = $null

function Load-Events {
  if (-not (Test-Path $EventsFile)) { return }
  try {
    $raw = Get-Content $EventsFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return }
    # PS 5.1: ConvertFrom-Json tra CA MANG duoi dang MOT object, nen @(...) se
    # boc thanh 1 phan tu chua mang. Phai dung foreach de duyet cho dung.
    $loaded = @()
    foreach ($e in ($raw | ConvertFrom-Json)) { $loaded += , $e }
    $script:Events = $loaded
    Write-Log "Da nap $($script:Events.Count) su kien tu $EventsFile"
  } catch {
    Write-Log "Khong doc duoc $EventsFile : $($_.Exception.Message)" 'WARN'
  }
}

function Save-Events {
  try {
    $keep = @($script:Events | Select-Object -Last $MaxEvents)
    # PS 5.1: neu pipe vao ConvertTo-Json thi mang 1 phan tu bi mat dau [ ].
    # -InputObject ([object[]]...) giu dung dinh dang mang trong moi truong hop.
    $json = ConvertTo-Json -InputObject ([object[]]$keep) -Depth 5 -Compress
    Set-Content -Path $EventsFile -Value $json -Encoding UTF8
  } catch {
    Write-Log "Khong ghi duoc $EventsFile : $($_.Exception.Message)" 'WARN'
  }
}

function New-OutageEvent {
  param($S)
  [ordered]@{
    start          = (Get-Date).ToString('s')
    end            = $null
    duration_s     = 0
    battery_start  = $S.BatteryPercent
    battery_end    = $S.BatteryPercent
    battery_min    = $S.BatteryPercent
    voltage_start  = $S.BatteryVoltage
    voltage_min    = $S.BatteryVoltage
    load_max       = $S.LoadPercent
    outlet_shed    = $false
    shutdown_fired = $false
    ongoing        = $true
  }
}

function Update-OutageEvent {
  param($S)
  if (-not $script:Current) { return }
  $e = $script:Current
  if ($S.BatteryPercent -lt $e.battery_min) { $e.battery_min = $S.BatteryPercent }
  if ($S.BatteryVoltage -lt $e.voltage_min) { $e.voltage_min = $S.BatteryVoltage }
  if ($S.LoadPercent -gt $e.load_max) { $e.load_max = $S.LoadPercent }
  $e.battery_end = $S.BatteryPercent
  $e.duration_s = [int]((Get-Date) - [datetime]$e.start).TotalSeconds
}

function Close-OutageEvent {
  if (-not $script:Current) { return }
  $e = $script:Current
  $e.end = (Get-Date).ToString('s')
  $e.duration_s = [int]([datetime]$e.end - [datetime]$e.start).TotalSeconds
  $e.ongoing = $false
  $script:Events += ,$e
  $script:Current = $null
  Save-Events
  Write-Log ("Da ghi su kien mat dien: {0} giay, pin {1}% -> {2}%, thap nhat {3}V{4}" -f
    $e.duration_s, $e.battery_start, $e.battery_end, $e.voltage_min,
    $(if ($e.outlet_shed) { ', o P1 da bi ngat' } else { '' })) 'ALERT'
}

function Format-Duration {
  param([int]$Seconds)
  if ($Seconds -lt 60) { return "$Seconds giay" }
  $m = [math]::Floor($Seconds / 60); $s = $Seconds % 60
  if ($m -lt 60) { return "$m phut $s giay" }
  $h = [math]::Floor($m / 60); $m = $m % 60
  "$h gio $m phut"
}

# ------------------------------------------------------------------- mqtt ----
$script:Mqtt = $null
$script:LastPing = Get-Date
$script:LastOutlet = $null
$UseMqtt = $Cfg.Mqtt.Enabled -and (-not $NoMqtt)
$Base    = $Cfg.Mqtt.BaseTopic
$TState  = "$Base/state"
$TEvents = "$Base/events"
$TAvail  = "$Base/availability"
$TCmd    = "$Base/cmd"

function Test-RemoteEnabled {
  $rc = $Cfg.RemoteControl
  return ($rc -and $rc.Enabled)
}

function Get-SensorEntities {
  $e = @(
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
  # O cam P1 chi de DOC (khong dieu khien) - van huu ich de biet no da bi shed
  $e += @{ Kind = 'binary_sensor'; Key = 'outlet_p1'; Name = 'Programmable Outlet P1'
           Unit = $null; Dc = $null; Sc = $null; Icon = 'mdi:power-socket-de' }
  return $e
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
  Publish-Events
  if (Test-RemoteEnabled) {
    $m.Subscribe($TCmd, 0) | Out-Null
    $m.Publish($TCmd, '', $true) | Out-Null
    Write-Log "Da subscribe topic dieu khien: $TCmd"
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

  # Nhat ky su kien: state = thoi diem gan nhat, attributes = ca mang su kien
  $payload = [ordered]@{
    name         = 'Power Events'
    uniq_id      = "$($Cfg.Ups.Id)_power_events"
    obj_id       = 'ups_power_events'
    stat_t       = $TEvents
    val_tpl      = '{{ value_json.last }}'
    json_attr_t  = $TEvents
    avty_t       = $TAvail
    pl_avail     = 'online'
    pl_not_avail = 'offline'
    ic           = 'mdi:history'
    dev          = $dev
  }
  $script:Mqtt.Publish(
    "$($Cfg.Mqtt.DiscoveryPrefix)/sensor/$($Cfg.Ups.Id)/power_events/config",
    ($payload | ConvertTo-Json -Depth 6 -Compress), $true) | Out-Null
  $n++

  Write-Log "Da gui HA auto-discovery cho $n entity"
}

function Publish-Events {
  if (-not $script:Mqtt) { return }
  $list = @($script:Events | Select-Object -Last $MaxEvents)
  if ($script:Current) { $list += ,$script:Current }   # ca su kien dang dien ra
  $last = if ($list.Count) { $list[-1].start } else { 'never' }
  $doc = [ordered]@{
    last    = $last
    count   = $list.Count
    ongoing = [bool]$script:Current
    events  = $list
  }
  $script:Mqtt.Publish($TEvents, ($doc | ConvertTo-Json -Depth 5 -Compress), $true) | Out-Null
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
    outlet_p1       = $(if ($OutletP1) { $OutletP1 } else { 'OFF' })
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
  if ($script:Current) { $script:Current.shutdown_fired = $true; Publish-Events }
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
}

# --------------------------------------------------------- remote control ----
# Mac dinh TAT (RemoteControl.Enabled = $false). Giu lai de bat khi can.
function Invoke-RemoteCommand {
  param([string]$Payload)
  $cmd = "$Payload".Trim().ToLower()
  if ([string]::IsNullOrWhiteSpace($cmd)) { return }
  Write-Log "Nhan lenh tu xa qua MQTT: '$cmd'" 'ALERT'
  if ($script:Mqtt) { $script:Mqtt.Publish($TCmd, '', $true) | Out-Null }
  if (-not (Test-RemoteEnabled)) { Write-Log 'RemoteControl dang tat -> bo qua.' 'WARN'; return }
  $g = [int]$Cfg.RemoteControl.GraceSeconds
  switch ($cmd) {
    'shutdown' {
      if ($DryRun) { Write-Log '[DryRun] Bo qua shutdown tu xa.' 'WARN'; return }
      & shutdown.exe '/s' '/f' '/t' "$g" '/c' "Tat may theo lenh tu Home Assistant."
      Write-Log "Da phat lenh TAT MAY tu xa, dem nguoc $g giay." 'ALERT'
    }
    'restart' {
      if ($DryRun) { Write-Log '[DryRun] Bo qua restart tu xa.' 'WARN'; return }
      & shutdown.exe '/r' '/f' '/t' "$g" '/c' "Khoi dong lai theo lenh tu Home Assistant."
      Write-Log "Da phat lenh KHOI DONG LAI tu xa, dem nguoc $g giay." 'ALERT'
    }
    'cancel' {
      if ($DryRun) { return }
      try { & shutdown.exe '/a' 2>&1 | Out-Null } catch { }
      $script:ShutdownIssued = $false
      Write-Log 'Da HUY lenh dang cho.' 'ALERT'
    }
    default { Write-Log "Lenh khong hieu: '$cmd'" 'WARN' }
  }
}

# Thay cho Start-Sleep: vua cho, vua giu keepalive, vua nghe lenh (neu bat).
function Wait-Tick {
  param([int]$Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ($script:Mqtt) {
      $remainMs = [int]((($deadline - (Get-Date)).TotalMilliseconds))
      if ($remainMs -le 0) { break }
      $slice = [Math]::Min(1000, [Math]::Max(100, $remainMs))
      if ($script:Mqtt.TryReadMessage($slice)) {
        if ($script:Mqtt.LastTopic -eq $TCmd) { Invoke-RemoteCommand $script:Mqtt.LastPayload }
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
Write-Log ('Dieu khien tu xa: {0}' -f $(if (Test-RemoteEnabled) { 'BAT' } else { 'TAT (chi doc)' }))

Load-Events
if ($UseMqtt) { Connect-Mqtt | Out-Null }

$script:OnBatterySince = $null
$script:ConfirmCount = 0
$script:ShutdownIssued = $false
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
      Wait-Tick $Cfg.Poll.NormalSeconds
      continue
    }

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

    # Trang thai o cam P1 (chi doc) - UPS tu ngat no sau mot khoang chay pin
    $outlet = Get-UpsOutlet 1
    if ($outlet -and $outlet -ne $script:LastOutlet) {
      if ($script:LastOutlet) {
        Write-Log "O cam lap trinh P1: $($script:LastOutlet) -> $outlet" 'ALERT'
        if ($outlet -eq 'OFF' -and $script:Current) { $script:Current.outlet_shed = $true }
      }
      $script:LastOutlet = $outlet
    }

    # ---- nhat ky mat dien / co dien lai ----
    if ($s.OnBattery) {
      if (-not $script:OnBatterySince) {
        $script:OnBatterySince = Get-Date
        $script:Current = New-OutageEvent $s
        Write-Log ('MAT DIEN LUOI - chay pin. Pin {0}%, {1}V, con {2} phut, tai {3}%' -f
          $s.BatteryPercent, $s.BatteryVoltage, $s.RuntimeMinutes, $s.LoadPercent) 'ALERT'
        Publish-Events
      } else {
        Update-OutageEvent $s
      }
    } else {
      if ($script:OnBatterySince) {
        $dur = [int]((Get-Date) - $script:OnBatterySince).TotalSeconds
        Write-Log ('CO DIEN LAI sau {0}' -f (Format-Duration $dur)) 'ALERT'
        $script:OnBatterySince = $null
        Close-OutageEvent
        Publish-Events
      }
      $script:ConfirmCount = 0
      if ($script:ShutdownIssued) {
        Stop-PendingShutdown
        $script:ShutdownIssued = $false
      }
    }

    if ($UseMqtt -and -not $script:Mqtt) { Connect-Mqtt | Out-Null }
    Publish-State $s $script:LastOutlet
    if ($script:Current) { Publish-Events }   # cap nhat su kien dang dien ra

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
      "O cam P1     : $script:LastOutlet"       | Write-Host
      "So su kien   : $($script:Events.Count)"  | Write-Host
      break
    }

    $wait = if ($s.OnBattery) { $Cfg.Poll.OnBatterySeconds } else { $Cfg.Poll.NormalSeconds }
    Wait-Tick $wait
  }
} finally {
  # Mat dien dot ngot: giu lai su kien dang do de khong mat du lieu
  if ($script:Current) {
    $script:Current.duration_s = [int]((Get-Date) - [datetime]$script:Current.start).TotalSeconds
    $script:Events += ,$script:Current
    Save-Events
  }
  if ($script:Mqtt) {
    try {
      $script:Mqtt.Publish($TAvail, 'offline', $true) | Out-Null
      $script:Mqtt.Dispose()
    } catch { }
  }
  Write-Log '===== Ups-Monitor ket thuc ====='
}
