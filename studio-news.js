// studio-news.js：所有 App 共用的「公告」視窗（畫面＋紅點＋自動跳出＋線上公告）
// 公告內容寫在各 App 自己的 news.js（window.NEWS），這個檔只管顯示，所有 App 都一樣。
// 說明：Desktop\claude\筆記本\遊戲公告系統.md
//
// index.html：<script src="news.js"></script> <script src="studio-news.js"></script>（放在主程式前面）
// 主程式：
//   STUDIO_NEWS.init({
//     game: 'guishi',                     // 線上公告檔名：https://weo001.github.io/news/guishi.json
//     button: '#newsBtn',                 // 公告按鈕（有新公告時加上 class "st-new" 和紅點）；畫面會重畫的話用選擇器，重畫後呼叫 STUDIO_NEWS.refresh()
//     isNewPlayer: () => save.runs === 0, // 新玩家：不自動跳，只亮紅點
//     canPop: () => 在主畫面且沒有別的視窗,  // 老玩家自動跳出前會一直等到這個是 true
//     stats: () => [['章節', '30 章'], ...],// 遊戲狀態（程式自動算，不要寫死）
//     onOpen, onClose,                    // 打開／關掉時（要暫停就在這裡）
//     theme: { bg, card, accent, text, sub },
//   });
//   STUDIO_NEWS.open();                   // 手動打開
//   STUDIO_NEWS.refresh();                // 公告按鈕重畫後補紅點
//
// 線上公告（不用重新上架就能發）：在開發者網站放 news/遊戲代號.json：
//   { "id": "2026-11-10a", "notice": [{ "tag": "活動", "title": "…", "body": "…" }], "soon": [...]（可省略） }
//   id 換了 → 老玩家自動跳一次。讀不到就只用 App 裡的 news.js。網頁版、App 版都會讀。
(function () {
  const LS = 'studio_v1';           // 跟 studio.js 同一份（已經有原生備份）
  const ONLINE = 'https://weo001.github.io/news/';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch {} },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let C = null, N = null, online = null, root = null, popTimer = 0, popped = false, styled = false;

  const base = () => Object.assign({ ver: '0', stage: '', notice: [], soon: [], log: [] }, window.NEWS || {});
  // 目前公告的「版本」：App 內建的 ver，加上線上公告的 id
  const key = () => N.ver + (online && online.id ? '+' + online.id : '');
  const seen = () => store.get().newsSeen;
  const hasNew = () => seen() !== key();

  function cleanOnline(j) {
    if (!j || typeof j !== 'object' || !j.id) return null;
    const arr = (a) => (Array.isArray(a) ? a : []);
    return {
      id: String(j.id).slice(0, 40),
      notice: arr(j.notice).filter((n) => n && n.title).slice(0, 5),
      soon: Array.isArray(j.soon) ? j.soon.map(String).slice(0, 20) : null,
    };
  }
  async function loadOnline() {
    const s = store.get();
    if (s.newsOnline && s.newsOnline.game === C.game) online = cleanOnline(s.newsOnline.data);
    try {
      const r = await fetch(ONLINE + C.game + '.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        online = cleanOnline(j);
        const s2 = store.get(); s2.newsOnline = { game: C.game, data: j }; store.set(s2);
      } else if (r.status === 404) {
        online = null;
        const s2 = store.get(); delete s2.newsOnline; store.set(s2);
      }
    } catch { /* 沒網路：用上次存的 */ }
  }

  function css() {
    if (styled) return; styled = true;
    const t = Object.assign({ bg: '#141022', card: '#221a36', accent: '#ffcf4d', text: '#fff6e6', sub: '#bfb3d6' }, C.theme || {});
    const st = document.createElement('style');
    st.textContent = `
#studioNews{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;font-family:inherit}
#studioNews.on{display:flex}
#studioNews .sn-box{text-align:left;width:min(92vw,400px);max-height:86vh;display:flex;flex-direction:column;background:${t.card};color:${t.text};border:2px solid ${t.accent};border-radius:16px;box-sizing:border-box;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#studioNews h2{margin:0;padding:14px 16px 8px;font-size:20px;text-align:center;color:${t.accent}}
#studioNews .sn-body{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px;flex:1;font-size:14px;line-height:1.6}
#studioNews .sn-stat{background:${t.bg};border-radius:10px;padding:10px 12px;margin-bottom:10px}
#studioNews .sn-stat b{font-size:16px;color:${t.accent}}
#studioNews .sn-stat .sn-stage{margin-left:8px;font-size:12px;padding:1px 8px;border-radius:9px;border:1px solid ${t.sub};color:${t.sub}}
#studioNews .sn-stat ul{margin:6px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;font-size:13px;color:${t.sub}}
#studioNews .sn-stat li span{color:${t.text};font-weight:700}
#studioNews .sn-item{border-left:3px solid ${t.accent};background:rgba(255,255,255,.04);border-radius:6px;padding:8px 10px;margin:8px 0}
#studioNews .sn-item i{font-style:normal;font-size:12px;background:${t.accent};color:#2a1a00;border-radius:6px;padding:0 6px;margin-right:6px;font-weight:700}
#studioNews .sn-item p{margin:4px 0 0;color:${t.sub};font-size:13px}
#studioNews h3{margin:14px 0 4px;font-size:15px;color:${t.accent}}
#studioNews ul.sn-list{margin:4px 0;padding-left:1.2em;color:${t.text}}
#studioNews ul.sn-list li{margin:2px 0}
#studioNews .sn-log{padding:8px 0;border-bottom:1px dashed rgba(255,255,255,.14)}
#studioNews .sn-log:last-child{border-bottom:0}
#studioNews .sn-log small{display:block;color:${t.sub};font-size:12px}
#studioNews .sn-soonnote{color:${t.sub};font-size:12px}
#studioNews .sn-foot{padding:10px 16px 14px}
#studioNews button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:11px 12px;width:100%;cursor:pointer;background:${t.accent};color:#2a1a00}
.st-newsdot{display:none;position:absolute;top:4px;right:6px;width:10px;height:10px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 0 2px rgba(0,0,0,.35);pointer-events:none}
.st-new>.st-newsdot{display:block}`;
    document.head.appendChild(st);
  }

  function html() {
    const stats = (() => { try { return (C.stats && C.stats()) || []; } catch (e) { console.warn(e); return []; } })();
    const notice = (online ? online.notice : []).concat(N.notice || []);
    const soon = online && online.soon ? online.soon : N.soon || [];
    let h = `<div class="sn-stat"><b>版本 ${esc(N.ver)}</b>${N.stage ? `<span class="sn-stage">${esc(N.stage)}</span>` : ''}`;
    if (stats.length) h += `<ul>${stats.map(([k, v]) => `<li>${esc(k)}：<span>${esc(v)}</span></li>`).join('')}</ul>`;
    h += `</div>`;
    for (const n of notice) h += `<div class="sn-item">${n.tag ? `<i>${esc(n.tag)}</i>` : ''}<b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>`;
    if (soon.length) h += `<h3>🛠 開發中（等待推出）</h3><ul class="sn-list">${soon.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="sn-soonnote">做好了會在這裡公告。</div>`;
    if ((N.log || []).length) {
      h += `<h3>📜 更新紀錄</h3>`;
      for (const v of N.log) h += `<div class="sn-log"><b>v${esc(v.ver)}　${esc(v.title)}</b><small>${esc(v.date)}</small><ul class="sn-list">${(v.items || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    }
    return h;
  }

  function open() {
    if (!C) return;
    if (!root) {
      css();
      root = document.createElement('div');
      root.id = 'studioNews';
      root.addEventListener('click', (e) => { if (e.target === root) close(); });
      document.body.appendChild(root);
    }
    if (root.classList.contains('on')) return;
    root.innerHTML = `<div class="sn-box"><h2>📢 公告</h2><div class="sn-body">${html()}</div><div class="sn-foot"><button>知道了</button></div></div>`;
    root.querySelector('button').onclick = close;
    root.classList.add('on');
    const s = store.get(); s.newsSeen = key(); store.set(s);
    popped = true;
    mark();
    try { C.onOpen && C.onOpen(); } catch (e) { console.warn(e); }
  }
  function close() {
    if (!root || !root.classList.contains('on')) return;
    root.classList.remove('on');
    try { C.onClose && C.onClose(); } catch (e) { console.warn(e); }
  }

  // 公告按鈕：可以是選擇器（畫面重畫、按鈕換新的也找得到）或按鈕本身
  const buttons = () => (typeof C.button === 'string' ? [...document.querySelectorAll(C.button)] : C.button ? [C.button] : []);
  function mark() {
    const on = hasNew();
    for (const b of buttons()) {
      if (!b.querySelector('.st-newsdot')) {
        if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
        const d = document.createElement('em'); d.className = 'st-newsdot'; b.appendChild(d);
      }
      b.classList.toggle('st-new', on);
    }
  }
  // 老玩家有新公告：等可以跳的時候跳一次（新玩家只亮紅點）
  function schedulePop() {
    clearInterval(popTimer);
    if (popped || !hasNew() || C._isNew) return;
    popTimer = setInterval(() => {
      if (popped || !hasNew()) { clearInterval(popTimer); return; }
      const other = (window.STUDIO && window.STUDIO.isOpen) || document.hidden;
      let ok = false;
      try { ok = !C.canPop || !!C.canPop(); } catch {}
      if (ok && !other) { clearInterval(popTimer); open(); }
    }, 800);
  }

  window.STUDIO_NEWS = {
    init(cfg) {
      C = cfg; N = base();
      const s = store.get();
      // 第一次打開這個公告系統：用存檔判斷是不是新玩家
      let isNew = false;
      try { isNew = !!(cfg.isNewPlayer && cfg.isNewPlayer()); } catch {}
      C._isNew = isNew && !s.newsSeen;
      if (typeof cfg.button === 'string') document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest(cfg.button)) open(); });
      else if (cfg.button) cfg.button.addEventListener('click', open);
      css(); // 先放好紅點的樣式
      mark(); schedulePop();
      loadOnline().then(() => { if (hasNew()) popped = false; mark(); schedulePop(); });
    },
    open, close, hasNew,
    refresh: () => C && mark(), // 畫面重畫（公告按鈕換新的）之後呼叫，補上紅點
    get isOpen() { return !!(root && root.classList.contains('on')); },
    get key() { return key(); },
  };
})();
