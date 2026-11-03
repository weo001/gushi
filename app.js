// 畫面：大盤、查詢、個股、自選、盲測、點數。規則都在 core.js，廣告在 ads.js。
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'gushi-v1';
  const DEV = /[?&]dev\b/.test(location.search);
  let S = Core.load((() => { try { return localStorage.getItem(KEY); } catch { return null; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  save();

  // ───── 資料 ─────
  let M = null, X = { items: {} }, D = null, WK = null, RP = null, byCode = new Map(), indAvg = {}, loadErr = '';
  async function loadData() {
    try {
      const get = (f) => fetch(CFG.DATA + f + '?t=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [m, x, d, w] = await Promise.all([get('market.json'), get('explain.json').catch(() => ({ items: {} })), get('daily.json').catch(() => null), get('weekly.json').catch(() => null)]);
      M = m; X = x; D = d && d.date === m.date ? d : null; WK = w && w.groups && w.groups.length ? w : null;
      byCode = new Map(m.rows.map((r) => [r[0], Object.fromEntries(m.cols.map((k, i) => [k, r[i]]))]));
      const agg = {};
      for (const s of byCode.values()) { if (!/^[1-9]\d{3}$/.test(s.c) || s.val < 0.05) continue; const a = (agg[s.ind] ||= { t: 0, n: 0 }); a.t += s.pct; a.n++; }
      indAvg = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { pct: v.t / v.n, n: v.n }]));
      loadErr = '';
    } catch (e) { loadErr = '資料載入失敗，請檢查網路後重新整理。'; }
  }
  // 個股報告書（約 200KB）：第一次打開報告書才載
  let rpP = null;
  const getReports = () => (rpP ||= fetch(CFG.DATA + 'reports.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: {} })).catch(() => ({ items: {} })).then((j) => (RP = j)));
  const md = (d) => (d ? d.slice(5).replace('-', '/') : '');
  const stocksOnly = () => [...byCode.values()].filter((s) => /^[1-9]\d{3}$/.test(s.c));

  // FinMind：App 直接抓（免費、每個使用者自己算額度）
  const fmCache = new Map();
  async function fm(dataset, q) {
    const u = new URL('https://api.finmindtrade.com/api/v4/data');
    u.searchParams.set('dataset', dataset);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    const key = u.toString();
    if (fmCache.has(key)) return fmCache.get(key);
    // 免費額度用完時 FinMind 回的錯誤沒有跨網域標頭，瀏覽器只會說 Failed to fetch → 換成看得懂的話
    const p = fetch(key).catch(() => { throw new Error('資料來源暫時連不上（可能是查詢太頻繁），過幾分鐘再試'); }).then((r) => r.json()).then((j) => {
      if (j.status !== 200) throw new Error(/limit|upper|402/i.test(j.msg + j.status) ? '查詢太頻繁了，休息一下再試（免費資料每小時有次數限制）' : '資料暫時抓不到：' + (j.msg || ''));
      return j.data;
    });
    fmCache.set(key, p); p.catch(() => fmCache.delete(key));
    return p;
  }
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
  const disclaimer = '<p class="disc">本 App 內容由程式和 AI 根據公開資料整理，只是幫你看懂資料，不是投資建議，也不保證正確。投資前請自己判斷，盈虧自負。資料來源：臺灣證券交易所、證券櫃檯買賣中心、FinMind。</p>';

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
    const d = M ? M.date.slice(5).replace('-', '/') : '';
    $('#top').innerHTML = (opts.back ? '<button class="back" onclick="history.length>1?history.back():location.hash=\'#home\'">‹</button>' : '')
      + (opts.title ? `<span class="brand">${esc(opts.title)}</span>` : '<span class="brand">股市<i>白話通</i></span>')
      + (d ? `<span class="date" id="dtag">${d} 收盤</span>` : '')
      + `<a class="tb-ic" href="#search" aria-label="查詢股票" style="margin-left:auto">🔍</a><a class="pts" href="#me" id="pts" style="margin-left:4px"><span class="coin">點</span><span class="num" data-v="${S.pts}">${S.pts}</span></a>`;
    // 頂部背景跟著大盤紅綠（勾選連動：狀態一變，整個畫面跟著變）
    if (M?.index?.[0]) document.body.dataset.mkt = M.index[0].chg > 0 ? 'up' : M.index[0].chg < 0 ? 'down' : 'flat';
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
  const item = (s, i = 0) => `<a class="it" href="#s/${s.c}" data-lc="${mk(s)}" data-lt="it" style="--k:${Math.min(i, 14)}"><div class="nm"><b>${esc(s.n)}</b>${X.items[s.c] ? '<span class="badge-ai">解說</span>' : ''}<small>${s.c}・${esc(s.ind)}${s.m === 'O' ? '・上櫃' : ''}</small></div>
    <div class="px num">${s.close}</div><div class="pc num ${cls(s.pct)}">${fp(s.pct)}</div></a>`;
  const listHtml = (arr) => (arr.length ? `<div class="list">${arr.map((s, i) => item(s, i)).join('')}</div>` : '<p class="empty">沒有資料</p>');

  // ───── 各頁 ─────
  const V = {};
  let homeTab = 'hot';
  V.home = () => {
    top();
    if (!M) return ($('#view').innerHTML = loadErr ? `<p class="empty">${loadErr}</p>` : spin);
    const B = M.breadth, tot = B.up + B.down + B.flat || 1;
    const L = { hot: '熱門', gain: '漲幅', lose: '跌幅', fbuy: '外資買', fsell: '外資賣', tbuy: '投信買', etf: 'ETF' };
    const st = stocksOnly(), liq = st.filter((s) => s.val >= 0.3);
    const lists = {
      hot: () => [...st].sort((a, b) => b.val - a.val), gain: () => [...liq].sort((a, b) => b.pct - a.pct), lose: () => [...liq].sort((a, b) => a.pct - b.pct),
      fbuy: () => st.filter((s) => s.f != null).sort((a, b) => b.f * b.close - a.f * a.close), fsell: () => st.filter((s) => s.f != null).sort((a, b) => a.f * a.close - b.f * b.close),
      tbuy: () => st.filter((s) => s.t != null).sort((a, b) => b.t * b.close - a.t * a.close), etf: () => [...byCode.values()].filter((s) => s.ind === 'ETF').sort((a, b) => b.val - a.val),
    };
    // 吸附卡片：加權（含 3 個月走勢線）、櫃買、漲跌家數、三大法人。左右滑會吸附，滑到的那張重畫線
    const idxCard = (i, k) => {
      const hist = k === 0 && M.taiex?.length >= 5 ? M.taiex.map(([date, close, v]) => ({ date, close, Trading_Volume: v })) : null;
      const lk = /櫃買/.test(i.name) ? 'otc_o00' : /加權/.test(i.name) ? 'tse_t00' : '';
      return `<div class="snap-c idx"${lk ? ` data-lc="${lk}" data-lt="idx"` : ''}><small class="mute">${i.name}${hist ? '・近 3 個月' : ''}</small><div class="v num ${cls(i.chg)}">${i.close.toLocaleString('en-US')}</div>
        <div class="c num ${cls(i.chg)}">${arrow(i.chg)} ${Math.abs(i.chg)}（${fp(i.pct)}）</div>${hist ? chart(hist, { h: 70, hide: true }) : `<div class="idx-big ${cls(i.chg)}">${arrow(i.chg) || '–'}</div>`}</div>`;
    };
    const imax = Math.max(...['f', 't', 'd'].map((k) => Math.abs(M.inst[k] || 0))) || 1;
    const ibar = (k, n) => { const v = M.inst[k] || 0, w = (Math.abs(v) / imax) * 50; return `<div class="ibar"><span>${n}</span><div class="ib-t"><i class="${cls(v)}" style="${v >= 0 ? 'left:50%' : `right:50%`};width:${w}%"></i></div><b class="num ${cls(v)}">${fc(v)} 億</b></div>`; };
    const cards = [
      ...M.index.map(idxCard),
      `<div class="snap-c"><small class="mute">今天漲跌家數・${M.otc ? '上市＋上櫃' : '上市'}</small>
        <div class="row" style="margin-top:6px"><b class="num up" style="font-size:24px">${B.up}</b><span class="mute small" style="margin:auto">平盤 ${B.flat}</span><b class="num down" style="font-size:24px">${B.down}</b></div>
        <div class="bar3"><i style="width:${(B.up / tot) * 100}%;background:var(--up)"></i><i style="width:${(B.flat / tot) * 100}%;background:var(--line2)"></i><i style="width:${(B.down / tot) * 100}%;background:var(--down)"></i></div>
        <p class="small sub" style="margin-top:6px">${B.up > B.down * 1.5 ? '大部分股票都在漲，普漲的一天。' : B.down > B.up * 1.5 ? '大部分股票都在跌，普跌的一天。' : '漲跌家數差不多，有漲有跌。'}</p></div>`,
      `<div class="snap-c"><small class="mute">三大法人買賣超（估算）</small><div style="margin-top:8px">${ibar('f', '外資')}${ibar('t', '投信')}${ibar('d', '自營商')}</div>
        <p class="small sub" style="margin-top:auto">${(() => { const f = M.inst.f || 0, t = M.inst.t || 0, sum = f + t + (M.inst.d || 0);
          const w = (v) => (v >= 0 ? '買' : '賣');
          return Math.sign(f) !== Math.sign(t) ? `外資${w(f)}、投信${w(t)}，法人看法分歧；合計${w(sum)}超約 ${Math.abs(Math.round(sum))} 億。` : `外資和投信都在${w(f)}，合計${w(sum)}超約 ${Math.abs(Math.round(sum))} 億。`; })()}</p></div>`,
    ];
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
    const watchCard = wl.length ? `<div class="card"><h3>⭐ 自選股晨報<small>${md(M.date)} 收盤</small></h3>
      <p class="small sub">你的 ${wl.length} 檔自選股：${wl.filter((s) => s.pct > 0).length} 漲、${wl.filter((s) => s.pct < 0).length} 跌。表現最好的是 <b>${esc(wbest[0].n)}</b>（<span class="${cls(wbest[0].pct)}">${fp(wbest[0].pct)}</span>）${wl.length > 1 ? `，最差的是 <b>${esc(wbest[wbest.length - 1].n)}</b>（<span class="${cls(wbest[wbest.length - 1].pct)}">${fp(wbest[wbest.length - 1].pct)}</span>）` : ''}。</p>
      <div class="wls">${wl.slice(0, 8).map(wline).join('')}</div>${wl.length > 8 ? '<a class="btn block" href="#watch" style="margin-top:8px">看全部自選</a>' : ''}</div>` : '';
    const dailyCard = D ? `<div class="card daily"><div class="dl-h"><span class="tagai">🤖 AI 盤後日報</span><small class="mute">${md(D.date)} 收盤後</small></div>
      <h2>${esc(D.title)}</h2><p class="dl-t" id="dlt">${esc(D.text)}</p>
      ${D.focus?.length ? `<div class="chips" style="margin-top:8px">${D.focus.map((c) => byCode.get(c)).filter(Boolean).map((s) => `<a class="chip" href="#s/${s.c}">${esc(s.n)} <b class="num ${cls(s.pct)}">${fp(s.pct, 1)}</b></a>`).join('')}</div>` : ''}
      <p class="disc">${D.ai ? '由 AI 根據證交所、櫃買中心公開資料和新聞標題整理，可能有錯，不是投資建議。' : '由程式根據公開資料整理。'}</p></div>` : '';
    const weekCard = WK ? `<a class="card wkc" href="#weekly"><div class="row"><h3 style="margin:0">🏭 概念股 AI 週報<small>近 5 個交易日・到 ${md(WK.groups[0].to)}</small></h3><span class="mute" style="margin-left:auto">›</span></div>
      <div class="chips" style="margin-top:8px">${WK.groups.slice(0, 3).map((g) => `<span class="chip">${esc(g.name)} <b class="num ${cls(g.pct5)}">${fp(g.pct5, 1)}</b></span>`).join('')}<span class="chip">…還有 ${Math.max(0, WK.groups.length - 3)} 個</span></div>
      <p class="small sub" style="margin-top:6px">12 個族群這週誰強誰弱、為什麼（${Core.ECON.COST.weekly} 點）</p></a>` : '';
    $('#view').innerHTML = `
      <a class="search" href="#search"><span>🔍</span><span class="mute">輸入代號或名稱，例如 2330、台積電</span></a>
      ${dailyCard}${watchCard}
      <div class="snap" id="snap">${cards.join('')}</div>
      <div class="dots" id="dots">${cards.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
      <div class="card"><h3>族群強弱<small>同產業平均漲跌・點了看熱力圖</small></h3>
        <div class="chips">${M.sectors.slice(0, 6).map((x) => `<a class="chip" href="#heat/ind:${encodeURIComponent(x.ind)}">${esc(x.ind)} <b class="num ${cls(x.pct)}">${fp(x.pct, 1)}</b></a>`).join('')}</div>
        <div class="chips" style="margin-top:6px">${M.sectors.slice(-4).reverse().map((x) => `<a class="chip" href="#heat/ind:${encodeURIComponent(x.ind)}">${esc(x.ind)} <b class="num ${cls(x.pct)}">${fp(x.pct, 1)}</b></a>`).join('')}</div>
        <a class="btn block" href="#heat" style="margin-top:10px">🔥 看全市場熱力圖</a></div>
      ${weekCard}
      <div class="card"><div class="tabs" id="tabs">${Object.entries(L).map(([k, v]) => `<button data-k="${k}" class="${k === homeTab ? 'on' : ''}">${v}</button>`).join('')}</div><div id="hl"></div>
        <p class="disc">有「解說」標籤的是今天的熱門股，已經準備好白話解說。其他股票打開時才即時整理。</p></div>
      ${disclaimer}`;
    const draw = () => { $('#hl').innerHTML = listHtml(lists[homeTab]().slice(0, 30)); };
    $('#tabs').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; homeTab = k; [...$('#tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.k === k)); FX.haptic(4); draw(); };
    draw();
    FX.carousel($('#snap'), $('#dots'));
  };

  let lastQ = '';
  V.search = () => {
    top();
    $('#view').innerHTML = `<div class="search"><span>🔍</span><input id="q" placeholder="代號或名稱，例如 2330、台積電" value="${esc(lastQ)}" autocomplete="off" inputmode="search"></div><div id="res"></div>`;
    const q = $('#q');
    const run = () => {
      lastQ = q.value.trim();
      if (!M) return ($('#res').innerHTML = spin);
      if (!lastQ) return ($('#res').innerHTML = '<div class="card"><h3>大家常查</h3>' + listHtml(stocksOnly().sort((a, b) => b.val - a.val).slice(0, 12)) + '</div>');
      const k = lastQ.toUpperCase();
      const r = [...byCode.values()].filter((s) => s.c.startsWith(k) || s.n.toUpperCase().includes(k))
        .sort((a, b) => (b.c === k) - (a.c === k) || (b.c.startsWith(k)) - (a.c.startsWith(k)) || b.val - a.val).slice(0, 40);
      $('#res').innerHTML = r.length ? '<div class="card">' + listHtml(r) + '</div>' : '<p class="empty">找不到這檔股票</p>';
    };
    q.oninput = run; q.onkeydown = (e) => { if (e.key === 'Enter') { const f = $('#res .it'); if (f) location.hash = f.getAttribute('href'); } };
    run(); setTimeout(() => q.focus(), 50);
  };

  // 個股頁
  const exCache = new Map();
  V.s = async (code) => {
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
        <div class="row"><div><div class="nm">${esc(s.n)}</div><small class="mute">${s.c}・${s.m === 'O' ? '上櫃' : '上市'}・${esc(s.ind)}</small></div><button class="star" id="star" title="加入自選">${on ? '⭐' : '☆'}</button></div>
        <div class="px num ${cls(s.pct)}">${s.close}</div><div class="ch num ${cls(s.pct)}">${arrow(s.chg)} ${Math.abs(s.chg)}（${fp(s.pct)}）</div>
        <div class="live5" hidden></div>
        <div class="kv-h small mute" hidden></div>
        <div class="kv">${kv('成交量', s.vol.toLocaleString('en-US') + ' 張')}${kv('成交值', s.val + ' 億')}${kv('量比', ex?.vr ? ex.vr + ' 倍' : '—')}
          ${kv('外資', fl(s.f), cls(s.f))}${kv('投信', fl(s.t), cls(s.t))}${kv('自營商', fl(s.d), cls(s.d))}</div>
        <p class="disc">法人買賣超單位：張。量比＝今天成交量 ÷ 前 20 天平均。</p>
      </div>
      <div class="card"><h3>📉 近半年走勢</h3><div id="ch">${spin}</div></div>
      <div class="card" id="ex"></div>
      <div class="card" id="deep"></div>
      ${disclaimer}`;
    $('#star').onclick = (e) => {
      const add = Core.toggleWatch(S, code); save();
      const b = e.currentTarget; b.textContent = add ? '⭐' : '☆'; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      if (add) { const r = b.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2, { n: 8, dist: 30, colors: ['#ffc85b', '#ffe7a8'], coin: false }); }
      FX.haptic(add ? 10 : 5); toast(add ? '已加入自選' : '已移出自選');
    };
    fm('TaiwanStockPrice', { data_id: code, start_date: addDays(M.date, -183) }).then((rows) => { const el = $('#ch'); if (el) el.innerHTML = chart(rows); }).catch((e) => { const el = $('#ch'); if (el) el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
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
      el.innerHTML = head + lockBox(s, 'explain', `${esc(s.n)}今天${word}的白話解說：和大盤、同產業比起來怎麼樣，成交量是不是異常，外資投信在買還是賣，還有今天的相關新聞…`);
      el.querySelector('[data-unlock]').onclick = (e) => tryUnlock(s.c, 'explain', (f) => drawExplain(s, f), e.currentTarget);
      return;
    }
    const ex = X.items[s.c];
    const render = (t, ai, tags, news) => {
      el.classList.toggle('reveal', !!fresh);
      el.innerHTML = head + `<p class="explain">${esc(t)}</p>
        <div style="margin-top:8px">${(tags || []).map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>
        ${news?.length ? `<div class="news"><small class="mute">今天的相關新聞</small>${news.map((n) => `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}<small>${esc(n.src || '')}</small></a>`).join('')}</div>` : ''}
        <p class="disc">${ai ? '由 AI 根據上面的資料整理，可能有錯，請以新聞原文為準。' : '由程式根據行情、法人和新聞整理。'}</p>`;
    };
    if (ex) return render(ex.t, ex.ai, ex.tags, ex.news);
    // 沒有預先準備的股票：當場用規則整理
    el.innerHTML = head + spin;
    let p = exCache.get(s.c);
    if (!p) {
      p = Promise.all([
        fm('TaiwanStockPrice', { data_id: s.c, start_date: addDays(M.date, -45) }),
        fm('TaiwanStockNews', { data_id: s.c, start_date: M.date }).catch(() => []),
      ]).then(([h, news]) => {
        const vols = h.filter((r) => r.date < M.date).map((r) => r.Trading_Volume).slice(-20);
        const v20 = vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
        const seen = new Set();
        const nws = news.reverse().filter((x) => !/爆料同學會|forum|PTT|鉅額成交/i.test(x.title + x.link)).filter((x) => { const k = x.title.slice(0, 18); if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 5).map((x) => ({ title: x.title.replace(/\s*-\s*[^-]{2,15}$/, ''), link: x.link, src: x.source }));
        const ia = indAvg[s.ind] || {}, idx = M.index[s.m === 'O' && M.index[1] ? 1 : 0];
        const r = Core.explainRule({ ...s, volRatio: v20 ? (s.vol * 1000) / v20 : NaN, mktPct: idx?.pct, indPct: ia.pct, indN: ia.n, news: nws });
        return { ...r, news: nws };
      });
      exCache.set(s.c, p); p.catch(() => exCache.delete(s.c));
    }
    p.then((r) => { if ($('#ex') === el) render(r.text, false, r.tags, r.news); })
      .catch((e) => { el.innerHTML = head + `<p class="empty">${esc(e.message)}</p><button class="btn block" id="exr">重試（不用再扣點）</button>`; $('#exr').onclick = () => drawExplain(s); });
  }

  const deepCache = new Map();
  function drawDeep(s, fresh) {
    const el = $('#deep'); if (!el) return;
    const head = '<h3>📑 AI 個股報告書<small>籌碼・營收・評價・歷史相似</small></h3>';
    if (!Core.isUnlocked(S, s.c, 'deep', M.date)) {
      el.innerHTML = head + lockBox(s, 'deep', 'AI 幫你讀完 3 年股價、法人、融資、營收、本益比，寫成一份有結論的報告：偏多和偏空訊號各有幾個？外資投信近 20 天的動向、融資有沒有暴增、月營收年增率、本益比貴不貴、歷史上走勢很像的時候之後怎麼走，還有魔鬼代言人的風險清單…');
      el.querySelector('[data-unlock]').onclick = (e) => tryUnlock(s.c, 'deep', (f) => drawDeep(s, f), e.currentTarget);
      return;
    }
    el.innerHTML = head + skel(4) + '<p class="small mute" style="text-align:center">整理 3 年股價、法人、融資、營收資料中…</p>';
    let p = deepCache.get(s.c);
    if (!p) {
      const d = M.date, q = (start) => ({ data_id: s.c, start_date: start });
      p = getReports().then((rp) => { const it = rp.items?.[s.c]; if (it?.R) return { ...it.R, aiText: it.ai, made: it.d }; return Promise.all([
        fm('TaiwanStockPrice', q(addDays(d, -3 * 365))),
        fm('TaiwanStockInstitutionalInvestorsBuySell', q(addDays(d, -45))).catch(() => []),
        fm('TaiwanStockMarginPurchaseShortSale', q(addDays(d, -45))).catch(() => []),
        fm('TaiwanStockMonthRevenue', q(addDays(d, -500))).catch(() => []),
        fm('TaiwanStockPER', q(addDays(d, -365))).catch(() => []),
      ]).then(([prices, inst, margin, rev, per]) => Core.analyze({ prices, inst, margin, rev, per })); });
      deepCache.set(s.c, p); p.catch(() => deepCache.delete(s.c));
    }
    p.then((R) => {
      if ($('#deep') !== el) return;
      if (R.error) return (el.innerHTML = head + `<p class="empty">${esc(R.error)}</p>`);
      const tot = R.bull + R.bear || 1;
      const dot = (t) => `<span class="dot" style="background:${t > 0 ? 'var(--up)' : t < 0 ? 'var(--down)' : 'var(--line2)'}"></span>`;
      // 疊卡：各項分析先疊成一疊（上面露出標題），點開依序攤開，再點收起
      const n = R.sections.length;
      el.classList.toggle('reveal', !!fresh);
      const aiBox = R.aiText ? `<div class="aic"><b>🤖 AI 結論</b><p>${esc(R.aiText)}</p></div>` : `<p class="small mute" style="margin:0 0 8px">這檔不在每天的 AI 報告名單（成交值前 100 檔）內，以下是程式即時整理的報告，沒有 AI 結論。</p>`;
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
    const grp = sc.startsWith('grp:') ? Core.GROUPS.find((g) => g.id === sc.slice(4)) : null;
    const indName = sc.startsWith('ind:') ? sc.slice(4) : null;
    let pool;
    if (isAll) pool = stocksOnly();
    else if (indName) pool = [...byCode.values()].filter((s) => s.ind === indName);
    else if (sc === 'watch') pool = S.watch.map((c) => byCode.get(c)).filter(Boolean);
    else if (grp) pool = grp.codes.map((c) => byCode.get(c)).filter(Boolean);
    else { HM.scope = 'all'; return V.heat(); }
    // ETF 沒有市值，ETF 群組和自選裡的 ETF 一律用成交值
    const sizeKey = HM.size !== 'val' && pool.some((s) => s.cap > 0) && !(grp && grp.id === 'etf') ? 'cap' : 'val';
    const fv = (s) => ((s.f || 0) * s.close) / 1e5; // 外資買賣超金額（億）
    // 平均＝每檔一樣大（先照市值挑出要畫的股票），看得到整個市場的漲跌分布，不會被台積電蓋掉
    const eq = HM.size === 'eq';
    let items = pool.map((s) => ({ s, v: s[sizeKey] > 0 ? s[sizeKey] : 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const shownAll = items.length;
    if (isAll) items = items.slice(0, eq ? 300 : 400);
    if (eq) items = items.map((x) => ({ s: x.s, v: 1 }));
    const fScale = (() => { const a = items.map((x) => Math.abs(fv(x.s))).sort((p, q) => p - q); return a[Math.floor(a.length * 0.9)] || 1; })();
    const liveTiles = !isAll && HM.color === 'pct' && items.length <= 150;
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
        const avg = r.arr.reduce((a, b) => a + b.s.pct * b.v, 0) / r.v; // 依大小加權的平均漲跌
        html += `<div class="hm-ind" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${hd ? `<button class="hm-hd" data-ind="${esc(r.ind)}"><span>${esc(r.ind)}</span><b class="${cls(avg)}">${fp(avg, 1)}</b> ›</button>` : ''}</div>`;
        for (const t of Core.squarify(r.arr, r.x + 1, r.y + hd + 1, r.w - 2, r.h - hd - 2)) html += tile(t, k++);
      }
    } else Core.squarify(items, 0, 0, W, H).forEach((t, k) => { html += tile(t, k); });
    const ups = items.filter((x) => x.s.pct > 0).length, dns = items.filter((x) => x.s.pct < 0).length;
    const wavg = items.reduce((a, b) => a + b.s.pct * b.v, 0) / (items.reduce((a, b) => a + b.v, 0) || 1);
    const chip = (id, name) => `<button class="chip ${sc === id ? 'on' : ''}" data-sc="${id}">${name}</button>`;
    const inds = [...new Set(stocksOnly().map((s) => s.ind))].filter((x) => x !== '其他').sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const title = isAll ? '全市場（照產業分區）' : indName ? `產業：${indName}` : sc === 'watch' ? '⭐ 我的自選' : grp.name;
    $('#view').innerHTML = `
      <div class="hm-chips">${chip('all', '全市場')}${chip('watch', '⭐ 自選')}${Core.GROUPS.map((g) => chip('grp:' + g.id, g.name)).join('')}</div>
      <div class="row" style="gap:6px;margin:10px 0 8px;flex-wrap:wrap">
        <div class="seg" id="sz"><button data-v="cap" class="${HM.size === 'cap' ? 'on' : ''}">市值</button><button data-v="val" class="${HM.size === 'val' ? 'on' : ''}">成交值</button><button data-v="eq" class="${eq ? 'on' : ''}">平均</button></div>
        <div class="seg" id="co"><button data-v="pct" class="${HM.color === 'pct' ? 'on' : ''}">漲跌幅</button><button data-v="f" class="${HM.color === 'f' ? 'on' : ''}">外資</button></div>
        <select id="indSel" class="seg-sel"><option value="">選產業…</option>${inds.map((i) => `<option ${indName === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select>
      </div>
      <div class="row small" style="margin-bottom:6px"><b>${esc(title)}</b>${!isAll ? '<button class="chip" data-sc="all" style="padding:1px 8px">‹ 回全市場</button>' : ''}
        <span class="mute" style="margin-left:auto">${items.length} 檔・<span class="up">漲 ${ups}</span>・<span class="down">跌 ${dns}</span>・${HM.color === 'f' ? '' : (eq ? '平均 ' : '加權 ') + fp(wavg)}</span></div>
      ${items.length ? `<div class="hm" id="hm" style="height:${H}px">${html}</div>` : `<div class="card empty">${sc === 'watch' ? '自選股還是空的，先到個股頁按 ☆ 加進來。' : '這裡沒有資料'}</div>`}
      <div class="hm-legend"><span>${HM.color === 'f' ? '外資賣' : '-6%'}</span><i></i><span>${HM.color === 'f' ? '外資買' : '+6%'}</span></div>
      <p class="disc">方塊大小＝${eq ? '每檔一樣大' : sizeKey === 'cap' ? '市值' : '今天成交值'}，顏色＝${HM.color === 'f' ? '外資今天買賣超金額（估算）' : '今天漲跌幅'}，紅漲綠跌。${isAll ? `全市場只畫${sizeKey === 'cap' ? '市值' : '成交值'}前 ${items.length} 檔（共 ${shownAll} 檔），點產業標題可以放大看全部。` : ''}${grp ? '概念股分類是人工整理的代表股，僅供參考。' : ''}${Live.enabled() ? (liveTiles ? '盤中每 5 秒更新漲跌（證交所報價）。' : isAll ? '全市場是收盤資料；自選、概念股、單一產業盤中會即時更新。' : '') : ''}點方塊看重點。</p>
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
      <div class="kv">${kv('成交值', s.val + ' 億')}${kv('市值', s.cap ? (s.cap >= 10000 ? (s.cap / 10000).toFixed(2) + ' 兆' : s.cap.toLocaleString('en-US') + ' 億') : '—')}${kv('成交量', s.vol.toLocaleString('en-US') + ' 張')}
        ${kv('外資', fl(s.f), cls(s.f))}${kv('投信', fl(s.t), cls(s.t))}${kv('自營商', fl(s.d), cls(s.d))}</div>
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
      $('#view').innerHTML = head + `<div class="card">${lockBox({ c: key }, 'weekly', '每個族群這週為什麼強、為什麼弱？誰帶頭、誰拖累？AI 讀完成員股票的漲跌和解說，一個族群一段話寫給你看…')}</div>${disclaimer}`;
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
    $('#view').innerHTML = `<div class="card"><h3>⭐ 我的自選<small>${arr.length} 檔</small></h3>${arr.length ? listHtml(arr) : '<p class="empty">還沒有自選股。打開任何一檔股票，按右上角的 ☆ 加進來。</p>'}</div>
      <p class="disc">在個股頁按 ⭐ 可以移出自選。</p>`;
  };

  // 盲測：遮住股票名稱和日期，猜之後 20 個交易日會漲還是跌
  const G = { phase: 'idle' };
  const SHOW = 60, AHEAD = 20;
  async function newRound() {
    if (!Core.gameUse(S)) return V.game();
    save();
    G.phase = 'loading'; V.game();
    const pool = stocksOnly().sort((a, b) => b.val - a.val).slice(0, 150);
    for (let tries = 0; tries < 4; tries++) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      const t0 = Date.parse('2018-01-01'), t1 = Date.parse(M.date) - 420 * 864e5;
      const start = new Date(t0 + Math.random() * (t1 - t0)).toISOString().slice(0, 10);
      try {
        const rows = await fm('TaiwanStockPrice', { data_id: s.c, start_date: start, end_date: addDays(start, 150) });
        const ok = rows.filter((r) => r.close > 0);
        if (ok.length < SHOW + AHEAD) continue;
        Object.assign(G, { phase: 'ask', s, rows: ok.slice(0, SHOW + AHEAD) });
        return V.game();
      } catch (e) { G.phase = 'idle'; G.err = e.message; S.gameToday = Math.max(0, S.gameToday - 1); save(); return V.game(); }
    }
    G.phase = 'idle'; G.err = '這次沒抓到合適的題目，再按一次'; S.gameToday = Math.max(0, S.gameToday - 1); save(); V.game();
  }
  V.game = () => {
    top();
    if (!M) return ($('#view').innerHTML = spin);
    const g = S.game, left = Core.gameLeft(S);
    const stats = `<div class="card"><div class="stat3"><div><b>${g.n ? Math.round((g.win / g.n) * 100) : 0}%</b><small>答對率（${g.win}/${g.n}）</small></div><div><b>${g.streak}<span class="mute small">/${g.best}</span></b><small>連對／最多</small></div><div><b>${g.sharp || 0}</b><small>🎯 神準次數</small></div></div></div>`;
    const moreBtn = left > 0 ? `<button class="btn pri block" id="go">${G.phase === 'reveal' ? '下一題' : '開始一題'}（今天還有 ${left} 題）</button>`
      : `<button class="btn gold block" id="more">📺 看廣告再玩 ${Core.ECON.GAME_AD_BONUS} 題</button><p class="disc" style="text-align:center">今天的免費題目用完了</p>`;
    let body = '';
    if (G.phase === 'loading') body = `<div class="card">${spin}<p class="small mute" style="text-align:center">從歷史裡挑一段真實走勢…</p></div>`;
    else if (G.phase === 'ask') {
      body = `<div class="card"><h3>🎯 神秘股票<small>${esc(G.s.ind)}・時間保密</small></h3>${chart(G.rows.slice(0, SHOW), { hide: true })}
        <p style="margin-top:8px">這是某檔台股真實的 ${SHOW} 個交易日走勢。<b>接下來 ${AHEAD} 個交易日</b>會漲還是跌？漲跌多少？</p>
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
        <a class="btn block" href="#s/${G.s.c}" style="margin-top:8px">看 ${esc(G.s.n)} 現在的資料</a></div>`;
    } else body = `<div class="card"><h3>🎯 歷史盲測</h3><p class="sub">從台股過去的真實走勢隨機挑一段，把股票名稱和日期遮起來，讓你猜之後會漲還是跌，答完才揭曉。用來測試自己看圖的直覺準不準。</p>${G.err ? `<p class="small" style="color:var(--gold);margin-top:6px">${esc(G.err)}</p>` : ''}</div>`;
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
      <div class="card"><h3>關於</h3><p class="small sub">股市白話通用白話告訴你股票今天為什麼漲跌。資料每個交易日收盤後更新${M ? `，目前是 ${M.date} 的資料` : ''}。</p>${disclaimer}</div>`;
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
})();
