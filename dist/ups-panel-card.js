/*!
 * ups-panel-card.js
 * Panel quan ly UPS Vertiv / Liebert GXT-3000MTPLUS230 cho Home Assistant.
 *
 * CHI DOC - khong co nut dieu khien nao. Du lieu den tu Windows agent
 * (Ups-Monitor.ps1) day len qua MQTT Discovery.
 *
 * Hai tab:
 *   1. Thong tin  - trang thai va thong so hien tai
 *   2. Nhat ky    - lich su mat dien / co dien lai
 *
 * Vi du cau hinh Lovelace:
 *   type: custom:ups-panel-card
 *   prefix: ups
 *   name: UPS Vertiv GXT-3000
 */

const UPS_CARD_VERSION = '2.0.0';

// Mau ma theo che do QMOD do agent gui len (mode_text bat dau bang tu khoa nay)
const MODE_STYLE = [
  { match: /^Line/i,      cls: 'ok',   label: 'Dien luoi' },
  { match: /^Battery/i,   cls: 'crit', label: 'Chay pin' },
  { match: /^Bypass/i,    cls: 'warn', label: 'Bypass' },
  { match: /^Fault/i,     cls: 'crit', label: 'Loi' },
  { match: /^ECO/i,       cls: 'ok',   label: 'ECO' },
  { match: /^Converter/i, cls: 'ok',   label: 'Converter' },
  { match: /^Standby/i,   cls: 'warn', label: 'Standby' },
  { match: /^Power On/i,  cls: 'warn', label: 'Dang khoi dong' },
  { match: /^Shutdown/i,  cls: 'crit', label: 'Shutdown' },
];

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec} giay`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} phut ${s} giay` : `${m} phut`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h} gio ${mm} phut` : `${h} gio`;
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
    this._config = Object.assign({ prefix: 'ups', name: 'UPS' }, config || {});
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
  }

  getCardSize() { return 9; }

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

  _events() {
    const e = this._hass && this._hass.states[this._id('sensor', 'power_events')];
    if (!e || !e.attributes) return [];
    const list = e.attributes.events;
    return Array.isArray(list) ? list : [];
  }

  _setTab(tab) {
    this._tab = tab;
    const $ = (id) => this.shadowRoot.getElementById(id);
    $('tab-info').className = 'tab' + (tab === 'info' ? ' sel' : '');
    $('tab-log').className = 'tab' + (tab === 'log' ? ' sel' : '');
    $('pane-info').style.display = tab === 'info' ? 'block' : 'none';
    $('pane-log').style.display = tab === 'log' ? 'block' : 'none';
    this._update();
  }

  // -------------------------------------------------------------- render ---
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

        .empty { text-align:center; padding:28px 12px; color:var(--secondary-text-color); font-size:.85rem; }
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
          <button class="tab sel" id="tab-info">Thong tin</button>
          <button class="tab" id="tab-log">Nhat ky</button>
        </div>

        <div class="banner off" id="banner"></div>

        <div id="pane-info">
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
            <div class="cell"><div class="k">Tai</div>         <div class="v" id="m-load">--</div></div>
            <div class="cell"><div class="k">Cong suat</div>   <div class="v" id="m-watt">--</div></div>
            <div class="cell"><div class="k">Dong ra</div>     <div class="v" id="m-amp">--</div></div>
            <div class="cell"><div class="k">Dien ap pin</div> <div class="v" id="m-bv">--</div></div>
            <div class="cell"><div class="k">Nhiet do</div>    <div class="v" id="m-temp">--</div></div>
            <div class="cell"><div class="k">Tan so vao</div>  <div class="v" id="m-inf">--</div></div>
          </div>

          <div class="outlet" id="outlet-row">
            <div>
              <div class="on">O cam lap trinh P1</div>
              <div class="os" id="outlet-sub">--</div>
            </div>
            <div class="dot na" id="outlet-dot">--</div>
          </div>
        </div>

        <div id="pane-log" style="display:none">
          <div class="sum">
            <div class="cell"><div class="k">So lan mat dien</div><div class="v" id="s-count">--</div></div>
            <div class="cell"><div class="k">Tong thoi gian</div> <div class="v" id="s-total">--</div></div>
            <div class="cell"><div class="k">Lan lau nhat</div>   <div class="v" id="s-max">--</div></div>
          </div>
          <div id="ev-list"></div>
        </div>

        <div class="foot" id="foot"></div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    $('tab-info').addEventListener('click', () => this._setTab('info'));
    $('tab-log').addEventListener('click', () => this._setTab('log'));
    this._built = true;
  }

  _update() {
    if (!this._hass || !this._built) return;
    const $ = (id) => this.shadowRoot.getElementById(id);

    const modeText = this._state('sensor', 'mode_text');
    const onBattery = this._state('binary_sensor', 'on_battery') === 'on';
    const hasFault = this._state('binary_sensor', 'has_warning') === 'on';
    const offline = !modeText || modeText === 'unavailable' || modeText === 'unknown';

    // --- badge trang thai ---
    let style = { cls: 'dead', label: 'Mat ket noi' };
    if (!offline) {
      style = MODE_STYLE.find((m) => m.match.test(modeText)) || { cls: 'warn', label: modeText };
    }
    if (hasFault && !offline) style = { cls: 'crit', label: 'LOI UPS' };
    const badge = $('badge');
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

    // --- tab thong tin ---
    $('in-v').textContent = this._fmt('input_voltage', 'V', 1);
    $('in-f').textContent = this._fmt('input_freq', 'Hz', 1);
    $('out-v').textContent = this._fmt('output_voltage', 'V', 1);
    $('out-f').textContent = this._fmt('output_freq', 'Hz', 1);
    $('ups-mode').textContent = offline ? '--' : style.label;
    $('ups-temp').textContent = this._fmt('temperature', '°C', 1);

    $('n-in').className = 'node' + (onBattery || offline ? ' dim' : '');
    $('a1').className = 'arrow' + (!onBattery && !offline ? ' live' : '');
    $('a2').className = 'arrow' + (offline ? '' : (onBattery ? ' batt' : ' live'));

    const pct = this._num('battery_percent', 0);
    const rt = this._num('runtime_minutes', 0);
    $('b-pct').textContent = pct === null ? '--' : `${pct}%`;
    $('b-rt').textContent = rt === null ? 'Thoi gian du phong: --'
      : `Du phong ~${rt >= 60 ? `${Math.floor(rt / 60)}h ${rt % 60}p` : `${rt} phut`}`;
    const bar = $('b-bar');
    const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    bar.style.width = `${p}%`;
    bar.style.background = p >= 60 ? '#4caf50' : (p >= 30 ? '#ff9800' : '#f44336');

    $('m-load').textContent = this._fmt('load_percent', '%', 0);
    $('m-watt').textContent = this._fmt('load_watts', 'W', 0);
    $('m-amp').textContent = this._fmt('output_current', 'A', 1);
    $('m-bv').textContent = this._fmt('battery_voltage', 'V', 1);
    $('m-temp').textContent = this._fmt('temperature', '°C', 1);
    $('m-inf').textContent = this._fmt('input_freq', 'Hz', 1);

    // --- o cam P1 (chi doc) ---
    const outState = this._state('binary_sensor', 'outlet_p1');
    const dot = $('outlet-dot');
    if (outState === 'on') {
      dot.className = 'dot on'; dot.textContent = 'DANG BAT';
      $('outlet-sub').textContent = 'Dang cap dien cho tai khong thiet yeu';
    } else if (outState === 'off') {
      dot.className = 'dot offx'; dot.textContent = 'DA NGAT';
      $('outlet-sub').textContent = 'UPS da tu ngat de danh pin cho tai quan trong';
    } else {
      dot.className = 'dot na'; dot.textContent = '--';
      $('outlet-sub').textContent = 'Khong ro trang thai';
    }

    // --- tab nhat ky ---
    this._renderLog();

    const src = this._hass.states[this._id('sensor', 'mode_text')];
    $('foot').textContent = src && (src.last_updated || src.last_changed)
      ? `Cap nhat: ${new Date(src.last_updated || src.last_changed).toLocaleTimeString()}`
      : '';
  }

  _renderLog() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const evs = this._events().slice().reverse();   // moi nhat len dau

    const done = evs.filter((e) => !e.ongoing);
    const total = done.reduce((a, e) => a + (e.duration_s || 0), 0);
    const longest = done.reduce((a, e) => Math.max(a, e.duration_s || 0), 0);
    $('s-count').textContent = evs.length ? String(evs.length) : '0';
    $('s-total').textContent = done.length ? fmtDuration(total) : '--';
    $('s-max').textContent = longest ? fmtDuration(longest) : '--';

    const box = $('ev-list');
    if (!evs.length) {
      box.innerHTML = `<div class="empty">Chua ghi nhan lan mat dien nao.<br>
        Nhat ky duoc luu tai <code>logs/power-events.json</code> va song sot qua reboot.</div>`;
      return;
    }

    box.innerHTML = evs.map((e) => {
      const live = !!e.ongoing;
      const tags = [];
      if (live) tags.push('<span class="tag live">DANG DIEN RA</span>');
      if (e.outlet_shed) tags.push('<span class="tag shed">O P1 bi ngat</span>');
      if (e.shutdown_fired) tags.push('<span class="tag shut">Da tu tat may</span>');

      const det = [
        `Pin ${e.battery_start}% &rarr; ${e.battery_end}%`,
        `thap nhat ${e.voltage_min}V`,
        `tai dinh ${e.load_max}%`,
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

customElements.define('ups-panel-card', UpsPanelCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ups-panel-card',
  name: 'UPS Panel Card',
  description: 'Panel theo doi UPS Vertiv/Liebert GXT: thong so + nhat ky mat dien.',
  preview: true,
});

console.info(`%c UPS-PANEL-CARD %c v${UPS_CARD_VERSION} `,
  'color:#fff;background:#2e7d32;font-weight:700',
  'color:#2e7d32;background:#eee');
