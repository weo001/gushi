// 盤中即時報價：手機直接向證交所「基本市況報導」抓（免費、約 5 秒延遲，上市＋上櫃＋指數）
//   iPhone App：Capacitor 的原生連線（CapacitorHttp）直連，不受跨網域限制
//   本機測試：走 serve.js 的 /__mis/ 代轉
//   公開網頁版：證交所不開放跨網域，維持收盤資料（不架伺服器代轉，避免變成轉發即時行情）
// 只抓「畫面上看得到的股票」，每次最多 150 檔，避免太頻繁被證交所暫時封鎖。
(function (root) {
  const TPE = 8 * 3600e3;
  const pad = (n) => String(n).padStart(2, '0');
  const tpe = (now) => new Date(now + TPE); // 用 getUTC* 讀，就是台北時間
  // 台北今天 yyyymmdd
  const today = (now = Date.now()) => { const d = tpe(now); return '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); };
  // 盤前 pre（8:30 前）、盤中 open（8:30～13:35，含試撮）、盤後 after、週末 closed（國定假日看報價日期判斷）
  function session(now = Date.now()) {
    const d = tpe(now), wd = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (wd === 0 || wd === 6) return 'closed';
    if (m < 8 * 60 + 30) return 'pre';
    if (m <= 13 * 60 + 35) return 'open';
    return 'after';
  }
  const num = (x) => { const v = parseFloat(x); return isFinite(v) && v > 0 ? v : null; };
  const lv = (s) => String(s || '').split('_').map(num).filter((v) => v != null);
  // 證交所一筆資料 → { c, d, t, price, prev, chg, pct, open, high, low, vol, ask[], askV[], bid[], bidV[], up, down }
  function parse(m, old) {
    const prev = num(m.y);
    const bid = lv(m.b), ask = lv(m.a);
    // z＝最新成交價；這 5 秒沒成交時是「-」→ 用 pz、上一次的價格、最佳買價
    const price = num(m.z) ?? num(m.pz) ?? (old && old.d === m.d ? old.price : null) ?? bid[0] ?? ask[0] ?? null;
    const chg = price != null && prev ? Math.round((price - prev) * 100) / 100 : null;
    return {
      c: m.c, d: m.d, t: m.t || '', price, prev, chg, pct: chg != null ? (chg / prev) * 100 : null,
      open: num(m.o), high: num(m.h), low: num(m.l), vol: num(m.v), up: num(m.u), down: num(m.w),
      bid, ask, bidV: lv(m.g), askV: lv(m.f),
    };
  }
  const Q = new Map(); // 'tse_2330' / 'otc_o00' → 報價
  let sysDate = null, last = 0, busy = false, fails = 0;
  const native = () => !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  const base = () => (native() ? 'https://mis.twse.com.tw/' : root.location && /^(localhost|127\.0\.0\.1)$/.test(root.location.hostname) ? '/__mis/' : null);
  const enabled = () => !!base();
  // keys：['tse_2330', 'otc_6488', 'tse_t00', 'otc_o00']
  async function fetchKeys(keys) {
    const b = base(); if (!b || busy || !keys.length) return false;
    busy = true;
    try {
      for (let i = 0; i < keys.length; i += 50) {
        const part = keys.slice(i, i + 50);
        const u = b + 'stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=' + part.map((k) => k + '.tw').join('%7C') + '&_=' + Date.now();
        const r = await fetch(u, { cache: 'no-store' });
        const j = await r.json();
        if (j.queryTime && j.queryTime.sysDate) sysDate = j.queryTime.sysDate;
        for (const m of j.msgArray || []) { const k = m.ex + '_' + m.c; Q.set(k, parse(m, Q.get(k))); }
        if (i + 50 < keys.length) await new Promise((res) => setTimeout(res, 400));
      }
      last = Date.now(); fails = 0; return true;
    } catch (e) { fails++; return false; } finally { busy = false; }
  }
  const get = (key) => Q.get(key) || null;
  // 下次多久後再抓：盤中 5 秒；連續失敗就放慢；盤後／盤前 10 分鐘（拿收盤價就夠）
  const interval = (now = Date.now()) => (session(now) === 'open' ? Math.min(60000, 5000 * 2 ** Math.min(fails, 3)) : 600000);
  const Live = { today, session, parse, fetchKeys, get, enabled, interval, get sysDate() { return sysDate; }, get last() { return last; }, _Q: Q };
  if (typeof module !== 'undefined' && module.exports) module.exports = Live; else root.Live = Live;
})(typeof window !== 'undefined' ? window : globalThis);
