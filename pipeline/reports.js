// 盤後 AI 報告（build.js 最後呼叫）：
//   data/daily.json   AI 盤後日報（每天 1 篇，免費看）
//   data/reports.json AI 個股報告書（成交值前 100 檔，FinMind 額度內輪流更新；每篇有規則版分析＋AI 結論）
//   data/hist.json    概念股成員的收盤價（最近 12 個交易日），算週漲跌用
//   data/weekly.json  概念股 AI 週報（每週五產生；12 個族群各一段＋總覽）
const fs = require('fs'), path = require('path');
const Core = require('../core.js');
const DATA = path.join(__dirname, '..', 'data');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o));
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const first = (t) => String(t || '').split(/(?<=。)/)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. 盤後日報 ──
async function daily({ date, market, stocks, explain, groq, log }) {
  const old = read('daily.json', {});
  if (old.date === date && old.ai) { log('盤後日報：今天已經有 AI 版'); return; }
  const fp = (p) => Core.fmtPct(p);
  const ix = market.index || [];
  const byVal = [...stocks].sort((a, b) => b.val - a.val);
  const ex = explain.items || {};
  const hot = byVal.slice(0, 5);
  const movers = [...byVal.slice(0, 30)].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 6);
  const notes = [...new Map([...hot, ...movers].map((s) => [s.c, s])).values()].filter((s) => ex[s.c]?.ai).slice(0, 8)
    .map((s) => `${s.n}（${fp(s.pct)}）：${first(ex[s.c].t)}`);
  const news = [...new Set(Object.values(ex).flatMap((x) => (x.news || []).slice(0, 2).map((n) => n.title)))].slice(0, 10);
  const f = {
    date, taiex: ix[0] ? `${ix[0].close}（${fp(ix[0].pct)}）` : '無資料', otc: ix[1] ? `${ix[1].close}（${fp(ix[1].pct)}）` : '',
    up: market.breadth.up, down: market.breadth.down, flat: market.breadth.flat, inst: market.inst,
    strong: market.sectors.slice(0, 4).map((x) => `${x.ind}${fp(x.pct)}`).join('、'), weak: market.sectors.slice(-3).reverse().map((x) => `${x.ind}${fp(x.pct)}`).join('、'),
    hot: hot.map((s) => `${s.n}${fp(s.pct)}`).join('、'), notes, news,
  };
  // 規則版（沒有 AI 或 AI 不合格時用）
  const w = (v) => (v >= 0 ? '買超' : '賣超');
  const rule = {
    title: ix[0] ? `加權指數${ix[0].pct >= 0 ? '上漲' : '下跌'} ${Math.abs(ix[0].pct)}%` : '今日台股',
    text: `加權指數收 ${f.taiex}，上漲 ${f.up} 家、下跌 ${f.down} 家。三大法人中，外資${w(f.inst.f)}約 ${Math.abs(Math.round(f.inst.f))} 億、投信${w(f.inst.t)}約 ${Math.abs(Math.round(f.inst.t))} 億。強勢族群是${f.strong}；弱勢族群是${f.weak}。成交值最大的是${f.hot}。`,
  };
  let out = null;
  if (groq) { const t = await groq(Core.dailyPrompt(f), 900); out = Core.parseDaily(t); if (!out && t) log('  日報 AI 不合格：', t.slice(0, 80)); }
  write('daily.json', { date, ai: !!out, ...(out || rule), hot: hot.map((s) => s.c), focus: notes.length ? [...new Map([...hot, ...movers].map((s) => [s.c, s])).values()].filter((s) => ex[s.c]?.ai).slice(0, 6).map((s) => s.c) : [] });
  log('盤後日報：', out ? 'AI' : '規則版', (out || rule).title);
}

// ── 2. 個股報告書 ──
async function stockReports({ date, stocks, fm, groq, log, budget }) {
  const old = read('reports.json', { items: {} });
  const items = {};
  // 舊的報告保留 10 天（還沒輪到更新的股票先給舊的，畫面會寫報告日期）
  for (const [c, x] of Object.entries(old.items || {})) if (x.d >= addDays(date, -10)) items[c] = x;
  const top = stocks.filter((s) => /^[1-9]\d{3}$/.test(s.c)).sort((a, b) => b.val - a.val).slice(0, 100);
  // 今天還沒做的排前面；同樣沒做的，越久沒更新越前面，再照成交值
  const todo = top.filter((s) => items[s.c]?.d !== date).sort((a, b) => (items[a.c]?.d || '') .localeCompare(items[b.c]?.d || '') || b.val - a.val);
  let calls = 0, made = 0, aiN = 0;
  for (const s of todo) {
    if (calls + 5 > budget) break;
    try {
      const q = (start) => ({ data_id: s.c, start_date: start });
      calls += 5;
      const [prices, inst, margin, rev, per] = await Promise.all([
        fm('TaiwanStockPrice', q(addDays(date, -3 * 365))), fm('TaiwanStockInstitutionalInvestorsBuySell', q(addDays(date, -45))).catch(() => []),
        fm('TaiwanStockMarginPurchaseShortSale', q(addDays(date, -45))).catch(() => []), fm('TaiwanStockMonthRevenue', q(addDays(date, -500))).catch(() => []),
        fm('TaiwanStockPER', q(addDays(date, -365))).catch(() => []),
      ]);
      const R = Core.analyze({ prices, inst, margin, rev, per });
      if (R.error) { log('  報告書略過', s.c, R.error); continue; }
      let ai = null;
      if (groq) { const t = Core.aiClean(await groq(Core.reportPrompt(s.n, s.c, R), 900)); if (Core.aiOk(t, 360, 60)) ai = t; else if (t) log('  報告書 AI 不合格', s.c, t.slice(0, 50)); }
      const { similar, ...keep } = R; // similar 的細節 App 用不到
      items[s.c] = { d: date, ai, R: keep };
      made++; if (ai) aiN++;
      log(`報告書 ${made} ${s.c} ${s.n} ${ai ? 'AI' : '規則'}（FinMind ${calls}/${budget}）`);
    } catch (e) {
      log('  報告書失敗', s.c, e.message);
      if (/limit|upper|402|次數/i.test(e.message)) { log('  FinMind 額度用完，下次再補'); break; }
    }
    await sleep(800);
  }
  write('reports.json', { date, items });
  log(`個股報告書：今天新做 ${made} 篇（AI ${aiN}），共 ${Object.keys(items).length} 篇`);
  return calls;
}

// ── 3. 概念股：每天記收盤價 → 每週五寫週報 ──
async function weekly({ date, all, explain, groq, log, fm, budget }) {
  const codes = [...new Set(Core.GROUPS.flatMap((g) => g.codes))];
  const hist = read('hist.json', { dates: [], c: {} });
  let calls = 0;
  // 第一次（或中斷太久）：用 FinMind 補最近 12 個交易日
  if (hist.dates.length < 6 || hist.dates[hist.dates.length - 1] < addDays(date, -10)) {
    log('概念股歷史收盤：從 FinMind 補');
    const dates = new Set(), c = {};
    for (const code of codes) {
      if (calls + 1 > budget) break;
      calls++;
      try { const rows = await fm('TaiwanStockPrice', { data_id: code, start_date: addDays(date, -24), end_date: date }); c[code] = Object.fromEntries(rows.map((r) => [r.date, r.close])); rows.forEach((r) => dates.add(r.date)); } catch (e) { log('  補收盤失敗', code, e.message); }
      await sleep(300);
    }
    hist.dates = [...dates].sort().slice(-12);
    hist.c = Object.fromEntries(Object.entries(c).map(([k, m]) => [k, hist.dates.map((d) => m[d] ?? null)]));
  }
  if (!hist.dates.includes(date)) {
    hist.dates.push(date);
    for (const code of codes) (hist.c[code] ||= Array(hist.dates.length - 1).fill(null)).push(all[code]?.close ?? null);
    while (hist.dates.length > 12) { hist.dates.shift(); for (const k in hist.c) hist.c[k].shift(); }
  } else {
    const i = hist.dates.indexOf(date); for (const code of codes) if (all[code]) (hist.c[code] ||= Array(hist.dates.length).fill(null))[i] = all[code].close;
  }
  write('hist.json', hist);

  // 週報：資料日是星期五，或週報超過 8 天沒更新
  const wk = Core.weekKey(date), old = read('weekly.json', {});
  const friday = new Date(Date.parse(date)).getUTCDay() === 5;
  if (old.week === wk && old.date === date && old.ai) { log('概念股週報：這週已經有了'); return calls; }
  if (!friday && old.date && old.date >= addDays(date, -8)) { log('概念股週報：星期五才寫'); return calls; }
  const names = Object.fromEntries(Object.values(all).map((s) => [s.c, s.n]));
  const ex = explain.items || {};
  const groups = [];
  let aiN = 0;
  for (const g of Core.GROUPS) {
    const r = Core.groupWeek(g, hist, names, 5); if (!r) continue;
    r.notes = r.members.filter((m) => ex[m[0]]?.ai).slice(0, 3).map((m) => `${m[1]}：${first(ex[m[0]].t)}`);
    const best = r.members[0], worst = r.members[r.members.length - 1];
    let text = `近 5 個交易日平均${r.pct5 >= 0 ? '上漲' : '下跌'} ${Math.abs(r.pct5).toFixed(1)}%，最強是${best[1]}（${Core.fmtPct(best[2])}），最弱是${worst[1]}（${Core.fmtPct(worst[2])}）。`, ai = false;
    if (groq) { const t = Core.aiClean(await groq(Core.groupPrompt(r), 600)); if (Core.aiOk(t, 220, 30)) { text = t; ai = true; aiN++; } }
    groups.push({ id: r.id, name: r.name, from: r.from, to: r.to, pct5: Math.round(r.pct5 * 100) / 100, members: r.members.map((m) => [m[0], m[1], Math.round(m[2] * 100) / 100]), text, ai });
  }
  groups.sort((a, b) => b.pct5 - a.pct5);
  const sum = groups.length ? `這週最強的族群是${groups[0].name}（${Core.fmtPct(groups[0].pct5)}），最弱的是${groups[groups.length - 1].name}（${Core.fmtPct(groups[groups.length - 1].pct5)}）。` : '';
  write('weekly.json', { week: wk, date, ai: aiN > 0, summary: sum, groups });
  log(`概念股週報 ${wk}：${groups.length} 個族群（AI ${aiN}）`);
  return calls;
}

module.exports = { daily, stockReports, weekly };
