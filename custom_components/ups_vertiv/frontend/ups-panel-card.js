/*!
 * ups-panel-card.js
 * Bảng theo dõi UPS Vertiv / Liebert GXT-3000MTPLUS230 cho Home Assistant.
 *
 * CHỈ ĐỌC — không có nút điều khiển nào. Dữ liệu đến từ agent trên máy Windows
 * (Ups-Monitor.ps1) đẩy lên qua MQTT Discovery.
 *
 * Ba tab:
 *   1. Thông tin — trạng thái và thông số hiện tại
 *   2. Nhật ký   — lịch sử mất điện / có điện lại
 *   3. Cài đặt   — bật/tắt cảnh báo, chọn điện thoại nhận thông báo
 *
 * Card tự dò tiền tố entity nên thường không cần cấu hình gì:
 *   type: custom:ups-panel-card
 * Chỉ đặt `prefix` khi muốn ép thủ công (ví dụ có 2 bộ UPS).
 */

const UPS_CARD_VERSION = '3.3.0';

// Agent chỉ đẩy MÃ (alias) thuần ASCII — toàn bộ phần chữ tiếng Việt nằm ở đây.
// Nhờ vậy file .ps1 không phụ thuộc bảng mã, và muốn đổi câu chữ chỉ sửa một chỗ.
// Alias do $Global:UpsModeMap trong UpsHid.ps1 sinh ra từ mã QMOD.
const MODE_LABEL = {
  Line:        { cls: 'ok',   label: 'Điện lưới' },
  Battery:     { cls: 'crit', label: 'Chạy pin' },
  Bypass:      { cls: 'warn', label: 'Chạy bypass' },
  Fault:       { cls: 'crit', label: 'Lỗi UPS' },
  ECO:         { cls: 'ok',   label: 'Tiết kiệm điện' },
  Converter:   { cls: 'ok',   label: 'Chuyển đổi tần số' },
  Standby:     { cls: 'warn', label: 'Chờ' },
  PowerOn:     { cls: 'warn', label: 'Đang khởi động' },
  BatteryTest: { cls: 'warn', label: 'Đang kiểm tra pin' },
  Shutdown:    { cls: 'crit', label: 'Đang tắt' },
};

// Home Assistant BỎ QUA obj_id trong MQTT discovery và tự sinh entity_id từ
// tên thiết bị + tên entity. Ví dụ: thiết bị "UPS Vertiv GXT-3000MTPLUS230"
// + entity "Status" -> sensor.ups_vertiv_gxt_3000mtplus230_status
// Bảng này ánh xạ khoá logic -> đuôi entity_id do HA sinh ra từ nhãn.
const NAME_SUFFIX = {
  battery_percent: 'battery',
  runtime_minutes: 'runtime',
  load_percent: 'load',
  load_watts: 'load_power',
  input_freq: 'input_frequency',
  output_freq: 'output_frequency',
  mode_text: 'status',
  has_warning: 'fault',
  outlet_p1: 'programmable_outlet_p1',
  // Các khoá còn lại trùng tên nên không cần ánh xạ:
  // input_voltage, output_voltage, battery_voltage, output_current,
  // temperature, power_events, on_battery
};

// Khoá dùng để dò tiền tố vì nó duy nhất và chắc chắn tồn tại
const PROBE_KEY = 'power_events';

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec} giây`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} phút ${s} giây` : `${m} phút`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h} giờ ${mm} phút` : `${h} giờ`;
}

function fmtWhen(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class UpsPanelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._built = false;
    this._tab = 'info';
  }

  static getStubConfig() {
    return { prefix: 'ups', name: 'UPS' };
  }

  setConfig(config) {
    this._config = Object.assign(
      { prefix: 'ups', name: 'UPS Vertiv GXT-3000' }, config || {}
    );
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
  }

  getCardSize() { return 9; }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  // ------------------------------------------------------------ tiện ích ----

  /**
   * Dò tiền tố thật của bộ entity. Ưu tiên tiền tố trong cấu hình; nếu không
   * khớp thì tự tìm entity kết thúc bằng `_power_events` để suy ra tiền tố do
   * HA sinh. Nhờ vậy card chạy được bất kể HA đặt tên kiểu nào.
   */
  _resolvePrefix() {
    const cfg = this._config.prefix;
    if (this._hass.states[`sensor.${cfg}_${PROBE_KEY}`]) return cfg;

    const hit = Object.keys(this._hass.states).find(
      (id) => id.startsWith('sensor.') && id.endsWith(`_${PROBE_KEY}`)
    );
    if (hit) return hit.slice('sensor.'.length, -(`_${PROBE_KEY}`.length));
    return cfg;
  }

  /** Thử cả tên theo khoá lẫn tên do HA sinh từ nhãn hiển thị. */
  _id(domain, key) {
    const pfx = this._pfx || this._config.prefix;
    const direct = `${domain}.${pfx}_${key}`;
    if (this._hass && this._hass.states[direct]) return direct;

    const alt = NAME_SUFFIX[key];
    if (alt) {
      const mapped = `${domain}.${pfx}_${alt}`;
      if (this._hass && this._hass.states[mapped]) return mapped;
    }
    return direct;   // để thông báo lỗi hiện tên dạng chuẩn, dễ đọc
  }

  _state(domain, key) {
    if (!this._hass) return null;
    const e = this._hass.states[this._id(domain, key)];
    return e ? e.state : null;
  }

  _num(key, digits) {
    const v = this._state('sensor', key);
    if (v === null || v === undefined || v === 'unavailable' || v === 'unknown') return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return digits === undefined ? n : Number(n.toFixed(digits));
  }

  _fmt(key, unit, digits) {
    const n = this._num(key, digits);
    return n === null ? '--' : `${n}${unit ? ' ' + unit : ''}`;
  }

  _events() {
    const e = this._hass && this._hass.states[this._id('sensor', 'power_events')];
    if (!e || !e.attributes) return [];
    const list = e.attributes.events;
    return Array.isArray(list) ? list : [];
  }

  _setTab(tab) {
    this._tab = tab;
    const $ = (id) => this.shadowRoot.getElementById(id);
    for (const t of ['info', 'log', 'set']) {
      $(`tab-${t}`).className = 'tab' + (tab === t ? ' sel' : '');
      $(`pane-${t}`).style.display = tab === t ? 'block' : 'none';
    }
    if (tab === 'set') this._loadSettings();
    this._update();
  }

  // ----------------------------------------------------------- cài đặt ----
  async _loadSettings() {
    if (!this._hass || !this._hass.callWS) return;
    try {
      const res = await this._hass.callWS({ type: 'ups_vertiv/get' });
      this._cfg = res.config || {};
      this._renderSettings();
    } catch (e) {
      this.shadowRoot.getElementById('set-msg').textContent =
        'Không đọc được cấu hình: ' + (e.message || e);
    }
  }

  /** Danh sách dịch vụ thông báo khả dụng: dịch vụ notify.* + entity notify.* */
  _notifyChoices() {
    const out = new Set();
    const svc = (this._hass.services && this._hass.services.notify) || {};
    for (const name of Object.keys(svc)) {
      if (name !== 'send_message') out.add(`notify.${name}`);
    }
    for (const id of Object.keys(this._hass.states)) {
      if (id.startsWith('notify.')) out.add(id);
    }
    return [...out].sort();
  }

  _renderSettings() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const c = this._cfg || {};

    const chosen = c.service || '';
    const opts = ['<option value="">Hiện trong Home Assistant (không ra điện thoại)</option>']
      .concat(
        this._notifyChoices().map(
          (s) => `<option value="${s}"${s === chosen ? ' selected' : ''}>${s}</option>`
        )
      );
    // Dịch vụ đã lưu nhưng hiện không còn tồn tại -> vẫn giữ để không mất cấu hình
    if (chosen && !this._notifyChoices().includes(chosen)) {
      opts.push(`<option value="${chosen}" selected>${chosen} (không tìm thấy)</option>`);
    }
    $('set-svc').innerHTML = opts.join('');

    $('set-enabled').checked = !!c.enabled;
    $('set-outage').checked = !!c.outage;
    $('set-restore').checked = !!c.restore;
    $('set-warn').checked = !!c.batt_warn;
    $('set-crit').checked = !!c.batt_crit;
    $('set-shed').checked = !!c.shed;
    $('set-warn-at').value = c.batt_warn_at ?? 50;
    $('set-crit-at').value = c.batt_crit_at ?? 25;
  }

  _collectSettings() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    return {
      enabled: $('set-enabled').checked,
      service: $('set-svc').value,
      outage: $('set-outage').checked,
      restore: $('set-restore').checked,
      batt_warn: $('set-warn').checked,
      batt_warn_at: Number($('set-warn-at').value) || 50,
      batt_crit: $('set-crit').checked,
      batt_crit_at: Number($('set-crit-at').value) || 25,
      shed: $('set-shed').checked,
    };
  }

  async _saveSettings() {
    const msg = this.shadowRoot.getElementById('set-msg');
    try {
      const config = this._collectSettings();
      await this._hass.callWS({ type: 'ups_vertiv/save', config });
      this._cfg = config;
      msg.textContent = 'Đã lưu.';
    } catch (e) {
      msg.textContent = 'Lưu thất bại: ' + (e.message || e);
    }
  }

  async _testNotify() {
    const msg = this.shadowRoot.getElementById('set-msg');
    msg.textContent = 'Đang gửi…';
    try {
      const res = await this._hass.callWS({
        type: 'ups_vertiv/test',
        service: this.shadowRoot.getElementById('set-svc').value,
      });
      msg.textContent = res.detail || (res.ok ? 'Đã gửi.' : 'Không gửi được.');
    } catch (e) {
      msg.textContent = 'Không gửi được: ' + (e.message || e);
    }
  }

  // ------------------------------------------------------------- dựng DOM ---
  _build() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        .hdr { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
        .title { font-size:1.15rem; font-weight:600; color:var(--primary-text-color); }
        .ver { font-size:.7rem; color:var(--secondary-text-color); }
        .badge { padding:4px 12px; border-radius:999px; font-size:.8rem; font-weight:600; white-space:nowrap; }
        .badge.ok   { background:rgba(76,175,80,.16);  color:#2e7d32; }
        .badge.warn { background:rgba(255,152,0,.16);  color:#ef6c00; }
        .badge.crit { background:rgba(244,67,54,.16);  color:#c62828; }
        .badge.dead { background:rgba(120,120,120,.16);color:var(--secondary-text-color); }

        .tabs { display:flex; gap:4px; border-bottom:1px solid var(--divider-color); margin-bottom:14px; }
        .tab { flex:1; padding:9px 12px; border:none; background:none; cursor:pointer; font-family:inherit;
               font-size:.88rem; font-weight:600; color:var(--secondary-text-color);
               border-bottom:2px solid transparent; margin-bottom:-1px; }
        .tab.sel { color:var(--primary-color, #03a9f4); border-bottom-color:var(--primary-color, #03a9f4); }
        .tab:hover { color:var(--primary-text-color); }

        .banner { padding:10px 12px; border-radius:8px; margin-bottom:14px; font-size:.85rem; display:none; }
        .banner.show { display:block; }
        .banner.off  { background:rgba(120,120,120,.14); color:var(--secondary-text-color); }
        .banner.bad  { background:rgba(244,67,54,.14);  color:#c62828; }
        .banner code { background:rgba(0,0,0,.10); padding:1px 5px; border-radius:4px;
                       font-size:.9em; word-break:break-all; }

        .flow { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center;
                gap:6px; margin-bottom:16px; }
        .node { text-align:center; padding:10px 6px; border-radius:10px;
                background:var(--secondary-background-color); }
        .node .lbl { font-size:.7rem; color:var(--secondary-text-color); letter-spacing:.02em; }
        .node .val { font-size:1.05rem; font-weight:600; color:var(--primary-text-color); margin-top:3px; }
        .node .sub { font-size:.72rem; color:var(--secondary-text-color); margin-top:2px; }
        .node.dim { opacity:.45; }
        .arrow { font-size:1.1rem; color:var(--secondary-text-color); }
        .arrow.live { color:#2e7d32; }
        .arrow.batt { color:#ef6c00; }

        .batt-wrap { margin-bottom:16px; }
        .batt-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
        .batt-pct { font-size:1.5rem; font-weight:700; color:var(--primary-text-color); }
        .batt-rt  { font-size:.85rem; color:var(--secondary-text-color); }
        .bar { height:12px; border-radius:6px; background:var(--divider-color); overflow:hidden; }
        .bar > i { display:block; height:100%; border-radius:6px; transition:width .5s ease, background .3s; }

        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(112px,1fr)); gap:8px; }
        .cell { background:var(--secondary-background-color); border-radius:8px; padding:9px 10px; }
        .cell .k { font-size:.68rem; color:var(--secondary-text-color); letter-spacing:.02em; }
        .cell .v { font-size:1rem; font-weight:600; color:var(--primary-text-color); margin-top:3px; }

        .outlet { display:flex; align-items:center; justify-content:space-between; gap:12px;
                  margin-top:12px; padding:11px 12px; border-radius:10px;
                  background:var(--secondary-background-color); }
        .outlet .on { font-size:.85rem; font-weight:600; color:var(--primary-text-color); }
        .outlet .os { font-size:.72rem; color:var(--secondary-text-color); margin-top:2px; }
        .dot { flex:0 0 auto; padding:4px 10px; border-radius:999px; font-size:.75rem; font-weight:700; }
        .dot.on  { background:rgba(76,175,80,.18); color:#2e7d32; }
        .dot.offx{ background:rgba(244,67,54,.16); color:#c62828; }
        .dot.na  { background:rgba(120,120,120,.16); color:var(--secondary-text-color); }

        .sum { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px; }
        .sum .cell .v { font-size:1.1rem; }

        .ev { border-left:3px solid var(--divider-color); padding:10px 12px; margin-bottom:8px;
              border-radius:0 8px 8px 0; background:var(--secondary-background-color); }
        .ev.live { border-left-color:#f44336; background:rgba(244,67,54,.09); }
        .ev.done { border-left-color:#4caf50; }
        .ev-top { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
        .ev-when { font-size:.88rem; font-weight:600; color:var(--primary-text-color); }
        .ev-dur { font-size:.85rem; font-weight:600; color:#ef6c00; }
        .ev-det { font-size:.75rem; color:var(--secondary-text-color); margin-top:5px; line-height:1.5; }
        .tag { display:inline-block; padding:1px 7px; border-radius:4px; font-size:.68rem;
               font-weight:600; margin-right:5px; margin-top:4px; }
        .tag.shed { background:rgba(255,152,0,.18); color:#ef6c00; }
        .tag.shut { background:rgba(244,67,54,.18); color:#c62828; }
        .tag.live { background:rgba(244,67,54,.22); color:#c62828; }

        .empty { text-align:center; padding:28px 12px; color:var(--secondary-text-color); font-size:.85rem; line-height:1.7; }

        .row { display:flex; align-items:center; justify-content:space-between; gap:12px;
               padding:10px 12px; border-radius:8px; background:var(--secondary-background-color);
               margin-bottom:8px; }
        .row .lb { font-size:.85rem; color:var(--primary-text-color); }
        .row .hint { font-size:.72rem; color:var(--secondary-text-color); margin-top:2px; }
        .row select, .row input[type=number] {
          font-family:inherit; font-size:.85rem; padding:6px 8px; border-radius:6px;
          border:1px solid var(--divider-color); background:var(--card-background-color);
          color:var(--primary-text-color); max-width:100%;
        }
        .row select { flex:1 1 240px; min-width:0; }
        .row input[type=number] { width:64px; }
        .row input[type=checkbox] { width:18px; height:18px; flex:0 0 auto; cursor:pointer; }
        .sect { font-size:.72rem; font-weight:700; color:var(--secondary-text-color);
                margin:16px 0 8px; letter-spacing:.03em; }
        .btns { display:flex; gap:8px; margin-top:14px; flex-wrap:wrap; }
        .btns button { flex:1 1 130px; padding:10px 12px; border:none; border-radius:8px;
                       cursor:pointer; font-size:.85rem; font-weight:600; font-family:inherit; }
        .btns .save { background:var(--primary-color,#03a9f4); color:#fff; }
        .btns .test { background:var(--secondary-background-color); color:var(--primary-text-color); }
        .btns button:hover { filter:brightness(.94); }
        #set-msg { margin-top:10px; font-size:.8rem; color:var(--secondary-text-color); min-height:1.2em; }
        .foot { margin-top:12px; font-size:.7rem; color:var(--secondary-text-color); text-align:right; }
      </style>

      <ha-card>
        <div class="hdr">
          <div>
            <div class="title">${c.name}</div>
            <div class="ver">ups-panel-card v${UPS_CARD_VERSION}</div>
          </div>
          <div class="badge dead" id="badge">--</div>
        </div>

        <div class="tabs">
          <button class="tab sel" id="tab-info">Thông tin</button>
          <button class="tab" id="tab-log">Nhật ký</button>
          <button class="tab" id="tab-set">Cài đặt</button>
        </div>

        <div class="banner off" id="banner"></div>

        <div id="pane-info">
          <div class="flow">
            <div class="node" id="n-in">
              <div class="lbl">Điện lưới</div>
              <div class="val" id="in-v">--</div>
              <div class="sub" id="in-f">--</div>
            </div>
            <div class="arrow" id="a1">&#8594;</div>
            <div class="node" id="n-ups">
              <div class="lbl">UPS</div>
              <div class="val" id="ups-mode">--</div>
              <div class="sub" id="ups-temp">--</div>
            </div>
            <div class="arrow" id="a2">&#8594;</div>
            <div class="node" id="n-out">
              <div class="lbl">Đầu ra</div>
              <div class="val" id="out-v">--</div>
              <div class="sub" id="out-f">--</div>
            </div>
          </div>

          <div class="batt-wrap">
            <div class="batt-top">
              <div class="batt-pct" id="b-pct">--</div>
              <div class="batt-rt"  id="b-rt">--</div>
            </div>
            <div class="bar"><i id="b-bar" style="width:0%"></i></div>
          </div>

          <div class="grid">
            <div class="cell"><div class="k">Tải</div>           <div class="v" id="m-load">--</div></div>
            <div class="cell"><div class="k">Công suất</div>     <div class="v" id="m-watt">--</div></div>
            <div class="cell"><div class="k">Dòng ra</div>       <div class="v" id="m-amp">--</div></div>
            <div class="cell"><div class="k">Điện áp pin</div>   <div class="v" id="m-bv">--</div></div>
            <div class="cell"><div class="k">Nhiệt độ</div>      <div class="v" id="m-temp">--</div></div>
            <div class="cell"><div class="k">Tần số vào</div>    <div class="v" id="m-inf">--</div></div>
          </div>

          <div class="outlet" id="outlet-row">
            <div>
              <div class="on">Ổ cắm lập trình P1</div>
              <div class="os" id="outlet-sub">--</div>
            </div>
            <div class="dot na" id="outlet-dot">--</div>
          </div>
        </div>

        <div id="pane-log" style="display:none">
          <div class="sum">
            <div class="cell"><div class="k">Số lần mất điện</div><div class="v" id="s-count">--</div></div>
            <div class="cell"><div class="k">Tổng thời gian</div> <div class="v" id="s-total">--</div></div>
            <div class="cell"><div class="k">Lần lâu nhất</div>   <div class="v" id="s-max">--</div></div>
          </div>
          <div id="ev-list"></div>
        </div>

        <div id="pane-set" style="display:none">
          <div class="row">
            <div>
              <div class="lb">Bật cảnh báo</div>
              <div class="hint">Tắt cái này thì không gửi thông báo nào</div>
            </div>
            <input type="checkbox" id="set-enabled">
          </div>

          <div class="sect">GỬI TỚI ĐÂU</div>
          <div class="row">
            <select id="set-svc"></select>
          </div>
          <div class="hint" style="padding:0 12px">
            Chọn <b>notify.mobile_app_…</b> tương ứng điện thoại đã cài app Home Assistant.
            Bấm <b>Gửi thử</b> để kiểm tra ngay.
          </div>

          <div class="sect">BÁO NHỮNG GÌ</div>
          <div class="row">
            <div class="lb">Mất điện lưới</div>
            <input type="checkbox" id="set-outage">
          </div>
          <div class="row">
            <div class="lb">Có điện trở lại</div>
            <input type="checkbox" id="set-restore">
          </div>
          <div class="row">
            <div class="lb">Pin xuống dưới <input type="number" id="set-warn-at" min="1" max="99"> %</div>
            <input type="checkbox" id="set-warn">
          </div>
          <div class="row">
            <div class="lb">Pin xuống dưới <input type="number" id="set-crit-at" min="1" max="99"> % (sắp tự tắt máy)</div>
            <input type="checkbox" id="set-crit">
          </div>
          <div class="row">
            <div class="lb">UPS tự ngắt ổ cắm P1</div>
            <input type="checkbox" id="set-shed">
          </div>

          <div class="btns">
            <button class="save" id="btn-save">Lưu</button>
            <button class="test" id="btn-test">Gửi thử</button>
          </div>
          <div id="set-msg"></div>
        </div>

        <div class="foot" id="foot"></div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    $('tab-info').addEventListener('click', () => this._setTab('info'));
    $('tab-log').addEventListener('click', () => this._setTab('log'));
    $('tab-set').addEventListener('click', () => this._setTab('set'));
    $('btn-save').addEventListener('click', () => this._saveSettings());
    $('btn-test').addEventListener('click', () => this._testNotify());
    this._built = true;
  }

  // ------------------------------------------------------------ cập nhật ---
  _update() {
    if (!this._hass || !this._built) return;
    const $ = (id) => this.shadowRoot.getElementById(id);

    // Dò lại tiền tố mỗi lần cập nhật: entity có thể xuất hiện muộn hơn card
    this._pfx = this._resolvePrefix();

    const modeEnt = this._hass.states[this._id('sensor', 'mode_text')];
    const modeText = modeEnt ? modeEnt.state : null;
    const onBattery = this._state('binary_sensor', 'on_battery') === 'on';
    const hasFault = this._state('binary_sensor', 'has_warning') === 'on';

    // Phân biệt 2 tình huống hoàn toàn khác nhau:
    //   missing = entity CHƯA TỒN TẠI  -> HA chưa đọc được MQTT discovery
    //   unavail = entity CÓ nhưng mất dữ liệu -> agent trên máy Windows không chạy
    const missing = !modeEnt;
    const unavail = !missing && (modeText === 'unavailable' || modeText === 'unknown');
    const offline = missing || unavail;

    // --- nhãn trạng thái ---
    let style = { cls: 'dead', label: 'Mất kết nối' };
    if (!offline) {
      // Alias lạ (firmware khác) thì hiện nguyên văn thay vì nuốt mất thông tin
      style = MODE_LABEL[modeText] || { cls: 'warn', label: modeText };
    }
    if (hasFault && !offline) style = { cls: 'crit', label: 'LỖI UPS' };
    const badge = $('badge');
    badge.className = `badge ${style.cls}`;
    badge.textContent = style.label;

    // --- dải cảnh báo ---
    const banner = $('banner');
    if (missing) {
      const hits = Object.keys(this._hass.states)
        .filter((id) => /(^|\.)ups[_.]|vertiv/i.test(id))
        .sort();
      const listed = hits.slice(0, 15).map((id) => `<code>${id}</code>`).join('<br>');
      const more = hits.length > 15 ? `<br>… và ${hits.length - 15} cái nữa` : '';
      const found = hits.length
        ? `<br><br><b>Entity liên quan đang có trong HA (${hits.length}):</b><br>${listed}${more}`
        : `<br><br>Không có entity nào tên liên quan tới UPS trong HA.`;

      banner.className = 'banner bad show';
      banner.innerHTML =
        `Không tìm thấy <code>${this._id('sensor', 'mode_text')}</code> trong Home Assistant.` +
        found +
        `<br><br><b>Nếu danh sách trên trống:</b> HA chưa đọc MQTT discovery. Kiểm tra ` +
        `<b>Cài đặt → Thiết bị &amp; Dịch vụ → MQTT → Cấu hình</b>: bật <i>Enable discovery</i> ` +
        `và để <i>Discovery prefix</i> = <code>homeassistant</code>.` +
        `<br><b>Nếu có tên khác lạ:</b> HA đã tạo entity nhưng đặt tên khác — báo lại tên đó ` +
        `để sửa <code>prefix</code> của card cho khớp.`;
    } else if (unavail) {
      banner.className = 'banner off show';
      banner.innerHTML =
        `Entity đã có trong HA nhưng đang <b>unavailable</b>. Nghĩa là agent ` +
        `<code>Ups-Monitor.ps1</code> trên máy Windows không chạy, hoặc máy đó đang tắt, ` +
        `hoặc mất kết nối tới broker MQTT.`;
    } else if (hasFault) {
      banner.className = 'banner bad show';
      banner.textContent = 'UPS đang báo lỗi. Kiểm tra màn hình trên máy UPS.';
    } else if (onBattery) {
      banner.className = 'banner bad show';
      banner.textContent =
        'MẤT ĐIỆN LƯỚI — UPS đang chạy pin. Máy tính sẽ tự tắt an toàn khi chạm ngưỡng đã đặt.';
    } else {
      banner.className = 'banner off';
      banner.textContent = '';
    }

    // --- sơ đồ dòng điện ---
    $('in-v').textContent = this._fmt('input_voltage', 'V', 1);
    $('in-f').textContent = this._fmt('input_freq', 'Hz', 1);
    $('out-v').textContent = this._fmt('output_voltage', 'V', 1);
    $('out-f').textContent = this._fmt('output_freq', 'Hz', 1);
    $('ups-mode').textContent = offline ? '--' : style.label;
    $('ups-temp').textContent = this._fmt('temperature', '°C', 1);

    $('n-in').className = 'node' + (onBattery || offline ? ' dim' : '');
    $('a1').className = 'arrow' + (!onBattery && !offline ? ' live' : '');
    $('a2').className = 'arrow' + (offline ? '' : (onBattery ? ' batt' : ' live'));

    // --- pin ---
    const pct = this._num('battery_percent', 0);
    const rt = this._num('runtime_minutes', 0);
    $('b-pct').textContent = pct === null ? '--' : `${pct}%`;
    $('b-rt').textContent = rt === null
      ? 'Thời gian dự phòng: --'
      : `Dự phòng ~${rt >= 60 ? `${Math.floor(rt / 60)} giờ ${rt % 60} phút` : `${rt} phút`}`;
    const bar = $('b-bar');
    const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    bar.style.width = `${p}%`;
    bar.style.background = p >= 60 ? '#4caf50' : (p >= 30 ? '#ff9800' : '#f44336');

    // --- lưới thông số ---
    $('m-load').textContent = this._fmt('load_percent', '%', 0);
    $('m-watt').textContent = this._fmt('load_watts', 'W', 0);
    $('m-amp').textContent = this._fmt('output_current', 'A', 1);
    $('m-bv').textContent = this._fmt('battery_voltage', 'V', 1);
    $('m-temp').textContent = this._fmt('temperature', '°C', 1);
    $('m-inf').textContent = this._fmt('input_freq', 'Hz', 1);

    // --- ổ cắm P1 (chỉ đọc) ---
    const outState = this._state('binary_sensor', 'outlet_p1');
    const dot = $('outlet-dot');
    if (outState === 'on') {
      dot.className = 'dot on'; dot.textContent = 'ĐANG BẬT';
      $('outlet-sub').textContent = 'Đang cấp điện cho tải không thiết yếu';
    } else if (outState === 'off') {
      dot.className = 'dot offx'; dot.textContent = 'ĐÃ NGẮT';
      $('outlet-sub').textContent = 'UPS đã tự ngắt để dành pin cho tải quan trọng';
    } else {
      dot.className = 'dot na'; dot.textContent = '--';
      $('outlet-sub').textContent = 'Không rõ trạng thái';
    }

    this._renderLog();

    const src = this._hass.states[this._id('sensor', 'mode_text')];
    $('foot').textContent = src && (src.last_updated || src.last_changed)
      ? `Cập nhật: ${new Date(src.last_updated || src.last_changed).toLocaleTimeString('vi-VN')}`
      : '';
  }

  // ------------------------------------------------------------- nhật ký ---
  _renderLog() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const evs = this._events().slice().reverse();   // mới nhất lên đầu

    const done = evs.filter((e) => !e.ongoing);
    const total = done.reduce((a, e) => a + (e.duration_s || 0), 0);
    const longest = done.reduce((a, e) => Math.max(a, e.duration_s || 0), 0);
    $('s-count').textContent = evs.length ? String(evs.length) : '0';
    $('s-total').textContent = done.length ? fmtDuration(total) : '--';
    $('s-max').textContent = longest ? fmtDuration(longest) : '--';

    const box = $('ev-list');
    if (!evs.length) {
      box.innerHTML = `<div class="empty">Chưa ghi nhận lần mất điện nào.<br>
        Nhật ký được lưu tại <code>logs/power-events.json</code> trên máy Windows
        và còn nguyên sau khi khởi động lại.</div>`;
      return;
    }

    box.innerHTML = evs.map((e) => {
      const live = !!e.ongoing;
      const tags = [];
      if (live) tags.push('<span class="tag live">ĐANG DIỄN RA</span>');
      if (e.outlet_shed) tags.push('<span class="tag shed">Ổ P1 bị ngắt</span>');
      if (e.shutdown_fired) tags.push('<span class="tag shut">Đã tự tắt máy</span>');

      const det = [
        `Pin ${e.battery_start}% &rarr; ${e.battery_end}%`,
        `thấp nhất ${e.voltage_min} V`,
        `tải đỉnh ${e.load_max}%`,
      ].join(' &middot; ');

      return `
        <div class="ev ${live ? 'live' : 'done'}">
          <div class="ev-top">
            <span class="ev-when">${fmtWhen(e.start)}${live ? '' : ' &rarr; ' + fmtWhen(e.end)}</span>
            <span class="ev-dur">${fmtDuration(e.duration_s)}</span>
          </div>
          <div class="ev-det">${det}</div>
          <div>${tags.join('')}</div>
        </div>`;
    }).join('');
  }
}

// Card được nạp toàn cục nên có thể bị nạp 2 lần (ví dụ sau khi reload
// integration). Định nghĩa trùng sẽ ném lỗi -> phải chặn.
if (!customElements.get('ups-panel-card')) {
  customElements.define('ups-panel-card', UpsPanelCard);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'ups-panel-card',
    name: 'UPS Panel Card',
    description: 'Bảng theo dõi UPS Vertiv/Liebert GXT: thông số + nhật ký mất điện.',
    preview: true,
  });
}

console.info(`%c UPS-PANEL-CARD %c v${UPS_CARD_VERSION} `,
  'color:#fff;background:#2e7d32;font-weight:700',
  'color:#2e7d32;background:#eee');
