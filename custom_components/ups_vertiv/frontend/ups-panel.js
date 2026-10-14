/*!
 * ups-panel.js
 * Trang toàn màn hình cho Home Assistant, được integration ups_vertiv đăng ký tại /ups.
 *
 * Trang này KHÔNG vẽ lại giao diện — nó tự nạp rồi bọc lại <ups-panel-card>
 * để tránh nhân đôi mã hiển thị.
 *
 * Dữ liệu đến từ thiết bị ESP32-C3 chạy ESPHome (xem thư mục esphome/).
 */

const CARD_TAG = 'ups-panel-card';

// Tính một lần, có đường lui: nếu import.meta.url không dùng được thì rơi về
// đường dẫn tĩnh mặc định do integration đăng ký.
//
// PHẢI mang theo query string của chính file này. Integration đăng ký panel ở
// `ups-panel.js?v=<phiên bản>`, nhưng `new URL('./x.js', base)` thì VỨT query
// đi — card luôn được nạp từ một URL không đổi, nên trình duyệt dùng mãi bản đã
// cache. Trên máy tính không ai nhận ra vì Ctrl+F5 bỏ qua cache; trên app điện
// thoại thì không có Ctrl+F5, và panel đứng yên ở bản cũ.
const CARD_URL = (() => {
  try {
    const me = new URL(import.meta.url);
    const url = new URL('./ups-panel-card.js', me);
    url.search = me.search;
    return url.href;
  } catch (e) {
    return '/ups_vertiv-frontend/ups-panel-card.js';
  }
})();

// Lấy luôn từ query string thay vì chép tay, để không bao giờ lệch với manifest
const UPS_PANEL_VERSION = (() => {
  try {
    return new URL(import.meta.url).searchParams.get('v') || 'dev';
  } catch (e) {
    return 'dev';
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

  // HA truyền thêm 2 thuộc tính này; không dùng nhưng phải nhận để không lỗi
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
          background: rgba(0,0,0,.08); padding: 1px 5px; border-radius: 4px; word-break: break-all;
        }
        .retry {
          margin-top: 14px; padding: 8px 18px; border: none; border-radius: 8px;
          background: #c62828; color: #fff; font-family: inherit; font-size: .88rem;
          font-weight: 600; cursor: pointer;
        }
        .load {
          margin: 32px auto; max-width: 640px; text-align: center; font-size: .9rem;
          color: var(--secondary-text-color, #666);
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
    const fail = await this._loadCard(wrap);
    if (fail) { await this._showCardError(wrap, fail); return; }
    this._mountCard(wrap);
  }

  /**
   * Nạp card, có thử lại và tự chẩn đoán.
   *
   * Bản trước thử đúng MỘT lần rồi bỏ cuộc vĩnh viễn, và hộp lỗi chỉ nói được
   * "không nạp được". Lần hỏng sáng 14/10/2026 rơi đúng vào vùng mù đó: không
   * có dòng "Lỗi import" nào cả, nghĩa là `import()` đã THÀNH CÔNG mà custom
   * element vẫn không xuất hiện. Một file RỖNG cũng import trót lọt y như vậy —
   * JS rỗng là JS hợp lệ — nên một phản hồi hỏng nằm trong cache của app là đủ
   * để ghim panel ở màn hình lỗi mãi mãi.
   *
   * Từ nay: thử lại vài lần, lần sau đổi URL để thoát cache, và nếu vẫn hỏng
   * thì đi hỏi thẳng server xem thực sự nhận được cái gì.
   */
  async _loadCard(wrap) {
    const MAX_TRY = 3;
    let last = null;

    for (let i = 1; i <= MAX_TRY; i++) {
      if (customElements.get(CARD_TAG)) return null;

      // Lần thử lại dùng URL khác: URL mới nằm ngoài module map của trình duyệt
      // và ngoài cache của service worker, nên một bản đã hỏng không ghim được
      // lỗi. Giữ nguyên URL thì import() lần hai chỉ trả lại đúng kết quả cũ.
      const url = i === 1
        ? CARD_URL
        : `${CARD_URL}${CARD_URL.includes('?') ? '&' : '?'}r=${Date.now()}`;

      wrap.innerHTML = `<div class="load">Đang nạp giao diện…`
        + (i > 1 ? ` (lần ${i}/${MAX_TRY})` : '') + `</div>`;

      try {
        await import(url);
      } catch (e) {
        last = { stage: 'import', url, msg: String((e && e.message) || e) };
        continue;
      }

      // Module đã chạy xong thì element phải có gần như tức thì. Vẫn chờ rộng
      // tay vì máy yếu, nhưng chờ lâu không cứu được trường hợp file rỗng.
      const ok = await Promise.race([
        customElements.whenDefined(CARD_TAG).then(() => true),
        new Promise((r) => setTimeout(() => r(false), 10000)),
      ]);
      if (ok) return null;

      last = { stage: 'define', url,
               msg: 'file nạp được nhưng không đăng ký custom element' };
    }
    return last || { stage: 'unknown', url: CARD_URL, msg: '' };
  }

  /** Hỏi thẳng server xem URL đó thực sự trả về cái gì. */
  async _probeCard(url) {
    try {
      const res = await fetch(url, { cache: 'reload' });
      const text = await res.text();
      return {
        status: res.status,
        type: res.headers.get('content-type') || '(không có)',
        len: text.length,
        head: text.slice(0, 60).replace(/\s+/g, ' '),
      };
    } catch (e) {
      return { status: 0, type: '-', len: 0,
               head: String((e && e.message) || e) };
    }
  }

  /** Dịch kết quả probe thành một câu nói rõ phải làm gì. */
  _diagnose(p) {
    if (p.status === 0) {
      return 'Không gọi tới được Home Assistant. Máy chủ chưa khởi động xong, '
        + 'hoặc điện thoại đang xem bản trang đã lưu sẵn mà không có mạng tới HA.';
    }
    if (p.status === 404) {
      return 'Máy chủ trả <b>404</b> — integration chưa đăng ký được đường dẫn tĩnh. '
        + 'Vào <b>Cài đặt → Thiết bị &amp; Dịch vụ</b>, xoá rồi thêm lại '
        + '<b>UPS Vertiv GXT Panel</b>, sau đó khởi động lại Home Assistant.';
    }
    if (p.status >= 500) {
      return `Máy chủ trả <b>${p.status}</b> — Home Assistant đang lỗi hoặc còn đang khởi động. `
        + 'Đợi HA chạy hẳn rồi bấm Thử lại.';
    }
    if (p.len === 0) {
      return 'Máy chủ trả về <b>file rỗng</b>. Gần như chắc chắn là một bản hỏng nằm '
        + 'trong cache của app. Bấm <b>Thử lại</b> (nó tự đổi URL để thoát cache); '
        + 'nếu vẫn vậy thì vào <b>Cài đặt → Companion app → Gỡ lỗi → Reset frontend cache</b>.';
    }
    if (!/javascript|ecmascript/i.test(p.type)) {
      return `Máy chủ trả về <code>${p.type}</code> chứ không phải JavaScript — `
        + 'nhiều khả năng là trang đăng nhập hoặc trang lỗi bị trả về thay cho file.';
    }
    return 'File tải về trông bình thường nhưng không đăng ký được custom element. '
      + 'Nhiều khả năng là bản JS cũ/hỏng trong cache — bấm <b>Thử lại</b>.';
  }

  async _showCardError(wrap, fail) {
    const p = await this._probeCard(fail.url);
    wrap.innerHTML = `
      <div class="miss">
        Không nạp được <code>${CARD_TAG}</code>.<br><br>
        ${this._diagnose(p)}<br><br>
        <b>Chi tiết để đối chiếu:</b><br>
        Hỏng ở bước: <code>${fail.stage === 'import' ? 'tải file' : 'đăng ký element'}</code>
        ${fail.msg ? `<br>Thông báo: <code>${fail.msg}</code>` : ''}<br>
        Máy chủ trả: <code>HTTP ${p.status} · ${p.type} · ${p.len} byte</code><br>
        ${p.head ? `Đầu file: <code>${p.head}</code><br>` : ''}
        Đường dẫn: <code>${fail.url}</code>
        <div><button class="retry" id="retry">Thử lại</button></div>
      </div>`;
    const btn = this.shadowRoot.getElementById('retry');
    if (btn) {
      btn.addEventListener('click', async () => {
        const again = await this._loadCard(wrap);
        if (again) { await this._showCardError(wrap, again); return; }
        this._mountCard(wrap);
      });
    }
  }

  _mountCard(wrap) {
    wrap.innerHTML = '';
    const card = document.createElement(CARD_TAG);
    // Khong ep prefix: de card tu dung mac dinh + tu do tien to entity
    card.setConfig({ name: 'UPS Vertiv GXT-3000' });
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
