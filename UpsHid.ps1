# UpsHid.ps1 - Giao tiep truc tiep voi UPS Vertiv/Liebert GXT-3000MTPLUS230
# qua cau noi Cypress USB-HID (VID_0665 / PID_5161), giao thuc Megatec/Voltronic.
# Dot-source:  . .\UpsHid.ps1   roi dung:  Invoke-UpsCommand 'QGS'

$UpsHidCSharp = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class UpsHid {
  [DllImport("hid.dll")] public static extern bool HidD_SetOutputReport(IntPtr h, byte[] b, int len);
  [DllImport("hid.dll")] public static extern bool HidD_FlushQueue(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadFile(IntPtr h, byte[] buf, uint n, out uint read, IntPtr ov);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] public static extern bool CancelIo(IntPtr h);

  static IntPtr H = IntPtr.Zero;

  public static string Ask(string path, string cmd, int timeoutMs) {
    IntPtr h = CreateFileW(path, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.ToInt64() == -1) return "ERR:open:" + Marshal.GetLastWin32Error();
    HidD_FlushQueue(h);
    byte[] raw = Encoding.GetEncoding(28591).GetBytes(cmd + "\r");
    for (int off = 0; off < raw.Length; off += 8) {
      byte[] rep = new byte[9];
      for (int k = 0; k < 8 && off + k < raw.Length; k++) rep[k+1] = raw[off+k];
      if (!HidD_SetOutputReport(h, rep, 9)) { CloseHandle(h); return "ERR:write:" + Marshal.GetLastWin32Error(); }
    }
    var reply = new StringBuilder();
    H = h;
    var sw = System.Diagnostics.Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < timeoutMs && reply.Length < 250 && reply.ToString().IndexOf('\r') < 0) {
      byte[] buf = new byte[9]; uint got = 0; bool ok = false;
      var t = new Thread(delegate() { ok = ReadFile(H, buf, 9, out got, IntPtr.Zero); });
      t.IsBackground = true; t.Start();
      if (!t.Join(timeoutMs)) { CancelIo(h); break; }
      if (!ok) break;
      for (int k = 1; k < got; k++) { if (buf[k] == 0) continue; reply.Append((char)buf[k]); }
    }
    CloseHandle(h);
    return reply.ToString().TrimEnd('\r');
  }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'UpsHid').Type) {
  Add-Type -TypeDefinition $UpsHidCSharp
}

function Get-UpsHidPath {
  $d = Get-PnpDevice -Class HIDClass -ErrorAction SilentlyContinue |
       Where-Object { $_.InstanceId -like 'HID\VID_0665&PID_5161*' -and $_.Status -eq 'OK' } |
       Select-Object -First 1
  if (-not $d) { return $null }
  $bs = [string][char]92
  ($bs + $bs + '?' + $bs) + $d.InstanceId.Replace($bs, '#').ToLower() + '#{4d1e55b2-f16f-11cf-88cb-001111000030}'
}

function Invoke-UpsCommand {
  param([Parameter(Mandatory)][string]$Command, [int]$TimeoutMs = 2500)
  $p = Get-UpsHidPath
  if (-not $p) { return 'ERR:UPS-not-found' }
  [UpsHid]::Ask($p, $Command, $TimeoutMs)
}

# Chi day MA (alias) thuan ASCII - KHONG dat tieng Viet o day.
# Phan dich sang tieng Viet nam trong panel (ups-panel-card.js), nho vay
# file .ps1 khong phu thuoc bang ma va PowerShell 5.1 doc luon dung.
$Global:UpsModeMap = @{
  'P' = 'PowerOn'
  'S' = 'Standby'
  'Y' = 'Bypass'
  'L' = 'Line'
  'B' = 'Battery'
  'T' = 'BatteryTest'
  'F' = 'Fault'
  'E' = 'ECO'
  'C' = 'Converter'
  'D' = 'Shutdown'
}

function Get-UpsStatus {
  $qgs  = Invoke-UpsCommand 'QGS'
  $qbv  = Invoke-UpsCommand 'QBV'
  $qmod = Invoke-UpsCommand 'QMOD'
  $qws  = Invoke-UpsCommand 'QWS'

  if ($qgs -notlike '(*' -or $qbv -notlike '(*') { return $null }

  $sep = [char]32
  $opt = [System.StringSplitOptions]::RemoveEmptyEntries
  $g = $qgs.TrimStart('(').Split($sep, $opt)
  $b = $qbv.TrimStart('(').Split($sep, $opt)

  $modeChar = if ($qmod -like '(*') { $qmod.TrimStart('(').Trim() } else { '?' }
  $faulted  = ($qws -like '(*') -and ($qws.TrimStart('(') -match '1')

  [pscustomobject]@{
    Timestamp        = (Get-Date)
    Mode             = $modeChar
    ModeText         = $(if ($Global:UpsModeMap.ContainsKey($modeChar)) { $Global:UpsModeMap[$modeChar] } else { "Unknown-$modeChar" })
    OnBattery        = ($modeChar -eq 'B')
    InputVoltage     = [double]$g[0]
    InputFreq        = [double]$g[1]
    OutputVoltage    = [double]$g[2]
    OutputFreq       = [double]$g[3]
    OutputCurrent    = [double]$g[4]
    LoadPercent      = [int]$g[5]
    BusPositive      = [double]$g[6]
    BusNegative      = [double]$g[7]
    BatteryVoltage   = [double]$g[8]
    TemperatureC     = [double]$g[10]
    StatusBits       = $g[11]
    BatteryPercent   = [int]$b[3]
    RuntimeMinutes   = [int]$b[4]
    BatteryCount     = [int]$b[1]
    BatteryPacks     = [int]$b[2]
    WarningRaw       = $qws
    HasWarning       = $faulted
  }
}

# --- CRC16-CCITT (XMODEM) theo chuan Megatec/Voltronic -----------------------
# Poly 0x1021, init 0x0000. Byte CRC nao roi vao 0x28 '(' / 0x0D CR / 0x0A LF
# thi phai +1 (quy uoc cua giao thuc, tranh lan voi ky tu dong khung).
function Get-VoltronicCrc {
  param([Parameter(Mandatory)][string]$Text)
  $crc = 0
  foreach ($b in [System.Text.Encoding]::GetEncoding(28591).GetBytes($Text)) {
    $crc = ($crc -bxor ([int]$b -shl 8)) -band 0xFFFF
    for ($i = 0; $i -lt 8; $i++) {
      if ($crc -band 0x8000) { $crc = ((($crc -shl 1) -band 0xFFFF) -bxor 0x1021) }
      else                   { $crc = ($crc -shl 1) -band 0xFFFF }
    }
  }
  $hi = ($crc -shr 8) -band 0xFF
  $lo = $crc -band 0xFF
  if ($hi -in 0x28, 0x0D, 0x0A) { $hi++ }
  if ($lo -in 0x28, 0x0D, 0x0A) { $lo++ }
  , @([byte]$hi, [byte]$lo)
}

function Invoke-UpsCommandCrc {
  param([Parameter(Mandatory)][string]$Command, [int]$TimeoutMs = 2500)
  $c = Get-VoltronicCrc $Command
  $full = $Command + [char]$c[0] + [char]$c[1]
  Invoke-UpsCommand $full $TimeoutMs
}

# --- O cam lap trinh duoc (PROGRAMMABLE OUTLETS P1) --------------------------
# Da kiem chung thuc te tren GXT-3000MTPLUS230:
#   QSK1  -> (1 dang bat / (0 dang tat
#   SKON1 -> (ACK  (da xac nhan bat lai thanh cong)
#   SKOFF1        (cung ho lenh)
# Firmware tra (ACK khi chap nhan, (NAK khi tu choi va KHONG lam gi.
function Get-UpsOutlet {
  param([int]$Number = 1)
  $r = Invoke-UpsCommand "QSK$Number" 2000
  switch ($r) {
    '(1'    { 'ON' }
    '(0'    { 'OFF' }
    default { $null }
  }
}

function Set-UpsOutlet {
  param(
    [Parameter(Mandatory)][ValidateSet('ON','OFF')][string]$State,
    [int]$Number = 1
  )
  $cmd = if ($State -eq 'ON') { "SKON$Number" } else { "SKOFF$Number" }
  $r = Invoke-UpsCommand $cmd 3000
  [pscustomobject]@{
    Command  = $cmd
    Reply    = $r
    Accepted = ($r -eq '(ACK')
  }
}
