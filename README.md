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

## Khi mạch mất kết nối

Đây là kiểu hỏng **nguy hiểm nhất** của cả hệ thống: mạch chết thì Home Assistant
im lặng, và bạn tưởng mình vẫn đang được bảo vệ trong khi thực ra thì không.

Panel có cảnh báo riêng cho việc này — bật ở tab *Cài đặt* → **"Mất kết nối với
mạch quá N phút"**. Có thời gian ân hạn để rớt mạng chớp nhoáng không đánh thức
bạn lúc nửa đêm. Khi mạch sống lại, nó báo tiếp một lần nữa.

### Nếu đổi tên hoặc mật khẩu WiFi

**Không cần tháo mạch ra nạp lại.** Khi không vào được mạng, ESP32 tự phát một
điểm truy cập tên **`UPS-Vertiv Fallback`**, mật khẩu `upsvertiv123`. Dùng điện
thoại nối vào đó, trình duyệt sẽ tự mở trang cấu hình — nhập tên và mật khẩu WiFi
mới, mạch lưu lại vào flash và tự vào mạng.

### Đọc `Reset Reason` để biết vì sao mạch khởi động lại

| Giá trị | Nghĩa |
|---|---|
| `Power on reset` · `Brownout` | **Mất nguồn** — kiểm ổ cắm, củ sạc, dây USB |
| `Software` · `Panic` · `Watchdog` | Firmware crash |
| `USB peripheral` | Vừa nạp lại qua USB — bình thường |

Nếu entity chuyển sang `unavailable` mà **không** kèm reboot, thì mạch vẫn sống,
chỉ mất WiFi.

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

Panel có 4 tab:

| Tab | Nội dung |
|---|---|
| **Thông tin** | Sơ đồ dòng điện, thanh pin, thông số, trạng thái ổ P1, tiêu thụ điện lưới |
| **Tiêu thụ** | Báo cáo theo ngày / tháng / năm, có biểu đồ cột |
| **Nhật ký** | Lịch sử mất điện — dựng lại từ **recorder của HA**, không cần bộ nhớ riêng |
| **Cài đặt** | Cảnh báo, điều khiển UPS, chọn ổ cắm để đo tiêu thụ |

Card cũng dùng được ở dashboard khác mà không phải khai báo resource:

```yaml
type: custom:ups-panel-card
```

Card **tự dò tiền tố entity** (tìm entity kết thúc bằng `_output_current`) nên chạy được
kể cả khi bạn đổi tên thiết bị ESPHome.

## ⚠️ Cập nhật xong mà app điện thoại vẫn hiện bản cũ

File JS được phục vụ kèm `?v=<phiên bản>`; trình duyệt coi mỗi phiên bản là một URL khác
nên tự nạp lại. Chỉ cần **khởi động lại HA** sau khi HACS tải bản mới — `add_extra_js_url`
và `panel_custom` chỉ sinh URL một lần lúc nạp integration.

Nếu vẫn thấy bản cũ, kiểm tra đúng hai chỗ này — cả hai từng hỏng và cùng gây ra một triệu
chứng: *máy tính thì đúng, điện thoại thì không*, vì Ctrl+F5 bỏ qua cache còn app thì không
có Ctrl+F5:

- `VERSION` trong `const.py` **đọc từ `manifest.json`**, không chép tay. Nó từng bị ghim
  cứng ở `4.0.0` suốt nhiều bản phát hành, nên `?v=` không bao giờ đổi.
- `ups-panel.js` import card phải **mang theo query string của chính nó**.
  `new URL('./x.js', import.meta.url)` vứt query đi, khiến card luôn được nạp từ một URL
  cố định.

Khi phát hành chỉ phải sửa **hai** chỗ: `version` trong `manifest.json` và
`UPS_CARD_VERSION` trong `ups-panel-card.js` (cái sau chỉ để hiện trên giao diện).

## ⚠️ "Không nạp được ups-panel-card"

Panel tự nạp card bằng `import()`. Khi hỏng, nó **thử lại 3 lần**, lần sau thêm `&r=<mốc
thời gian>` vào URL — URL mới nằm ngoài module map của trình duyệt và ngoài cache của
service worker, nên một bản hỏng không ghim được lỗi vĩnh viễn. Vẫn hỏng thì panel **tự
gọi lại URL đó** và in ra `HTTP <mã> · <content-type> · <số byte>` cùng đầu file, rồi dịch
thành một câu nói rõ phải làm gì, kèm nút **Thử lại**.

Đọc dòng chẩn đoán đó trước, đừng đoán:

| Panel in ra | Nghĩa là |
|---|---|
| `HTTP 0` | Không với tới HA — máy chủ chưa khởi động xong, hoặc điện thoại đang xem bản trang đã lưu mà không có mạng tới HA |
| `HTTP 404` | Integration chưa đăng ký được đường dẫn tĩnh → xoá rồi thêm lại integration, khởi động lại HA |
| `HTTP 5xx` | HA đang lỗi hoặc còn đang khởi động → đợi rồi bấm Thử lại |
| `200 · 0 byte` | Bản hỏng trong cache của app → bấm Thử lại; không đỡ thì *Companion app → Gỡ lỗi → Reset frontend cache* |
| `200 · text/html` | Trang đăng nhập hoặc trang lỗi bị trả về thay cho file JS |

> ⚠️ Một file JS **rỗng vẫn import thành công** — JS rỗng là JS hợp lệ. Bản trước của panel
> chỉ thử một lần và chỉ báo "không nạp được", nên đúng trường hợp này rơi vào vùng mù:
> không có thông báo lỗi nào để lần, vì không có lỗi nào được ném ra cả.

Lỗi này **không liên quan** tới việc UPS hay mạch ESP32 có đang chạy hay không. Mạch chết
thì entity thành `unavailable` và card hiện dải cảnh báo — nhưng card vẫn nạp được.

## Cảnh báo mất điện

Panel → tab **Cài đặt** → chọn `notify.mobile_app_…` → **Lưu**. Bấm **Gửi thử** để kiểm
tra ngay, không phải chờ mất điện thật.

Báo 5 tình huống: mất điện · pin dưới ngưỡng cảnh báo · pin dưới ngưỡng nguy cấp ·
UPS ngắt ổ P1 · có điện lại.

Engine chạy nền trong integration, bám `async_track_state_change_event` nên phản ứng tức
thì. Cảnh báo pin chỉ bắn **một lần cho mỗi lần mất điện**, reset khi có điện lại.

## Đo tiêu thụ điện lưới

UPS **không** báo công suất nó rút từ lưới. `QGS` chỉ cho `Load%` và dòng *đầu ra* —
thiếu đúng phần quan trọng nhất là tổn hao của chính cái UPS (quạt, biến áp, sạc pin),
thứ chạy 24/7 và chiếm phần lớn hoá đơn khi tải nhẹ.

Cách đo đúng là **đặt một ổ cắm thông minh ở phía đầu vào** và đọc nó. Panel → tab
**Cài đặt** → mục *Đo tiêu thụ điện* → chọn cảm biến công suất (W), cảm biến năng lượng
(kWh) và công tắc của ổ cắm đó, điền giá điện → **Lưu**. Số liệu hiện ở tab **Thông tin**:
đang rút · hôm nay · tháng này · năm nay, kèm quy ra tiền.

Chọn công tắc thì khối **Điều khiển UPS** có thêm một công tắc **bật/tắt ổ cắm**. Nó khác
`SOFF` ở một điểm quyết định:

| | Tắt UPS (`SOFF`) | Tắt ổ cắm |
|---|---|---|
| Tải | mất điện ngay | vẫn có điện, UPS chạy pin |
| Bật lại từ HA | **không được** — mạch ESP32 chết theo | **được** — ổ cắm có điện và WiFi riêng |
| Rủi ro nếu quên | tải dừng ngay | UPS cạn pin rồi tắt, tải dừng sau |

Ổ cắm tắt thì mọi con số tiêu thụ đứng im và `đang rút` về 0 W, nên panel hiện thẳng dòng
đỏ *"Ổ cắm đang TẮT — UPS không có điện lưới và đang chạy bằng pin"* thay vì để người đọc
tự đoán.

### Bật / tắt máy tính qua Wake-on-LAN

**Cài đặt → Bật / Tắt máy tính**: điền MAC của card mạng **có dây**, IP, cổng để dò
trạng thái, và (tuỳ chọn) cách tắt. Integration tự tạo entity `switch.ups_vertiv_pc_power`,
dùng được cả ở dashboard khác lẫn trong phần gán nút ở trên.

| Chiều | Cách làm | Chạy được không |
|---|---|---|
| **Bật** | Gói UDP 102 byte (6×`FF` + MAC lặp 16 lần) gửi tới `x.x.x.255` và `255.255.255.255`, cổng 9 và 7 | Trọn vẹn, không cần cài gì trên máy |
| **Trạng thái** | Mở thử một kết nối **TCP** (mặc định cổng 445 — SMB của Windows) | Trọn vẹn |
| **Tắt** | Kích hoạt một entity do bạn chọn (`script` / `button`) | **Cần một thứ đang chạy sẵn trên máy** |

Dùng TCP chứ **không dùng ping**: ping cần raw socket, container của Home Assistant
thường thiếu quyền đó rồi im lặng trả về "không trả lời" — tức là báo máy đã tắt trong
khi nó đang chạy.

Panel bắt MAC/IP sai ngay trên form. Một ký tự sai trong MAC là đủ để gói đánh thức
không bao giờ tới nơi **mà không có thông báo lỗi nào**: gói vẫn gửi đi bình thường, chỉ
là không máy nào nhận — không bắt ở đây thì sẽ ngồi đoán xem BIOS, card mạng hay router
hỏng.

Ô tick **không tự bật ngay sau khi bấm**: máy mất 30–60 giây mới lên, báo "bật" ngay là
nói dối. Hạn chờ xác nhận cho máy tính là 120 giây thay vì 6 giây như các công tắc UPS.

**Ba thứ phải đúng thì Wake-on-LAN mới chạy:**

1. **BIOS**: bật *Power On By PCI-E/PCI* (ASUS X299: Advanced → APM Configuration).
2. **Card mạng**: Device Manager → card mạng → Power Management → *Allow this device to
   wake the computer* + *Only allow a magic packet*.
3. **Tắt Fast Startup** của Windows. Đây là thủ phạm hay gặp nhất: "shutdown" khi còn bật
   Fast Startup thực chất là ngủ đông lai, và nhiều card Intel bỏ trạng thái chờ đánh
   thức ở chế độ đó. Kiểm tra bằng PowerShell quyền admin:

   ```powershell
   # 1 = đang bật (phá WoL sau khi shutdown)
   (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power').HiberbootEnabled
   # tắt đi
   Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' HiberbootEnabled 0
   ```

#### Tắt PC rồi cắt điện — một nút, có chờ

Entity `button.ups_vertiv_shutdown_all` chạy cả chuỗi:

1. Kích hoạt entity *Cách TẮT máy*.
2. Hỏi lại máy mỗi 5 giây cho tới khi **không còn trả lời** (tối đa *Chờ máy tắt tối đa*).
3. Chờ thêm *Chờ thêm sau khi máy im* — ngừng trả lời mạng nghĩa là Windows đã vào giai
   đoạn cuối, nhưng chưa chắc đã ghi xong đĩa.
4. Cắt theo mục *Sau khi tắt máy thì*: **UPS trước, ổ cắm sau**. Tắt UPS làm mạch ESP32
   chết theo nên sau đó không ra lệnh cho UPS được nữa; ổ cắm thì vẫn tắt được vì có điện
   và WiFi riêng.

> ⚠️ **Máy không tắt trong hạn thì chuỗi HUỶ, không cắt điện**, và gửi thông báo. Một cái
> PC chạy tiếp thì hơn hẳn một cái PC bị rút phích giữa chừng — thường là có hộp thoại
> "lưu file?" đang chặn tắt máy.
>
> Chuỗi cũng dừng khi chưa khai báo IP: không đo được thì không có cách nào biết lúc nào
> an toàn, nên nó gửi lệnh tắt rồi dừng chứ không đoán.

Hạn chờ bị ép tối thiểu 30 giây, và thuộc tính của entity hiện **con số sẽ dùng** chứ
không phải con số đã nhập.

> ⚠️ **`homeassistant.turn_on` KHÔNG bấm được một `button`.** Home Assistant trả về
> thành công, **0 entity đổi trạng thái**, không một thông báo lỗi nào — lệnh biến mất
> trong im lặng. Đo trên HA 2026.10.1:
>
> | Gọi | Kết quả | Thiết bị nhận được |
> |---|---|---|
> | `homeassistant.turn_on button.x` | 0 entity đổi | không gì cả |
> | `button.press button.x` | 1 entity đổi | lệnh chạy thật |
>
> Nên mọi chỗ "kích hoạt một entity" trong integration đều đi qua `activate_service()`
> trong [buttons.py](custom_components/ups_vertiv/buttons.py): `button` và `input_button`
> thì gọi `press`, còn lại gọi `homeassistant.turn_on`. Cũng vì thế `button` không nhận
> hành động *tắt*/*đảo* — panel cảnh báo ngay trên form thay vì để lệnh rơi vào im lặng.

**Chiều tắt** thì Wake-on-LAN không làm được, và Windows không nhận lệnh tắt từ xa nếu
không có gì đang nghe sẵn. Hai đường thực tế:

- **HASS.Agent** — ứng dụng Windows, nói chuyện qua MQTT. Cho luôn `button` tắt máy, ngủ,
  khoá màn hình, cộng thêm cảm biến CPU/RAM. Hợp nếu đã có broker MQTT trong nhà. Nhớ cài
  cả **satellite service**: bản tray chỉ sống khi có người đăng nhập, không có service thì
  lúc máy đang ở màn hình khoá sẽ không ai nhận lệnh tắt.
- **OpenSSH Server** — tính năng có sẵn của Windows, không phải cài thêm phần mềm ngoài.
  Bật nó, tạo khoá, rồi một `shell_command` trong HA chạy `ssh user@máy "shutdown /s /t 0"`,
  bọc lại thành `script.tat_pc` và chọn script đó ở ô *Cách TẮT máy*.

### Gán nút công tắc ngữ cảnh

Công tắc ngữ cảnh (scene switch) **không điều khiển được** — và không phải lỗi gì cả, nó
là thiết bị **đầu vào**. Trong Home Assistant nó hiện ra là entity `event.*`: không có
trạng thái bật/tắt, không có dịch vụ nào để gọi. `state` của nó là **dấu thời gian của lần
bấm gần nhất**. Nên cách duy nhất là *nghe* nó rồi tự gọi lệnh lên thiết bị khác.

**Cài đặt → Nút bấm vật lý**: ba khe gán, mỗi khe đặt tên được và nhận **hai hành động
trên cùng một nút**, phân biệt bằng kiểu bấm — ví dụ bấm một lần thì mở, bấm hai lần thì
tắt. Một nút một hành động thì muốn vừa bật vừa tắt phải hy sinh hai nút cho một thiết bị.

Hành động gán được: bật / tắt / đảo **UPS** (`SON` / `SOFF`), bật / tắt / đảo **ổ cắm**,
và bật / tắt / đảo **một thiết bị khác** tự chọn.

Ô *thiết bị khác* nhận `fan`, `switch`, `light`, `climate`, `media_player`, `cover`,
`script`, và cả **`scene`** — vì nhiều thiết bị hồng ngoại không vào được HA dưới dạng
entity riêng, đường duy nhất là một cảnh *tap-to-run* của hãng. Lệnh gửi qua domain
`homeassistant` (`homeassistant.turn_on` …) chứ không phải `switch`, nên chạy được với
mọi loại trong số đó.

**Không biết nút nào là nút nào thì bấm "Bấm thử để dò"** rồi bấm nút thật trên tường.
Panel chụp trạng thái mọi entity `event.*`, chờ 25 giây, và cái nào đổi thì đó là nó —
điền luôn cả entity lẫn kiểu bấm vừa dùng.

Chọn tay từ danh sách gần như không dùng được: một công tắc 4 nút ra bốn entity tên na ná
nhau (`..._button_1` … `_button_4`), mà **thứ tự đánh số không nhất thiết khớp thứ tự nút
trên mặt công tắc**. Bấm thử là cách duy nhất chắc chắn.

Phần đầu mục cũng in ra **đang có bao nhiêu entity `event.*`** trong HA. Nếu là 0 thì tích
hợp của công tắc chưa tạo entity cho nút bấm — kiểm lại ở *Công cụ cho nhà phát triển →
Trạng thái*, lọc `event.`.

Danh sách kiểu bấm **đọc thẳng từ thuộc tính `event_types` của chính entity đó**, không
đoán. Mỗi tích hợp đặt tên một khác — `single_press`, `single`, `multi_press_1`… — đoán
sai thì ô chọn ra một giá trị mà thiết bị không bao giờ gửi, và nút im lặng không làm gì.

Ba cái bẫy đã chặn sẵn trong [buttons.py](custom_components/ups_vertiv/buttons.py):

- **Home Assistant khởi động lại.** Entity `event.*` khôi phục mốc thời gian cũ, sinh ra
  một lần đổi trạng thái `None → mốc cũ`. Không chặn thì **mỗi lần HA khởi động lại là
  một cú bấm tự động** — có thể là bấm vào nút tắt UPS. Chặn bằng hai lớp: bỏ qua khi
  `old_state` là `None`, và bỏ qua sự kiện cũ hơn 60 giây.
- **Bấm nhầm.** Nút nằm trên tường, ai đi qua chạm phải cũng kích hoạt. Nếu hành động làm
  mất điện mà kiểu bấm để "bất kỳ", panel hiện cảnh báo đỏ ngay trong Cài đặt và khuyên
  đổi sang *bấm hai lần* hoặc *giữ*.
- **Hai hành động trùng kiểu bấm.** Cùng một khe mà hai hành động cùng nghe một kiểu bấm
  thì cả hai cùng nổ — gần như luôn là nhầm, nên panel bắt ngay trên form. Cũng bắt luôn
  trường hợp chọn hành động mà chưa chọn nút, hoặc chọn *thiết bị khác* mà bỏ trống ô
  thiết bị: cả hai đều dẫn tới "bấm nút, không có gì xảy ra, không chỗ nào báo vì sao".
- **Tiền tố entity không đồng nhất.** Dò công tắc UPS theo **hậu tố** `_ups_power` thay vì
  ghép từ một tiền tố — thiết bị ESPHome từng được đổi tên sau khi một số entity đã tồn
  tại, nên entity cũ giữ tên cũ còn entity mới mang tên mới.

> ⚠️ **Nút "Mở UPS" chỉ chạy được khi UPS đang bật.** Lệnh `SON` đi qua mạch ESP32, mà mạch
> lấy điện từ đầu ra của UPS — UPS tắt là mạch chết theo, không còn đường nào nhận lệnh.
> Nút *bật/tắt ổ cắm* thì không vướng chuyện này vì ổ cắm có điện và WiFi riêng.

### Tab Tiêu thụ — báo cáo theo ngày / tháng / năm

| Chế độ | Mỗi cột là | Chu kỳ thống kê |
|---|---|---|
| **Ngày** | một giờ (24 cột) | `hour`, riêng hôm nay dùng `5minute` |
| **Tháng** | một ngày | `day` |
| **Năm** | một tháng (12 cột) | `month` |

Hai nút `‹` `›` lùi/tiến từng kỳ; nút tiến tự khoá khi đã ở kỳ hiện tại. Bấm vào một cột
để xem số chính xác của cột đó. Lùi được **đến tận lúc recorder bắt đầu ghi**, không giới
hạn như app của hãng ổ cắm.

Hai chi tiết khiến con số đáng tin:

- **Ô của kỳ đang chạy được vá bằng dữ liệu mịn hơn.** Thống kê theo giờ chỉ chốt khi hết
  giờ, nên cột "hôm nay" trong biểu đồ tháng sẽ thiếu đúng phần giờ hiện tại — và lệch với
  con số *Hôm nay* ở tab Thông tin. Lệch số giữa hai tab là loại lỗi làm mất tin vào cả
  hai, nên cột đó được vá lại bằng chu kỳ 5 phút (tương tự: cột tháng này trong biểu đồ
  năm vá bằng chu kỳ ngày).
- **Kỳ đang chạy so với ĐÚNG PHẦN TƯƠNG ỨNG của kỳ trước**, không phải cả kỳ. So nửa ngày
  với cả ngày thì lúc nào cũng ra "giảm 50%" — một con số xanh lè vô nghĩa. Mốc cắt làm
  tròn xuống về biên chu kỳ để tổng luôn là những ô trọn vẹn. Lúc chưa trôi qua ô nào
  (ví dụ 00:30) thì panel ghi *"chưa đủ dữ liệu để so sánh"* chứ không bịa ra tỉ lệ.

Kỳ đã khép lại thì số không bao giờ đổi nữa nên panel nhớ luôn, không hỏi lại recorder;
chỉ kỳ đang chạy mới làm mới, nhiều nhất 60 giây một lần.

Biểu đồ vẽ bằng `div`, **không tải thư viện vẽ đồ thị nào** — panel không được phụ thuộc
internet để hiển thị.

Vài điểm đáng biết:

- **Các mốc ngày/tháng/năm do Home Assistant tự tính**, bằng `recorder/statistics_during_period`
  trên bộ đếm tích luỹ của ổ cắm. Không gọi cloud của hãng ổ cắm, nên không chết khi
  hãng đổi API — và không cần tạo `utility_meter` hay helper nào.
- **Giai đoạn chạy pin tự động bị loại khỏi phép tính**, không cần làm gì thêm: mất điện
  lưới thì ổ cắm cũng mất điện và đếm được 0 W. Đây đúng là *điện lưới đã tiêu thụ*.
- Mốc "hôm nay" lấy từ thống kê ngắn hạn (chu kỳ 5 phút) nên trễ tối đa 5 phút; tháng và
  năm lấy chu kỳ ngày/tháng. Ba mốc hỏi độc lập — một mốc lỗi thì hai mốc kia vẫn hiện.
- Panel gọi lại thống kê **nhiều nhất 60 giây một lần**. Công suất tức thời thì đọc thẳng
  từ state nên đổi theo đúng nhịp ổ cắm đẩy dữ liệu về.

Đo thực tế trên máy này, tải 6–8%: **~340 W** rút từ lưới → **~8,2 kWh/ngày**. Phần lớn
là tổn hao của UPS, không phải điện mà tải dùng.

> ⚠️ Đặt `Power-on behavior` của ổ cắm thành **On**. Để `Off` thì mỗi lần ổ cắm mất điện
> rồi có lại, nó sẽ **không tự cấp điện lại cho UPS** — UPS xả hết pin rồi tắt, trong khi
> điện lưới vẫn có.

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

Không hỗ trợ: `QPIRI`, `QPIGS`, `QPGS0`, `QPRI`, `QBDR` — đều `(NAK`.

## Lệnh GHI cờ — hoạt động, nhưng phải viết HOA

| Lệnh | Phản hồi | Việc nó làm |
|---|---|---|
| `QFLAG` | `(EpbraehczDovgfjlm` | Đọc cờ: sau `E` là đang bật, sau `D` là đang tắt |
| `PEE` / `PDE` | `(ACK` | Bật / tắt **ECO mode** |
| `PEA` / `PDA` | `(ACK` | Bật / tắt **còi báo** |

> ⚠️ **Chữ cái cờ trong lệnh ghi phải VIẾT HOA.** `QFLAG` *trả về* chữ thường
> (`...e...a...`) nhưng lệnh ghi chữ thường thì UPS trả `(NAK`. Tài liệu này từng
> ghi nhầm là máy "không hỗ trợ `PEa`/`PDa`" — thực ra chỉ sai kiểu chữ, và nhầm
> lẫn đó khiến cả tính năng điều khiển bị bỏ qua suốt một thời gian dài.

## Lệnh BẬT / TẮT máy

| Lệnh | Việc nó làm |
|---|---|
| **`SON`** | Bật UPS |
| **`SOFF`** | Tắt UPS (về standby) |
| `Sn` | Tắt sau `n` phút, **tự bật khi có điện lưới trở lại** |
| `SnRm` | Tắt sau `n` phút, tự bật sau `m` phút |
| `SnR0000` | Tắt và **ở yên đó** |
| `CS` | Huỷ lệnh tắt đang chờ |

Trạng thái bật/tắt đọc từ `QMOD`: **`S` = Standby** (đã tắt, không có điện ra).

> ⚠️ **Standby vẫn sạc pin** — manual ghi *"UPS is powered off without output power,
> but the battery still can be charged"*. Nghĩa là bo điều khiển vẫn sống và cổng
> RS-232 vẫn đáp lệnh khi máy đã tắt.
>
> Nhưng **mạch ESP32 thì không**, nếu nó lấy điện từ đầu ra của UPS. Tắt máy là
> mạch chết theo, và không còn đường nào gửi `SON` để bật lại. Muốn điều khiển
> bật/tắt thật sự từ xa thì **mạch phải có nguồn riêng** — xem phần dưới.

Ý nghĩa vài cờ đã giải mã trên máy này: `e` ECO · `a` còi báo · `r` tự khởi động
lại khi có điện · `v` converter · `g` tự tắt khi không tải · `o` bypass khi UPS tắt.

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

# 6. Còi báo — điều khiển được qua serial

Panel có công tắc **Còi báo** ở tab Cài đặt, dùng cờ `A` của `QFLAG`:

| Lệnh | Phản hồi | Việc nó làm |
|---|---|---|
| `PEA` | `(ACK` | Bật còi |
| `PDA` | `(ACK` | Tắt còi |

> ⚠️ Mục này từng kết luận **sai** là "không điều khiển được qua serial", vì thực nghiệm
> ban đầu gửi `PEa`/`PDa` chữ thường và nhận `(NAK` 21/21 lần. Nguyên nhân chỉ là kiểu
> chữ — xem phần [Lệnh GHI cờ](#lệnh-ghi-cờ--hoạt-động-nhưng-phải-viết-hoa).

Manual mục 3-1 mô tả cách làm bằng tay, vẫn đúng và vẫn dùng được:

> *Mute the alarm: When the UPS is on battery mode, press and hold this button for at
> least 5 seconds to disable or enable the alarm system.*

Đó là **toggle vật lý trên nút `ON/MUTE`**, và **chỉ tác dụng khi đang chạy pin** — nên
nếu muốn làm bằng tay thì: rút điện lưới → giữ `ON/MUTE` 5 giây → kiểm biểu tượng mute
trên LCD → cắm điện lại. Qua panel thì không cần mất điện.

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
