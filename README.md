# UPS Vertiv / Liebert GXT-3000MTPLUS230 → Home Assistant

Đọc UPS qua **RS-232** bằng **ESP32-C3 + ESPHome**, hiển thị trên panel `/ups` của
Home Assistant kèm cảnh báo mất điện gửi tới điện thoại.

```
UPS ──RS-232──> MAX3232 ──TTL──> ESP32-C3 (ESPHome) ──WiFi──> Home Assistant
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
| **Module MAX3232 có DB9** | Chuyển RS-232 (±12V) ↔ TTL 3.3V |
| **Cáp null-modem DB9 đực–đực** | Cổng RS-232 của UPS là đầu **cái**, module cũng **cái** |
| Củ sạc USB 5V | Cắm vào dãy `OUTPUT` của UPS |
| Đầu chuyển IEC C14 → ổ cắm 3 chân | Ổ ra của UPS là **IEC C13**, củ sạc không cắm thẳng được |

## Đấu nối

```
                ESP32-C3 Super Mini          Module MAX3232
                ┌──────────────┐             ┌─────────────┐
   USB 5V ─────►│ USB-C        │             │             │
                │          3V3 ├────────────►│ VCC         │
                │          GND ├────────────►│ GND         │      ┌───────┐
                │       GPIO4  │◄────────────┤ TXD         │      │  DB9  │
                │       GPIO5  ├────────────►│ RXD         │      │ (cái) │
                └──────────────┘             └─────────────┴──────┴───┬───┘
                                                                      │
                                              cáp null-modem đực–đực  │
                                                                      ▼
                                                          UPS · cổng RS-232
```

| MAX3232 | ESP32-C3 | |
|---|---|---|
| `VCC` | **`3V3`** | **đừng cắm 5V** — sẽ đưa 5V vào chân GPIO |
| `GND` | `GND` | |
| `TXD` | `GPIO4` | dữ liệu từ UPS về |
| `RXD` | `GPIO5` | lệnh gửi sang UPS |

GPIO4/GPIO5 chọn có chủ ý: **tránh GPIO2, GPIO8, GPIO9** vì là chân strapping trên C3 —
GPIO8 còn là LED onboard, GPIO9 là nút BOOT.

## ⚠️ Cổng RS-232 của UPS dùng chân PHI TIÊU CHUẨN

Đây là điểm quan trọng nhất của cả dự án, và không có trong bất kỳ manual nào của Vertiv.

Đặc tả giao thức Megatec quy định sơ đồ chân DB9 **khác hẳn** cổng COM máy tính:

```
COMPUTER           UPS
==========================
   RX    <---  TX  (pin 9)
   TX     --->  RX  (pin 6)
   GND   <---  GND (pin 7)
```

Cổng COM tiêu chuẩn (và mọi module MAX3232 bán sẵn) dùng **chân 2, 3, 5**.
UPS dùng **chân 9, 6, 7**.

**Hệ quả: không một sợi cáp DB9 bán sẵn nào chạy được** — cả cáp thẳng lẫn cáp
null-modem chéo 2-3 đều nối vào những chân mà UPS không dùng.

### Sơ đồ chân — nhìn thẳng vào cổng

Cổng RS-232 trên UPS là đầu **CÁI** (9 lỗ). Đầu cái đánh số **ngược chiều** với
đầu đực để hai bên cắm khớp nhau — đây là chỗ nhầm phổ biến nhất.

**Nhìn thẳng vào cổng trên UPS (thấy 9 lỗ):**

```
        ╭───────────────────────────╮
        │   5    4    3    2    1   │
         ╲    9    8    7    6     ╱
          ╰───────────────────────╯
              ▲         ▲    ▲
              │         │    │
            UPS PHÁT   GND  UPS THU
             (pin 9)  (pin7) (pin 6)
```

Cả ba chân cần dùng đều nằm ở **hàng dưới**. Hàng dưới đọc từ trái sang phải là
`9 · 8 · 7 · 6` — dùng hết trừ chân 8.

**Nhìn thẳng vào cổng DB9 của module MAX3232 (cũng là đầu CÁI):**

```
        ╭───────────────────────────╮
        │   5    4    3    2    1   │
         ╲    9    8    7    6     ╱
          ╰───────────────────────╯
            ▲         ▲    ▲
            │         │    │
           GND    module  module
          (pin 5)  PHÁT    THU
                  (pin 3) (pin 2)
```

Ba chân cần dùng ở đây nằm ở **hàng trên**: `5` ngoài cùng bên trái, rồi `3` và `2`.

> Nếu bạn dùng đầu chuyển ra terminal vít thì không cần nhớ vị trí — các cầu đấu
> đã đánh sẵn số 1–9, cứ theo số mà nối.

> Nếu hàn thẳng vào đầu DB9 **đực**, nhớ rằng nhìn từ mặt trước đầu đực thì số
> chạy ngược lại: hàng trên là `1 2 3 4 5`, hàng dưới là `6 7 8 9`.

### Phải tự làm cáp

| UPS (DB9) | → | Module MAX3232 (DB9) |
|---|---|---|
| chân **9** (UPS phát) | → | chân **2** (module thu) |
| chân **6** (UPS thu) | ← | chân **3** (module phát) |
| chân **7** (GND) | ↔ | chân **5** (GND) |

Cách làm không cần hàn chân DB9: mua **2 đầu chuyển DB9 đực ra terminal vít**
(khoảng 25–30k mỗi cái), cắm một cái vào UPS, một cái vào module, rồi nối 3 dây
giữa hai cầu đấu theo bảng trên.

### Tham số cổng (theo đặc tả Megatec)

| Mục | Giá trị |
|---|---|
| Baud | **2400** |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |

Nguồn: [Megatec protocol — Network UPS Tools](https://www.networkupstools.org/protocols/megatec.html)

## ⚠️ Ba điểm dễ hỏng

**USB và RS-232 không dùng cùng lúc.** Manual ghi rõ: *"USB port and RS-232 port can't
work at the same time"*. Còn cắm cáp USB thì cổng RS-232 im lặng hoàn toàn.

**Nguồn phải lấy từ dãy `OUTPUT`, không phải `P1`.** Ổ P1 bị UPS tự ngắt sau vài phút
chạy pin — ESP32 sẽ chết đúng lúc cần nó nhất.

**Nhãn TXD/RXD trên module MAX3232 không thống nhất giữa các hãng.** Nếu không nhận được
dữ liệu, đảo `tx_pin` ↔ `rx_pin` trong YAML rồi nạp lại. Vô hại, không cháy gì.

---

# 2. Nạp firmware

```bash
cd esphome
cp secrets.yaml.example secrets.yaml     # rồi điền WiFi
esphome run ups-vertiv.yaml              # lần đầu qua USB
```

Sau lần đầu, **cập nhật qua OTA**: `esphome run ups-vertiv.yaml` sẽ tự tìm thiết bị trên
mạng, không cần cắm dây.

Thiết bị dùng `api:` native của ESPHome nên HA **tự phát hiện** — vào
*Cài đặt → Thiết bị & Dịch vụ*, ESPHome sẽ đề xuất thêm `ups-vertiv`.

## Nếu không nhận được dữ liệu

Log sẽ báo `Khong co phan hoi cho 'QMOD'`. Thử theo thứ tự:

1. **Đã rút cáp USB khỏi UPS chưa** — nguyên nhân phổ biến nhất
2. **Đảo `tx_pin` ↔ `rx_pin`** trong `ups-vertiv.yaml`
3. **Đổi `baud_rate`**: manual không ghi tốc độ. Mặc định `2400` là chuẩn Megatec phổ
   biến nhất; thử lần lượt `9600` → `1200` → `4800` → `19200`. Mỗi lần chỉ cần OTA.
4. Đổi cáp null-modem sang đầu đổi giới tính thẳng
5. Kiểm `VCC` có đúng 3.3V

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
