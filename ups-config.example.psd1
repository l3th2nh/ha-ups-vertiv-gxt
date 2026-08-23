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

  # Nhat ky su kien mat dien / co dien lai
  Events = @{
    KeepCount = 50   # so su kien gan nhat giu lai (file + day len HA)
  }

  Shutdown = @{
    Enabled = $true

    # Tat may khi DANG CHAY PIN va thoa BAT KY dieu kien nao duoi day.
    # Dat 0 de tat tung dieu kien.

    # (1) Theo dien ap pin - do phan giai 0.1V nen dang tin cay NHAT.
    #     Pack 6 binh x 12V = 72V danh dinh. Float ~82V. Cat tai ~63V (10.5V/binh).
    #     66.0V ~ 11.0V/binh = con it nhung chua kiet -> du thoi gian tat may.
    BatteryVoltageBelow = 66.0

    # (2) Theo phan tram pin. Da do thuc te: buoc nhay 1% (98 -> 97 -> 96...),
    #     KHONG phai buoc 25% nhu lo ngai ban dau.
    BatteryPercentBelow = 25

    # (3) Theo so phut UPS uoc tinh con lai.
    #     CANH BAO: gia tri nay nhieu RAT nang - do duoc 96..215 phut giua cac
    #     lan doc cach nhau 1.2 giay, ke ca khi dang chay pin. Chi nen de lam
    #     luoi an toan cuoi cung, khong dung lam chot chan chinh.
    RuntimeMinutesBelow = 10

    # (4) Da chay pin lien tuc qua N giay (0 = bo qua).
    OnBatterySecondsAbove = 0

    # So lan doc lien tiep phai cung thoa dieu kien truoc khi hanh dong
    # (chong nhieu / doc loi nhat thoi).
    ConfirmReadings = 3

    # Dem nguoc truoc khi tat. Neu dien co lai trong khoang nay -> tu dong HUY.
    GraceSeconds = 60
  }

  # Dieu khien tu xa qua MQTT. MAC DINH TAT - he chi DOC va GHI NHAT KY.
  #
  # Khi bat, agent chi SUBSCRIBE topic  <BaseTopic>/cmd  va chap nhan 3 payload:
  #   shutdown | restart | cancel
  # KHONG co nut nao duoc tao san trong HA (panel card cung khong co nut).
  # Muon dung thi tu tao automation trong HA publish vao topic do.
  #
  # CANH BAO: khi bat, ai truy cap duoc broker MQTT deu co the tat may nay.
  RemoteControl = @{
    Enabled      = $false
    GraceSeconds = 30
  }

  Mqtt = @{
    Enabled         = $true
    Host            = '192.168.1.10'   # <<< DIEN IP HOME ASSISTANT CUA BAN
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
