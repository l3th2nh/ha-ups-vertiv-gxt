# UPS Vertiv / Liebert GXT-3000MTPLUS230 → Home Assistant

Đọc UPS qua **RS-232** bằng **ESP32-C3 + ESPHome**, hiển thị trên panel `/ups` của
Home Assistant kèm cảnh báo mất điện gửi tới điện thoại.

```
UPS ──RS-232──> SP3232 ──TTL──> ESP32-C3 (ESPHome) ──WiFi──> Home Assistant
                                                                 ├── panel /ups
                                                                 └── cảnh báo → điện thoại
```

Thiết bị chạy 24/7 và độc lập với máy tính, nên không có lỗ hổng dữ liệu.

| Thư mục | Nội dung |
|---|---|
| [`esphome/`](esphome/) | Firmware ESPHome + component `ups_voltronic` |
| [`custom_components/ups_vertiv/`](custom_components/ups_vertiv/) | Integration HA: panel `/ups` + engine cảnh báo |

---

# 1. Phần cứng

| Món | Ghi chú |
|---|---|
| **ESP32-C3 Super Mini** | Loại nào cũng được; C3 cần cấu hình riêng (xem dưới) |
| **Module SP3232 breakout** | Chuyển RS-232 (±9V) ↔ TTL 3.3V. Loại **không gắn DB9**, tách rõ hai phía `TTL` và `RS232` |
| **Đầu hàn DB9 đực + cáp 3 sợi** | Cổng RS-232 của UPS là đầu **cái**. Chỉ cần 3 sợi: chân 2, 3, 5 |
| Củ sạc USB 5V | Cắm vào dãy `OUTPUT` của UPS |
| Đầu chuyển IEC C14 → ổ cắm 3 chân | Ổ ra của UPS là **IEC C13**, củ sạc không cắm thẳng được |

## Đấu nối

```
                ESP32-C3 Super Mini          Module SP3232
                ┌──────────────┐             ┌─────────────┐
   USB 5V ─────►│ USB-C        │             │             │
                │          3V3 ├────────────►│ VCC         │
                │          GND ├────────────►│ GND         │
                │       GPIO4  │◄────────────┤ TXD  2-RXD ├◄──── UPS chân 2
                │       GPIO5  ├────────────►│ RXD  3-TXD ├────► UPS chân 3
                └──────────────┘             │      5-GND ├───── UPS chân 5
                                             └─────────────┘
```

| SP3232 · phía TTL | ESP32-C3 | |
|---|---|---|
| `VCC` | **`3V3`** | **đừng cắm 5V** — sẽ đưa 5V vào chân GPIO |
| `GND` | `GND` | |
| `TXD` | `GPIO4` | dữ liệu từ UPS về |
| `RXD` | `GPIO5` | lệnh gửi sang UPS |

| SP3232 · phía RS232 | UPS DB9 | |
|---|---|---|
| `2-RXD` | **chân 2** | chân **PHÁT** của UPS |
| `3-TXD` | **chân 3** | chân **THU** của UPS |
| `5-GND` | **chân 5** | mass |

4 pad ở giữa board (`TTL-CTS`, `TTL-RTS`, `232-CTS`, `232-RTS`): **để trống**.

GPIO4/GPIO5 chọn có chủ ý: **tránh GPIO2, GPIO8, GPIO9** vì là chân strapping trên C3 —
GPIO8 còn là LED onboard, GPIO9 là nút BOOT.

## Cổng RS-232 — sơ đồ chân đã kiểm chứng

Máy này chạy **Voltronic PI01** (`QPI` → `(PI01`), không phải Megatec/Q1 đời cũ
(`Q1` và `QS` đều trả `(NAK`).

Cổng RS-232 của UPS đấu kiểu **DCE** — nối **THẲNG theo số**, không đấu chéo:

| UPS DB9 | Vai trò | Nối tới pad module |
|---|---|---|
| **chân 2** | **PHÁT** của UPS | `2-RXD` (đầu vào bộ thu) |
| **chân 3** | **THU** của UPS | `3-TXD` (đầu ra bộ phát) |
| **chân 5** | mass | `5-GND` |

Chỉ nối đúng ba dây này. Network UPS Tools cảnh báo cho dòng GXT: *"an RS-232 cable
with ONLY the RX, TX and ground pin must be used... the handshaking lines are used for
purposes other than RS-232 flow control. Use of a standard RS-232 cable with full
handshaking may result in undesired operation and/or shutdown."*

### ⚠️ Đừng suy diễn sơ đồ chân từ phép đo điện áp

Chân 3 đo được **−9 V**, và từ đó đã có kết luận sai rằng chân 3 là chân phát —
mất gần hai ngày vì suy diễn này. Mức âm chỉ chứng minh đó là **một** đầu ra đang
giữ MARK, **không** chứng minh nó là đường dữ liệu. Chân 3 trên máy này mang chức
năng khác.

Bằng chứng đúng là **phép thử chức năng**: quét lệnh × baud × parity rồi xem UPS có
trả lời không. Công cụ quét nằm ở [`esphome/ups-probe.yaml`](esphome/ups-probe.yaml).
Sơ đồ 9/6/7 của Megatec đời cũ **không áp dụng** cho máy này.

### Tham số cổng

| Mục | Giá trị |
|---|---|
| Baud | **2400** — chỉ tốc độ này có phản hồi |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |

### Sơ đồ chân DB9 — nhìn thẳng vào cổng

Cổng trên UPS là đầu **CÁI**, đầu hàn của bạn là **ĐỰC**. Hai loại đánh số **ngược
chiều** nhau để cắm khớp — đây là chỗ nhầm phổ biến nhất.

```
Nhìn thẳng vào đầu CÁI (9 lỗ):        Nhìn thẳng vào đầu ĐỰC (9 chân):
  ╭─────────────────────────╮           ╭─────────────────────────╮
  │  5    4    3    2    1  │           │  1    2    3    4    5  │
   ╲   9    8    7    6    ╱             ╲   6    7    8    9    ╱
    ╰─────────────────────╯               ╰─────────────────────╯
```

**Mặt hàn của đầu đực trùng với mặt cắm của đầu cái** — cả hai đều chạy `5 4 3 2 1`.
Lật một đầu nối ra sau là thứ tự đảo, bất kể đực hay cái.

Trên hầu hết đầu DB9 có số rất nhỏ đúc chìm cạnh chân **1**, **5**, **6**, **9**.

## ⚠️ Ba điểm dễ hỏng

**USB và RS-232 không dùng cùng lúc.** Manual ghi rõ: *"USB port and RS-232 port can't
work at the same time"*. Còn cắm cáp USB thì cổng RS-232 im lặng hoàn toàn.

**Nguồn phải lấy từ dãy `OUTPUT`, không phải `P1`.** Ổ P1 bị UPS tự ngắt sau vài phút
chạy pin — ESP32 sẽ chết đúng lúc cần nó nhất.

**Nhãn TXD/RXD trên module không thống nhất giữa các hãng.** Nếu không nhận được dữ
liệu, đảo hai sợi ở phía RS-232 (`2-RXD` ↔ `3-TXD`) rồi thử lại. Vô hại, không cháy gì —
và chính thao tác này đã gỡ được nút thắt lớn nhất của dự án.

---

# 2. Nạp firmware

```powershell
cd esphome
cp secrets.yaml.example secrets.yaml     # rồi điền WiFi
esphome run ups-vertiv.yaml              # lần đầu qua USB
```

Sau lần đầu, **cập nhật qua OTA**: `esphome run ups-vertiv.yaml` sẽ tự tìm thiết bị trên
mạng, không cần cắm dây.

## ⚠️ Phải build từ PowerShell, không dùng Git Bash

Chạy `esphome compile` / `esphome run` từ **Git Bash (MSys/Mingw)** sẽ bị ESP-IDF chặn:
nó in `MSys/Mingw is no longer supported...` rồi **thoát ngay, không biên dịch gì**.
ESPHome vẫn báo `Successfully compiled program` và vẫn đóng gói `firmware.factory.bin`
từ file `.bin` **cũ còn sót trong thư mục build**, rồi nạp lên chip.

Hậu quả: chip chạy firmware cũ, mọi thay đổi trong YAML biến mất không dấu vết.

Cách nhận biết chắc chắn: đối chiếu `.esphome/build/<tên>/build/<tên>.bin` — nếu mtime
của nó **cũ hơn** file YAML thì build đã không chạy. Build thật sự thành công khi log
có bảng báo cáo bộ nhớ (`RAM: ... Flash: ...`) và dòng `INFO Created: ... firmware.elf`.

Thiết bị dùng `api:` native của ESPHome nên HA **tự phát hiện** — vào
*Cài đặt → Thiết bị & Dịch vụ*, ESPHome sẽ đề xuất thêm `ups-vertiv`.

## Nếu không nhận được dữ liệu

Đọc log rồi phân biệt **hai triệu chứng khác hẳn nhau** — chúng chỉ về hai nguyên
nhân trái ngược:

| Log báo | Nghĩa | Làm gì |
|---|---|---|
| `nhan N byte nhung khong thanh khung` kèm hex toàn `00`/`FF` | Chân RX **thả nổi** — module không lái đường dây | Kiểm nguồn module: đèn `PWR`, đo `VCC` **ngay tại chân module**, đo chân `TXD` phía RS232 phải ≈ **−5,5 V** |
| `KHONG nhan duoc byte nao` | Đường dây **lành**, module đang giữ mức nghỉ, nhưng UPS không trả lời | Sai chân hoặc sai giao thức — xem dưới |

Với triệu chứng thứ hai, thử theo thứ tự:

1. **Đảo hai sợi phía RS-232** (`2-RXD` ↔ `3-TXD`). Đây là lỗi đã làm mất gần hai ngày
2. **Đã rút cáp USB khỏi UPS chưa** — manual ghi rõ hai cổng không dùng cùng lúc
3. **Nạp [`ups-probe.yaml`](esphome/ups-probe.yaml)** — quét lệnh × baud × parity và ghi
   lại mọi byte nhận được. Nạp qua OTA, một vòng đầy đủ mất khoảng 3 phút
4. Kiểm `VCC` có đúng 3.3V **đo tại chân module**, không đo ở phía ESP32

Phép thử dứt điểm cho phía ta: **nối tắt `GPIO4` với `GPIO5`** (bỏ module ra). Nếu log
dội lại đúng byte đã gửi (`51 4D 4F 44 0D` = `QMOD`) thì UART và firmware hoàn hảo, lỗi
nằm ngoài ESP32.

## Vì sao ESP32-C3 cần cấu hình riêng

| | ESP32 thường | **ESP32-C3** |
|---|---|---|
| UART | UART0/1/**2** | **chỉ UART0/1** |
| GPIO16/17 | có | **không có** |
| Serial monitor | qua chip CH340 | **USB CDC gốc** |

---

# 3. Cài panel vào Home Assistant

Repo này là **HACS integration**. Cài xong tự dựng mục **UPS** trên thanh bên tại `/ups`.

1. HACS → ⋮ → **Custom repositories** → dán URL repo, Kiểu = **Bộ tích hợp**
2. Tìm **UPS Vertiv GXT Panel** → Download → **khởi động lại HA**
3. *Cài đặt → Thiết bị & Dịch vụ → Thêm tích hợp* → **UPS Vertiv** → Submit

Panel có 3 tab:

| Tab | Nội dung |
|---|---|
| **Thông tin** | Sơ đồ dòng điện, thanh pin, thông số, trạng thái ổ P1 |
| **Nhật ký** | Lịch sử mất điện — dựng lại từ **recorder của HA**, không cần bộ nhớ riêng |
| **Cài đặt** | Bật/tắt cảnh báo, chọn điện thoại nhận thông báo, nút Gửi thử |

Card cũng dùng được ở dashboard khác mà không phải khai báo resource:

```yaml
type: custom:ups-panel-card
```

Card **tự dò tiền tố entity** (tìm entity kết thúc bằng `_output_current`) nên chạy được
kể cả khi bạn đổi tên thiết bị ESPHome.

## Cảnh báo mất điện

Panel → tab **Cài đặt** → chọn `notify.mobile_app_…` → **Lưu**. Bấm **Gửi thử** để kiểm
tra ngay, không phải chờ mất điện thật.

Báo 5 tình huống: mất điện · pin dưới ngưỡng cảnh báo · pin dưới ngưỡng nguy cấp ·
UPS ngắt ổ P1 · có điện lại.

Engine chạy nền trong integration, bám `async_track_state_change_event` nên phản ứng tức
thì. Cảnh báo pin chỉ bắn **một lần cho mỗi lần mất điện**, reset khi có điện lại.

---

# 4. Giao thức — kết quả dò thực tế

Phần này là kiến thức lõi, đã đo và kiểm chứng trên chính máy này.

## Thiết bị

| Mục | Giá trị |
|---|---|
| Model UPS tự báo (`QMD`) | `G3K` — 3000VA, PF 0.80 → **2400W**, 1 pha/1 pha, 230V/230V |
| Firmware (`QVFW`) | `VERFW:00072.07` |
| Định mức (`QRI`) | 230.0V, 13A, battery 72.0V, 50.0Hz |
| Cấu hình bình | 6 bình × 12V = 72V danh định |

## Giao thức **Voltronic PI01**

`QPI` → `(PI01`. **KHÔNG phải Megatec/Q1 đời cũ** — `Q1` và `QS` đều trả `(NAK`.

- Lệnh là ASCII thuần + `CR`, **KHÔNG kèm CRC** (kèm CRC bị trả `NAK`)
- Phản hồi bắt đầu bằng `(` và kết thúc bằng `CR`
- **`(ACK`** = lệnh ghi được chấp nhận · **`(NAK`** = bị từ chối, không có tác dụng

> `(NAK` **không tuyệt đối tin được**: đã bắt được `QFLAG` (lệnh đọc hợp lệ) trả `(NAK`
> một lần trong 12 lần đọc. Đừng kết luận "lệnh không được hỗ trợ" chỉ từ một lần NAK.

## Lệnh chỉ-đọc đã kiểm chứng

| Lệnh | Phản hồi mẫu | Ý nghĩa |
|---|---|---|
| `QMOD` | `(L` | Chế độ hiện tại |
| `QGS` | `(244.5 50.2 229.9 50.2 000.8 006 373.3 374.3 082.0 ---.- 026.4 100000000001` | Trạng thái tổng hợp |
| `QBV` | `(082.0 06 01 100 102` | Battery: V, số bình, số pack, %, số phút còn lại |
| `QWS` | `(0000…0` (64 số 0) | Cờ cảnh báo — toàn 0 = không lỗi |
| `QSK1` | `(1` / `(0` | Ổ cắm lập trình P1 |
| `QFLAG` | `(EpbrahczDovegfjlm` | Cờ bật (sau `E`) / tắt (sau `D`) |
| `QMD` | `(############G3K ###3000 80 1/1 230 230 06 12.0` | Thông tin model |

Không hỗ trợ: `QPIRI`, `QPIGS`, `QPGS0`, `QPRI`, `QBDR`, `PEa`/`PDa` — đều `(NAK`.

**Bố cục `QGS`:** `InV · InHz · OutV · OutHz · OutA · Load% · BUS+ · BUS− · BattV ·
BattCell · TempC · StatusBits`

**Bố cục `QBV`:** `BattV · SốBình · SốPackSongSong · Dung lượng% · Số phút backup`

## Bảng mã `QMOD`

| Mã | Alias | Hiển thị trên panel |
|---|---|---|
| `L` | `Line` | Điện lưới |
| `B` | `Battery` | Chạy pin |
| `Y` | `Bypass` | Chạy bypass |
| `F` | `Fault` | Lỗi UPS |
| `E` | `ECO` | Tiết kiệm điện |
| `C` | `Converter` | Chuyển đổi tần số |
| `S` | `Standby` | Chờ |
| `P` | `PowerOn` | Đang khởi động |
| `T` | `BatteryTest` | Đang kiểm tra pin |
| `D` | `Shutdown` | Đang tắt |

Firmware chỉ đẩy **alias tiếng Anh**; phần chữ tiếng Việt nằm trong `ups-panel-card.js`.
Muốn đổi câu chữ chỉ sửa một chỗ, **không phải nạp lại firmware**.

## ⚠️ Lệnh nguy hiểm — tuyệt đối không gửi

- `T` / `T<nn>` — kích hoạt battery test (chuyển tải sang pin)
- `S<nn>` / `S<nn>R<mmmm>` — **hẹn giờ TẮT UPS**, cắt điện toàn bộ tải

## Độ phân giải phần trăm pin: **bước 1%**

Đo trong lần xả pin thật: `098 → 097 → 096 → …`. Không phải bước 25%.

**Nhưng số phút dự phòng thì nhiễu rất nặng** — đo được `96 → 192 → 200 → 215 → 194 → 96`
giữa các lần đọc cách nhau 1.2 giây, kể cả khi đang chạy pin. Dùng nó để tham khảo,
đừng dùng làm chốt chặn duy nhất.

---

# 5. Ổ cắm lập trình P1

Mặt sau UPS có **hai dãy ổ**:

| Dãy | Nhãn | Hành vi |
|---|---|---|
| Trái | `OUTPUT` | **Luôn có điện** khi UPS chạy |
| Phải | `PROGRAMMABLE OUTLETS (P1)` | **Tự ngắt sau một khoảng chạy pin** |

Điều khiển trong menu LCD (giữ **`SELECT`** 5 giây khi UPS ở standby hoặc bypass):

| Mã | Mục | Giá trị |
|---|---|---|
| **06** | Programmable outlets enable/disable | ENA / DIS |
| **07** | Programmable outlets setting | **0–999 phút** |

Mục **07** chính là bộ đếm quyết định khi nào ổ P1 bị cắt.

> **KHÔNG cắm máy tính, NAS, hay ESP32 vào P1.** Đã từng có sự cố: PC cắm ở P1 bị cắt
> điện đột ngột giữa lúc test.

Lệnh serial (đã kiểm chứng): `QSK1` đọc trạng thái, **`SKON1`** bật (trả `(ACK`),
`SKOFF1` tắt. Panel hiện tại **chỉ đọc**, không điều khiển.

---

# 6. Còi báo — không điều khiển được qua serial

Manual mục 3-1:

> *Mute the alarm: When the UPS is on battery mode, press and hold this button for at
> least 5 seconds to disable or enable the alarm system.*

Đây là **toggle vật lý trên nút `ON/MUTE`**, và **chỉ tác dụng khi đang chạy pin**.
Manual không liệt kê lệnh serial nào cho còi báo; thực nghiệm cũng khớp — `PEa`/`PDa`
trả `(NAK` 21/21 lần trong khi `SKON1` trả `(ACK` cùng phiên.

**Bật lại còi:** rút điện lưới → giữ `ON/MUTE` 5 giây → kiểm biểu tượng mute trên LCD
đã biến mất → cắm điện lại.

---

# 7. Cổng EPO — đọc trước khi chạm vào

**EPO = Emergency Power Off**. Manual mục 2-2 Step 5:

> *Keep the pin 1 and pin 2 closed for UPS normal operation. To activate EPO function,
> cut the wire between pin 1 and pin 2.*

Mạch **thường ĐÓNG**: có cầu nối chân 1–2 thì UPS chạy bình thường.
**Ngắt mạch đó → UPS cắt toàn bộ đầu ra ngay lập tức.**

> ⚠️ Vì là mạch thường-đóng, **jumper lỏng hoặc rơi ra = mất điện toàn bộ tức khắc**.
> Kiểm tra cầu nối có cắm chắc không, đừng rút ra thử.

| Mã trên LCD | Tiếng còi | Xử lý |
|---|---|---|
| `E.P` | mỗi giây một tiếng | Nối lại mạch chân 1–2 |

EPO không đưa vào hệ giám sát: là mạch cứng, không đọc được qua serial.

---

# 8. Hai cổng "IN"/"OUT" — không phải RS485

Manual mục 2-1 hạng mục 5: **"Network/Fax/Modem surge protection"**. Chỉ là đường chống
sét đi xuyên qua, **không mang dữ liệu gì của UPS**.

Cổng giao tiếp thật: **USB** (7), **RS-232** (8), **SNMP intelligent slot** (9).

---

# 9. Đã gỡ bỏ

Phiên bản trước đọc UPS bằng agent PowerShell trên máy Windows qua USB-HID rồi đẩy MQTT.
Toàn bộ phần đó **đã xoá** vì máy tính không chạy 24/7 — và tệ hơn, đúng lúc mất điện lâu
thì máy tự tắt, mất khả năng theo dõi ở thời điểm cần nhất.

> **Khoảng trống còn lại:** tính năng **tự tắt máy tính an toàn khi sắp hết pin** đã mất
> theo. ESP32 chỉ đọc UPS, không tắt được máy tính. Cần lấp lại bằng automation trong HA
> (gọi lệnh tắt qua SSH, hoặc agent nhỏ nghe HA) — **chưa làm**.
