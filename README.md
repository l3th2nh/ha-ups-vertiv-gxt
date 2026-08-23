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

---

# Độ phân giải phần trăm pin — CHƯA kết luận được

Đo 8 lần liên tiếp lúc UPS đang sạc đầy:

```
QBV -> (082.1 06 01 100 099
       (082.1 06 01 100 192
       (082.0 06 01 100 200
       (082.1 06 01 100 215
       (082.1 06 01 100 194
       (082.1 06 01 100 096
       (082.0 06 01 100 206
       (082.1 06 01 100 183
                     ^^^ ^^^
                      %  phút
```

**Phần trăm luôn đúng bằng `100`.** Ở trạng thái sạc đầy thì mọi thang đo — dù liên tục
0–100 hay chỉ có bước 0/25/50/75/100 — đều cho ra `100`. **Không thể phân biệt nếu không xả pin.**
Cách duy nhất kết luận: ngắt điện đầu vào UPS và quan sát chuỗi giá trị khi nó tụt xuống.

**Phát hiện đáng lo hơn:** cột **số phút dự phòng nhiễu rất nặng** — 8 lần đọc cách nhau
~1.2 giây cho ra **96 → 192 → 200 → 215 → 194 → 96 → 206 → 183**. Biên độ hơn gấp đôi.
Vì vậy **không nên** dùng `RuntimeMinutesBelow` làm chốt chặn duy nhất.

Kết luận thiết kế: dùng **điện áp pin** làm ngưỡng chính (`BatteryVoltageBelow`).
Nó có độ phân giải 0.1V (đo được 082.0 / 082.1, chỉ dao động 0.1V) nên ổn định nhất
trong ba nguồn tín hiệu. Ba ngưỡng còn lại giữ vai trò lưới an toàn chồng lên nhau —
điều kiện nào chạm trước thì kích hoạt trước.

## Bài kiểm tra thực tế nên làm (~2 phút)

Rút phích cắm **đầu vào** UPS (không rút tải) khoảng 60–90 giây, trong lúc đó chạy:

```powershell
cd D:\Iot\ups
. .\UpsHid.ps1
1..40 | ForEach-Object {
  '{0}  {1}  {2}' -f (Get-Date -Format 'HH:mm:ss'), (Invoke-UpsCommand 'QMOD'), (Invoke-UpsCommand 'QBV')
  Start-Sleep -Seconds 2
}
```

Bài này trả lời cùng lúc 4 câu:
1. Phần trăm pin nhảy theo bước bao nhiêu
2. Số phút dự phòng lúc chạy pin có ổn định hơn không
3. `QMOD` có thật sự đổi `L` → `B` không (xác thực toàn bộ đường phát hiện mất điện)
4. 12 bit trạng thái `QGS` — so chuỗi lúc có điện và lúc mất điện để giải mã bit nào là gì

---

# Dữ liệu HA đến từ đâu?

```
UPS ──USB(HID)──> MÁY TÍNH NÀY ──MQTT/WiFi──> Mosquitto ──> Home Assistant
     Cypress 0665:5161      Ups-Monitor.ps1    192.168.0.146
```

**Home Assistant nhận dữ liệu từ MÁY TÍNH NÀY, không phải trực tiếp từ UPS.**
Bản thân UPS không có cổng mạng — nó chỉ có USB và khe IntelliSlot (đang trống).

Hệ quả quan trọng: **máy tính tắt thì HA mất số liệu UPS.** Bộ giám sát có Last Will nên
HA sẽ hiện `unavailable` ngay chứ không treo số liệu cũ — card panel bắt trạng thái này
và hiện băng cảnh báo.

**Muốn HA đọc thẳng từ UPS, độc lập với máy tính:** cần lắp card mạng
**Liebert IntelliSlot** (IS-UNITY-DP / RDU101) vào khe IntelliSlot của GXT3. Khi đó UPS
có IP riêng, nói SNMP + web, và HA đọc trực tiếp. Đây là phần cứng phải mua thêm.

---

# Cài panel vào HA qua HACS

Repo này vừa là Windows agent, vừa là HACS plugin (`hacs.json` + `dist/ups-panel-card.js`).

1. Push repo lên GitHub.
2. HA → **HACS → Frontend → ⋮ → Custom repositories**
   URL = repo của bạn, Category = **Lovelace**.
3. Cài **UPS Vertiv GXT Panel**, xong Ctrl+F5.
4. Thêm card vào dashboard:

```yaml
type: custom:ups-panel-card
prefix: ups
name: UPS Vertiv GXT-3000
show_controls: true
```

Agent đặt `obj_id` trong discovery nên entity_id **cố định và đoán trước được**:
`sensor.ups_battery_percent`, `sensor.ups_mode_text`, `binary_sensor.ups_on_battery`,
`button.ups_pc_shutdown`… Nhờ vậy card chỉ cần biết tiền tố `ups`.

---

# Tắt / bật máy tính từ xa

## Tắt và khởi động lại — ĐÃ LÀM XONG

Agent subscribe topic `ups/vertiv_gxt3000/cmd`. HA tự tạo 3 nút:

| Entity | Payload | Việc thực hiện |
|---|---|---|
| `button.ups_pc_shutdown` | `shutdown` | `shutdown /s /f /t 30` |
| `button.ups_pc_restart` | `restart` | `shutdown /r /f /t 30` |
| `button.ups_cancel_shutdown` | `cancel` | `shutdown /a` |

Card panel có sẵn 3 nút này kèm hộp xác nhận. Chỉnh thời gian đếm ngược ở
`RemoteControl.GraceSeconds`.

> **Cảnh báo bảo mật:** bất kỳ ai truy cập được broker MQTT đều tắt được máy này.
> Đặt `RemoteControl.Enabled = $false` nếu không cần.
>
> Lệnh retained được xoá ngay sau khi xử lý, tránh việc máy tự tắt lặp lại mỗi lần
> agent kết nối lại.

## Bật máy từ xa — CẦN CẮM DÂY MẠNG

Wake-on-LAN đã sẵn sàng ở phía Windows. `powercfg /devicequery wake_armed` cho thấy
**cả hai card Ethernet đều đã được phép đánh thức máy**:

| Card | MAC | Trạng thái |
|---|---|---|
| Intel I211 Gigabit | `40-16-7E-A4-D2-93` | **Chưa cắm dây** |
| Intel I219-V | `10-7B-44-16-25-5D` | **Chưa cắm dây** |
| Qualcomm QCA61x4A (WiFi) | `6E-0B-8A-27-A6-AB` | Đang dùng — **WoL không khả dụng** |

Máy đang chạy WiFi, mà **Wake-on-WLAN trên chip Qualcomm này không dùng được thực tế**.
Nên **muốn bật máy từ xa thì phải cắm dây LAN.**

Sau khi cắm dây, thêm vào `configuration.yaml` của HA:

```yaml
wake_on_lan:

switch:
  - platform: wake_on_lan
    name: PC UPS
    mac: "40:16:7E:A4:D2:93"      # doi theo cong Ethernet ban cam that
    host: 192.168.0.196
    turn_off:
      service: button.press
      target:
        entity_id: button.ups_pc_shutdown
```

Hai điều kiện phía BIOS/Windows cần kiểm tra thêm:
- BIOS: bật **Wake on LAN** / **Power On by PCI-E**
- Windows: **tắt Fast Startup** (Control Panel → Power Options → Choose what the power
  buttons do). Fast Startup khiến máy vào trạng thái hybrid và thường làm WoL từ trạng
  thái tắt hẳn không hoạt động.

---

# Ổ cắm lập trình được (PROGRAMMABLE OUTLETS P1)

Mặt sau UPS có **hai dãy ổ**:

| Dãy | Nhãn | Hành vi |
|---|---|---|
| Trái (3 ổ C13) | `OUTPUT` | **Luôn có điện** khi UPS chạy |
| Phải (3 ổ) | `PROGRAMMABLE OUTLETS (P1)` | **Tự ngắt sau một khoảng chạy pin** để dành pin cho tải quan trọng |

## Lệnh đã kiểm chứng thực tế

| Lệnh | Phản hồi | Tác dụng |
|---|---|---|
| `QSK1` | `(1` / `(0` | Đọc trạng thái P1 (1 = đang bật) |
| `SKON1` | `(ACK` | **Bật P1** — đã xác nhận chạy đúng |
| `SKOFF1` | (chưa thử) | Tắt P1 — cùng họ lệnh |

> Chỉ có `QSK1` tồn tại. `QSK2`/`QSK3`/`QSK4` đều trả `(NAK` → UPS này chỉ có **một** nhóm ổ lập trình được.

## Quy ước phản hồi của firmware này

Đây là điểm quan trọng để đọc log về sau:

- **`(ACK`** = lệnh ghi được chấp nhận và đã thực thi
- **`(NAK`** = lệnh bị từ chối, **không** có tác dụng gì

`SKON1` trả `(ACK`, còn `PDa` / `PEa` / mọi lệnh kèm CRC đều trả `(NAK`.
Vì vậy họ lệnh `PE`/`PD` thực sự không được firmware hỗ trợ và không đổi được gì.

## ⚠️ CẢNH BÁO BỐ TRÍ TẢI

**KHÔNG cắm máy tính (hoặc NAS, hoặc bất kỳ thiết bị nào cần tắt êm) vào dãy P1.**

P1 được thiết kế để **tự ngắt khi chạy pin**. Cắm máy tính vào đó thì mỗi lần mất điện,
máy sẽ bị **cắt điện đột ngột** sau vài phút — đúng thứ mà cả hệ thống UPS và script
tự-tắt-máy này sinh ra để phòng tránh.

- Máy tính, NAS, ổ cứng ngoài → dãy **`OUTPUT`** (luôn có điện)
- Màn hình, loa, đèn, sạc điện thoại → dãy **`P1`** (ngắt được để kéo dài pin)

Bố trí đúng như vậy thì P1 trở thành công cụ hữu ích: khi mất điện, các tải không thiết
yếu tự rụng, dồn toàn bộ pin cho máy tính và NAS.
