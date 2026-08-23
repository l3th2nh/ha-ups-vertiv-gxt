/*!
 * ups-panel-card.js
 * Panel quan ly UPS Vertiv / Liebert GXT-3000MTPLUS230 cho Home Assistant.
 *
 * Du lieu den tu Windows agent (Ups-Monitor.ps1) day len qua MQTT Discovery.
 * Card nay chi doc tu cac entity da co san trong HA - khong goi mang truc tiep.
 *
 * Vi du cau hinh Lovelace:
 *   type: custom:ups-panel-card
 *   prefix: ups
 *   name: UPS Vertiv GXT-3000
 *   show_controls: true
 */

const UPS_CARD_VERSION = '1.0.0';

const SENSOR_KEYS = [
  'battery_percent', 'runtime_minutes', 'load_percent', 'load_watts',
  'input_voltage', 'output_voltage', 'battery_voltage',
  'input_freq', 'output_freq', 'output_current',
  'temperature', 'mode_text',
];

// Mau ma theo che do QMOD do agent gui len (mode_text bat dau bang tu khoa nay)
const MODE_STYLE = [
  { match: /^Line/i,     cls: 'ok',    label: 'Dien luoi' },
  { match: /^Battery/i,  cls: 'crit',  label: 'Chay pin' },
  { match: /^Bypass/i,   cls: 'warn',  label: 'Bypass' },
  { match: /^Fault/i,    cls: 'crit',  label: 'Loi' },
  { match: /^ECO/i,      cls: 'ok',    label: 'ECO' },
  { match: /^Converter/i,cls: 'ok',    label: 'Converter' },
  { match: /^Standby/i,  cls: 'warn',  label: 'Standby' },
  { match: /^Power On/i, cls: 'warn',  label: 'Dang khoi dong' },
  { match: /^Shutdown/i, cls: 'crit',  label: 'Shutdown' },
];

class UpsPanelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._built = false;
  }

  static getStubConfig() {
    return { prefix: 'ups', name: 'UPS', show_controls: true };
  }

  setConfig(config) {
    this._config = Object.assign(
      { prefix: 'ups', name: 'UPS', show_controls: true },
      config || {}
    );
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
  }

  getCardSize() { return 8; }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  // ------------------------------------------------------------ helpers ----
  _id(domain, key) { return `${domain}.${this._config.prefix}_${key}`; }

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

  _press(key, confirmText) {
    const id = this._id('button', key);
    if (!this._hass || !this._hass.states[id]) {
      alert(`Khong tim thay entity ${id}.\nKiem tra RemoteControl.Enabled trong ups-config.psd1.`);
      return;
    }
    if (confirmText && !window.confirm(confirmText)) return;
    this._hass.callService('button', 'press', { entity_id: id });
  }

  // -------------------------------------------------------------- render ---
  _build() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        .hdr { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
        .title { font-size:1.15rem; font-weight:600; color:var(--primary-text-color); }
        .ver { font-size:.7rem; color:var(--secondary-text-color); }
        .badge { padding:4px 12px; border-radius:999px; font-size:.8rem; font-weight:600; white-space:nowrap; }
        .badge.ok   { background:rgba(76,175,80,.16);  color:#2e7d32; }
        .badge.warn { background:rgba(255,152,0,.16);  color:#ef6c00; }
        .badge.crit { background:rgba(244,67,54,.16);  color:#c62828; }
        .badge.dead { background:rgba(120,120,120,.16);color:var(--secondary-text-color); }

        .banner { padding:10px 12px; border-radius:8px; margin-bottom:14px; font-size:.85rem; display:none; }
        .banner.show { display:block; }
        .banner.off  { background:rgba(120,120,120,.14); color:var(--secondary-text-color); }
        .banner.bad  { background:rgba(244,67,54,.14);  color:#c62828; }

        .flow { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center;
                gap:6px; margin-bottom:16px; }
        .node { text-align:center; padding:10px 6px; border-radius:10px;
                background:var(--secondary-background-color); }
        .node .lbl { font-size:.7rem; color:var(--secondary-text-color); text-transform:uppercase; letter-spacing:.04em; }
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

        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(108px,1fr)); gap:8px; }
        .cell { background:var(--secondary-background-color); border-radius:8px; padding:9px 10px; }
        .cell .k { font-size:.68rem; color:var(--secondary-text-color); text-transform:uppercase; letter-spacing:.04em; }
        .cell .v { font-size:1rem; font-weight:600; color:var(--primary-text-color); margin-top:3px; }

        .ctl { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
        .ctl button { flex:1 1 110px; padding:10px 12px; border:none; border-radius:8px; cursor:pointer;
                      font-size:.85rem; font-weight:600; font-family:inherit; }
        .ctl button.off  { background:rgba(244,67,54,.14);  color:#c62828; }
        .ctl button.rst  { background:rgba(255,152,0,.14);  color:#ef6c00; }
        .ctl button.can  { background:var(--secondary-background-color); color:var(--primary-text-color); }
        .ctl button:hover { filter:brightness(.94); }

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

        <div class="banner off" id="banner"></div>

        <div class="flow">
          <div class="node" id="n-in">
            <div class="lbl">Dien luoi</div>
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
            <div class="lbl">Dau ra</div>
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
          <div class="cell"><div class="k">Tai</div>       <div class="v" id="m-load">--</div></div>
          <div class="cell"><div class="k">Cong suat</div> <div class="v" id="m-watt">--</div></div>
          <div class="cell"><div class="k">Dong ra</div>   <div class="v" id="m-amp">--</div></div>
          <div class="cell"><div class="k">Dien ap pin</div><div class="v" id="m-bv">--</div></div>
          <div class="cell"><div class="k">Nhiet do</div>  <div class="v" id="m-temp">--</div></div>
          <div class="cell"><div class="k">Tan so vao</div><div class="v" id="m-inf">--</div></div>
        </div>

        <div class="ctl" id="ctl" style="display:${c.show_controls ? 'flex' : 'none'}">
          <button class="off" id="btn-off">Tat may</button>
          <button class="rst" id="btn-rst">Khoi dong lai</button>
          <button class="can" id="btn-can">Huy</button>
        </div>

        <div class="foot" id="foot"></div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    $('btn-off').addEventListener('click', () =>
      this._press('pc_shutdown', 'Tat may tinh nay?\nCac chuong trinh dang mo se bi dong (/f).'));
    $('btn-rst').addEventListener('click', () =>
      this._press('pc_restart', 'Khoi dong lai may tinh nay?\nCac chuong trinh dang mo se bi dong (/f).'));
    $('btn-can').addEventListener('click', () => this._press('cancel_shutdown', null));

    this._built = true;
  }

  _update() {
    if (!this._hass || !this._built) return;
    const $ = (id) => this.shadowRoot.getElementById(id);

    const modeText = this._state('sensor', 'mode_text');
    const onBattery = this._state('binary_sensor', 'on_battery') === 'on';
    const hasFault  = this._state('binary_sensor', 'has_warning') === 'on';
    const offline   = !modeText || modeText === 'unavailable' || modeText === 'unknown';

    // --- badge trang thai ---
    const badge = $('badge');
    let style = { cls: 'dead', label: 'Mat ket noi' };
    if (!offline) {
      const hit = MODE_STYLE.find((m) => m.match.test(modeText));
      style = hit || { cls: 'warn', label: modeText };
    }
    if (hasFault && !offline) style = { cls: 'crit', label: 'LOI UPS' };
    badge.className = `badge ${style.cls}`;
    badge.textContent = style.label;

    // --- banner canh bao ---
    const banner = $('banner');
    if (offline) {
      banner.className = 'banner off show';
      banner.textContent =
        'Khong nhan duoc du lieu. May tinh cam UPS dang tat, hoac Ups-Monitor khong chay, hoac mat MQTT.';
    } else if (hasFault) {
      banner.className = 'banner bad show';
      banner.textContent = 'UPS dang bao loi (QWS khac 0). Kiem tra man hinh UPS.';
    } else if (onBattery) {
      banner.className = 'banner bad show';
      banner.textContent = 'MAT DIEN LUOI - UPS dang chay pin. May se tu tat khi cham nguong da dat.';
    } else {
      banner.className = 'banner off';
      banner.textContent = '';
    }

    // --- so do dong dien ---
    $('in-v').textContent  = this._fmt('input_voltage', 'V', 1);
    $('in-f').textContent  = this._fmt('input_freq', 'Hz', 1);
    $('out-v').textContent = this._fmt('output_voltage', 'V', 1);
    $('out-f').textContent = this._fmt('output_freq', 'Hz', 1);
    $('ups-mode').textContent = offline ? '--' : style.label;
    $('ups-temp').textContent = this._fmt('temperature', '°C', 1);

    $('n-in').className = 'node' + (onBattery || offline ? ' dim' : '');
    $('a1').className = 'arrow' + (!onBattery && !offline ? ' live' : '');
    $('a2').className = 'arrow' + (offline ? '' : (onBattery ? ' batt' : ' live'));

    // --- pin ---
    const pct = this._num('battery_percent', 0);
    const rt  = this._num('runtime_minutes', 0);
    $('b-pct').textContent = pct === null ? '--' : `${pct}%`;
    $('b-rt').textContent  = rt === null ? 'Thoi gian du phong: --'
      : `Du phong ~${rt >= 60 ? `${Math.floor(rt / 60)}h ${rt % 60}p` : `${rt} phut`}`;
    const bar = $('b-bar');
    const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    bar.style.width = `${p}%`;
    bar.style.background = p >= 60 ? '#4caf50' : (p >= 30 ? '#ff9800' : '#f44336');

    // --- luoi thong so ---
    $('m-load').textContent = this._fmt('load_percent', '%', 0);
    $('m-watt').textContent = this._fmt('load_watts', 'W', 0);
    $('m-amp').textContent  = this._fmt('output_current', 'A', 1);
    $('m-bv').textContent   = this._fmt('battery_voltage', 'V', 1);
    $('m-temp').textContent = this._fmt('temperature', '°C', 1);
    $('m-inf').textContent  = this._fmt('input_freq', 'Hz', 1);

    // --- chan trang ---
    const src = this._hass.states[this._id('sensor', 'mode_text')];
    $('foot').textContent = src && src.last_changed
      ? `Cap nhat: ${new Date(src.last_updated || src.last_changed).toLocaleTimeString()}`
      : '';
  }
}

customElements.define('ups-panel-card', UpsPanelCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ups-panel-card',
  name: 'UPS Panel Card',
  description: 'Panel quan ly UPS Vertiv/Liebert GXT qua MQTT (Windows agent).',
  preview: true,
});

console.info(`%c UPS-PANEL-CARD %c v${UPS_CARD_VERSION} `,
  'color:#fff;background:#2e7d32;font-weight:700',
  'color:#2e7d32;background:#eee');
