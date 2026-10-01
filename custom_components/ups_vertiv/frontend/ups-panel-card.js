/*!
 * ups-panel-card.js
 * Bảng theo dõi UPS Vertiv / Liebert GXT-3000MTPLUS230 cho Home Assistant.
 *
 * CHỈ ĐỌC — không có nút điều khiển nào. Dữ liệu đến từ thiết bị ESP32-C3 chạy
 * ESPHome, đọc UPS qua RS-232 và đẩy lên HA bằng API native của ESPHome.
 *
 * Ba tab:
 *   1. Thông tin — trạng thái và thông số hiện tại
 *   2. Nhật ký   — lịch sử mất điện, dựng lại từ recorder của Home Assistant
 *   3. Cài đặt   — bật/tắt cảnh báo, chọn điện thoại nhận thông báo
 *
 * Card tự dò tiền tố entity nên thường không cần cấu hình gì:
 *   type: custom:ups-panel-card
 * Chỉ đặt `prefix` khi muốn ép thủ công (ví dụ có 2 bộ UPS).
 */

// Ky tu xuong dong cho hop thoai confirm. Viet bang fromCharCode vi chuoi
// escape tung bi cong cu ghi file bien thanh xuong dong THAT, lam vo cu phap.
const BR = String.fromCharCode(10);
const UPS_CARD_VERSION = '4.8.0';

// Firmware chỉ đẩy MÃ (alias) tiếng Anh — toàn bộ phần chữ tiếng Việt nằm ở đây.
// Muốn đổi câu chữ chỉ sửa một chỗ này, không phải nạp lại firmware.
// Alias sinh từ mã QMOD trong component ups_voltronic.
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

// Nguồn dữ liệu là thiết bị ESPHome `ups-vertiv`. HA sinh entity_id từ tên
// thiết bị + tên entity, ví dụ: sensor.ups_vertiv_battery
// Tên entity trong ESPHome để tiếng Anh cho slug sạch; phần chữ tiếng Việt
// nằm ngay trong file này.
const NAME_SUFFIX = {
  battery_percent: 'battery',
  runtime_minutes: 'runtime',
  load_percent: 'load',
  load_watts: 'load_power',
  input_freq: 'input_frequency',
  output_freq: 'output_frequency',
  mode_text: 'status',
  has_warning: 'fault',
  outlet_p1: 'outlet_p1',
  // Các khoá còn lại trùng tên nên không cần ánh xạ:
  // input_voltage, output_voltage, battery_voltage, output_current,
  // temperature, on_battery
};

// Khoá dùng để dò tiền tố: đủ hiếm để không đụng entity khác trong nhà
const PROBE_KEY = 'output_current';

// Khoảng thời gian dựng lại nhật ký mất điện từ recorder của HA
const LOG_DAYS = 14;

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec} giây`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} phút ${s} giây` : `${m} phút`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h} giờ ${mm} phút` : `${h} giờ`;
}

/** Khoa ngay theo giờ ĐỊA PHƯƠNG (không dùng toISOString - nó trả về UTC). */
function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Nhãn ngày: 'Hôm nay' / 'Hôm qua' / 'Thứ Hai, 31/08'. */
function dayLabel(iso) {
  const d = new Date(iso);
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(new Date()) - midnight(d)) / 86400000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  const THU = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  return `${THU[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtVnd(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
}

function fmtKwh(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${n.toFixed(n < 10 ? 2 : 1)} kWh`;
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
    return { prefix: 'ups_vertiv', name: 'UPS Vertiv GXT-3000' };
  }

  setConfig(config) {
    this._config = Object.assign(
      { prefix: 'ups_vertiv', name: 'UPS Vertiv GXT-3000' }, config || {}
    );
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
  }

  getCardSize() { return 9; }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._ensureCfg();
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
    const sufs = NAME_SUFFIX[key] ? [key, NAME_SUFFIX[key]] : [key];

    // 1. Đúng tiền tố đã dò — trường hợp thường gặp
    for (const suf of sufs) {
      const id = `${domain}.${pfx}_${suf}`;
      if (this._hass && this._hass.states[id]) return id;
    }

    // 2. Tiền tố KHÔNG đồng nhất giữa các entity.
    //    Xảy ra khi thiết bị được đổi tên sau lúc một số entity đã tồn tại:
    //    cái cũ giữ tên cũ, cái mới sinh ra mang tên mới. Ví dụ thực tế:
    //      sensor.ups_vertiv_output_current      (tạo trước khi đổi tên)
    //      switch.tang_3_ups_vertiv_buzzer       (tạo sau khi đổi tên)
    //    Nên phải dò theo HẬU TỐ trong cùng domain thay vì ghép từ một tiền tố.
    if (this._hass) {
      for (const suf of sufs) {
        const cands = Object.keys(this._hass.states)
          .filter((id) => id.startsWith(`${domain}.`) && id.endsWith(`_${suf}`));
        if (!cands.length) continue;
        // Ưu tiên cái có chứa tiền tố đã dò, để không vớ nhầm entity nhà khác
        return cands.find((id) => id.includes(pfx)) || cands[0];
      }
    }
    return `${domain}.${pfx}_${sufs[0]}`;   // để thông báo lỗi đọc được
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

  // ------------------------------------------------------------ nhật ký ----

  /**
   * Dựng lại lịch sử mất điện từ recorder của Home Assistant.
   *
   * Thiết bị ESPHome không tự lưu nhật ký (khác agent Windows trước đây ghi ra
   * power-events.json). Nhưng HA đã ghi sẵn lịch sử trạng thái, nên chỉ cần đọc
   * lại và ghép thành từng lần mất điện — không cần thêm bộ nhớ nào.
   *
   * Lấy luôn lịch sử pin và điện áp pin để tính giá trị thấp nhất trong mỗi lần.
   */
  async _loadLog() {
    if (!this._hass || !this._hass.callWS) return;
    const box = this.shadowRoot.getElementById('ev-list');

    const eOnBat = this._id('binary_sensor', 'on_battery');
    const eBatt = this._id('sensor', 'battery_percent');
    const eVolt = this._id('sensor', 'battery_voltage');

    if (!this._hass.states[eOnBat]) {
      this._outages = [];
      this._renderLog();
      return;
    }

    const end = new Date();
    const start = new Date(end.getTime() - LOG_DAYS * 24 * 3600 * 1000);

    try {
      if (box && !this._outages) box.innerHTML = '<div class="empty">Đang đọc lịch sử…</div>';
      const res = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [eOnBat, eBatt, eVolt],
        minimal_response: true,
        no_attributes: true,
      });
      this._outages = this._buildOutages(res, eOnBat, eBatt, eVolt);
    } catch (e) {
      this._outages = [];
      this._logError = e.message || String(e);
    }
    this._renderLog();
  }

  /** Chuẩn hoá một bản ghi history: HA trả phần tử đầu khác các phần tử sau. */
  _histRows(res, id) {
    const raw = (res && res[id]) || [];
    return raw
      .map((r) => ({
        state: r.s !== undefined ? r.s : r.state,
        t: r.lu !== undefined
          ? r.lu * 1000
          : new Date(r.last_updated || r.last_changed).getTime(),
      }))
      .filter((r) => r.state !== undefined && !Number.isNaN(r.t))
      .sort((a, b) => a.t - b.t);
  }

  _buildOutages(res, eOnBat, eBatt, eVolt) {
    const bat = this._histRows(res, eOnBat);
    const pct = this._histRows(res, eBatt);
    const vol = this._histRows(res, eVolt);

    // Ghép các quãng 'on' liên tiếp thành từng lần mất điện
    const spans = [];
    let cur = null;
    for (const r of bat) {
      if (r.state === 'on' && !cur) cur = { from: r.t, to: null };
      else if (r.state === 'off' && cur) { cur.to = r.t; spans.push(cur); cur = null; }
    }
    if (cur) spans.push(cur);   // vẫn đang mất điện

    const numIn = (rows, from, to) => {
      const vals = rows
        .filter((r) => r.t >= from && (to === null || r.t <= to))
        .map((r) => Number(r.state))
        .filter((v) => !Number.isNaN(v));
      return vals.length ? vals : null;
    };

    return spans.map((sp) => {
      const ongoing = sp.to === null;
      const to = ongoing ? Date.now() : sp.to;
      const p = numIn(pct, sp.from, sp.to);
      const v = numIn(vol, sp.from, sp.to);
      return {
        start: new Date(sp.from).toISOString(),
        end: ongoing ? null : new Date(sp.to).toISOString(),
        duration_s: Math.round((to - sp.from) / 1000),
        battery_start: p ? p[0] : null,
        battery_end: p ? p[p.length - 1] : null,
        battery_min: p ? Math.min(...p) : null,
        voltage_min: v ? Math.min(...v) : null,
        ongoing,
      };
    });
  }


  _setTab(tab) {
    this._tab = tab;
    const $ = (id) => this.shadowRoot.getElementById(id);
    for (const t of ['info', 'log', 'set']) {
      $(`tab-${t}`).className = 'tab' + (tab === t ? ' sel' : '');
      $(`pane-${t}`).style.display = tab === t ? 'block' : 'none';
    }
    if (tab === 'set') this._loadSettings();
    if (tab === 'log') this._loadLog();
    this._update();
  }

  // -------------------------------------------------- tiêu thụ điện lưới ---

  /**
   * Nạp cấu hình một lần ngay khi card dựng xong.
   *
   * Trước đây cấu hình chỉ được đọc khi mở tab Cài đặt, nhưng khối tiêu thụ
   * nằm ở tab Thông tin nên phải biết trước ổ cắm nào đang đo. Lỗi ở đây không
   * được làm chết card: không đọc được thì khối tiêu thụ chỉ đơn giản là ẩn.
   */
  async _ensureCfg() {
    if (this._cfg || this._cfgLoading || !this._hass || !this._hass.callWS) return;
    this._cfgLoading = true;
    try {
      const res = await this._hass.callWS({ type: 'ups_vertiv/get' });
      this._cfg = res.config || {};
      this._updatePower();
    } catch (e) {
      /* bỏ qua: khối tiêu thụ ẩn, phần còn lại của card vẫn chạy */
    }
    this._cfgLoading = false;
  }

  /** Entity trong một domain, lọc theo device_class nếu có, để đổ vào danh sách chọn. */
  _entityChoices(domain, deviceClass) {
    const out = [];
    for (const id of Object.keys(this._hass.states)) {
      if (!id.startsWith(`${domain}.`)) continue;
      const a = this._hass.states[id].attributes || {};
      if (deviceClass && a.device_class !== deviceClass) continue;
      out.push({ id, name: a.friendly_name || id, outlet: a.device_class === 'outlet' });
    }
    // Ổ cắm lên trước: nhà có thể có hàng chục switch, phần lớn không liên quan
    out.sort((x, y) => (y.outlet - x.outlet) || x.name.localeCompare(y.name, 'vi'));
    return out;
  }

  _fillSelect(el, choices, chosen, emptyLabel) {
    if (!el) return;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const opts = [`<option value="">${emptyLabel}</option>`];
    let found = false;
    for (const c of choices) {
      if (c.id === chosen) found = true;
      opts.push(`<option value="${esc(c.id)}"${c.id === chosen ? ' selected' : ''}>`
        + `${esc(c.name)} — ${esc(c.id)}</option>`);
    }
    // Entity đã lưu nhưng hiện không còn -> vẫn giữ để không âm thầm mất cấu hình
    if (chosen && !found) {
      opts.push(`<option value="${esc(chosen)}" selected>${esc(chosen)} (không tìm thấy)</option>`);
    }
    el.innerHTML = opts.join('');
  }

  /**
   * Lấy lượng điện theo ngày / tháng / năm từ thống kê dài hạn của Home Assistant.
   *
   * Ổ cắm thông minh chỉ gửi về CÔNG SUẤT tức thời và một BỘ ĐẾM tích luỹ. Các
   * mốc thời gian là do HA tự tính từ bộ đếm đó, nên không phụ thuộc cloud của
   * hãng ổ cắm và không mất khi cloud đổi API.
   *
   * Chọn chu kỳ theo độ tươi cần thiết:
   *   hôm nay  -> '5minute' (thống kê ngắn hạn, trễ tối đa 5 phút)
   *   tháng/năm -> 'day' / 'month' (nhẹ, sai số không đáng kể)
   */
  async _fetchEnergy(ent) {
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
    const y0 = new Date(now.getFullYear(), 0, 1);

    const ask = async (start, period) => {
      const res = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: now.toISOString(),
        statistic_ids: [ent],
        period,
        types: ['change'],
      });
      const rows = (res && res[ent]) || [];
      let sum = 0;
      let seen = false;
      for (const r of rows) {
        if (r.change === null || r.change === undefined) continue;
        const v = Number(r.change);
        if (!Number.isFinite(v)) continue;
        sum += v;
        seen = true;
      }
      return seen ? sum : null;
    };

    // Mỗi mốc hỏi độc lập: recorder có thể từ chối một chu kỳ (ví dụ thống kê
    // ngắn hạn đã bị dọn) mà hai mốc còn lại vẫn đọc được bình thường. Dùng
    // Promise.all trần thì một lỗi lẻ sẽ xoá sạch cả ba con số.
    let err = null;
    const safe = (start, period) => ask(start, period).catch((e) => {
      err = err || (e.message || String(e));
      return null;
    });
    const [today, month, year] = await Promise.all([
      safe(d0, '5minute'), safe(m0, 'day'), safe(y0, 'month'),
    ]);
    return { today, month, year, err };
  }

  /**
   * Cập nhật khối tiêu thụ.
   *
   * Công suất tức thời đọc thẳng từ state nên đổi theo từng lần HA đẩy dữ liệu.
   * Thống kê thì gọi lại nhiều nhất 60 giây một lần — `_update()` chạy mỗi khi
   * BẤT KỲ entity nào đổi trạng thái, gọi websocket theo nhịp đó sẽ làm ngập
   * recorder một cách vô ích.
   */
  _updatePower() {
    if (!this._built || !this._hass) return;
    const $ = (id) => this.shadowRoot.getElementById(id);
    const c = this._cfg || {};
    const pEnt = c.power_entity || '';
    const eEnt = c.energy_entity || '';
    const show = !!(pEnt || eEnt);

    if ($('pw-sec')) $('pw-sec').style.display = show ? '' : 'none';
    if ($('pw-grid')) $('pw-grid').style.display = show ? 'grid' : 'none';
    if (!show) {
      if ($('pw-note')) $('pw-note').style.display = 'none';
      return;
    }

    const ps = pEnt ? this._hass.states[pEnt] : null;
    const w = ps ? Number(ps.state) : NaN;
    const price = Number(c.price_kwh) || 0;
    $('pw-now').textContent = Number.isFinite(w) ? `${w.toFixed(0)} W` : '--';
    $('pw-now-sub').textContent = Number.isFinite(w) && w > 0
      ? `≈ ${fmtKwh(w * 24 / 1000)}/ngày`
        + (price ? ` · ${fmtVnd(w * 24 / 1000 * 30 * price)}/tháng` : '')
      : (pEnt ? '' : 'Chưa chọn cảm biến công suất');

    if (eEnt && !this._pwBusy
        && (this._pwEnt !== eEnt || !this._pwAt || Date.now() - this._pwAt > 60000)) {
      this._pwBusy = true;
      this._pwEnt = eEnt;
      this._fetchEnergy(eEnt)
        .then((r) => { this._pwVals = r; this._pwErr = r.err || null; })
        .catch((e) => { this._pwVals = null; this._pwErr = e.message || String(e); })
        .then(() => { this._pwAt = Date.now(); this._pwBusy = false; this._paintEnergy(); });
    }
    this._paintEnergy();
  }

  _paintEnergy() {
    if (!this._built || !this._hass) return;
    const $ = (id) => this.shadowRoot.getElementById(id);
    if (!$('pw-today')) return;
    const c = this._cfg || {};
    const price = Number(c.price_kwh) || 0;
    const v = this._pwVals || {};

    for (const [key, cell] of [['today', 'pw-today'], ['month', 'pw-month'], ['year', 'pw-year']]) {
      const n = v[key];
      $(cell).textContent = (n === null || n === undefined) ? '--' : fmtKwh(n);
      $(`${cell}-sub`).textContent =
        (price && Number.isFinite(n)) ? fmtVnd(n * price) : '';
    }

    const note = $('pw-note');
    if (!note) return;
    note.className = 'hint';

    // Ổ cắm bị tắt là lý do số 1 khiến mọi con số ở trên đứng im. Nói thẳng ra,
    // đừng để người đọc tự đoán vì sao "đang rút" lại là 0 W.
    const plugEnt = c.plug_entity || '';
    const plugSt = plugEnt && this._hass.states[plugEnt]
      ? this._hass.states[plugEnt].state : null;
    if (plugSt === 'off') {
      note.className = 'hint alert';
      note.style.display = '';
      note.textContent = 'Ổ cắm đang TẮT — UPS không có điện lưới và đang chạy bằng '
        + 'pin. Bật lại ở tab Cài đặt, khối Điều khiển UPS.';
      return;
    }

    if (!c.energy_entity) {
      note.style.display = '';
      note.textContent = 'Chọn thêm cảm biến năng lượng (kWh) trong tab Cài đặt '
        + 'để xem lượng điện theo ngày, tháng và năm.';
    } else if (this._pwErr) {
      note.style.display = '';
      note.textContent = 'Không đọc được thống kê: ' + this._pwErr;
    } else if (v.today === null || v.today === undefined) {
      note.style.display = '';
      note.textContent = 'Home Assistant chưa có thống kê cho cảm biến này. '
        + 'Số liệu sẽ xuất hiện sau khoảng 5–10 phút kể từ khi ổ cắm được thêm vào.';
    } else {
      note.style.display = '';
      note.textContent = 'Đây là điện lưới mà UPS rút vào, đo tại ổ cắm — '
        + 'gồm cả phần UPS tự tiêu thụ và phần sạc acquy. '
        + 'Số liệu do Home Assistant tự tính từ bộ đếm của ổ cắm.';
    }
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
    $('set-offline').checked = c.offline !== false;
    $('set-offline-after').value = c.offline_after ?? 3;
    $('set-warn-at').value = c.batt_warn_at ?? 50;
    $('set-crit-at').value = c.batt_crit_at ?? 25;

    this._fillSelect($('set-pw-power'), this._entityChoices('sensor', 'power'),
      c.power_entity || '', '— không đo —');
    this._fillSelect($('set-pw-energy'), this._entityChoices('sensor', 'energy'),
      c.energy_entity || '', '— không đo —');
    this._fillSelect($('set-pw-plug'), this._entityChoices('switch'),
      c.plug_entity || '', '— không điều khiển —');
    $('set-price').value = c.price_kwh ?? 3000;
  }

  _collectSettings() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    // Giữ lại những khoá KHÔNG có ô nhập trên form (ví dụ log_cleared_at).
    // Backend ghép theo kiểu {**DEFAULT_CONFIG, **config}, nên khoá nào bị
    // thiếu ở đây sẽ bị trả về giá trị mặc định - tức là âm thầm mất dữ liệu.
    return {
      ...(this._cfg || {}),
      enabled: $('set-enabled').checked,
      service: $('set-svc').value,
      outage: $('set-outage').checked,
      restore: $('set-restore').checked,
      batt_warn: $('set-warn').checked,
      batt_warn_at: Number($('set-warn-at').value) || 50,
      batt_crit: $('set-crit').checked,
      batt_crit_at: Number($('set-crit-at').value) || 25,
      shed: $('set-shed').checked,
      offline: $('set-offline').checked,
      offline_after: Number($('set-offline-after').value) || 3,
      power_entity: $('set-pw-power').value,
      energy_entity: $('set-pw-energy').value,
      plug_entity: $('set-pw-plug').value,
      price_kwh: Number($('set-price').value) || 0,
    };
  }

  async _saveSettings() {
    const msg = this.shadowRoot.getElementById('set-msg');
    try {
      const config = this._collectSettings();
      await this._hass.callWS({ type: 'ups_vertiv/save', config });
      this._cfg = config;
      this._pwAt = 0;          // buộc hỏi lại thống kê theo ổ cắm vừa chọn
      this._updatePower();
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

        .day { display:flex; justify-content:space-between; align-items:baseline;
               gap:8px; flex-wrap:wrap; margin:14px 0 7px; padding-bottom:5px;
               border-bottom:1px solid var(--divider-color); }
        .day:first-child { margin-top:2px; }
        .day-name { font-weight:600; font-size:.92rem; color:var(--primary-text-color); }
        .day-sum  { font-size:.75rem; color:var(--secondary-text-color); }
        .log-bar { display:flex; justify-content:flex-end; margin:10px 0 2px; }
        .btn-clear { background:none; border:1px solid var(--divider-color);
                     color:var(--secondary-text-color); border-radius:8px;
                     padding:6px 14px; font-size:.8rem; cursor:pointer; }
        .btn-clear:hover { color:#f44336; border-color:#f44336; }
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

        .hint { font-size:.75rem; color:var(--secondary-text-color); line-height:1.5; }
        .pw-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:6px 0 4px; }
        @media (max-width:560px) { .pw-grid { grid-template-columns:repeat(2,1fr); } }
        .pw-grid .v { font-size:1.05rem; }
        .pw-grid .sub { font-size:.72rem; color:var(--secondary-text-color); margin-top:2px; }
        .sec { font-weight:600; font-size:.82rem; letter-spacing:.04em;
               text-transform:uppercase; color:var(--secondary-text-color);
               margin:16px 0 8px; }
        .sec:first-child { margin-top:4px; }
        .mode-pill { font-weight:600; font-size:.85rem; padding:4px 12px;
                     border-radius:999px; background:var(--secondary-background-color);
                     color:var(--primary-text-color); white-space:nowrap; }
        .mode-pill.ok   { background:rgba(76,175,80,.16);  color:#2e7d32; }
        .mode-pill.eco  { background:rgba(3,169,244,.16);  color:#0277bd; }
        .mode-pill.warn { background:rgba(255,152,0,.18);  color:#e65100; }
        .mode-pill.bad  { background:rgba(244,67,54,.16);  color:#c62828; }
        .row.danger { border-left:3px solid #f44336; padding-left:9px; }
        .ctl-note { min-height:1.1em; margin:2px 0 4px; }
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
        /* Cong tac truot. Khong dung ::before trucc tiep tren <input> vi Firefox
           khong dung pseudo-element tren input; boc trong <label> thi chay moi noi. */
        .sw { position:relative; display:inline-block; width:44px; height:24px;
              flex:0 0 auto; cursor:pointer; }
        .sw input { position:absolute; inset:0; width:100%; height:100%; margin:0;
                    opacity:0; cursor:pointer; }
        .sw .sl { position:absolute; inset:0; border-radius:999px; transition:background .18s;
                  background:var(--switch-unchecked-track-color, rgba(130,130,130,.45)); }
        .sw .sl::before { content:''; position:absolute; top:2px; left:2px;
                  width:20px; height:20px; border-radius:50%;
                  background:var(--switch-unchecked-button-color, #fafafa);
                  box-shadow:0 1px 3px rgba(0,0,0,.35);
                  transition:transform .18s, background .18s; }
        .sw input:checked + .sl { background:var(--switch-checked-track-color, rgba(3,169,244,.5)); }
        .sw input:checked + .sl::before { transform:translateX(20px);
                  background:var(--switch-checked-button-color, var(--primary-color, #03a9f4)); }
        .sw input:focus-visible + .sl { outline:2px solid var(--primary-color, #03a9f4);
                  outline-offset:2px; }
        /* Hang nguy hiem: bat len la mau do, de khong bao gio bam nham ma khong thay */
        .row.danger .sw input:checked + .sl { background:rgba(244,67,54,.45); }
        .row.danger .sw input:checked + .sl::before { background:#f44336; }
        .hint.alert { color:#c62828; font-weight:600; }
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

          <div class="sec" id="pw-sec" style="display:none">Tiêu thụ điện lưới</div>
          <div class="pw-grid" id="pw-grid" style="display:none">
            <div class="cell"><div class="k">Đang rút</div><div class="v" id="pw-now">--</div>
              <div class="sub" id="pw-now-sub"></div></div>
            <div class="cell"><div class="k">Hôm nay</div><div class="v" id="pw-today">--</div>
              <div class="sub" id="pw-today-sub"></div></div>
            <div class="cell"><div class="k">Tháng này</div><div class="v" id="pw-month">--</div>
              <div class="sub" id="pw-month-sub"></div></div>
            <div class="cell"><div class="k">Năm nay</div><div class="v" id="pw-year">--</div>
              <div class="sub" id="pw-year-sub"></div></div>
          </div>
          <div class="hint" id="pw-note" style="display:none"></div>
        </div>

        <div id="pane-log" style="display:none">
          <div class="sum">
            <div class="cell"><div class="k">Số lần mất điện</div><div class="v" id="s-count">--</div></div>
            <div class="cell"><div class="k">Tổng thời gian</div> <div class="v" id="s-total">--</div></div>
            <div class="cell"><div class="k">Lần lâu nhất</div>   <div class="v" id="s-max">--</div></div>
          </div>
          <div class="log-bar">
            <button class="btn-clear" id="btn-clear-log">Xoá nhật ký</button>
          </div>
          <div id="ev-list"></div>
        </div>

        <div id="pane-set" style="display:none">

          <div class="sec">Điều khiển UPS</div>
          <div class="row">
            <div>
              <div class="lb">Chế độ đang chạy</div>
              <div class="hint" id="ctl-mode-hint">Đọc trực tiếp từ UPS</div>
            </div>
            <div class="mode-pill" id="ctl-mode">--</div>
          </div>
          <div class="row">
            <div>
              <div class="lb">Chế độ ECO</div>
              <div class="hint">Điện lưới tốt thì tải đi thẳng qua bypass — tiết kiệm
                phần lớn điện không tải. Đổi lại thời gian chuyển sang pin là ~4 ms
                thay vì 0, và đầu ra không còn được ổn áp.<br>
                Đây là <b>cài đặt</b>. UPS có thể tạm về double-conversion khi điện
                lưới lệch khỏi ngưỡng cho phép — lúc đó ô này vẫn bật nhưng
                <b>Chế độ đang chạy</b> ở trên sẽ hiện <code>Line</code>.</div>
            </div>
            <label class="sw"><input type="checkbox" id="ctl-eco"><span class="sl"></span></label>
          </div>
          <div class="row">
            <div>
              <div class="lb">Còi báo</div>
              <div class="hint">Cảnh báo tại chỗ khi mất điện — không phụ thuộc WiFi
                hay điện thoại.</div>
            </div>
            <label class="sw"><input type="checkbox" id="ctl-buzzer"><span class="sl"></span></label>
          </div>
          <div class="row danger">
            <div>
              <div class="lb">Bật / tắt UPS</div>
              <div class="hint">Tắt sẽ <b>cắt điện toàn bộ tải</b>. Nếu mạch giám sát
                đang lấy điện từ chính UPS thì nó chết theo — và <b>không còn đường
                nào bật lại từ xa</b>, phải ra tận nơi bấm nút trên máy.</div>
            </div>
            <label class="sw"><input type="checkbox" id="ctl-power"><span class="sl"></span></label>
          </div>
          <div class="row danger" id="ctl-plug-row" style="display:none">
            <div>
              <div class="lb">Ổ cắm cấp điện lưới cho UPS</div>
              <div class="hint">Tắt là <b>cắt điện lưới vào UPS</b> — UPS chuyển sang
                chạy pin và sẽ cạn pin rồi tắt nếu để lâu.<br>
                Khác với <b>Bật / tắt UPS</b> ở trên: ổ cắm lấy điện và WiFi độc lập
                với UPS, nên <b>bật lại từ đây lúc nào cũng được</b>.</div>
            </div>
            <label class="sw"><input type="checkbox" id="ctl-plug"><span class="sl"></span></label>
          </div>
          <div class="hint ctl-note" id="ctl-msg"></div>

          <div class="sec">Đo tiêu thụ điện</div>
          <div class="hint" style="margin-bottom:8px">Chọn ổ cắm thông minh đang
            cấp điện lưới cho UPS. Panel sẽ tự tính lượng điện theo ngày và tháng
            từ thống kê của Home Assistant — không cần tạo helper nào.</div>
          <div class="row">
            <div class="lb">Cảm biến công suất</div>
            <select id="set-pw-power"></select>
          </div>
          <div class="row">
            <div class="lb">Cảm biến năng lượng</div>
            <select id="set-pw-energy"></select>
          </div>
          <div class="row">
            <div>
              <div class="lb">Công tắc ổ cắm</div>
              <div class="hint">Chọn để có công tắc bật/tắt ổ cắm ngay trong khối
                <b>Điều khiển UPS</b> ở trên.</div>
            </div>
            <select id="set-pw-plug"></select>
          </div>
          <div class="row">
            <div class="lb">Giá điện (đ/kWh)</div>
            <input type="number" id="set-price" min="0" step="100" style="width:90px">
          </div>

          <div class="sec">Cảnh báo</div>
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
          <div class="row">
            <div>
              <div class="lb">Mất kết nối với mạch quá
                <input type="number" id="set-offline-after" min="1" max="60"> phút</div>
              <div class="hint">Báo khi chính mạch giám sát chết — lúc đó hệ thống
                không còn báo được mất điện nữa</div>
            </div>
            <input type="checkbox" id="set-offline">
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
    $('btn-clear-log').addEventListener('click', () => this._clearLog());
    $('ctl-eco').addEventListener('change', (ev) =>
      this._toggleSwitch('eco_mode', ev.target.checked, 'Chế độ ECO'));
    $('ctl-buzzer').addEventListener('change', (ev) =>
      this._toggleSwitch('buzzer', ev.target.checked, 'Còi báo'));
    $('ctl-power').addEventListener('change', (ev) => {
      const on = ev.target.checked;
      if (!on) {
        const warn = 'TẮT UPS sẽ cắt điện toàn bộ thiết bị đang cắm trên nó. '
          + 'Nếu mạch giám sát cũng lấy điện từ UPS thì nó sẽ mất kết nối và '
          + 'KHÔNG THỂ bật lại từ Home Assistant — phải ra tận nơi bấm nút. '
          + 'Bạn chắc chắn muốn tắt?';
        if (!confirm(warn)) { this._update(); return; }   // huỷ -> trả ô tick về
      }
      this._toggleSwitch('ups_power', on, 'UPS');
    });
    $('ctl-plug').addEventListener('change', (ev) => {
      const on = ev.target.checked;
      const eid = (this._cfg || {}).plug_entity || '';
      if (!on) {
        const warn = 'TẮT Ổ CẮM sẽ cắt điện lưới vào UPS. UPS chuyển sang chạy pin '
          + 'và sẽ cạn pin rồi tắt nếu để lâu — kéo theo toàn bộ tải đang cắm.'
          + BR + BR
          + 'Bật lại từ đây vẫn được (ổ cắm không phụ thuộc UPS). Chắc chắn tắt?';
        if (!confirm(warn)) { this._update(); return; }   // huỷ -> trả công tắc về
      }
      this._toggleSwitch('plug', on, 'Ổ cắm', eid);
    });
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
    //   missing = entity CHƯA TỒN TẠI  -> HA chưa thêm thiết bị ESPHome
    //   unavail = entity CÓ nhưng mất dữ liệu -> mạch ESP32 mất điện hoặc mất mạng
    // --- khối điều khiển ở tab Cài đặt ---
    // Ô tick luôn lấy từ entity, KHÔNG giữ giá trị người dùng vừa bấm: nếu UPS
    // từ chối lệnh thì ô tự quay về đúng thực tế thay vì hiển thị sai.
    const MODE_PILL = {
      Line: ['ok', 'Điện lưới · double-conversion'],
      ECO: ['eco', 'ECO · tải qua bypass, tiết kiệm điện'],
      Battery: ['bad', 'Đang chạy pin'],
      Bypass: ['warn', 'Bypass · tải KHÔNG được bảo vệ'],
      Converter: ['warn', 'Converter · khoá tần số, không tiết kiệm'],
      Standby: ['warn', 'Standby · đầu ra đang tắt'],
      Fault: ['bad', 'UPS báo lỗi'],
    };
    const pill = $('ctl-mode');
    if (pill) {
      const m = modeEnt && modeEnt.state ? modeEnt.state : null;
      const [cls, hint] = MODE_PILL[m] || ['', 'Đọc trực tiếp từ UPS'];
      pill.textContent = m || '--';
      pill.className = 'mode-pill ' + cls;
      const mh = $('ctl-mode-hint');
      if (mh) mh.textContent = hint;
    }
    this._pending = this._pending || {};
    // Ba công tắc đầu là entity của ESPHome, dò theo tiền tố. Ổ cắm thì không:
    // entity của nó do người dùng chọn trong Cài đặt nên truyền thẳng id vào.
    const plugEnt = (this._cfg || {}).plug_entity || '';
    const plugRow = $('ctl-plug-row');
    if (plugRow) plugRow.style.display = plugEnt ? '' : 'none';
    const CONTROLS = [['eco_mode', 'ctl-eco', null], ['buzzer', 'ctl-buzzer', null],
                      ['ups_power', 'ctl-power', null]];
    if (plugEnt) CONTROLS.push(['plug', 'ctl-plug', plugEnt]);
    for (const [key, id, explicit] of CONTROLS) {
      const el = $(id);
      if (!el) continue;
      const st = explicit
        ? (this._hass.states[explicit] ? this._hass.states[explicit].state : null)
        : this._state('switch', key);
      // Đang chờ UPS xác nhận thì KHÔNG ghi đè ô tick, nếu không nó sẽ bật lại
      // ngay khi vừa bấm và trông như "không bấm được".
      if (this._pending[key] !== undefined) {
        if (st === this._pending[key]) delete this._pending[key];   // đã xác nhận
        continue;
      }
      // KHÔNG disable: ô bị khoá mà không giải thích gì thì người dùng không
      // biết vì sao. Cứ cho bấm, rồi báo lỗi cụ thể nếu không gửi được.
      el.checked = st === 'on';
    }

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
        `<br><br><b>Nếu danh sách trên trống:</b> HA chưa có thiết bị ESPHome. Vào ` +
        `<b>Cài đặt → Thiết bị &amp; Dịch vụ</b> và thêm tích hợp <b>ESPHome</b> ` +
        `(thiết bị <code>ups-vertiv</code>, cổng 6053).` +
        `<br><b>Nếu có tên khác lạ:</b> HA đã tạo entity nhưng đặt tên khác — báo lại tên đó ` +
        `để sửa <code>prefix</code> của card cho khớp.`;
    } else if (unavail) {
      banner.className = 'banner off show';
      banner.innerHTML =
        `Entity đã có trong HA nhưng đang <b>unavailable</b> — Home Assistant không ` +
        `nối được tới mạch <b>ESP32</b> đọc UPS.` +
        `<br><br>Kiểm tra theo thứ tự:` +
        `<br>1. <b>Mạch có điện không</b> — đèn nguồn trên ESP32 phải sáng. Nguồn phải lấy ` +
        `từ dãy <code>OUTPUT</code> của UPS, <b>không phải ổ P1</b> (P1 bị UPS tự ngắt).` +
        `<br>2. <b>Mạch có vào WiFi không</b> — nếu không, nó sẽ phát AP dự phòng tên ` +
        `<code>UPS-Vertiv Fallback</code>. Dùng điện thoại quét WiFi để kiểm.` +
        `<br>3. <b>Tên/mật khẩu WiFi có đổi không</b> — đổi rồi thì phải nạp lại firmware.`;
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

    this._updatePower();

    const src = this._hass.states[this._id('sensor', 'mode_text')];
    $('foot').textContent = src && (src.last_updated || src.last_changed)
      ? `Cập nhật: ${new Date(src.last_updated || src.last_changed).toLocaleTimeString('vi-VN')}`
      : '';
  }

  /** Gửi lệnh bật/tắt xuống UPS.
   *  KHÔNG tự đổi ô tick: trạng thái thật do thiết bị công bố sau khi UPS xác
   *  nhận bằng QFLAG. Nếu UPS từ chối, ô tick sẽ tự quay về đúng thực tế.
   */
  async _toggleSwitch(key, on, label, explicitId) {
    const msg = this.shadowRoot.getElementById('ctl-msg');
    const eid = explicitId || this._id('switch', key);

    if (!this._hass || !this._hass.states[eid]) {
      // Noi ro ten entity da tim, de doi chieu duoc ngay trong Developer Tools.
      // Huong dan khac nhau theo nguon entity: entity cua ESPHome thi tai lai
      // tich hop, con entity do nguoi dung tu chon thi phai chon lai cho dung.
      const how = explicitId
        ? `Entity này do bạn chọn ở <b>Cài đặt → Đo tiêu thụ điện</b>. ` +
          `Có thể nó đã bị đổi tên hoặc xoá — chọn lại rồi <b>Lưu</b>.`
        : `Vào <b>Cài đặt → Thiết bị &amp; Dịch vụ → ESPHome → ⋮ → Tải lại</b>, ` +
          `rồi <b>Ctrl+F5</b>.`;
      msg.innerHTML = `Không tìm thấy <code>${eid}</code>.<br>` + how;
      this._update();          // tra o tick ve dung thuc te
      return;
    }

    // "Ai xac nhan" khac nhau: cong tac cua UPS do UPS tra loi qua QFLAG/QMOD,
    // con o cam thong minh thi do chinh no bao ve. Dung chu chung cho dung ca hai.
    const who = explicitId ? 'xác nhận' : 'UPS xác nhận';

    this._pending = this._pending || {};
    this._pending[key] = on ? 'on' : 'off';
    msg.textContent = `Đang gửi lệnh ${on ? 'bật' : 'tắt'} ${label}, chờ ${who}…`;
    try {
      await this._hass.callService('switch', on ? 'turn_on' : 'turn_off',
        { entity_id: eid });
    } catch (e) {
      delete this._pending[key];
      msg.textContent = `Lỗi: ${e.message || e}`;
      this._update();
      return;
    }
    // Khong xac nhan trong 6s -> bo cho, tra cong tac ve trang thai that
    setTimeout(() => {
      if (this._pending && this._pending[key] !== undefined) {
        delete this._pending[key];
        msg.textContent = `${label}: không nhận được xác nhận — lệnh có thể bị từ chối.`;
        this._update();
      } else if (msg.textContent.startsWith('Đang gửi')) {
        msg.textContent = `${label}: đã xác nhận.`;
        setTimeout(() => { if (msg.textContent.endsWith('đã xác nhận.')) msg.textContent = ''; }, 3000);
      }
    }, 6000);
  }

  /** Xoá nhật ký: ghi một mốc thời gian, panel chỉ hiện sự kiện sau mốc đó. */
  async _clearLog() {
    const btn = this.shadowRoot.getElementById('btn-clear-log');
    const msg = 'Xoá toàn bộ nhật ký đang hiển thị? '
      + 'Lịch sử gốc trong Home Assistant vẫn được giữ nguyên — '
      + 'panel chỉ ngừng hiển thị các lần mất điện trước thời điểm này.';
    if (!confirm(msg)) return;
    const old = btn.textContent;
    btn.textContent = 'Đang xoá…';
    btn.disabled = true;
    try {
      const res = await this._hass.callWS({ type: 'ups_vertiv/clear_log' });
      this._cfg = { ...(this._cfg || {}), log_cleared_at: res.cleared_at };
      this._renderLog();
      btn.textContent = 'Đã xoá';
      setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1500);
    } catch (e) {
      btn.textContent = 'Lỗi: ' + (e.message || e);
      btn.disabled = false;
      setTimeout(() => { btn.textContent = old; }, 3000);
    }
  }

  // ---------------------------------------------------- vẽ tab nhật ký ---
  _renderLog() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const box = $('ev-list');
    if (!box) return;

    // Bỏ qua các sự kiện trước mốc "đã xoá nhật ký"
    const clearedAt = this._cfg && this._cfg.log_cleared_at
      ? Date.parse(this._cfg.log_cleared_at) : 0;
    const evs = (this._outages || [])
      .filter((e) => !clearedAt || Date.parse(e.start) > clearedAt)
      .slice().reverse();   // mới nhất lên đầu
    const done = evs.filter((e) => !e.ongoing);
    const total = done.reduce((a, e) => a + (e.duration_s || 0), 0);
    const longest = done.reduce((a, e) => Math.max(a, e.duration_s || 0), 0);

    $('s-count').textContent = String(evs.length);
    $('s-total').textContent = done.length ? fmtDuration(total) : '--';
    $('s-max').textContent = longest ? fmtDuration(longest) : '--';

    if (this._logError) {
      box.innerHTML = `<div class="empty">Không đọc được lịch sử.<br>
        <code>${this._logError}</code></div>`;
      return;
    }
    if (!this._outages) {
      box.innerHTML = '<div class="empty">Đang đọc lịch sử…</div>';
      return;
    }
    if (!evs.length) {
      box.innerHTML = `<div class="empty">${clearedAt
        ? 'Nhật ký đã được xoá. Các lần mất điện mới sẽ hiện ở đây.'
        : `Chưa ghi nhận lần mất điện nào trong ${LOG_DAYS} ngày qua.`}<br>
        Nhật ký dựng từ lịch sử của Home Assistant, nên chỉ có dữ liệu kể từ khi
        thiết bị được thêm vào.</div>`;
      return;
    }

    // Gom theo ngày, giữ nguyên thứ tự mới nhất trước
    const groups = [];
    for (const e of evs) {
      const k = dayKey(e.start);
      if (!groups.length || groups[groups.length - 1].key !== k) {
        groups.push({ key: k, iso: e.start, items: [] });
      }
      groups[groups.length - 1].items.push(e);
    }

    const renderEvent = (e) => {
      const live = !!e.ongoing;
      const tags = live ? '<span class="tag live">ĐANG DIỄN RA</span>' : '';

      const det = [];
      if (e.battery_start !== null && e.battery_end !== null) {
        det.push(`Pin ${Math.round(e.battery_start)}% &rarr; ${Math.round(e.battery_end)}%`);
      }
      if (e.voltage_min !== null) det.push(`thấp nhất ${e.voltage_min.toFixed(1)} V`);

      return `
        <div class="ev ${live ? 'live' : 'done'}">
          <div class="ev-top">
            <span class="ev-when">${fmtWhen(e.start)}${live ? '' : ' &rarr; ' + fmtWhen(e.end)}</span>
            <span class="ev-dur">${fmtDuration(e.duration_s)}</span>
          </div>
          ${det.length ? `<div class="ev-det">${det.join(' &middot; ')}</div>` : ''}
          <div>${tags}</div>
        </div>`;
    };

    box.innerHTML = groups.map((g) => {
      const gd = g.items.filter((e) => !e.ongoing);
      const gtotal = gd.reduce((a, e) => a + (e.duration_s || 0), 0);
      const sum = `${g.items.length} lần`
        + (gd.length ? ` &middot; ${fmtDuration(gtotal)}` : '');
      return `
        <div class="day">
          <span class="day-name">${dayLabel(g.iso)}</span>
          <span class="day-sum">${sum}</span>
        </div>
        ${g.items.map(renderEvent).join('')}`;
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
