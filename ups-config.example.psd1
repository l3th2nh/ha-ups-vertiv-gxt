# ups-config.example.psd1
# ---------------------------------------------------------------------------
# COPY file nay thanh  ups-config.psd1  roi dien thong tin that.
# ups-config.psd1 da bi .gitignore chan, KHONG BAO GIO commit len GitHub.
# ---------------------------------------------------------------------------
@{
  Ups = @{
    Name  = 'UPS Vertiv GXT-3000MTPLUS230'
    Id    = 'vertiv_gxt3000'
    Model = 'GXT-3000MTPLUS230 (G3K, 3000VA / 2400W)'
    Maker = 'Vertiv / Liebert'
  }

  Poll = @{
    NormalSeconds    = 15   # chu ky doc khi chay dien luoi
    OnBatterySeconds = 5    # chu ky doc khi dang chay pin (doc day hon)
  }

  Shutdown = @{
    Enabled = $true

    # Tat may khi DANG CHAY PIN va thoa BAT KY dieu kien nao duoi day.
    # Dat 0 de tat tung dieu kien.

    # (1) Theo phan tram pin do UPS bao.
    #     LUU Y: chua kiem chung do phan giai that (xem README muc "Do phan giai
    #     phan tram pin"). Neu UPS chi bao theo buoc 25% thi moi gia tri 1..25
    #     deu hanh xu giong het nhau. Vi vay KHONG nen dung lam chot chan duy nhat.
    BatteryPercentBelow = 25

    # (2) Theo dien ap pin - do phan giai 0.1V nen dang tin cay nhat.
    #     Pack 6 binh x 12V = 72V danh dinh. Float ~82V. Cat tai ~63V (10.5V/binh).
    #     66.0V ~ 11.0V/binh = con it nhung chua kiet -> du thoi gian tat may.
    BatteryVoltageBelow = 66.0

    # (3) Theo so phut UPS uoc tinh con lai.
    #     LUU Y: luc chay dien luoi gia tri nay nhieu rat manh (do duoc 96..215
    #     phut trong 8 lan doc lien tiep). Khi chay pin thi on dinh hon nhieu.
    RuntimeMinutesBelow = 10

    # (4) Da chay pin lien tuc qua N giay (0 = bo qua).
    OnBatterySecondsAbove = 0

    # So lan doc lien tiep phai cung thoa dieu kien truoc khi hanh dong
    # (chong nhieu / doc loi nhat thoi).
    ConfirmReadings = 3

    # Dem nguoc truoc khi tat. Neu dien co lai trong khoang nay -> tu dong HUY.
    GraceSeconds = 60
  }

  # Dieu khien tu xa qua MQTT (HA tao san 3 nut bam).
  # CANH BAO: ai truy cap duoc broker MQTT deu co the tat may nay.
  RemoteControl = @{
    Enabled       = $true
    AllowShutdown = $true
    AllowRestart  = $true
    AllowOutletControl = $true   # bat/tat o cam P1 tu HA
    GraceSeconds  = 30   # dem nguoc khi bam nut tu HA
  }

  Mqtt = @{
    Enabled         = $true
    Host            = '192.168.0.146'
    Port            = 1883
    Username        = ''    # <<< DIEN TAI KHOAN MQTT
    Password        = ''    # <<< DIEN MAT KHAU MQTT
    ClientId        = 'ups-vertiv-win'
    BaseTopic       = 'ups/vertiv_gxt3000'
    DiscoveryPrefix = 'homeassistant'
  }

  Log = @{
    Directory = 'D:\Iot\ups\logs'
    MaxSizeMB = 5
    KeepFiles = 5
  }
}
