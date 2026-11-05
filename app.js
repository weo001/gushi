// 畫面：大盤、查詢、個股、自選、盲測、點數。規則都在 core.js，廣告在 ads.js。
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'gushi-v1';
  const DEV = /[?&]dev\b/.test(location.search);
  const hadSave = (() => { try { return !!localStorage.getItem(KEY); } catch { return false; } })();
  let S = Core.load((() => { try { return localStorage.getItem(KEY); } catch { return null; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  save();

  // ───── 資料（台股、美股、陸股各一份；台股在 data/，美股 data/us/，陸股 data/cn/）─────
  let M = null, X = { items: {} }, D = null, WK = null, RP = null, byCode = new Map(), indAvg = {}, loadErr = '';
  if (!Core.MKT_IDS.includes(S.mkt)) S.mkt = 'tw';
  const MK = () => S.mkt, GM = () => Core.MARKETS[S.mkt], isTW = () => S.mkt === 'tw';
  const dir = (mkt) => CFG.DATA + (mkt === 'tw' ? '' : mkt + '/');
  const tick = () => Math.floor(Date.now() / 300000);
  const twStock = (c) => /^[1-9]\d{3}$/.test(c);
  const DB = {};
  function loadMarket(mkt) {
    if (DB[mkt]?.p) return DB[mkt].p;
    const db = (DB[mkt] = { M: null, X: { items: {} }, D: null, WK: null, byCode: new Map(), indAvg: {}, err: '' });
    const get = (f) => fetch(dir(mkt) + f + '?t=' + tick(), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    db.p = Promise.all([get('market.json'), get('explain.json').catch(() => ({ items: {} })), get('daily.json').catch(() => null), mkt === 'tw' ? get('weekly.json').catch(() => null) : null]).then(([m, x, d, w]) => {
      db.M = m; db.X = x; db.D = d && d.date === m.date ? d : null; db.WK = w && w.groups && w.groups.length ? w : null;
      db.byCode = new Map(m.rows.map((r) => [r[0], Object.fromEntries(m.cols.map((k, i) => [k, r[i]]))]));
      const agg = {};
      for (const s of db.byCode.values()) { if (mkt === 'tw' ? !twStock(s.c) || s.val < 0.05 : s.ind === 'ETF') continue; const a = (agg[s.ind] ||= { t: 0, n: 0 }); a.t += s.pct; a.n++; }
      db.indAvg = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { pct: v.t / v.n, n: v.n }]));
    }).catch(() => { db.err = mkt === 'tw' ? '資料載入失敗，請檢查網路後重新整理。' : `${Core.MARKETS[mkt].name}暫停提供：目前還找不到「免費、又允許 App 使用」的${Core.MARKETS[mkt].name}資料來源，確認授權後會恢復。台股照常提供。`; db.p = null; });
    return db.p;
  }
  // 把目前市場的資料放到 M、X、byCode… 讓各頁共用
  function useMarket() {
    const db = DB[MK()] || {};
    M = db.M || null; X = db.X || { items: {} }; D = db.D || null; WK = db.WK || null; byCode = db.byCode || new Map(); indAvg = db.indAvg || {}; loadErr = db.err || ''; RP = db.RP || null;
  }
  async function loadData() { await loadMarket(MK()); useMarket(); }
  // 個股報告書（約 200KB）：第一次打開報告書才載
  const getReports = () => { const db = DB[MK()]; return (db.rpP ||= fetch(dir(MK()) + 'reports.json?t=' + tick(), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: {} })).catch(() => ({ items: {} })).then((j) => (db.RP = RP = j))); };
  // 美股、陸股的走勢圖（近半年，約 1MB）：第一次打開個股才載
  const getChart = () => getChartOf(MK());
  const getChartOf = (mkt) => { const db = DB[mkt]; return (db.chP ||= fetch(dir(mkt) + 'chart.json?t=' + tick(), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('走勢資料暫時抓不到'); return r.json(); }).catch((e) => { db.chP = null; throw e; })); };
  const chartRows = (ch, code) => { const c = ch.c[code], v = ch.v[code]; if (!c) return []; return ch.dates.map((date, i) => (c[i] > 0 ? { date, close: c[i], Trading_Volume: (v[i] || 0) * 100 } : null)).filter(Boolean); };
  const md = (d) => (d ? d.slice(5).replace('-', '/') : '');
  const stocksOnly = () => [...byCode.values()].filter((s) => (isTW() ? twStock(s.c) : s.ind !== 'ETF'));
  // 單位：台股成交量是「張」、成交值「億」；美股陸股是「股」和「億美元／億人民幣」
  const volTxt = (s) => (isTW() ? s.vol.toLocaleString('en-US') + ' 張' : Core.fmtShares(s.vol));
  const valTxt = (v) => (v == null ? '—' : v + ' ' + (isTW() ? '億' : GM().valUnit));
  const capTxt = (c) => (!c ? '—' : (c >= 10000 ? (c / 10000).toFixed(2) + ' 兆' : c.toLocaleString('en-US') + ' 億') + (isTW() ? '' : GM().cur === '美元' ? '美元' : '人民幣'));

  // （2026-11-05 起不再讓手機直接連 FinMind：免費版不能用在 App；走勢都改讀伺服器的 chart.json）
  const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);

  // ───── 小工具 ─────
  const cls = (p) => (p > 0 ? 'up' : p < 0 ? 'down' : 'flat');
  const fp = (p, d = 2) => (p == null || !isFinite(p) ? '—' : (p > 0 ? '+' : '') + p.toFixed(d) + '%');
  const fc = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + (+x).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const fl = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + Math.round(x).toLocaleString('en-US'));
  const arrow = (p) => (p > 0 ? '▲' : p < 0 ? '▼' : '');
  function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.append(el); setTimeout(() => el.remove(), 1800); }
  function modal(html) {
    const el = document.createElement('div'); el.className = 'modal'; el.innerHTML = `<div class="box">${html}</div>`;
    el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
    document.body.append(el); return el;
  }
  // 載入中：用骨架（灰色方塊閃光）取代轉圈圈，畫面不會跳
  const skel = (n = 3) => `<div class="skel">${'<i></i>'.repeat(n)}</div>`;
  const spin = skel(3);
  const pageSkel = `<div class="card">${skel(2)}</div><div class="card">${skel(5)}</div>`;
  const disclaimer = () => `<p class="disc">本 App 內容由程式和 AI 根據公開資料整理，只是幫你看懂資料，不是投資建議，也不保證正確。投資前請自己判斷，盈虧自負。${GM().name}資料來源：${GM().src}${isTW() ? '' : '（收盤後資料，非即時報價）'}。${isTW() ? '台股資料係依<a href="https://data.gov.tw/license" target="_blank" rel="noopener">政府資料開放授權條款</a>進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。' : ''}</p>`;

  // 走勢圖（SVG）。split＝盲測的分界點；hide＝不顯示價格
  function chart(rows, { split = -1, hide = false, h = 170 } = {}) {
    if (!rows || rows.length < 2) return '<p class="empty">沒有走勢資料</p>';
    const W = 520, H = h, VH = 34, pad = 6;
    const cs = rows.map((r) => r.close), lo = Math.min(...rows.map((r) => r.min || r.close)), hi = Math.max(...rows.map((r) => r.max || r.close));
    const vmax = Math.max(...rows.map((r) => r.Trading_Volume || 0)) || 1;
    const x = (i) => pad + (i / (rows.length - 1)) * (W - pad * 2), y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2);
    const end = split > 0 ? split : rows.length - 1;
    const up = cs[end] >= cs[0], col = up ? 'var(--up)' : 'var(--down)';
    const seg = (a, b) => cs.slice(a, b + 1).map((v, k) => `${k ? 'L' : 'M'}${x(a + k).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H + VH}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? '#ff5b5b' : '#2fcf7f'}" stop-opacity=".28"/><stop offset="1" stop-color="${up ? '#ff5b5b' : '#2fcf7f'}" stop-opacity="0"/></linearGradient></defs>`;
    for (let k = 1; k < 4; k++) s += `<line x1="0" x2="${W}" y1="${(H * k) / 4}" y2="${(H * k) / 4}" stroke="#253150" stroke-width="1"/>`;
    s += `<path class="area" d="${seg(0, end)}L${x(end)},${H}L${x(0)},${H}Z" fill="url(#${id})"/><path class="ln" d="${seg(0, end)}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (split > 0 && split < rows.length - 1) {
      const fu = cs[rows.length - 1] >= cs[split];
      s += `<line x1="${x(split)}" x2="${x(split)}" y1="0" y2="${H}" stroke="#ffc85b" stroke-dasharray="4 4"/><path class="ln fut" d="${seg(split, rows.length - 1)}" fill="none" stroke="${fu ? 'var(--up)' : 'var(--down)'}" stroke-width="2.8" stroke-linecap="round"/>`;
    }
    rows.forEach((r, i) => { const vh = ((r.Trading_Volume || 0) / vmax) * (VH - 4); const c = i && r.close < rows[i - 1].close ? '#2fcf7f' : '#ff5b5b'; s += `<rect x="${x(i) - 1.2}" y="${H + VH - vh}" width="2.4" height="${vh}" fill="${c}" opacity="${split > 0 && i > split ? 0.9 : 0.45}"/>`; });
    if (!hide) s += `<text x="${W - 4}" y="14" text-anchor="end" fill="#717d99" font-size="12">${hi}</text><text x="${W - 4}" y="${H - 6}" text-anchor="end" fill="#717d99" font-size="12">${lo}</text>`;
    return s + '</svg>';
  }

  // ───── 頂部、選單 ─────
  let curRoute = 'home';
  function top(opts = {}) {
    const d = M ? (MK() === 'us' ? '美東 ' + md(M.date) : md(M.date) + ' 收盤') : '';
    $('#top').innerHTML = (opts.back ? '<button class="back" onclick="history.length>1?history.back():location.hash=\'#home\'">‹</button>' : '')
      + (opts.title ? `<span class="brand">${esc(opts.title)}</span>` : '<span class="brand">股市<i>白話通</i></span>')
      + (opts.back ? '' : `<button class="mkt-btn" id="mktBtn" aria-label="切換股市">${GM().flag} ${GM().name}<span>▾</span></button>`)
      + (d ? `<span class="date" id="dtag">${d}</span>` : '')
      + `<a class="tb-ic" href="#search" aria-label="查詢股票" style="margin-left:auto">🔍</a><button class="tb-ic" id="newsBtn" aria-label="公告">📢</button><a class="pts" href="#me" id="pts" style="margin-left:4px"><span class="coin">點</span><span class="num" data-v="${S.pts}">${S.pts}</span></a>`;
    // 頂部背景跟著大盤紅綠（勾選連動：狀態一變，整個畫面跟著變）
    if (window.STUDIO_NEWS) STUDIO_NEWS.refresh();
    if (M?.index?.[0]) document.body.dataset.mkt = M.index[0].chg > 0 ? 'up' : M.index[0].chg < 0 ? 'down' : 'flat';
    const mb = $('#mktBtn'); if (mb) mb.onclick = marketSheet;
  }

  // ───── 切換股市：台股／美股／陸股 ─────
  const DEF_WATCH = { us: ['NVDA', 'AAPL', 'TSM'], cn: ['600519', '300750', '002594'] };
  function marketSheet() {
    FX.haptic(6);
    const el = modal(`<h2>切換股市</h2><p class="sub">三個市場都是<b>收盤後</b>的資料和 AI 報告，下面是各市場的收盤時間（台灣時間）。</p>
      <div class="mkt-list">${Core.MKT_IDS.map((id) => { const g = Core.MARKETS[id], ci = Core.closeInfo(id), db = DB[id];
        return `<button class="mkt-op ${id === MK() ? 'on' : ''}" data-m="${id}"><span class="fl">${g.flag}</span><span class="tx"><b>${g.name}</b><small>${ci.short}${db?.M ? '・目前資料 ' + Core.dateLabel(id, db.M.date) : ''}</small></span>${id === MK() ? '<span class="ck">✓</span>' : ''}</button>`; }).join('')}</div>`);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; el.remove(); switchMarket(b.dataset.m); });
  }
  async function switchMarket(id) {
    if (!Core.MARKETS[id]) return;
    const changed = id !== MK();
    S.mkt = id;
    // 第一次進美股、陸股：先放幾檔常見的自選股
    S.watchInit ||= {};
    if (id !== 'tw' && !S.watchInit[id]) { S.watchInit[id] = 1; for (const c of DEF_WATCH[id]) if (!S.watch.includes(c)) S.watch.push(c); }
    save();
    if (changed) { HM.scope = 'all'; hmSave(); toast(`已切換到${Core.MARKETS[id].name}`); }
    useMarket();
    const r = (location.hash.slice(1) || 'home').split('/')[0];
    if (['s', 'weekly', 'search'].includes(r)) location.hash = '#home'; else route();
    await loadData();
    if (MK() === id) route();
  }
  // 點數變動：數字滾動＋跳一下；加點時從點數徽章噴金幣
  const bump = () => {
    const p = $('#pts'); if (!p) return;
    const n = p.querySelector('.num'), before = +n.dataset.v;
    FX.count(n, S.pts, { dur: 600 });
    p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump');
    if (S.pts > before) { const r = p.getBoundingClientRect(); FX.burst(r.left + 16, r.top + r.height / 2, { n: 10, dist: 36 }); FX.haptic(10); }
  };

  // ───── 廣告和點數 ─────
  // 按下看廣告後：按鈕變「載入中」（真的廣告載入最久要 20 秒，不能看起來像沒反應）
  function adBusy(btn) { if (btn) { btn.disabled = true; btn.textContent = '📺 廣告載入中…'; } }
  async function watchAd(btn, quiet) {
    if (Core.adsLeft(S) <= 0) { toast('今天的廣告次數用完了，明天再來'); return 'cap'; }
    adBusy(btn);
    const r = await Ads.rewarded('points');
    if (r === 'completed') { Core.grantAd(S); save(); bump(); toast(`+${Core.ECON.AD_REWARD} 點`); }
    else if (r === 'skipped') { S.stats.adsSkip++; S.lastReward = Date.now(); save(); toast('沒看完，沒有拿到點數'); }
    else if (r !== 'busy') { S.stats.adsNofill++; save(); if (!quiet) toast('現在沒有廣告可以播，等一下再試試'); }
    return r;
  }
  // 點數不夠時：看廣告補點，補夠了自動解鎖
  function needPoints(code, kind, onDone) {
    const cost = Core.ECON.COST[kind];
    const el = modal('');
    const draw = (msg = '') => {
      const left = Core.adsLeft(S);
      el.querySelector('.box').innerHTML = `<h2>點數不夠</h2>
        <p class="sub">${Core.KIND_NAME[kind]}要 <b>${cost}</b> 點，你現在有 <b>${S.pts}</b> 點。看一支廣告可以拿 <b>${Core.ECON.AD_REWARD}</b> 點。</p>
        ${msg ? `<p class="small" style="color:var(--gold);margin-top:6px">${msg}</p>` : ''}
        <div style="display:grid;gap:8px;margin-top:14px">
          <button class="btn gold block" data-a="ad" ${left ? '' : 'disabled'}>📺 看廣告拿 ${Core.ECON.AD_REWARD} 點${left ? `（今天還有 ${left} 次）` : '（今天用完了）'}</button>
          ${Core.canCheckin(S) ? `<button class="btn block" data-a="ci">📅 每日簽到 +${Core.ECON.CHECKIN} 點</button>` : ''}
          <button class="btn block" data-a="x">先不要</button>
        </div>`;
    };
    draw();
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      if (a === 'x') return el.remove();
      if (a === 'ci') { Core.checkin(S); save(); bump(); }
      if (a === 'ad') {
        const r = await watchAd(e.target.closest('button'), true);
        if (r === 'nofill' || r === 'error') {
          const f = Core.unlockFree(S, code, kind, M.date); save();
          if (f.ok) { el.remove(); toast('廣告暫時播不出來，這次免費'); return onDone(); }
          return draw('現在沒有廣告可以播，等一下再試試。');
        }
      }
      if (S.pts >= cost) { el.remove(); onDone(true); } else draw();
    });
  }
  // 解鎖：按鈕縮成圓、畫出打勾、噴粒子，然後內容滑出來
  async function tryUnlock(code, kind, after, btn) {
    const r = Core.unlock(S, code, kind, M.date);
    if (r.ok) { save(); if (r.paid) bump(); if (btn && btn.isConnected) await FX.unlock(btn); return after(true); }
    if (r.why === 'pts') needPoints(code, kind, () => tryUnlock(code, kind, after, btn));
  }

  // ───── 股票列表 ─────
  const mk = (s) => (s.m === 'O' ? 'otc_' : 'tse_') + s.c;
  const item = (s, i = 0) => `<a class="it" href="#s/${s.c}" data-lc="${mk(s)}" data-lt="it" style="--k:${Math.min(i, 14)}"><div class="nm"><b>${esc(s.n)}</b>${X.items[s.c] ? '<span class="badge-ai">解說</span>' : ''}<small>${s.c}・${esc(s.ind)}${s.m === 'O' && isTW() ? '・上櫃' : ''}</small></div>
    <div class="px num">${s.close}</div><div class="pc num ${cls(s.pct)}">${fp(s.pct)}</div></a>`;
  const listHtml = (arr) => (arr.length ? `<div class="list">${arr.map((s, i) => item(s, i)).join('')}</div>` : '<p class="empty">沒有資料</p>');

  // ───── 各頁 ─────
  const V = {};
  let homeTab = 'hot';
  V.home = () => {
    top();
    if (!M) return ($('#view').innerHTML = loadErr ? `<p class="empty">${loadErr}</p>` : spin);
    const B = M.breadth, tot = B.up + B.down + B.flat || 1;
    const L = isTW() ? { hot: '熱門', gain: '漲幅', lose: '跌幅', fbuy: '外資買', fsell: '外資賣', tbuy: '投信買', etf: 'ETF' }
      : { hot: '熱門', gain: '漲幅', lose: '跌幅', ...([...byCode.values()].some((s) => s.ind === 'ETF') ? { etf: 'ETF' } : {}) };
    if (!L[homeTab]) homeTab = 'hot';
    const st = stocksOnly(), liq = isTW() ? st.filter((s) => s.val >= 0.3) : [...st].sort((a, b) => b.val - a.val).slice(0, Math.max(60, Math.round(st.length * 0.4))); // 美股陸股：成交值前 40% 才排漲跌幅（冷門股不算）
    const lists = {
      hot: () => [...st].sort((a, b) => b.val - a.val), gain: () => [...liq].sort((a, b) => b.pct - a.pct), lose: () => [...liq].sort((a, b) => a.pct - b.pct),
      fbuy: () => st.filter((s) => s.f != null).sort((a, b) => b.f * b.close - a.f * a.close), fsell: () => st.filter((s) => s.f != null).sort((a, b) => a.f * a.close - b.f * b.close),
      tbuy: () => st.filter((s) => s.t != null).sort((a, b) => b.t * b.close - a.t * a.close), etf: () => [...byCode.values()].filter((s) => s.ind === 'ETF').sort((a, b) => b.val - a.val),
    };
    // 吸附卡片：加權（含 3 個月走勢線）、櫃買、漲跌家數、三大法人。左右滑會吸附，滑到的那張重畫線
    const idxCard = (i, k) => {
      const hist = k === 0 && M.taiex?.length >= 5 ? M.taiex.map(([date, close, v]) => ({ date, close, Trading_Volume: v })) : null;
      const lk = /櫃買/.test(i.name) ? 'otc_o00' : /加權/.test(i.name) ? 'tse_t00' : '';
      return `<div class="snap-c idx"${lk && isTW() ? ` data-lc="${lk}" data-lt="idx"` : ''}><small class="mute">${i.name}${hist ? '・近 3 個月' : ''}</small><div class="v num ${cls(i.chg)}">${i.close.toLocaleString('en-US')}</div>
        <div class="c num ${cls(i.chg)}">${arrow(i.chg)} ${Math.abs(i.chg)}（${fp(i.pct)}）</div>${hist ? chart(hist, { h: 70, hide: true }) : `<div class="idx-big ${cls(i.chg)}">${arrow(i.chg) || '–'}</div>`}</div>`;
    };
    const imax = Math.max(...['f', 't', 'd'].map((k) => Math.abs(M.inst?.[k] || 0))) || 1;
    const ibar = (k, n) => { const v = M.inst[k] || 0, w = (Math.abs(v) / imax) * 50; return `<div class="ibar"><span>${n}</span><div class="ib-t"><i class="${cls(v)}" style="${v >= 0 ? 'left:50%' : `right:50%`};width:${w}%"></i></div><b class="num ${cls(v)}">${fc(v)} 億</b></div>`; };
    const cards = [
      ...M.index.map(idxCard),
      `<div class="snap-c"><small class="mute">今天漲跌家數・${isTW() ? (M.otc ? '上市＋上櫃' : '上市') : esc(M.scope || '收錄的股票')}</small>
        <div class="row" style="margin-top:6px"><b class="num up" style="font-size:24px">${B.up}</b><span class="mute small" style="margin:auto">平盤 ${B.flat}</span><b class="num down" style="font-size:24px">${B.down}</b></div>
        <div class="bar3"><i style="width:${(B.up / tot) * 100}%;background:var(--up)"></i><i style="width:${(B.flat / tot) * 100}%;background:var(--line2)"></i><i style="width:${(B.down / tot) * 100}%;background:var(--down)"></i></div>
        <p class="small sub" style="margin-top:6px">${B.up > B.down * 1.5 ? '大部分股票都在漲，普漲的一天。' : B.down > B.up * 1.5 ? '大部分股票都在跌，普跌的一天。' : '漲跌家數差不多，有漲有跌。'}</p></div>`,
      ...(M.inst ? [`<div class="snap-c"><small class="mute">${M.instScope === 'otc' ? '上櫃三大法人買賣超' : '三大法人買賣超（估算）'}</small><div style="margin-top:8px">${ibar('f', '外資')}${ibar('t', '投信')}${ibar('d', '自營商')}</div>
        <p class="small sub" style="margin-top:auto">${(() => { const f = M.inst.f || 0, t = M.inst.t || 0, sum = f + t + (M.inst.d || 0);
          const w = (v) => (v >= 0 ? '買' : '賣');
          return Math.sign(f) !== Math.sign(t) ? `外資${w(f)}、投信${w(t)}，法人看法分歧；合計${w(sum)}超約 ${Math.abs(Math.round(sum))} 億。` : `外資和投信都在${w(f)}，合計${w(sum)}超約 ${Math.abs(Math.round(sum))} 億。`; })()}</p></div>`] : []),
    ];
    // 收盤時間說明（台灣時間）：很多人不知道美股、陸股幾點收盤 → 每個市場首頁最上面都寫清楚
    const ci = Core.closeInfo(MK());
    const closeCard = `<div class="card close-i"><div class="row"><b>🕐 ${esc(ci.title)}</b><small class="mute" style="margin-left:auto">${esc(Core.dateLabel(MK(), M.date))}</small></div>
      <ul>${ci.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
    // 自選股晨報（免費）：你的自選股上個交易日怎麼了
    const wl = S.watch.map((c) => byCode.get(c)).filter(Boolean);
    const wline = (s) => {
      const ex = X.items[s.c], bits = [];
      if (s.f) bits.push(`外資${s.f > 0 ? '買' : '賣'} ${Math.abs(s.f).toLocaleString('en-US')} 張`);
      if (s.t) bits.push(`投信${s.t > 0 ? '買' : '賣'} ${Math.abs(s.t).toLocaleString('en-US')} 張`);
      if (ex?.vr) bits.push(`量是平常的 ${ex.vr} 倍`);
      return `<a class="wl" href="#s/${s.c}"><div><b>${esc(s.n)}</b> <span class="num ${cls(s.pct)}">${fp(s.pct)}</span>${ex ? '<span class="badge-ai">解說</span>' : ''}<small>${bits.join('・') || '—'}</small></div><span class="mute">›</span></a>`;
    };
    const wbest = [...wl].sort((a, b) => b.pct - a.pct);
    const watchCard = wl.length ? `<div class="card"><h3>⭐ 自選股${isTW() ? '晨報' : '盤後'}<small>${esc(Core.dateLabel(MK(), M.date))}</small></h3>
      <p class="small sub">你的 ${wl.length} 檔自選股：${wl.filter((s) => s.pct > 0).length} 漲、${wl.filter((s) => s.pct < 0).length} 跌。表現最好的是 <b>${esc(wbest[0].n)}</b>（<span class="${cls(wbest[0].pct)}">${fp(wbest[0].pct)}</span>）${wl.length > 1 ? `，最差的是 <b>${esc(wbest[wbest.length - 1].n)}</b>（<span class="${cls(wbest[wbest.length - 1].pct)}">${fp(wbest[wbest.length - 1].pct)}</span>）` : ''}。</p>
      <div class="wls">${wl.slice(0, 8).map(wline).join('')}</div>${wl.length > 8 ? '<a class="btn block" href="#watch" style="margin-top:8px">看全部自選</a>' : ''}</div>` : '';
    const dailyCard = D ? `<div class="card daily"><div class="dl-h"><span class="tagai">🤖 ${isTW() ? '' : GM().name + ' '}AI 盤後日報</span><small class="mute">${MK() === 'us' ? '美東 ' + md(D.date) : md(D.date)} 收盤後</small></div>
      <h2>${esc(D.title)}</h2><p class="dl-t" id="dlt">${esc(D.text)}</p>
      ${D.focus?.length ? `<div class="chips" style="margin-top:8px">${D.focus.map((c) => byCode.get(c)).filter(Boolean).map((s) => `<a class="chip" href="#s/${s.c}">${esc(s.n)} <b class="num ${cls(s.pct)}">${fp(s.pct, 1)}</b></a>`).join('')}</div>` : ''}
      <p class="disc">${D.ai ? `由 AI 根據${isTW() ? '證交所、櫃買中心' : GM().src}公開資料${GM().id === 'cn' ? '' : '和新聞標題'}整理，可能有錯，不是投資建議。` : '由程式根據公開資料整理。'}</p></div>` : '';
    const weekCard = WK ? `<a class="card wkc" href="#weekly"><div class="row"><h3 style="margin:0">🏭 概念股 AI 週報<small>近 5 個交易日・到 ${md(WK.groups[0].to)}</small></h3><span class="mute" style="margin-left:auto">›</span></div>
      <div class="chips" style="margin-top:8px">${WK.groups.slice(0, 3).map((g) => `<span class="chip">${esc(g.name)} <b class="num ${cls(g.pct5)}">${fp(g.pct5, 1)}</b></span>`).join('')}<span class="chip">…還有 ${Math.max(0, WK.groups.length - 3)} 個</span></div>
      <p class="small sub" style="margin-top:6px">12 個族群這週誰強誰弱、為什麼（${Core.ECON.COST.weekly} 點）</p></a>` : '';
    $('#view').innerHTML = `
      <a class="search" href="#search"><span>🔍</span><span class="mute">${searchHint()}</span></a>
      ${closeCard}${dailyCard}${watchCard}
      <div class="snap" id="snap">${cards.join('')}</div>
      <div class="dots" id="dots">${cards.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
      <div class="card"><h3>族群強弱<small>同產業平均漲跌・點了看熱力圖</small></h3>
        <div class="chips">${M.sectors.slice(0, 6).map((x) => `<a class="chip" href="#heat/ind:${encodeURIComponent(x.ind)}">${esc(x.ind)} <b class="num ${cls(x.pct)}">${fp(x.pct, 1)}</b></a>`).join('')}</div>
        <div class="chips" style="margin-top:6px">${M.sectors.slice(-4).reverse().map((x) => `<a class="chip" href="#heat/ind:${encodeURIComponent(x.ind)}">${esc(x.ind)} <b class="num ${cls(x.pct)}">${fp(x.pct, 1)}</b></a>`).join('')}</div>
        <a class="btn block" href="#heat" style="margin-top:10px">🔥 看全市場熱力圖</a></div>
      ${weekCard}
      <div class="card"><div class="tabs" id="tabs">${Object.entries(L).map(([k, v]) => `<button data-k="${k}" class="${k === homeTab ? 'on' : ''}">${v}</button>`).join('')}</div><div id="hl"></div>
        <p class="disc">有「解說」標籤的是今天的熱門股，已經準備好白話解說。其他股票打開時才即時整理。${isTW() ? '' : `${GM().name}目前收錄${esc(M.scope || '')}，共 ${M.rows.length} 檔。`}</p></div>
      ${disclaimer()}`;
    const draw = () => { $('#hl').innerHTML = listHtml(lists[homeTab]().slice(0, 30)); };
    $('#tabs').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; homeTab = k; [...$('#tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.k === k)); FX.haptic(4); draw(); };
    draw();
    FX.carousel($('#snap'), $('#dots'));
  };

  let lastQ = '';
  const searchHint = () => ({ tw: '輸入代號或名稱，例如 2330、台積電', us: '輸入代號或名稱，例如 NVDA、輝達、蘋果', cn: '輸入代號或名稱，例如 600519、茅臺、寧德' }[MK()]);
  V.search = () => {
    top();
    $('#view').innerHTML = `<div class="search"><span>🔍</span><input id="q" placeholder="${searchHint().replace('輸入', '')}" value="${esc(lastQ)}" autocomplete="off" inputmode="search"></div><div id="res"></div>`;
    const q = $('#q');
    const run = () => {
      lastQ = q.value.trim();
      if (!M) return ($('#res').innerHTML = spin);
      if (!lastQ) return ($('#res').innerHTML = '<div class="card"><h3>大家常查</h3>' + listHtml(stocksOnly().sort((a, b) => b.val - a.val).slice(0, 12)) + '</div>');
      const k = lastQ.toUpperCase();
      // 陸股名稱是「貴州茅臺」：打「茅台」也要找得到（台／臺 通用）
      const kk = k.replace(/台/g, '臺');
      const r = [...byCode.values()].filter((s) => s.c.startsWith(k) || s.n.toUpperCase().includes(k) || s.n.replace(/台/g, '臺').toUpperCase().includes(kk) || (s.en && s.en.toUpperCase().includes(k)))
        .sort((a, b) => (b.c === k) - (a.c === k) || (b.c.startsWith(k)) - (a.c.startsWith(k)) || b.val - a.val).slice(0, 40);
      $('#res').innerHTML = r.length ? '<div class="card">' + listHtml(r) + '</div>' : '<p class="empty">找不到這檔股票</p>';
    };
    q.oninput = run; q.onkeydown = (e) => { if (e.key === 'Enter') { const f = $('#res .it'); if (f) location.hash = f.getAttribute('href'); } };
    run(); setTimeout(() => q.focus(), 50);
  };

  // 個股頁
  const exCache = new Map();
  // 從網址打開的股票不是目前的市場（例如在台股時點了美股的連結）→ 自動切過去
  // 美股＝英文代號；陸股＝6 碼（000～003、30、60、68 開頭）；其他是台股（4 碼、00 開頭的 ETF）
  const guessMkt = (code) => (/^[A-Z][A-Z.\-]*$/.test(code) ? 'us' : /^(00[0-3]\d{3}|30\d{4}|6[08]\d{4})$/.test(code) ? 'cn' : 'tw');
  V.s = async (code) => {
    if (M && !byCode.has(code)) {
      const g = guessMkt(code);
      if (g !== MK()) { S.mkt = g; save(); await loadData(); if (curRoute !== 's/' + code) return; }
    }
    const s = byCode.get(code);
    top({ back: true, title: s ? s.n : '個股' });
    if (!M) return ($('#view').innerHTML = loadErr ? `<p class="empty">${loadErr}</p>` : spin);
    if (!s) return ($('#view').innerHTML = '<p class="empty">找不到這檔股票</p>');
    // 查詢時偶爾先跳插頁廣告（頻率規則在 core.js）
    if (Core.onOpenStock(S)) { save(); $('#view').innerHTML = spin; const r = await Ads.interstitial(Core.ECON.INTER_AFTER_REWARD_MS); if (r !== 'gap') Core.interShown(S); }
    save();
    if (curRoute !== 's/' + code) return; // 廣告期間使用者已經離開
    const ex = X.items[code];
    const kv = (k, v, c = '') => `<div><small>${k}</small><b class="${c}">${v}</b></div>`;
    const on = S.watch.includes(code);
    $('#view').innerHTML = `
      <div class="card hero" data-lc="${mk(s)}" data-lt="hero">
        <div class="row"><div><div class="nm">${esc(s.n)}</div><small class="mute">${s.c}・${isTW() ? (s.m === 'O' ? '上櫃' : '上市') : GM().flag + ' ' + esc(s.m || GM().name)}・${esc(s.ind)}</small>${s.en ? `<small class="mute en">${esc(s.en)}</small>` : ''}</div><button class="star" id="star" title="加入自選">${on ? '⭐' : '☆'}</button></div>
        <div class="px num ${cls(s.pct)}">${s.close}${isTW() ? '' : `<small class="cur">${GM().cur}</small>`}</div><div class="ch num ${cls(s.pct)}">${arrow(s.chg)} ${Math.abs(s.chg)}（${fp(s.pct)}）</div>
        <div class="live5" hidden></div>
        <div class="kv-h small mute" hidden></div>
        <div class="kv">${kv('成交量', volTxt(s))}${kv('成交值', valTxt(s.val))}${kv('量比', ex?.vr ? ex.vr + ' 倍' : '<span id="vr">—</span>')}
          ${isTW() ? `${kv('外資', fl(s.f), cls(s.f))}${kv('投信', fl(s.t), cls(s.t))}${kv('自營商', fl(s.d), cls(s.d))}` : `${s.cap ? kv(MK() === 'cn' ? '流通市值' : '市值', capTxt(s.cap)) : kv('今天漲跌', fp(s.pct), cls(s.pct))}${kv('近 5 日', '<span id="r5">—</span>')}${kv('近 20 日', '<span id="r20">—</span>')}`}</div>
        <p class="disc">${isTW() ? (s.m === 'L' && s.f == null ? '上市股票的三大法人買賣超是證交所的付費資料，本 App 沒有提供（上櫃股票有）。' : '法人買賣超單位：張。') : `${esc(Core.dateLabel(MK(), M.date))}的資料。`}量比＝今天成交量 ÷ 前 20 天平均。</p>
      </div>
      <div class="card"><h3>📉 近半年走勢</h3><div id="ch">${spin}</div></div>
      <div class="card" id="ex"></div>
      <div class="card" id="deep"></div>
      ${disclaimer()}`;
    $('#star').onclick = (e) => {
      const add = Core.toggleWatch(S, code); save();
      const b = e.currentTarget; b.textContent = add ? '⭐' : '☆'; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      if (add) { const r = b.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2, { n: 8, dist: 30, colors: ['#ffc85b', '#ffe7a8'], coin: false }); }
      FX.haptic(add ? 10 : 5); toast(add ? '已加入自選' : '已移出自選');
    };
    const histP = getChart().then((ch) => chartRows(ch, code));
    histP.then((rows) => {
      const el = $('#ch'); if (el) el.innerHTML = chart(rows);
      if (isTW() && rows.length < 20) { const el2 = $('#ch'); if (el2) el2.insertAdjacentHTML('beforeend', `<p class="small mute">走勢資料從 ${rows[0]?.date || M.date} 開始每天記錄（政府開放資料只提供最新一天），已累積 ${rows.length} 個交易日。</p>`); }
      if (!isTW() && rows.length > 21) { // 美股陸股：近 5／20 日漲跌、量比從走勢資料算
        const n = rows.length, c = rows[n - 1].close, ret = (k) => fp((c / rows[n - 1 - k].close - 1) * 100, 1);
        const a = $('#r5'), b = $('#r20'), v = $('#vr');
        if (a) { a.textContent = ret(5); a.className = cls(c - rows[n - 6].close); }
        if (b) { b.textContent = ret(20); b.className = cls(c - rows[n - 21].close); }
        const v20 = rows.slice(-21, -1).reduce((x, r) => x + r.Trading_Volume, 0) / 20;
        if (v && v20) v.textContent = Math.round((rows[n - 1].Trading_Volume / v20) * 10) / 10 + ' 倍';
      }
    }).catch((e) => { const el = $('#ch'); if (el) el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
    drawExplain(s); drawDeep(s);
  };

  const lockBox = (s, kind, teaser) => `<div class="lock"><div class="blur">${teaser}</div>
    <button class="btn pri" data-unlock="${kind}">🔓 用 ${Core.ECON.COST[kind]} 點解鎖${Core.KIND_NAME[kind]}</button>
    <div class="cost">你有 ${S.pts} 點・今天看過的，今天內可以免費重看</div></div>`;

  function drawExplain(s, fresh) {
    const el = $('#ex'); if (!el) return;
    const word = s.pct > 0 ? '漲' : s.pct < 0 ? '跌' : '沒動';
    const head = `<h3>🤖 為什麼${dayWord()}${word}？</h3>`;
    if (!Core.isUnlocked(S, s.c, 'explain', M.date)) {
      el.innerHTML = head + lockBox(s, 'explain', isTW() ? `${esc(s.n)}今天${word}的白話解說：和大盤、同產業比起來怎麼樣，成交量是不是異常，${s.m === 'O' ? '外資投信在買還是賣，' : ''}還有公司今天的重大訊息…`
        : `${esc(s.n)}${word}的白話解說：和${GM().idxName}、同產業比起來怎麼樣，成交量是不是異常，最近一週一個月的走勢${MK() === 'us' ? '，還有相關的英文新聞（AI 幫你用中文講重點）' : ''}…`);
      el.querySelector('[data-unlock]').onclick = (e) => tryUnlock(s.c, 'explain', (f) => drawExplain(s, f), e.currentTarget);
      return;
    }
    const ex = X.items[s.c];
    const render = (t, ai, tags, news) => {
      el.classList.toggle('reveal', !!fresh);
      el.innerHTML = head + `<p class="explain">${esc(t)}</p>
        <div style="margin-top:8px">${(tags || []).map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>
        ${news?.length ? `<div class="news"><small class="mute">${MK() === 'us' ? '相關新聞（英文原文）' : '今天的相關新聞'}</small>${news.map((n) => `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}<small>${esc(n.src || '')}</small></a>`).join('')}</div>` : ''}
        <p class="disc">${ai ? `由 AI 根據${isTW() ? '上面的資料' : '行情、同產業比較' + (news?.length ? '和新聞標題' : '')}整理，可能有錯${news?.length ? '，請以新聞原文為準' : ''}。` : isTW() ? '由程式根據行情、法人和新聞整理。' : '由程式根據行情和同產業比較整理（這檔沒有預先準備 AI 解說）。'}</p>`;
    };
    if (ex) return render(ex.t, ex.ai, ex.tags, ex.news);
    // 沒有預先準備的股票：當場用規則整理
    el.innerHTML = head + spin;
    let p = exCache.get(MK() + s.c);
    if (!p) {
      // 沒有預先準備的股票：用伺服器做好的走勢資料（chart.json）算量比，規則版整理（沒有新聞）
      const g = GM();
      p = getChart().then((ch) => {
        const h = chartRows(ch, s.c), n = h.length;
        const past = h.slice(-21, -1), v20 = past.length >= 5 ? past.reduce((a, r) => a + r.Trading_Volume, 0) / past.length : NaN;
        const ia = indAvg[s.ind] || {}, idx = M.index[isTW() && s.m === 'O' && M.index[1] ? 1 : 0];
        return { ...Core.explainRule({ ...s, name: s.n, cur: g.cur, limit: MK() === 'cn' ? Core.cnLimit(s.c, s.n) : g.limit, volRatio: v20 && n ? h[n - 1].Trading_Volume / v20 : NaN, mktPct: idx?.pct, indPct: ia.pct, indN: ia.n, news: [] }), news: [] };
      });
      exCache.set(MK() + s.c, p); p.catch(() => exCache.delete(MK() + s.c));
    }
    p.then((r) => { if ($('#ex') === el) render(r.text, false, r.tags, r.news); })
      .catch((e) => { el.innerHTML = head + `<p class="empty">${esc(e.message)}</p><button class="btn block" id="exr">重試（不用再扣點）</button>`; $('#exr').onclick = () => drawExplain(s); });
  }

  const deepCache = new Map();
  function drawDeep(s, fresh) {
    const el = $('#deep'); if (!el) return;
    const head = `<h3>📑 AI 個股報告書<small>${isTW() ? '營收・評價・融資・股價位置' : MK() === 'cn' ? '股價位置・本益比・歷史相似' : '股價位置・成交量・歷史相似'}</small></h3>`;
    if (!Core.isUnlocked(S, s.c, 'deep', M.date)) {
      el.innerHTML = head + lockBox(s, 'deep', isTW() ? 'AI 幫你讀完股價、融資、月營收、本益比（上櫃股票還有三大法人），寫成一份有結論的報告：偏多和偏空訊號各有幾個？融資有沒有暴增、月營收年增率、本益比貴不貴、歷史上走勢很像的時候之後怎麼走，還有魔鬼代言人的風險清單…'
        : `AI 幫你讀完近 2 年股價${MK() === 'cn' ? '和本益比' : '和成交量'}，寫成一份有結論的報告：偏多和偏空訊號各有幾個？股價在一年高低區間的哪裡、月線季線年線、${MK() === 'cn' ? '本益比貴不貴、' : ''}歷史上走勢很像的時候之後怎麼走，還有魔鬼代言人的風險清單…`);
      el.querySelector('[data-unlock]').onclick = (e) => tryUnlock(s.c, 'deep', (f) => drawDeep(s, f), e.currentTarget);
      return;
    }
    el.innerHTML = head + skel(4) + `<p class="small mute" style="text-align:center">整理資料中…</p>`;
    let p = deepCache.get(MK() + s.c);
    if (!p) {
      // 伺服器每天做好成交值前 100（台股）／60（美股陸股）檔＋AI 結論；其他股票用近半年走勢當場整理
      p = getReports().then((rp) => { const it = rp.items?.[s.c]; if (it?.R) return { ...it.R, aiText: it.ai, made: it.d };
        return getChart().then((ch) => ({ ...Core.analyze({ prices: chartRows(ch, s.c), cur: GM().cur, volFmt: isTW() ? undefined : Core.fmtShares, allowShort: isTW() }), local: true })); });
      deepCache.set(MK() + s.c, p); p.catch(() => deepCache.delete(MK() + s.c));
    }
    p.then((R) => {
      if ($('#deep') !== el) return;
      if (R.error) return (el.innerHTML = head + `<p class="empty">${esc(R.error)}</p>`);
      const tot = R.bull + R.bear || 1;
      const dot = (t) => `<span class="dot" style="background:${t > 0 ? 'var(--up)' : t < 0 ? 'var(--down)' : 'var(--line2)'}"></span>`;
      // 疊卡：各項分析先疊成一疊（上面露出標題），點開依序攤開，再點收起
      const n = R.sections.length;
      el.classList.toggle('reveal', !!fresh);
      const aiBox = R.aiText ? `<div class="aic"><b>🤖 AI 結論</b><p>${esc(R.aiText)}</p></div>` : `<p class="small mute" style="margin:0 0 8px">${R.local ? `這檔不在每天的 AI 報告名單（${GM().name}成交值前 ${isTW() ? 100 : 60} 檔）內，以下是程式用近期走勢即時整理的報告，沒有 AI 結論。` : R.made ? '這份報告今天的 AI 額度用完了，先給程式整理的版本，沒有 AI 結論。' : `這檔不在每天的 AI 報告名單（成交值前 ${isTW() ? 100 : 60} 檔）內，以下是程式即時整理的報告，沒有 AI 結論。`}</p>`;
      el.innerHTML = head + aiBox + `<div class="summary">${esc(R.summary)}</div>
        <div class="meter"><i style="width:${(R.bull / tot) * 100}%;background:var(--up)"></i><i style="width:${(R.bear / tot) * 100}%;background:var(--down)"></i></div>
        <div class="row small" style="margin-bottom:10px"><span class="up">偏多 ${R.bull}</span><span class="down" style="margin-left:auto">偏空 ${R.bear}</span></div>
        <div class="deck" id="dk">
          <button class="deck-stack" aria-label="展開全部分析"><span class="deck-top">${R.sections.slice(0, 4).map((x) => `<span>${x.icon} ${esc(x.title)}${dot(x.tone)}</span>`).join('')}</span><span class="deck-hint">點開看 ${n} 項分析 ▾</span></button>
          ${R.sections.map((x) => `<div class="sec deck-i"><h4>${x.icon} ${esc(x.title)}${dot(x.tone)}</h4>${x.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`).join('')}
          <button class="deck-btn btn block"><span class="o">展開 ${n} 項分析 ▾</span><span class="c">收起 ▴</span></button>
        </div>
        <div class="risk"><b>😈 魔鬼代言人：要注意的地方</b><ul>${R.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
        <p class="disc">資料到 ${esc(R.date)}${R.made && R.made < M.date ? `（熱門股每天輪流更新，這份是 ${md(R.made)} 做的）` : ''}。「偏多／偏空」只是把資料分類，不是叫你買或賣。${R.aiText ? 'AI 結論由程式讀上面的資料寫成，可能有錯。' : ''}</p>`;
      FX.deck($('#dk'));
    }).catch((e) => { el.innerHTML = head + `<p class="empty">${esc(e.message)}</p><button class="btn block" id="dpr">重試（不用再扣點）</button>`; $('#dpr').onclick = () => drawDeep(s); });
  }

  // ───── 熱力圖 ─────
  // 範圍：全市場（照產業分區）、單一產業、概念股群組、自選股。大小：市值／成交值。顏色：漲跌幅／外資買賣超
  const HM = (() => { try { return { scope: 'all', size: 'cap', color: 'pct', ...JSON.parse(localStorage.getItem('gushi-heat') || '{}') }; } catch { return { scope: 'all', size: 'cap', color: 'pct' }; } })();
  const hmSave = () => { try { localStorage.setItem('gushi-heat', JSON.stringify(HM)); } catch {} };
  let hmTap = null;
  V.heat = (arg) => {
    if (arg) { HM.scope = arg; hmSave(); history.replaceState(null, '', '#heat'); }
    top();
    if (!M) return ($('#view').innerHTML = pageSkel);
    const W = Math.max(280, $('#view').clientWidth - 32);
    const sc = HM.scope, isAll = sc === 'all';
    if (!isTW() && HM.color === 'f') HM.color = 'pct'; // 美股陸股沒有外資買賣超
    const grp = sc.startsWith('grp:') ? Core.groupsOf(MK()).find((g) => g.id === sc.slice(4)) : null;
    const indName = sc.startsWith('ind:') ? sc.slice(4) : null;
    let pool;
    if (isAll) pool = stocksOnly();
    else if (indName) pool = [...byCode.values()].filter((s) => s.ind === indName);
    else if (sc === 'watch') pool = S.watch.map((c) => byCode.get(c)).filter(Boolean);
    else if (grp) pool = grp.codes.map((c) => byCode.get(c)).filter(Boolean);
    else { HM.scope = 'all'; return V.heat(); }
    // ETF 沒有市值，ETF 群組和自選裡的 ETF 一律用成交值
    const mv = HM.size === 'mv'; // 漲跌＝漲跌越多方塊越大（跌最多的最大），一眼看出今天誰動最大
    const sizeKey = HM.size !== 'val' && pool.some((s) => s.cap > 0) && !(grp && grp.id === 'etf') ? 'cap' : 'val';
    const fv = (s) => ((s.f || 0) * s.close) / 1e5; // 外資買賣超金額（億）
    // 平均＝每檔一樣大（先照市值挑出要畫的股票），看得到整個市場的漲跌分布，不會被台積電蓋掉
    const eq = HM.size === 'eq';
    let items = mv
      ? pool.filter((s) => s.val >= 0.1 && Number.isFinite(s.pct)).map((s) => ({ s, v: Math.abs(s.pct) + 0.15 })).sort((a, b) => b.v - a.v) // 太冷門（成交值不到 1000 萬）的不畫
      : pool.map((s) => ({ s, v: s[sizeKey] > 0 ? s[sizeKey] : 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const shownAll = items.length;
    if (isAll) items = items.slice(0, eq || mv ? 300 : 400);
    if (eq) items = items.map((x) => ({ s: x.s, v: 1 }));
    const fScale = (() => { const a = items.map((x) => Math.abs(fv(x.s))).sort((p, q) => p - q); return a[Math.floor(a.length * 0.9)] || 1; })();
    const liveTiles = isTW() && !isAll && HM.color === 'pct' && items.length <= 150;
    const colorOf = (s) => (HM.color === 'f' ? Core.heatColor((fv(s) / fScale) * 6) : Core.heatColor(s.pct));
    const H = Math.round(W * (isAll ? 1.45 : items.length > 12 ? 1.1 : 0.85));
    const tile = (t, k) => {
      const s = t.s, area = Math.sqrt(t.w * t.h), fsz = Math.max(9, Math.min(22, area / 5.2));
      const lab = t.w > 30 && t.h > 18 ? `<b style="font-size:${fsz}px">${esc(s.n)}</b>${t.h > fsz * 2.5 && t.w > 40 ? `<span class="tp" style="font-size:${Math.max(9, fsz * 0.78)}px">${HM.color === 'f' ? fc(Math.round(fv(s) * 10) / 10) + '億' : fp(s.pct)}</span>` : ''}` : '';
      return `<button class="tl" data-c="${s.c}"${liveTiles ? ` data-lc="${mk(s)}" data-lt="tl"` : ''} style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;background:${colorOf(s)};--k:${Math.min(k, 60)}" title="${esc(s.n)} ${fp(s.pct)}">${lab}</button>`;
    };
    let html = '';
    if (isAll) {
      const byInd = {};
      for (const x of items) (byInd[x.s.ind] ||= []).push(x);
      const inds = Object.entries(byInd).map(([ind, arr]) => ({ ind, arr, v: arr.reduce((a, b) => a + b.v, 0) }));
      let k = 0;
      for (const r of Core.squarify(inds, 0, 0, W, H)) {
        const hd = r.w > 54 && r.h > 40 ? 16 : 0;
        const avg = mv ? r.arr.reduce((a, b) => a + b.s.pct, 0) / r.arr.length : r.arr.reduce((a, b) => a + b.s.pct * b.v, 0) / r.v; // 依大小加權的平均漲跌（漲跌模式用簡單平均）
        html += `<div class="hm-ind" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${hd ? `<button class="hm-hd" data-ind="${esc(r.ind)}"><span>${esc(r.ind)}</span><b class="${cls(avg)}">${fp(avg, 1)}</b> ›</button>` : ''}</div>`;
        for (const t of Core.squarify(r.arr, r.x + 1, r.y + hd + 1, r.w - 2, r.h - hd - 2)) html += tile(t, k++);
      }
    } else Core.squarify(items, 0, 0, W, H).forEach((t, k) => { html += tile(t, k); });
    const ups = items.filter((x) => x.s.pct > 0).length, dns = items.filter((x) => x.s.pct < 0).length;
    const wavg = mv ? items.reduce((a, b) => a + b.s.pct, 0) / (items.length || 1) : items.reduce((a, b) => a + b.s.pct * b.v, 0) / (items.reduce((a, b) => a + b.v, 0) || 1);
    const chip = (id, name) => `<button class="chip ${sc === id ? 'on' : ''}" data-sc="${id}">${name}</button>`;
    const inds = [...new Set(stocksOnly().map((s) => s.ind))].filter((x) => x !== '其他').sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const title = isAll ? '全市場（照產業分區）' : indName ? `產業：${indName}` : sc === 'watch' ? '⭐ 我的自選' : grp.name;
    $('#view').innerHTML = `
      <div class="hm-chips">${chip('all', '全市場')}${chip('watch', '⭐ 自選')}${Core.groupsOf(MK()).map((g) => chip('grp:' + g.id, g.name)).join('')}</div>
      <div class="row" style="gap:6px;margin:10px 0 8px;flex-wrap:wrap">
        <div class="seg" id="sz"><button data-v="cap" class="${HM.size === 'cap' ? 'on' : ''}">市值</button><button data-v="val" class="${HM.size === 'val' ? 'on' : ''}">成交值</button><button data-v="eq" class="${eq ? 'on' : ''}">平均</button><button data-v="mv" class="${mv ? 'on' : ''}">漲跌</button></div>
        <div class="seg" id="co"><button data-v="pct" class="${HM.color === 'pct' ? 'on' : ''}">漲跌幅</button>${isTW() ? `<button data-v="f" class="${HM.color === 'f' ? 'on' : ''}">外資（上櫃）</button>` : ''}</div>
        <select id="indSel" class="seg-sel"><option value="">選產業…</option>${inds.map((i) => `<option ${indName === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select>
      </div>
      <div class="row small" style="margin-bottom:6px"><b>${esc(title)}</b>${!isAll ? '<button class="chip" data-sc="all" style="padding:1px 8px">‹ 回全市場</button>' : ''}
        <span class="mute" style="margin-left:auto">${items.length} 檔・<span class="up">漲 ${ups}</span>・<span class="down">跌 ${dns}</span>・${HM.color === 'f' ? '' : (eq || mv ? '平均 ' : '加權 ') + fp(wavg)}</span></div>
      ${items.length ? `<div class="hm" id="hm" style="height:${H}px">${html}</div>` : `<div class="card empty">${sc === 'watch' ? '自選股還是空的，先到個股頁按 ☆ 加進來。' : '這裡沒有資料'}</div>`}
      <div class="hm-legend"><span>${HM.color === 'f' ? '外資賣' : '-6%'}</span><i></i><span>${HM.color === 'f' ? '外資買' : '+6%'}</span></div>
      <p class="disc">方塊大小＝${mv ? '今天漲跌的幅度（漲最多、跌最多的最大）' : eq ? '每檔一樣大' : sizeKey === 'cap' ? (MK() === 'cn' ? '流通市值' : '市值') : '今天成交值'}，顏色＝${HM.color === 'f' ? '外資今天買賣超金額（估算）' : '今天漲跌幅'}，紅漲綠跌。${isAll ? `全市場只畫${mv ? '漲跌幅度' : sizeKey === 'cap' ? '市值' : '成交值'}前 ${items.length} 檔（共 ${shownAll} 檔），點產業標題可以放大看全部。` : ''}${grp ? '概念股分類是人工整理的代表股，僅供參考。' : ''}${Live.enabled() ? (liveTiles ? '盤中每 5 秒更新漲跌（證交所報價）。' : isAll ? '全市場是收盤資料；自選、概念股、單一產業盤中會即時更新。' : '') : ''}點方塊看重點。</p>
      ${!isAll && items.length ? `<div class="card"><h3>漲跌排行</h3>${listHtml(items.map((x) => x.s).sort((a, b) => b.pct - a.pct))}</div>` : ''}`;
    if (hmTap) { FX.circle($('#hm'), hmTap.x, hmTap.y); hmTap = null; }
    const go = (scope, e) => { HM.scope = scope; hmSave(); if (e) hmTap = { x: e.clientX, y: e.clientY }; FX.haptic(5); V.heat(); window.scrollTo({ top: 0 }); };
    $('#view').querySelectorAll('[data-sc]').forEach((b) => (b.onclick = (e) => go(b.dataset.sc, e)));
    $('#view').querySelectorAll('[data-ind]').forEach((b) => (b.onclick = (e) => go('ind:' + b.dataset.ind, e)));
    $('#indSel').onchange = (e) => e.target.value && go('ind:' + e.target.value);
    $('#sz').onclick = (e) => { const v = e.target.dataset.v; if (v && v !== HM.size) { HM.size = v; hmSave(); V.heat(); } };
    $('#co').onclick = (e) => { const v = e.target.dataset.v; if (v && v !== HM.color) { HM.color = v; hmSave(); V.heat(); } };
    const hm = $('#hm'); if (hm) hm.onclick = (e) => { const t = e.target.closest('.tl'); if (t) heatSheet(byCode.get(t.dataset.c)); };
    const cur = $('.hm-chips .on'); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  // 點方塊：先跳小卡看重點，再決定要不要進個股頁
  function heatSheet(s) {
    if (!s) return;
    FX.haptic(6);
    const on = S.watch.includes(s.c);
    const kv = (k, v, c = '') => `<div><small>${k}</small><b class="${c}">${v}</b></div>`;
    const el = modal(`<div class="row"><div><h2 style="margin:0">${esc(s.n)} <small class="mute" style="font-size:13px;font-weight:400">${s.c}・${esc(s.ind)}</small></h2></div>
      <div style="margin-left:auto;text-align:right"><div class="num ${cls(s.pct)}" style="font-size:24px;font-weight:700">${s.close}</div><div class="num ${cls(s.pct)} small">${arrow(s.chg)} ${Math.abs(s.chg)}（${fp(s.pct)}）</div></div></div>
      <div class="kv">${kv('成交值', valTxt(s.val))}${s.cap || isTW() ? kv(MK() === 'cn' ? '流通市值' : '市值', capTxt(s.cap)) : ''}${kv('成交量', volTxt(s))}
        ${isTW() ? `${kv('外資', fl(s.f), cls(s.f))}${kv('投信', fl(s.t), cls(s.t))}${kv('自營商', fl(s.d), cls(s.d))}` : ''}</div>
      ${X.items[s.c] ? '<p class="small" style="margin-top:10px;color:var(--acc)">🤖 這檔今天有準備好的白話解說</p>' : ''}
      <div class="grid2" style="margin-top:14px"><button class="btn" data-a="w">${on ? '⭐ 已在自選' : '☆ 加自選'}</button><a class="btn pri" href="#s/${s.c}" data-a="go">看個股 ›</a></div>`);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'go') el.remove();
      if (a === 'w') { const add = Core.toggleWatch(S, s.c); save(); e.target.closest('button').textContent = add ? '⭐ 已在自選' : '☆ 加自選'; toast(add ? '已加入自選' : '已移出自選'); FX.haptic(8); }
    });
  }

  V.weekly = () => {
    top({ back: true, title: '概念股 AI 週報' });
    if (!M) return ($('#view').innerHTML = pageSkel);
    if (!WK) return ($('#view').innerHTML = '<p class="empty">週報還沒準備好（每週五收盤後產生）</p>');
    const key = 'W' + WK.week;
    const head = `<div class="card"><h3>🏭 概念股 AI 週報<small>近 5 個交易日・到 ${md(WK.groups[0].to)}</small></h3>
      <div class="wk-bars">${WK.groups.map((g) => { const w = Math.min(100, Math.abs(g.pct5) * 8); return `<div class="wk-b"><span>${esc(g.name)}</span><div class="ib-t"><i class="${cls(g.pct5)}" style="${g.pct5 >= 0 ? 'left:50%' : 'right:50%'};width:${w / 2}%"></i></div><b class="num ${cls(g.pct5)}">${fp(g.pct5, 1)}</b></div>`; }).join('')}</div>
      <p class="small sub" style="margin-top:8px">${esc(WK.summary)}</p></div>`;
    if (!Core.isUnlocked(S, key, 'weekly', M.date)) {
      $('#view').innerHTML = head + `<div class="card">${lockBox({ c: key }, 'weekly', '每個族群這週為什麼強、為什麼弱？誰帶頭、誰拖累？AI 讀完成員股票的漲跌和解說，一個族群一段話寫給你看…')}</div>${disclaimer()}`;
      $('#view').querySelector('[data-unlock]').onclick = (e) => tryUnlock(key, 'weekly', () => V.weekly(), e.currentTarget);
      return;
    }
    $('#view').innerHTML = head + WK.groups.map((g) => `<div class="card wkg"><div class="row"><h3 style="margin:0">${esc(g.name)}</h3><b class="num ${cls(g.pct5)}" style="margin-left:auto;font-size:18px">${fp(g.pct5)}</b></div>
      <p class="wk-t">${g.ai ? '🤖 ' : ''}${esc(g.text)}</p>
      <div class="chips">${g.members.map((m) => `<a class="chip" href="#s/${m[0]}">${esc(m[1])} <b class="num ${cls(m[2])}">${fp(m[2], 1)}</b></a>`).join('')}</div>
      <a class="small" href="#heat/grp:${g.id}" style="display:inline-block;margin-top:8px">看熱力圖 ›</a></div>`).join('')
      + `<p class="disc">週漲跌＝成員股票近 5 個交易日漲跌的平均。概念股分類是人工整理的代表股。${WK.ai ? '各族群的說明由 AI 根據公開資料整理，可能有錯，' : ''}不是投資建議。</p>`;
  };

  V.watch = () => {
    top();
    if (!M) return ($('#view').innerHTML = spin);
    const arr = S.watch.map((c) => byCode.get(c)).filter(Boolean);
    $('#view').innerHTML = `<div class="card"><h3>⭐ 我的自選・${GM().flag} ${GM().name}<small>${arr.length} 檔</small></h3>${arr.length ? listHtml(arr) : '<p class="empty">還沒有自選股。打開任何一檔股票，按右上角的 ☆ 加進來。</p>'}</div>
      <p class="disc">在個股頁按 ⭐ 可以移出自選。${(() => { const o = Core.MKT_IDS.filter((id) => id !== MK() && DB[id]?.M && S.watch.some((c) => DB[id].byCode.has(c))).map((id) => Core.MARKETS[id].name); return o.length ? `其他市場（${o.join('、')}）的自選股，按上面的 ${GM().flag} 切換市場就看得到。` : ''; })()}</p>`;
  };

  // 盲測：遮住股票名稱和日期，猜之後 20 個交易日會漲還是跌
  const G = { phase: 'idle' };
  const SHOW = 60, AHEAD = 20;
  async function newRound() {
    if (!Core.gameUse(S)) return V.game();
    save();
    G.phase = 'loading'; V.game();
    // 題目只出台股：用伺服器每天存的開放資料走勢（chart.json，最近 125 個交易日）；在美股、陸股時也一樣
    const back = () => { S.gameToday = Math.max(0, S.gameToday - 1); save(); };
    await loadMarket('tw'); const TW = DB.tw;
    if (!TW?.M) { G.phase = 'idle'; G.err = '台股資料載入失敗，等一下再試'; back(); return V.game(); }
    let ch; try { ch = await getChartOf('tw'); } catch (e) { G.phase = 'idle'; G.err = e.message; back(); return V.game(); }
    if (ch.dates.length < SHOW + AHEAD) { G.phase = 'idle'; back(); return V.game(); }
    const pool = [...TW.byCode.values()].filter((x) => twStock(x.c)).sort((a, b) => b.val - a.val).slice(0, 150);
    for (let tries = 0; tries < 6; tries++) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      const rows = chartRows(ch, s.c);
      if (rows.length < SHOW + AHEAD) continue;
      const k = Math.floor(Math.random() * (rows.length - SHOW - AHEAD + 1));
      Object.assign(G, { phase: 'ask', s, rows: rows.slice(k, k + SHOW + AHEAD) });
      return V.game();
    }
    G.phase = 'idle'; G.err = '這次沒抓到合適的題目，再按一次'; S.gameToday = Math.max(0, S.gameToday - 1); save(); V.game();
  }
  V.game = () => {
    top();
    if (!M) return ($('#view').innerHTML = spin);
    const g = S.game, left = Core.gameLeft(S);
    // 盲測需要 80 個交易日的走勢；台股改用開放資料後要自己累積（2026-11 起），不夠就先暫停
    const twDays = DB.tw?.M?.histDays, paused = twDays != null && twDays < SHOW + AHEAD;
    const stats = `<div class="card"><div class="stat3"><div><b>${g.n ? Math.round((g.win / g.n) * 100) : 0}%</b><small>答對率（${g.win}/${g.n}）</small></div><div><b>${g.streak}<span class="mute small">/${g.best}</span></b><small>連對／最多</small></div><div><b>${g.sharp || 0}</b><small>🎯 神準次數</small></div></div></div>`;
    if (paused && G.phase !== 'reveal') return ($('#view').innerHTML = `<div class="card"><h3>🎯 歷史盲測<small>暫停中</small></h3><p class="sub">盲測要用一段 ${SHOW + AHEAD} 個交易日的真實走勢出題。台股資料改成政府開放資料後（只提供最新一天），我們每天自己記錄，目前累積 <b>${twDays}</b> 天，大約再 ${Math.ceil((SHOW + AHEAD - twDays) / 5)} 週就能重新開放。</p></div>` + stats);
    const moreBtn = left > 0 ? `<button class="btn pri block" id="go">${G.phase === 'reveal' ? '下一題' : '開始一題'}（今天還有 ${left} 題）</button>`
      : `<button class="btn gold block" id="more">📺 看廣告再玩 ${Core.ECON.GAME_AD_BONUS} 題</button><p class="disc" style="text-align:center">今天的免費題目用完了</p>`;
    let body = '';
    if (G.phase === 'loading') body = `<div class="card">${spin}<p class="small mute" style="text-align:center">從歷史裡挑一段真實走勢…</p></div>`;
    else if (G.phase === 'ask') {
      body = `<div class="card"><h3>🎯 神秘股票<small>${esc(G.s.ind)}・時間保密</small></h3>${chart(G.rows.slice(0, SHOW), { hide: true })}
        <p style="margin-top:8px">這是某檔<b>台股</b>真實的 ${SHOW} 個交易日走勢。<b>接下來 ${AHEAD} 個交易日</b>會漲還是跌？漲跌多少？</p>
        <div class="guess"><div class="gv num" id="gv">0%</div><small class="mute">左右拖動尺規選擇・方向猜對就算對，差 ${Core.ECON.GAME_SHARP}% 以內是「神準」+${Core.ECON.GAME_SHARP_BONUS} 點</small></div>
        <div id="rl"></div>
        <button class="btn pri block" id="gok" disabled style="margin-top:12px">拖動尺規選擇漲跌幅</button></div>`;
    } else if (G.phase === 'reveal') {
      const a = G.rows[SHOW - 1].close, b = G.rows[SHOW + AHEAD - 1].close, r = (b / a - 1) * 100, win = (r > 0 ? 1 : -1) === G.pick;
      body = `<div class="card"><div class="result"><div class="big pop ${win ? 'up' : 'down'}">${G.sharp ? '🎯 神準！' : win ? '🎉 答對了！' : '😵 答錯了'}</div>
        ${G.sharp ? `<p class="small" style="color:var(--gold)">差不到 ${Core.ECON.GAME_SHARP}%，送你 ${Core.ECON.GAME_SHARP_BONUS} 點</p>` : ''}
        <p>${esc(G.s.n)}（${G.s.c}）<br><span class="mute small">${G.rows[0].date} ～ ${G.rows[SHOW + AHEAD - 1].date}</span></p>
        <p>你猜 <b class="num ${cls(G.guess)}">${fp(G.guess, 0)}</b>，實際 ${AHEAD} 個交易日 <b class="num ${cls(r)}">${fp(r, 1)}</b>（${a} → ${b} 元）</p></div>
        ${chart(G.rows, { split: SHOW - 1 })}
        <p class="disc">股價短期走勢很難猜，答對率能長期贏過 50% 已經不容易。想知道現在的情況，可以看「AI 個股報告書」。</p>
        <a class="btn block" href="#s/${G.s.c}" data-tw="1" style="margin-top:8px">看 ${esc(G.s.n)} 現在的資料</a></div>`;
    } else body = `<div class="card"><h3>🎯 歷史盲測${isTW() ? '' : '<small>題目是台股</small>'}</h3><p class="sub">從台股過去的真實走勢隨機挑一段，把股票名稱和日期遮起來，讓你猜之後會漲還是跌，答完才揭曉。用來測試自己看圖的直覺準不準。</p>${G.err ? `<p class="small" style="color:var(--gold);margin-top:6px">${esc(G.err)}</p>` : ''}</div>`;
    $('#view').innerHTML = body + (G.phase === 'ask' || G.phase === 'loading' ? '' : moreBtn) + `<div style="height:12px"></div>` + stats;
    G.err = '';
    const go = $('#go'); if (go) go.onclick = newRound;
    const more = $('#more'); if (more) more.onclick = async () => {
      adBusy(more);
      const r = await Ads.rewarded('game');
      if (r === 'completed' || r === 'nofill' || r === 'error') { Core.gameAdBonus(S); save(); toast(r === 'completed' ? `多 ${Core.ECON.GAME_AD_BONUS} 題` : '廣告播不出來，這次直接送你'); }
      V.game();
    };
    // 慣性尺規：-30% ～ +30%，每格 1%
    if (G.phase === 'ask') {
      const gv = $('#gv'), ok = $('#gok');
      const R = FX.ruler($('#rl'), {
        min: -30, max: 30, step: 1, value: 0,
        onChange: (v) => { gv.textContent = fp(v, 0).replace('.0', ''); gv.className = 'gv num ' + cls(v); ok.disabled = !v; ok.textContent = v ? `就猜 ${fp(v, 0)}` : '拖動尺規選擇漲跌幅'; },
      });
      ok.onclick = () => {
        const v = R.value; if (!v) return;
        const a = G.rows[SHOW - 1].close, z = G.rows[SHOW + AHEAD - 1].close, real = (z / a - 1) * 100;
        G.guess = v; G.pick = Math.sign(v);
        const res = Core.gameResult(S, (z > a ? 1 : -1) === G.pick, Math.abs(v - real) <= Core.ECON.GAME_SHARP);
        G.sharp = res.sharp; save(); G.phase = 'reveal'; V.game();
        FX.haptic(res.win ? 14 : 6);
        const big = $('.result .big');
        if (res.win && big) { const r = big.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2, { n: res.sharp ? 22 : 14, dist: 80 }); }
        if (res.sharp) bump();
      };
    }
  };

  let walletShown = null; // 點數頁上次顯示的數字：再打開時從這裡滾到現在的點數
  V.me = () => {
    top();
    if (walletShown == null) walletShown = S.pts;
    const E = Core.ECON, left = Core.adsLeft(S);
    $('#view').innerHTML = `
      <div class="card wallet"><div class="wal-row">
          <div style="flex:1;text-align:left"><small class="mute">我的點數</small><div class="big num" id="wp" data-v="${walletShown}">${walletShown}</div><small class="mute">新手送的、簽到、看廣告、盲測神準都會加點</small></div>
          ${FX.ring(S.adsToday / E.AD_DAILY_MAX, `<b class="num">${S.adsToday}</b><small>/${E.AD_DAILY_MAX}<br>今日廣告</small>`)}
        </div>
        <div style="display:grid;gap:8px;margin-top:14px">
          <button class="btn gold block" id="ad" ${left ? '' : 'disabled'}>📺 看廣告 +${E.AD_REWARD} 點${left ? `（今天還有 ${left} 次）` : '（今天用完了）'}</button>
          <button class="btn block" id="ci" ${Core.canCheckin(S) ? '' : 'disabled'}>📅 每日簽到 +${E.CHECKIN} 點${Core.canCheckin(S) ? '' : '（今天簽過了）'}</button>
        </div></div>
      <div class="card"><h3>點數怎麼用</h3><table class="rules">
        <tr><td>🤖 白話解說：今天為什麼漲跌</td><td>${E.COST.explain} 點</td></tr>
        <tr><td>📑 AI 個股報告書：籌碼、營收、評價、歷史相似、風險＋AI 結論</td><td>${E.COST.deep} 點</td></tr><tr><td>🏭 概念股 AI 週報：12 個族群這週誰強誰弱</td><td>${E.COST.weekly} 點</td></tr><tr><td>🤖 AI 盤後日報、⭐ 自選股晨報</td><td>免費</td></tr>
        <tr><td>🔍 查股價、走勢、法人、自選股</td><td>免費</td></tr>
        <tr><td>🎯 歷史盲測</td><td>每天 ${E.GAME_FREE} 題免費</td></tr></table>
        <p class="disc">同一檔股票的同一份報告，當天看過可以免費重看。新朋友送 ${E.START} 點。</p></div>
      <div class="card"><h3>點數紀錄</h3><div class="loglist">${S.log.slice(0, 15).map((l) => `<div><span>${esc(l.why)}<small class="mute"> ${new Date(l.t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span><b class="num ${l.d > 0 ? 'up' : l.d < 0 ? 'down' : 'mute'}">${l.d > 0 ? '+' : ''}${l.d}</b></div>`).join('') || '<p class="empty">還沒有紀錄</p>'}</div></div>
      ${DEV ? `<div class="card"><h3>🛠 開發者</h3><p class="small mute">假廣告模式</p><select id="am" class="btn block" style="margin:6px 0">${Object.entries(Ads.MODES).map(([k, v]) => `<option value="${k}" ${Ads.mode() === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <div class="grid2"><button class="btn" id="p50">+50 點</button><button class="btn" id="rst">清除所有資料</button></div>
        <p class="small mute" style="margin-top:8px">廣告看完 ${S.stats.adsDone}・中途關掉 ${S.stats.adsSkip}・沒廣告 ${S.stats.adsNofill}・插頁 ${S.stats.inter}・花掉 ${S.stats.spent} 點・查詢 ${S.opens} 次</p></div>` : ''}
      <div class="card"><h3>關於</h3><p class="small sub">股市白話通用白話告訴你股票今天為什麼漲跌。資料每個交易日收盤後更新${M ? `，目前是 ${M.date} 的資料` : ''}。</p>${disclaimer()}</div>`;
    FX.count($('#wp'), S.pts, { dur: 800 }); walletShown = S.pts;
    $('#ad').onclick = async (e) => { await watchAd(e.currentTarget); V.me(); };
    $('#ci').onclick = () => { const r = Core.checkin(S); save(); if (r.ok) { bump(); toast(`+${r.got} 點`); } V.me(); };
    if (DEV) {
      $('#am').onchange = (e) => Ads.setMode(e.target.value);
      $('#p50').onclick = () => { S.pts += 50; save(); V.me(); };
      $('#rst').onclick = () => { const m = modal('<h2>清除所有資料？</h2><p class="sub">點數、自選股、紀錄都會清掉。</p><div class="grid2" style="margin-top:14px"><button class="btn" data-a="n">取消</button><button class="btn pri" data-a="y">清除</button></div>'); m.onclick = (e) => { const a = e.target.dataset?.a; if (a === 'y') { S = Core.newState(); save(); m.remove(); V.me(); } if (a === 'n') m.remove(); }; };
    }
  };

  // ───── 盤中即時報價（live.js）─────
  // 只在 iPhone App（和本機測試）有；報價日期比收盤資料新才顯示，所以假日、收盤資料更新後自動回到收盤資料
  const mdate = () => (M ? M.date.replace(/-/g, '') : '');
  const dayWord = () => (M && Live.today() > mdate() ? ' ' + M.date.slice(5).replace('-', '/') + ' ' : '今天');
  const fresh = (q) => q && q.price != null && q.d > mdate();
  const px2 = (v) => (v == null ? '—' : v >= 1000 ? Math.round(v * 100) / 100 + '' : +v.toFixed(2) + '');
  const setCls = (el, p) => { if (!el) return; el.classList.remove('up', 'down', 'flat'); el.classList.add(cls(p)); };
  function paintLive() {
    if (!M) return;
    let any = null;
    for (const el of document.querySelectorAll('[data-lc]')) {
      const q = Live.get(el.dataset.lc); if (!fresh(q)) continue;
      any = q;
      const t = el.dataset.lt, chs = `${arrow(q.chg)} ${Math.abs(q.chg)}（${fp(q.pct)}）`;
      if (t === 'it') {
        const a = el.querySelector('.px'), b = el.querySelector('.pc');
        if (a && a.textContent !== px2(q.price)) { a.textContent = px2(q.price); a.classList.remove('tick'); void a.offsetWidth; a.classList.add('tick'); }
        if (b) { b.textContent = fp(q.pct); setCls(b, q.pct); }
      } else if (t === 'idx') {
        const v = el.querySelector('.v'), c = el.querySelector('.c');
        if (v) { v.textContent = q.price.toLocaleString('en-US'); setCls(v, q.chg); }
        if (c) { c.textContent = chs; setCls(c, q.chg); }
      } else if (t === 'tl') {
        el.style.background = Core.heatColor(q.pct);
        const sp = el.querySelector('.tp'); if (sp) sp.textContent = fp(q.pct);
      } else if (t === 'hero') {
        const v = el.querySelector('.px'), c = el.querySelector('.ch');
        if (v) { if (v.textContent !== px2(q.price)) { v.textContent = px2(q.price); v.classList.remove('tick'); void v.offsetWidth; v.classList.add('tick'); } setCls(v, q.pct); }
        if (c) { c.textContent = chs; setCls(c, q.pct); }
        const f5 = el.querySelector('.live5');
        if (f5) {
          f5.hidden = false;
          const kv = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
          const rows = [0, 1, 2, 3, 4].map((i) => `<tr><td class="num">${q.bidV[i] ?? ''}</td><td class="num ${cls((q.bid[i] ?? q.prev) - q.prev)}">${q.bid[i] != null ? px2(q.bid[i]) : ''}</td><td class="num ${cls((q.ask[i] ?? q.prev) - q.prev)}">${q.ask[i] != null ? px2(q.ask[i]) : ''}</td><td class="num">${q.askV[i] ?? ''}</td></tr>`).join('');
          f5.innerHTML = `<div class="kv">${kv('開盤', px2(q.open))}${kv('最高', px2(q.high))}${kv('最低', px2(q.low))}${kv('成交量', q.vol != null ? q.vol.toLocaleString('en-US') + ' 張' : '—')}${kv('漲停', px2(q.up))}${kv('跌停', px2(q.down))}</div>
            ${q.bid.length || q.ask.length ? `<table class="ob"><tr><th>買量</th><th>買價</th><th>賣價</th><th>賣量</th></tr>${rows}</table>` : ''}`;
          const h = el.querySelector('.kv-h'); if (h) { h.hidden = false; h.textContent = `下面是 ${M.date.slice(5).replace('-', '/')} 收盤後的資料（成交量、法人買賣超）`; }
        }
      }
    }
    const tag = $('#dtag');
    if (tag && any) {
      const open = Live.session() === 'open';
      tag.innerHTML = open ? `<span class="live-dot"></span>即時 ${any.t.slice(0, 5)}` : `收盤 ${any.d.slice(4, 6)}/${any.d.slice(6)}`;
      tag.classList.toggle('on', open);
    }
  }
  let liveTimer = 0, moT = 0;
  const tried = new Set();
  // 畫面換了新的股票列表（切分頁、熱力圖換範圍）→ 馬上補抓、補畫
  new MutationObserver((ms) => {
    if (!ms.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('[data-lc]') || n.querySelector('[data-lc]'))))) return;
    clearTimeout(moT); moT = setTimeout(() => { paintLive(); liveTick(); }, 120);
  }).observe(document.getElementById('view'), { childList: true, subtree: true });
  async function liveTick() {
    clearTimeout(liveTimer);
    if (Live.enabled() && M && !document.hidden && Live.session() !== 'closed') {
      const keys = [...new Set([...document.querySelectorAll('[data-lc]')].map((e) => e.dataset.lc))].slice(0, 150);
      const due = Date.now() - Live.last >= Live.interval() - 300 || keys.some((k) => !tried.has(k));
      if (keys.length && due) { keys.forEach((k) => tried.add(k)); await Live.fetchKeys(keys); }
      paintLive();
    }
    liveTimer = setTimeout(liveTick, Live.session() === 'open' ? 5000 : 30000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });

  // ───── 路由 ─────
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)) || 'home';
    const [r, arg] = h.split('/');
    curRoute = h;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r || (r === 'search' && a.dataset.r === 'home')));
    window.scrollTo(0, 0);
    (V[r] || V.home)(arg);
    // 圓形擴散轉場：從底部選單按下的位置擴散開（只有點選單才有）
    if (navTap && Date.now() - navTap.t < 800) FX.circle($('#view'), navTap.x, navTap.y);
    navTap = null;
    setTimeout(() => { paintLive(); liveTick(); }, 60);
  }
  let navTap = null;
  $('#nav').addEventListener('pointerdown', (e) => { navTap = { x: e.clientX, y: e.clientY, t: Date.now() }; FX.haptic(4); });
  window.addEventListener('hashchange', route);
  route();
  loadData().then(route);
  Ads.preload();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol) && !Ads.isNative()) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__app = { get S() { return S; }, get M() { return M; }, Core };
  // 公告（studio-news.js 共用，內容在 news.js）
  if (window.STUDIO_NEWS) STUDIO_NEWS.init({
    game: 'gushi', button: '#newsBtn',
    isNewPlayer: () => !hadSave,
    canPop: () => /^(#home)?$/.test(location.hash) && !document.querySelector('.inter'),
    stats: () => (M ? [['資料日期', M.date + ' 收盤'], ['股票／ETF', M.rows.length.toLocaleString() + ' 檔']] : []),
    theme: { bg: '#0b1020', card: '#121a2e', accent: '#ffc85b', text: '#eef2ff', sub: '#9aa6c8' },
  });
})();
