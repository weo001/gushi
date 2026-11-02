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
  let M = null, X = { items: {} }, byCode = new Map(), indAvg = {}, loadErr = '';
  async function loadData() {
    try {
      const get = (f) => fetch(CFG.DATA + f + '?t=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [m, x] = await Promise.all([get('market.json'), get('explain.json').catch(() => ({ items: {} }))]);
      M = m; X = x;
      byCode = new Map(m.rows.map((r) => [r[0], Object.fromEntries(m.cols.map((k, i) => [k, r[i]]))]));
      const agg = {};
      for (const s of byCode.values()) { if (!/^[1-9]\d{3}$/.test(s.c) || s.val < 0.05) continue; const a = (agg[s.ind] ||= { t: 0, n: 0 }); a.t += s.pct; a.n++; }
      indAvg = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { pct: v.t / v.n, n: v.n }]));
      loadErr = '';
    } catch (e) { loadErr = '資料載入失敗，請檢查網路後重新整理。'; }
  }
  const stocksOnly = () => [...byCode.values()].filter((s) => /^[1-9]\d{3}$/.test(s.c));

  // FinMind：App 直接抓（免費、每個使用者自己算額度）
  const fmCache = new Map();
  async function fm(dataset, q) {
    const u = new URL('https://api.finmindtrade.com/api/v4/data');
    u.searchParams.set('dataset', dataset);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    const key = u.toString();
    if (fmCache.has(key)) return fmCache.get(key);
    const p = fetch(key).then((r) => r.json()).then((j) => {
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
  const spin = '<div class="spin"></div>';
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
    s += `<path d="${seg(0, end)}L${x(end)},${H}L${x(0)},${H}Z" fill="url(#${id})"/><path d="${seg(0, end)}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>`;
    if (split > 0 && split < rows.length - 1) {
      const fu = cs[rows.length - 1] >= cs[split];
      s += `<line x1="${x(split)}" x2="${x(split)}" y1="0" y2="${H}" stroke="#ffc85b" stroke-dasharray="4 4"/><path d="${seg(split, rows.length - 1)}" fill="none" stroke="${fu ? 'var(--up)' : 'var(--down)'}" stroke-width="2.6" stroke-dasharray="1 0"/>`;
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
      + (d ? `<span class="date">資料 ${d}</span>` : '')
      + `<a class="pts" href="#me" id="pts"><span class="coin">點</span><span class="num">${S.pts}</span></a>`;
  }
  const bump = () => { const p = $('#pts'); if (p) { p.querySelector('.num').textContent = S.pts; p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); } };

  // ───── 廣告和點數 ─────
  async function watchAd() {
    if (Core.adsLeft(S) <= 0) { toast('今天的廣告次數用完了，明天再來'); return 'cap'; }
    const r = await Ads.rewarded('points');
    if (r === 'completed') { Core.grantAd(S); save(); bump(); toast(`+${Core.ECON.AD_REWARD} 點`); }
    else if (r === 'skipped') { S.stats.adsSkip++; S.lastReward = Date.now(); save(); toast('沒看完，沒有拿到點數'); }
    else if (r !== 'busy') { S.stats.adsNofill++; save(); }
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
        const r = await watchAd();
        if (r === 'nofill' || r === 'error') {
          const f = Core.unlockFree(S, code, kind, M.date); save();
          if (f.ok) { el.remove(); toast('廣告暫時播不出來，這次免費'); return onDone(); }
          return draw('現在沒有廣告可以播，等一下再試試。');
        }
      }
      if (S.pts >= cost) { el.remove(); onDone(true); } else draw();
    });
  }
  function tryUnlock(code, kind, after) {
    const r = Core.unlock(S, code, kind, M.date);
    if (r.ok) { save(); if (r.paid) { bump(); toast(`-${r.paid} 點`); } return after(); }
    if (r.why === 'pts') needPoints(code, kind, () => tryUnlock(code, kind, after));
  }

  // ───── 股票列表 ─────
  const item = (s) => `<a class="it" href="#s/${s.c}"><div class="nm"><b>${esc(s.n)}</b>${X.items[s.c] ? '<span class="badge-ai">解說</span>' : ''}<small>${s.c}・${esc(s.ind)}${s.m === 'O' ? '・上櫃' : ''}</small></div>
    <div class="px num">${s.close}</div><div class="pc num ${cls(s.pct)}">${fp(s.pct)}</div></a>`;
  const listHtml = (arr) => (arr.length ? `<div class="list">${arr.map(item).join('')}</div>` : '<p class="empty">沒有資料</p>');

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
    const inst = (k, n) => `<div><small class="mute">${n}</small><div class="num ${cls(M.inst[k])}" style="font-weight:700">${fc(M.inst[k])} 億</div></div>`;
    $('#view').innerHTML = `
      <a class="search" href="#search"><span>🔍</span><span class="mute">輸入代號或名稱，例如 2330、台積電</span></a>
      <div class="grid2">${M.index.map((i) => `<div class="card idx" style="margin:0"><small class="mute">${i.name}</small><div class="v num ${cls(i.chg)}">${i.close.toLocaleString('en-US')}</div><div class="c num ${cls(i.chg)}">${arrow(i.chg)} ${Math.abs(i.chg)}（${fp(i.pct)}）</div></div>`).join('')}</div>
      <div class="card" style="margin-top:12px">
        <h3>今天市場<small>${M.otc ? '上市＋上櫃' : '上市'}股票</small></h3>
        <div class="bar3"><i style="width:${(B.up / tot) * 100}%;background:var(--up)"></i><i style="width:${(B.flat / tot) * 100}%;background:var(--line2)"></i><i style="width:${(B.down / tot) * 100}%;background:var(--down)"></i></div>
        <div class="row small"><span class="up">上漲 ${B.up}</span><span class="mute" style="margin:auto">平盤 ${B.flat}</span><span class="down">下跌 ${B.down}</span></div>
        <div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-top:10px;text-align:center">${inst('f', '外資')}${inst('t', '投信')}${inst('d', '自營商')}</div>
        <p class="disc" style="text-align:center;margin-top:4px">三大法人買賣超金額是用收盤價估算的</p>
      </div>
      <div class="card"><h3>族群強弱<small>同產業平均漲跌</small></h3>
        <div class="chips">${M.sectors.slice(0, 6).map((x) => `<span class="chip">${esc(x.ind)} <b class="num up">${fp(x.pct, 1)}</b></span>`).join('')}</div>
        <div class="chips" style="margin-top:6px">${M.sectors.slice(-4).reverse().map((x) => `<span class="chip">${esc(x.ind)} <b class="num ${cls(x.pct)}">${fp(x.pct, 1)}</b></span>`).join('')}</div></div>
      <div class="card"><div class="tabs" id="tabs">${Object.entries(L).map(([k, v]) => `<button data-k="${k}" class="${k === homeTab ? 'on' : ''}">${v}</button>`).join('')}</div><div id="hl"></div>
        <p class="disc">有「解說」標籤的是今天的熱門股，已經準備好白話解說。其他股票打開時才即時整理。</p></div>
      ${disclaimer}`;
    const draw = () => { $('#hl').innerHTML = listHtml(lists[homeTab]().slice(0, 30)); };
    $('#tabs').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; homeTab = k; [...$('#tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.k === k)); draw(); };
    draw();
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
      <div class="card hero">
        <div class="row"><div><div class="nm">${esc(s.n)}</div><small class="mute">${s.c}・${s.m === 'O' ? '上櫃' : '上市'}・${esc(s.ind)}</small></div><button class="star" id="star" title="加入自選">${on ? '⭐' : '☆'}</button></div>
        <div class="px num ${cls(s.pct)}">${s.close}</div><div class="ch num ${cls(s.pct)}">${arrow(s.chg)} ${Math.abs(s.chg)}（${fp(s.pct)}）</div>
        <div class="kv">${kv('成交量', s.vol.toLocaleString('en-US') + ' 張')}${kv('成交值', s.val + ' 億')}${kv('量比', ex?.vr ? ex.vr + ' 倍' : '—')}
          ${kv('外資', fl(s.f), cls(s.f))}${kv('投信', fl(s.t), cls(s.t))}${kv('自營商', fl(s.d), cls(s.d))}</div>
        <p class="disc">法人買賣超單位：張。量比＝今天成交量 ÷ 前 20 天平均。</p>
      </div>
      <div class="card"><h3>📉 近半年走勢</h3><div id="ch">${spin}</div></div>
      <div class="card" id="ex"></div>
      <div class="card" id="deep"></div>
      ${disclaimer}`;
    $('#star').onclick = () => { const add = Core.toggleWatch(S, code); save(); $('#star').textContent = add ? '⭐' : '☆'; toast(add ? '已加入自選' : '已移出自選'); };
    fm('TaiwanStockPrice', { data_id: code, start_date: addDays(M.date, -183) }).then((rows) => { const el = $('#ch'); if (el) el.innerHTML = chart(rows); }).catch((e) => { const el = $('#ch'); if (el) el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
    drawExplain(s); drawDeep(s);
  };

  const lockBox = (s, kind, teaser) => `<div class="lock"><div class="blur">${teaser}</div>
    <button class="btn pri" data-unlock="${kind}">🔓 用 ${Core.ECON.COST[kind]} 點解鎖${Core.KIND_NAME[kind]}</button>
    <div class="cost">你有 ${S.pts} 點・今天看過的，今天內可以免費重看</div></div>`;

  function drawExplain(s) {
    const el = $('#ex'); if (!el) return;
    const word = s.pct > 0 ? '漲' : s.pct < 0 ? '跌' : '沒動';
    const head = `<h3>🤖 為什麼今天${word}？</h3>`;
    if (!Core.isUnlocked(S, s.c, 'explain', M.date)) {
      el.innerHTML = head + lockBox(s, 'explain', `${esc(s.n)}今天${word}的白話解說：和大盤、同產業比起來怎麼樣，成交量是不是異常，外資投信在買還是賣，還有今天的相關新聞…`);
      el.querySelector('[data-unlock]').onclick = () => tryUnlock(s.c, 'explain', () => drawExplain(s));
      return;
    }
    const ex = X.items[s.c];
    const render = (t, ai, tags, news) => {
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
  function drawDeep(s) {
    const el = $('#deep'); if (!el) return;
    const head = '<h3>📑 深度報告<small>籌碼・營收・評價・歷史相似</small></h3>';
    if (!Core.isUnlocked(S, s.c, 'deep', M.date)) {
      el.innerHTML = head + lockBox(s, 'deep', '偏多訊號和偏空訊號各有幾個？外資投信近 20 天的動向、融資有沒有暴增、月營收年增率、本益比貴不貴、歷史上走勢很像的時候之後怎麼走，還有魔鬼代言人的風險清單…');
      el.querySelector('[data-unlock]').onclick = () => tryUnlock(s.c, 'deep', () => drawDeep(s));
      return;
    }
    el.innerHTML = head + spin + '<p class="small mute" style="text-align:center">整理 3 年股價、法人、融資、營收資料中…</p>';
    let p = deepCache.get(s.c);
    if (!p) {
      const d = M.date, q = (start) => ({ data_id: s.c, start_date: start });
      p = Promise.all([
        fm('TaiwanStockPrice', q(addDays(d, -3 * 365))),
        fm('TaiwanStockInstitutionalInvestorsBuySell', q(addDays(d, -45))).catch(() => []),
        fm('TaiwanStockMarginPurchaseShortSale', q(addDays(d, -45))).catch(() => []),
        fm('TaiwanStockMonthRevenue', q(addDays(d, -500))).catch(() => []),
        fm('TaiwanStockPER', q(addDays(d, -365))).catch(() => []),
      ]).then(([prices, inst, margin, rev, per]) => Core.analyze({ prices, inst, margin, rev, per }));
      deepCache.set(s.c, p); p.catch(() => deepCache.delete(s.c));
    }
    p.then((R) => {
      if ($('#deep') !== el) return;
      if (R.error) return (el.innerHTML = head + `<p class="empty">${esc(R.error)}</p>`);
      const tot = R.bull + R.bear || 1;
      const dot = (t) => `<span class="dot" style="background:${t > 0 ? 'var(--up)' : t < 0 ? 'var(--down)' : 'var(--line2)'}"></span>`;
      el.innerHTML = head + `<div class="summary">${esc(R.summary)}</div>
        <div class="meter"><i style="width:${(R.bull / tot) * 100}%;background:var(--up)"></i><i style="width:${(R.bear / tot) * 100}%;background:var(--down)"></i></div>
        <div class="row small" style="margin-bottom:6px"><span class="up">偏多 ${R.bull}</span><span class="down" style="margin-left:auto">偏空 ${R.bear}</span></div>
        ${R.sections.map((x) => `<div class="sec"><h4>${x.icon} ${esc(x.title)}${dot(x.tone)}</h4>${x.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`).join('')}
        <div class="risk"><b>😈 魔鬼代言人：要注意的地方</b><ul>${R.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
        <p class="disc">資料到 ${esc(R.date)}。「偏多／偏空」只是把資料分類，不是叫你買或賣。</p>`;
    }).catch((e) => { el.innerHTML = head + `<p class="empty">${esc(e.message)}</p><button class="btn block" id="dpr">重試（不用再扣點）</button>`; $('#dpr').onclick = () => drawDeep(s); });
  }

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
    const stats = `<div class="card"><div class="stat3"><div><b>${g.n ? Math.round((g.win / g.n) * 100) : 0}%</b><small>答對率（${g.win}/${g.n}）</small></div><div><b>${g.streak}</b><small>目前連對</small></div><div><b>${g.best}</b><small>最多連對</small></div></div></div>`;
    const moreBtn = left > 0 ? `<button class="btn pri block" id="go">${G.phase === 'reveal' ? '下一題' : '開始一題'}（今天還有 ${left} 題）</button>`
      : `<button class="btn gold block" id="more">📺 看廣告再玩 ${Core.ECON.GAME_AD_BONUS} 題</button><p class="disc" style="text-align:center">今天的免費題目用完了</p>`;
    let body = '';
    if (G.phase === 'loading') body = `<div class="card">${spin}<p class="small mute" style="text-align:center">從歷史裡挑一段真實走勢…</p></div>`;
    else if (G.phase === 'ask') {
      body = `<div class="card"><h3>🎯 神秘股票<small>${esc(G.s.ind)}・時間保密</small></h3>${chart(G.rows.slice(0, SHOW), { hide: true })}
        <p style="margin-top:8px">這是某檔台股真實的 ${SHOW} 個交易日走勢。<b>接下來 ${AHEAD} 個交易日</b>，你覺得會漲還是跌？</p>
        <div class="qbtns"><button class="u" data-g="1">📈 會漲</button><button class="d" data-g="-1">📉 會跌</button></div></div>`;
    } else if (G.phase === 'reveal') {
      const a = G.rows[SHOW - 1].close, b = G.rows[SHOW + AHEAD - 1].close, r = (b / a - 1) * 100, win = (r > 0 ? 1 : -1) === G.pick;
      body = `<div class="card"><div class="result"><div class="big ${win ? 'up' : 'down'}">${win ? '🎉 答對了！' : '😵 答錯了'}</div>
        <p>${esc(G.s.n)}（${G.s.c}）<br><span class="mute small">${G.rows[0].date} ～ ${G.rows[SHOW + AHEAD - 1].date}</span></p>
        <p>虛線之後 ${AHEAD} 個交易日：<b class="num ${cls(r)}">${fp(r, 1)}</b>（${a} → ${b} 元）</p></div>
        ${chart(G.rows, { split: SHOW - 1 })}
        <p class="disc">股價短期走勢很難猜，答對率能長期贏過 50% 已經不容易。想知道現在的情況，可以看個股的「深度報告」。</p>
        <a class="btn block" href="#s/${G.s.c}" style="margin-top:8px">看 ${esc(G.s.n)} 現在的資料</a></div>`;
    } else body = `<div class="card"><h3>🎯 歷史盲測</h3><p class="sub">從台股過去的真實走勢隨機挑一段，把股票名稱和日期遮起來，讓你猜之後會漲還是跌，答完才揭曉。用來測試自己看圖的直覺準不準。</p>${G.err ? `<p class="small" style="color:var(--gold);margin-top:6px">${esc(G.err)}</p>` : ''}</div>`;
    $('#view').innerHTML = body + (G.phase === 'ask' || G.phase === 'loading' ? '' : moreBtn) + `<div style="height:12px"></div>` + stats;
    G.err = '';
    const go = $('#go'); if (go) go.onclick = newRound;
    const more = $('#more'); if (more) more.onclick = async () => {
      const r = await Ads.rewarded('game');
      if (r === 'completed' || r === 'nofill' || r === 'error') { Core.gameAdBonus(S); save(); toast(r === 'completed' ? `多 ${Core.ECON.GAME_AD_BONUS} 題` : '廣告播不出來，這次直接送你'); }
      V.game();
    };
    for (const b of document.querySelectorAll('[data-g]')) b.onclick = () => {
      G.pick = +b.dataset.g; const a = G.rows[SHOW - 1].close, z = G.rows[SHOW + AHEAD - 1].close;
      Core.gameResult(S, (z > a ? 1 : -1) === G.pick); save(); G.phase = 'reveal'; V.game();
    };
  };

  V.me = () => {
    top();
    const E = Core.ECON, left = Core.adsLeft(S);
    $('#view').innerHTML = `
      <div class="card wallet"><small class="mute">我的點數</small><div class="big num">${S.pts}</div>
        <div style="display:grid;gap:8px;margin-top:14px">
          <button class="btn gold block" id="ad" ${left ? '' : 'disabled'}>📺 看廣告 +${E.AD_REWARD} 點${left ? `（今天還有 ${left} 次）` : '（今天用完了）'}</button>
          <button class="btn block" id="ci" ${Core.canCheckin(S) ? '' : 'disabled'}>📅 每日簽到 +${E.CHECKIN} 點${Core.canCheckin(S) ? '' : '（今天簽過了）'}</button>
        </div></div>
      <div class="card"><h3>點數怎麼用</h3><table class="rules">
        <tr><td>🤖 白話解說：今天為什麼漲跌</td><td>${E.COST.explain} 點</td></tr>
        <tr><td>📑 深度報告：籌碼、營收、評價、歷史相似、風險</td><td>${E.COST.deep} 點</td></tr>
        <tr><td>🔍 查股價、走勢、法人、自選股</td><td>免費</td></tr>
        <tr><td>🎯 歷史盲測</td><td>每天 ${E.GAME_FREE} 題免費</td></tr></table>
        <p class="disc">同一檔股票的同一份報告，當天看過可以免費重看。新朋友送 ${E.START} 點。</p></div>
      <div class="card"><h3>點數紀錄</h3><div class="loglist">${S.log.slice(0, 15).map((l) => `<div><span>${esc(l.why)}<small class="mute"> ${new Date(l.t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span><b class="num ${l.d > 0 ? 'up' : l.d < 0 ? 'down' : 'mute'}">${l.d > 0 ? '+' : ''}${l.d}</b></div>`).join('') || '<p class="empty">還沒有紀錄</p>'}</div></div>
      ${DEV ? `<div class="card"><h3>🛠 開發者</h3><p class="small mute">假廣告模式</p><select id="am" class="btn block" style="margin:6px 0">${Object.entries(Ads.MODES).map(([k, v]) => `<option value="${k}" ${Ads.mode() === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <div class="grid2"><button class="btn" id="p50">+50 點</button><button class="btn" id="rst">清除所有資料</button></div>
        <p class="small mute" style="margin-top:8px">廣告看完 ${S.stats.adsDone}・中途關掉 ${S.stats.adsSkip}・沒廣告 ${S.stats.adsNofill}・插頁 ${S.stats.inter}・花掉 ${S.stats.spent} 點・查詢 ${S.opens} 次</p></div>` : ''}
      <div class="card"><h3>關於</h3><p class="small sub">股市白話通用白話告訴你股票今天為什麼漲跌。資料每個交易日收盤後更新${M ? `，目前是 ${M.date} 的資料` : ''}。</p>${disclaimer}</div>`;
    $('#ad').onclick = async () => { await watchAd(); V.me(); };
    $('#ci').onclick = () => { const r = Core.checkin(S); save(); if (r.ok) { bump(); toast(`+${r.got} 點`); } V.me(); };
    if (DEV) {
      $('#am').onchange = (e) => Ads.setMode(e.target.value);
      $('#p50').onclick = () => { S.pts += 50; save(); V.me(); };
      $('#rst').onclick = () => { const m = modal('<h2>清除所有資料？</h2><p class="sub">點數、自選股、紀錄都會清掉。</p><div class="grid2" style="margin-top:14px"><button class="btn" data-a="n">取消</button><button class="btn pri" data-a="y">清除</button></div>'); m.onclick = (e) => { const a = e.target.dataset?.a; if (a === 'y') { S = Core.newState(); save(); m.remove(); V.me(); } if (a === 'n') m.remove(); }; };
    }
  };

  // ───── 路由 ─────
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)) || 'home';
    const [r, arg] = h.split('/');
    curRoute = h;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r || (r === 's' && a.dataset.r === 'search')));
    window.scrollTo(0, 0);
    (V[r] || V.home)(arg);
  }
  window.addEventListener('hashchange', route);
  route();
  loadData().then(route);
  Ads.preload();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol) && !Ads.isNative()) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__app = { get S() { return S; }, get M() { return M; }, Core };
})();
