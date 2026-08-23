# UPS Vertiv/Liebert GXT-3000MTPLUS230 — Kết quả dò giao thức

## Phần cứng đã xác minh (2026-08-23)

| Mục | Giá trị |
|---|---|
| Model ghi trên nhãn | GXT-3000MTPLUS230 (3000VA / 2400W) |
| Model UPS tự báo (`QMD`) | `G3K` — 3000VA, PF 0.80 → **2400W**, 1 pha/1 pha, 230V/230V |
| Model firmware (`I`) | `HV 3K`, ver `00007207` |
| Firmware (`QVFW`) | `VERFW:00072.07` |
| Định mức (`F` / `QRI`) | 230.0V, 13A, battery 72.0V, 50.0Hz |
| Cấu hình bình | 6 bình × 12V = 72V nominal (`QMD`, `QBV`) |

## Đường truyền USB

- Cầu nối: **Cypress USB-HID bridge**, `VID_0665` / `PID_5161`
- Instance: `HID\VID_0665&PID_5161\7&146E9F30&0&0000` (ProblemCode 0 = OK)
- HID caps: UsagePage `0xFF00` (vendor-defined), Usage `0x0001`
- Report: Input 9 byte / Output 9 byte (1 byte report-ID + 8 byte payload)
- Không có string descriptor (Manufacturer/Product đều rỗng) — bình thường với cầu Cypress
- Ghi lệnh: `HidD_SetOutputReport`, payload chia khối 8 byte, kết thúc bằng CR
- Đọc: `ReadFile`, gom khối 8 byte đến khi gặp CR

> **QUAN TRỌNG:** vì UsagePage là `0xFF00` chứ không phải `0x84` (HID Power Device),
> Windows **KHÔNG** nhận UPS này là pin. `Win32_Battery` trả về rỗng.
> ⇒ Tính năng "critical battery action" có sẵn của Windows KHÔNG dùng được.
> Bắt buộc phải có phần mềm giám sát riêng.

## Giao thức

**Voltronic PI01** (`QPI` → `(PI01`) — KHÔNG phải Megatec/Q1 đời cũ.
`Q1` và `QS` đều trả `(NAK`.

### Lệnh chỉ-đọc đã kiểm chứng

| Lệnh | Phản hồi mẫu | Ý nghĩa |
|---|---|---|
| `QPI` | `(PI01` | Phiên bản giao thức |
| `QMOD` | `(L` | Chế độ hiện tại (xem bảng dưới) |
| `QGS` | `(244.5 50.2 229.9 50.2 000.8 006 373.3 374.3 082.0 ---.- 026.4 100000000001` | Trạng thái tổng hợp |
| `QBV` | `(082.0 06 01 100 102` | Battery: V, số bình, số pack, %, số phút còn lại |
| `QWS` | `(0000...0` (64 số 0) | Cờ cảnh báo — toàn 0 = không lỗi |
| `QFLAG` | `(EpbrahczDovegfjlm` | Cờ bật (sau `E`) / tắt (sau `D`) |
| `QVFW` | `(VERFW:00072.07` | Firmware |
| `QRI` | `(230.0 013 072.0 50.0` | Thông số định mức |
| `QMD` | `(############G3K ###3000 80 1/1 230 230 06 12.0` | Thông tin model |
| `I` | `#                HV 3K      00007207  ` | Model + version |
| `F` | `#230.0 013 072.0 50.0` | Định mức |
| `QHE` | `(242 218` | Ngưỡng dải điện áp high-efficiency |

Không hỗ trợ: `QPIRI`, `QPIGS` (đều `(NAK`).

### Bố cục trường `QGS`

`(1:InV 2:InHz 3:OutV 4:OutHz 5:OutA 6:Load% 7:BUS+ 8:BUS- 9:BattV 10:BattCell 11:TempC 12:StatusBits`

### Bố cục trường `QBV`

`(1:BattV 2:SốBình 3:SốPackSongSong 4:Dung lượng% 5:Số phút backup còn lại`

### Bảng mã `QMOD`

| Mã | Nghĩa |
|---|---|
| `P` | Power On (đang khởi động) |
| `S` | Standby |
| `Y` | Bypass |
| `L` | **Line — chạy điện lưới (bình thường)** |
| `B` | **Battery — ĐANG CHẠY PIN** |
| `T` | Battery Test |
| `F` | Fault |
| `E` | ECO |
| `C` | Converter |
| `D` | Shutdown |

> Logic tắt máy nên dựa vào `QMOD` + `QBV` (rõ nghĩa, không mơ hồ),
> KHÔNG nên dựa vào 12 bit trạng thái cuối của `QGS` — thứ tự bit chưa được
> kiểm chứng trên model này (bit đầu = `1` trong khi lưới điện vẫn bình thường,
> nên không thể là "Utility Fail" như tài liệu Voltronic chung mô tả).
> Muốn xác định chính xác: rút điện đầu vào UPS vài giây rồi so sánh chuỗi bit.

## ⚠️ Lệnh NGUY HIỂM — tuyệt đối không gửi khi đang thử nghiệm

- `T` / `T<nn>` — kích hoạt battery test
- `S<nn>` / `S<nn>R<mmmm>` — hẹn giờ **TẮT UPS** (mất điện toàn bộ tải)
- `C` / `CT` — hủy lệnh, nhưng chỉ dùng khi biết rõ ngữ cảnh

## Cách dùng

```powershell
. .\UpsHid.ps1

Get-UpsStatus            # trạng thái đã giải mã
Invoke-UpsCommand 'QGS'  # gửi lệnh thô
Get-UpsHidPath           # đường dẫn HID (tự dò)
```

## Trạng thái đo được lúc kiểm tra

```
Mode           : L  (Line - chạy điện lưới)
InputVoltage   : 242.5 V   @ 50.2 Hz
OutputVoltage  : 229.6 V   @ 50.2 Hz
OutputCurrent  : 0.8 A     (Load 10%)
BatteryVoltage : 82.1 V    (float charge, pack 72V)
BatteryPercent : 100 %
RuntimeMinutes : 164 phút
TemperatureC   : 26.4 °C
HasWarning     : False
```

---

# Bộ giám sát & tự tắt máy

## Các file

| File | Vai trò |
|---|---|
| `UpsHid.ps1` | Thư viện nói chuyện với UPS qua USB-HID (P/Invoke `hid.dll`) |
| `MqttLite.ps1` | MQTT 3.1.1 client tối giản, thuần .NET — không cần cài thư viện |
| `ups-config.psd1` | **File cấu hình duy nhất cần sửa** |
| `Ups-Monitor.ps1` | Vòng lặp giám sát: đọc → publish → quyết định tắt máy |
| `Install-UpsMonitor.ps1` | Đăng ký Scheduled Task chạy nền dưới quyền SYSTEM |
| `logs/` | Log xoay vòng |

## Cài đặt

1. Sửa `ups-config.psd1` — điền `Mqtt.Username` / `Mqtt.Password`.
2. Mở PowerShell **Run as administrator**:

```powershell
cd D:\Iot\ups
.\Install-UpsMonitor.ps1
```

## Kiểm tra

```powershell
.\Ups-Monitor.ps1 -Once -DryRun          # đọc 1 lần, in ra, không tắt máy
.\Ups-Monitor.ps1 -Once -DryRun -NoMqtt  # bỏ qua cả MQTT
.\Install-UpsMonitor.ps1 -Status         # trạng thái task + 15 dòng log cuối
Get-Content .\logs\ups-monitor.log -Tail 30 -Wait
```

## Logic tắt máy

Chỉ kích hoạt khi **`QMOD` = `B` (đang chạy pin)** và thỏa **bất kỳ** điều kiện:

- Dung lượng pin ≤ `BatteryPercentBelow` (mặc định 30%)
- UPS báo thời gian còn lại ≤ `RuntimeMinutesBelow` (mặc định 10 phút)
- Đã chạy pin liên tục ≥ `OnBatterySecondsAbove` (mặc định 0 = tắt điều kiện này)

Chống báo động giả: điều kiện phải đúng **`ConfirmReadings` lần đọc liên tiếp** (mặc định 3).
Khi chạy pin, chu kỳ đọc tự siết từ 15s xuống 5s.

Khi kích hoạt: chạy `shutdown /s /f /t 60`. **Nếu điện có lại trong 60s đếm ngược
→ tự động `shutdown /a` để hủy.**

## Tích hợp Home Assistant

Script publish MQTT Discovery nên HA tự tạo thiết bị, **không cần sửa `configuration.yaml`**.

- Broker: `192.168.0.146:1883`
- State topic: `ups/vertiv_gxt3000/state` (JSON, retained)
- Availability: `ups/vertiv_gxt3000/availability` — có **Last Will**, nên PC mất điện đột ngột
  thì HA thấy `offline` ngay
- Discovery: `homeassistant/{sensor,binary_sensor}/vertiv_gxt3000/+/config` (retained)

**13 entity được tạo:** Battery %, Runtime, Load, Input/Output Voltage, Battery Voltage,
Input/Output Frequency, Output Current, Temperature, Status, + 2 binary sensor
(On Battery, Fault).

Nhờ có sẵn trên HA, bạn có thể làm automation kiểu: mất điện → thông báo
`notify.mobile_app_*`; pin < 50% → tắt bớt thiết bị không thiết yếu.

## Bảo mật

`ups-config.psd1` chứa mật khẩu MQTT dạng plaintext. Trình cài đặt tự chạy `icacls`
để chỉ `SYSTEM` + `Administrators` + user hiện tại đọc được. Nên tạo **tài khoản MQTT
riêng** cho UPS thay vì dùng tài khoản HA chính.

## Chưa làm (cân nhắc sau)

Lệnh `S<nn>` tắt hẳn UPS sau khi PC đã shutdown — giúp UPS không xả kiệt pin và tự bật
lại khi có điện. **Chưa bật** vì nó cắt điện toàn bộ tải, cần cân nhắc kỹ với NAS và các
thiết bị khác đang cắm chung.
