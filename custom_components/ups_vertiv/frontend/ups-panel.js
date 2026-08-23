/*!
 * ups-panel.js
 * Panel toan trang cho Home Assistant, dang ky tai /ups boi integration ups_vertiv.
 *
 * Panel nay KHONG ve lai giao dien - no tu import roi boc lai <ups-panel-card>
 * de tranh nhan doi code render.
 */

const UPS_PANEL_VERSION = '3.0.3';
const CARD_TAG = 'ups-panel-card';

// Tinh mot lan, co duong lui: neu import.meta.url khong dung duoc thi rot ve
// duong dan tinh mac dinh do integration dang ky.
const CARD_URL = (() => {
  try {
    return new URL('./ups-panel-card.js', import.meta.url).href;
  } catch (e) {
    return '/ups_vertiv-frontend/ups-panel-card.js';
  }
})();

class UpsVertivPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._built = false;
    this._narrow = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    if (this._card) this._card.hass = hass;
  }

  set narrow(value) {
    this._narrow = !!value;
    this._applyNarrow();
  }

  // HA truyen them 2 thuoc tinh nay; khong dung nhung phai nhan de khong loi
  set route(_v) { }
  set panel(_v) { }

  _applyNarrow() {
    if (!this._built) return;
    const btn = this.shadowRoot.getElementById('menu');
    if (btn) btn.style.display = this._narrow ? 'flex' : 'none';
  }

  async _build() {
    this._built = true;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100vh;
          overflow: auto;
          background: var(--primary-background-color, #fafafa);
        }
        .bar {
          position: sticky; top: 0; z-index: 4;
          display: flex; align-items: center; gap: 8px;
          height: 56px; padding: 0 12px; box-sizing: border-box;
          background: var(--app-header-background-color, var(--primary-color, #03a9f4));
          color: var(--app-header-text-color, #fff);
          box-shadow: 0 2px 4px rgba(0,0,0,.14);
        }
        .bar .ttl { font-size: 1.15rem; font-weight: 500; }
        #menu {
          display: none; align-items: center; justify-content: center;
          width: 40px; height: 40px; border: none; border-radius: 50%;
          background: none; color: inherit; cursor: pointer; font-size: 1.3rem;
        }
        #menu:hover { background: rgba(255,255,255,.12); }
        .wrap { max-width: 720px; margin: 0 auto; padding: 16px 12px 40px; }
        .miss {
          margin: 24px auto; max-width: 640px; padding: 16px 18px; border-radius: 10px;
          background: rgba(244,67,54,.12); color: #c62828; font-size: .9rem; line-height: 1.6;
        }
        .miss code {
          background: rgba(0,0,0,.08); padding: 1px 5px; border-radius: 4px;
        }
      </style>

      <div class="bar">
        <button id="menu" title="Menu">&#9776;</button>
        <div class="ttl">UPS Vertiv GXT-3000</div>
      </div>
      <div class="wrap" id="wrap"></div>
    `;

    this.shadowRoot.getElementById('menu').addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true })
      );
    });
    this._applyNarrow();

    const wrap = this.shadowRoot.getElementById('wrap');

    // TU nap card thay vi trong cho frontend.add_extra_js_url.
    // add_extra_js_url chi duoc tiem vao luc trang frontend khoi tao, nen ngay
    // sau khi them integration (hoac khi trinh duyet con cache trang cu) card
    // se chua ton tai. Panel va card nam cung thu muc tinh, ma panel duoc nap
    // dang ES module, nen import tuong doi luon giai ra dung URL.
    let importErr = null;
    if (!customElements.get(CARD_TAG)) {
      try {
        await import(CARD_URL);
      } catch (e) {
        importErr = e;
        console.error('[ups-panel] khong import duoc card:', e);
      }
    }

    const ready = await Promise.race([
      customElements.whenDefined(CARD_TAG).then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);

    if (!ready) {
      const detail = importErr
        ? `<br><br>Loi import: <code>${String(importErr.message || importErr)}</code>`
        : '';
      wrap.innerHTML = `
        <div class="miss">
          Khong nap duoc <code>${CARD_TAG}</code>.${detail}<br><br>
          Kiem tra file co phuc vu duoc khong bang cach mo thang duong dan nay
          trong trinh duyet:<br>
          <code>${CARD_URL}</code><br><br>
          Neu bao 404 thi vao <b>Cai dat &rarr; Thiet bi &amp; Dich vu</b>,
          xoa roi them lai <b>UPS Vertiv GXT Panel</b>, sau do khoi dong lai
          Home Assistant.
        </div>`;
      return;
    }

    const card = document.createElement(CARD_TAG);
    card.setConfig({ prefix: 'ups', name: 'UPS Vertiv GXT-3000' });
    wrap.appendChild(card);
    this._card = card;
    if (this._hass) card.hass = this._hass;
  }
}

if (!customElements.get('ups-vertiv-panel')) {
  customElements.define('ups-vertiv-panel', UpsVertivPanel);
}

console.info(`%c UPS-VERTIV-PANEL %c v${UPS_PANEL_VERSION} `,
  'color:#fff;background:#2e7d32;font-weight:700',
  'color:#2e7d32;background:#eee');
