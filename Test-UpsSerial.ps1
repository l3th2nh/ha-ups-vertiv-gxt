<#
.SYNOPSIS
  Do tim tham so RS-232 cua UPS truoc khi build ESP32.

  Manual KHONG ghi toc do baud lan so do chan cua cong RS-232, nen phai do
  thuc te. Script quet moi cong COM x moi toc do baud x cac to hop DTR/RTS,
  gui lenh chi-doc 'QGS' va bao cau hinh nao co phan hoi.

.DESCRIPTION
  CHUAN BI PHAN CUNG
    1. RUT cap USB khoi UPS  (manual: "USB port and RS-232 port can't work
       at the same time" - cam ca hai thi RS-232 se im lang)
    2. Cam cap USB-to-DB9 RS-232 that (vi du Prolific PL2303) vao cong
       RS-232 cua UPS. Module CP210x/CH340 la muc TTL, KHONG dung truc tiep
       duoc voi RS-232 (+/-12V) - se khong doc duoc, va co the hong chip.
    3. Chay script nay.

  Sau khi do xong, cam lai cap USB de agent chay tiep nhu cu.

.EXAMPLE
  .\Test-UpsSerial.ps1
.EXAMPLE
  .\Test-UpsSerial.ps1 -Port COM4 -Baud 2400
#>
[CmdletBinding()]
param(
  [string]$Port,
  [int]$Baud,
  [int]$TimeoutMs = 1200
)

$ErrorActionPreference = 'Continue'

# 2400 dat truoc: chuan Megatec/Voltronic thuong dung toc do nay
$BAUDS = if ($Baud) { @($Baud) } else { @(2400, 9600, 1200, 4800, 19200, 38400) }

# Mot so UPS can DTR len cao de cap nguon cho opto-coupler ben trong,
# va RTS xuong thap. Thu ca 3 to hop pho bien.
$FLOW = @(
  @{ Name = 'DTR=on  RTS=off'; Dtr = $true;  Rts = $false }
  @{ Name = 'DTR=on  RTS=on';  Dtr = $true;  Rts = $true  }
  @{ Name = 'DTR=off RTS=off'; Dtr = $false; Rts = $false }
)

# Lenh chi-doc, khong lam gi den UPS
$PROBES = @('QGS', 'QMOD', 'QPI', 'Q1')

function Test-OneCombo {
  param([string]$PortName, [int]$BaudRate, [hashtable]$Flow)

  $sp = New-Object System.IO.Ports.SerialPort $PortName, $BaudRate, 'None', 8, 'One'
  $sp.ReadTimeout = $TimeoutMs
  $sp.WriteTimeout = 1000
  $sp.NewLine = "`r"
  $sp.DtrEnable = $Flow.Dtr
  $sp.RtsEnable = $Flow.Rts
  $sp.Handshake = 'None'

  $results = @()
  try {
    $sp.Open()
    Start-Sleep -Milliseconds 250    # cho opto/UPS on dinh sau khi DTR len
    foreach ($cmd in $PROBES) {
      try {
        $sp.DiscardInBuffer(); $sp.DiscardOutBuffer()
        $sp.Write($cmd + "`r")
        Start-Sleep -Milliseconds 350
        $buf = ''
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
          if ($sp.BytesToRead -gt 0) {
            $buf += $sp.ReadExisting()
            if ($buf.Contains("`r")) { break }
          } else { Start-Sleep -Milliseconds 40 }
        }
        $clean = $buf.Trim() -replace "`r", '<CR>' -replace "`n", '<LF>'
        if ($clean) { $results += [pscustomobject]@{ Cmd = $cmd; Reply = $clean } }
      } catch { }
    }
  } catch {
    return @{ Error = $_.Exception.Message.Split([char]10)[0]; Results = @() }
  } finally {
    try { if ($sp.IsOpen) { $sp.Close() } } catch { }
    try { $sp.Dispose() } catch { }
  }
  return @{ Error = $null; Results = $results }
}

# ------------------------------------------------------------------ main ---
Write-Host ''
Write-Host '=== Do tham so RS-232 cua UPS ===' -ForegroundColor Cyan
Write-Host ''

$ports = if ($Port) { @($Port) } else { [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object }

if (-not $ports -or $ports.Count -eq 0) {
  Write-Host 'KHONG THAY CONG COM NAO.' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Kiem tra:' -ForegroundColor Yellow
  Write-Host '  1. Da cam cap USB-to-DB9 (RS-232 that) vao may chua?'
  Write-Host '  2. Da RUT cap USB khoi UPS chua? (khong dung duoc ca hai cung luc)'
  Write-Host '  3. Cap co phai RS-232 that khong? CP210x/CH340 la TTL, khong dung duoc.'
  return
}

Write-Host ("Cong COM tim thay: {0}" -f ($ports -join ', ')) -ForegroundColor Gray
Write-Host ("Toc do se thu    : {0}" -f ($BAUDS -join ', ')) -ForegroundColor Gray
Write-Host ''

$hit = $null
foreach ($p in $ports) {
  foreach ($b in $BAUDS) {
    foreach ($f in $FLOW) {
      Write-Host ("  {0} @ {1,-6} {2} ... " -f $p, $b, $f.Name) -NoNewline
      $r = Test-OneCombo -PortName $p -BaudRate $b -Flow $f

      if ($r.Error) { Write-Host "loi: $($r.Error)" -ForegroundColor DarkGray; continue }
      if ($r.Results.Count -eq 0) { Write-Host 'im lang' -ForegroundColor DarkGray; continue }

      Write-Host 'CO PHAN HOI' -ForegroundColor Green
      foreach ($x in $r.Results) { Write-Host ("      {0,-5} -> {1}" -f $x.Cmd, $x.Reply) -ForegroundColor Green }
      if (-not $hit) { $hit = @{ Port = $p; Baud = $b; Flow = $f.Name; Results = $r.Results } }
    }
  }
}

Write-Host ''
if ($hit) {
  Write-Host '=== KET QUA ===' -ForegroundColor Green
  Write-Host "  Cong : $($hit.Port)"
  Write-Host "  Baud : $($hit.Baud)"
  Write-Host "  Flow : $($hit.Flow)"
  Write-Host ''
  Write-Host '  Dung cac tham so nay cho firmware ESP32.' -ForegroundColor Green
} else {
  Write-Host '=== KHONG CO CAU HINH NAO PHAN HOI ===' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Kha nang:' -ForegroundColor Yellow
  Write-Host '  - Cap USB van con cam o UPS (phai rut ra)'
  Write-Host '  - Cap dung la loai TTL chu khong phai RS-232 that'
  Write-Host '  - So do chan cua UPS khong chuan -> can cap cheo (null-modem)'
  Write-Host '    hoac cap rieng cua hang'
  Write-Host '  - Cong RS-232 cua UPS bi khoa khi Intelligent slot dang co card'
}
Write-Host ''
