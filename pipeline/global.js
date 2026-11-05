// 美股、陸股共用的盤後資料產生器：吃整理好的日 K，寫出 App 要的檔案到 data/us/ 或 data/cn/
//   market.json  全部股票今天的行情（欄位跟台股一樣，三大法人那三欄是空的）
//   chart.json   每檔近半年收盤價和成交量（個股走勢圖、沒有預先做好的解說用）
//   explain.json 熱門股的白話解說（有 Groq 金鑰就用 AI）
//   daily.json   AI 盤後日報
//   reports.json AI 個股報告書（成交值前 REPORTS 檔，輪流更新，舊的留 10 天）
// 輸入 raw：{ mkt, date, scope, indexes:[{ name, k:[[date, close, pct]] }],
//             stocks:[{ c, n, ind, ex, etf, cap(億), k:[{ date, open, max, min, close, Trading_Volume, amt, pct, PER, PBR }] }],
//             news: async (stock) => [{ title, link, src, d }] }
const fs = require('fs'), path = require('path');
const Core = require('../core.js');
const { groq, GROQ_KEY, modelName, log, sleep } = require('./ai.js');

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null), r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null);
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const first = (t) => String(t || '').split(/(?<=。)/)[0];
const pct = (a, b) => (b ? (a / b - 1) * 100 : NaN);

async function build(raw, opt = {}) {
  const { mkt, date } = raw, G = Core.MARKETS[mkt];
  const DIR = path.join(__dirname, '..', 'data', mkt);
  fs.mkdirSync(DIR, { recursive: true });
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
  const write = (f, o) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(o));
  const LIMIT = opt.explain ?? 50, REPORTS = opt.reports ?? 60, REPORT_AI = opt.reportAi ?? 30;

  // 1. 今天的行情（最後一根 K 棒是今天的才算有交易）
  const all = [];
  for (const s of raw.stocks) {
    const k = s.k.filter((r) => r.close > 0);
    const L = k[k.length - 1];
    if (!L || L.date !== date) continue;
    const prev = k[k.length - 2];
    const p = Number.isFinite(L.pct) ? L.pct : prev ? pct(L.close, prev.close) : NaN;
    const chg = prev ? L.close - prev.close : (L.close * p) / (100 + p);
    all.push({ ...s, k, close: L.close, chg, pct: p, vol: L.Trading_Volume, val: (L.amt || L.close * L.Trading_Volume) / 1e8 });
  }
  if (all.length < 50) throw new Error(`${G.name} ${date} 只有 ${all.length} 檔有資料`);
  const stocks = all.filter((s) => !s.etf);
  const breadth = { up: stocks.filter((s) => s.pct > 0.001).length, down: stocks.filter((s) => s.pct < -0.001).length };
  breadth.flat = stocks.length - breadth.up - breadth.down;
  const agg = {};
  for (const s of stocks) { const a = (agg[s.ind] ||= { t: 0, k: 0 }); a.t += s.pct; a.k++; }
  const indAvg = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { pct: v.t / v.k, n: v.k }]));
  const sectors = Object.entries(indAvg).filter(([k, v]) => v.n >= 3 && k !== '其他').map(([k, v]) => ({ ind: k, pct: r2(v.pct), n: v.n })).sort((a, b) => b.pct - a.pct);
  const index = raw.indexes.filter((x) => x.k.length >= 2 && x.k[x.k.length - 1][0] === date).map((x) => {
    const L = x.k[x.k.length - 1], P = x.k[x.k.length - 2];
    return { name: x.name, close: r2(L[1]), chg: r2(L[1] - P[1]), pct: r2(Number.isFinite(L[2]) ? L[2] : pct(L[1], P[1])) };
  });
  const main = raw.indexes[0];
  const taiex = main.k.filter((r) => r[0] >= addDays(date, -92)).map((r) => [r[0], r2(r[1]), 0]); // 首頁畫線用（欄位名稱沿用台股）
  log(`${G.name} ${date}：${all.length} 檔，漲 ${breadth.up} 跌 ${breadth.down}；${index.map((i) => i.name + ' ' + Core.fmtPct(i.pct)).join('、')}`);

  const market = {
    mkt, date, updated: new Date().toISOString(), scope: raw.scope, index, breadth, taiex, sectors,
    cols: ['c', 'n', 'm', 'ind', 'close', 'chg', 'pct', 'vol', 'val', 'f', 't', 'd', 'cap', 'en'], // en＝英文名稱（美股，搜尋用）
    rows: all.sort((a, b) => a.c.localeCompare(b.c)).map((s) => [s.c, s.n, s.ex || '', s.etf ? 'ETF' : s.ind, r2(s.close), r2(s.chg), r2(s.pct), r0(s.vol), r2(s.val), null, null, null, r0(s.cap), s.en || null]),
  };

  // 2. 走勢圖：近 125 個交易日（日期共用一份，股票只存收盤價和成交量）
  const dates = main.k.map((r) => r[0]).filter((d) => d <= date).slice(-125);
  const chart = { date, dates, c: {}, v: {} };
  for (const s of all) {
    const m = new Map(s.k.map((r) => [r.date, r]));
    chart.c[s.c] = dates.map((d) => (m.has(d) ? r2(m.get(d).close) : null));
    chart.v[s.c] = dates.map((d) => (m.has(d) ? r0(m.get(d).Trading_Volume / 100) : null)); // 單位：百股
  }

  // 3. 白話解說：成交值前 25 ＋ 漲幅前 13 ＋ 跌幅前 12（成交值太小的不算）
  const byVal = [...stocks].sort((a, b) => b.val - a.val);
  const liquid = byVal.slice(0, Math.max(60, Math.round(byVal.length * 0.4)));
  const pick = [...new Map([...byVal.slice(0, 25), ...[...liquid].sort((a, b) => b.pct - a.pct).slice(0, 13), ...[...liquid].sort((a, b) => a.pct - b.pct).slice(0, 12)].map((s) => [s.c, s])).values()].slice(0, LIMIT);
  const mktPct = index[0]?.pct;
  let prev = {}; { const e = read('explain.json', {}); if (e.date === date) prev = e.items || {}; }
  const items = {}; let aiN = 0, ruleN = 0;
  for (const [i, s] of pick.entries()) {
    if (prev[s.c]?.ai) { items[s.c] = prev[s.c]; aiN++; continue; }
    const k = s.k, n = k.length, vols = k.slice(-21, -1).map((r) => r.Trading_Volume);
    const v20 = vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
    const news = raw.news ? await raw.news(s).catch((e) => (log('  新聞失敗', s.c, e.message), [])) : [];
    const ia = indAvg[s.ind] || {};
    const ctx = { mkt, code: s.c, name: s.n, close: r2(s.close), chg: s.chg, pct: s.pct, cur: G.cur, limit: s.limit ?? G.limit, volRatio: v20 ? s.vol / v20 : NaN,
      r5: n > 5 ? pct(s.close, k[n - 6].close) : NaN, r20: n > 20 ? pct(s.close, k[n - 21].close) : NaN, mktPct, ind: s.ind, indPct: ia.pct, indN: ia.n, news };
    const rule = Core.explainRule(ctx);
    let text = rule.text, ai = false;
    if (GROQ_KEY) {
      const t = Core.aiClean(await groq(Core.aiPrompt(ctx)));
      if (Core.aiOk(t)) { text = t; ai = true; } else if (t) log('  AI 回答不合格，改用規則版：', t.slice(0, 60));
    }
    ai ? aiN++ : ruleN++;
    items[s.c] = { t: text, ai, tags: rule.tags, vr: Number.isFinite(ctx.volRatio) ? Math.round(ctx.volRatio * 10) / 10 : null, news: news.slice(0, 5) };
    log(`${G.name}解說 ${i + 1}/${pick.length} ${s.c} ${s.n} ${Core.fmtPct(s.pct)} ${ai ? 'AI' : '規則'}`);
  }

  write('market.json', market);
  write('chart.json', chart);
  write('explain.json', { date, updated: market.updated, model: aiN ? modelName() : 'rule', items });
  log(`${G.name}：行情 ${all.length} 檔、解說 AI ${aiN}／規則 ${ruleN}`);

  // 4. 盤後日報
  try {
    const old = read('daily.json', {});
    if (old.date === date && old.ai) log(`${G.name}日報：今天已經有 AI 版`);
    else {
      const hot = byVal.slice(0, 5), movers = [...byVal.slice(0, 30)].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 6);
      const focus = [...new Map([...hot, ...movers].map((s) => [s.c, s])).values()].filter((s) => items[s.c]);
      const fp = (p) => Core.fmtPct(p);
      const f = {
        mkt, date, scope: raw.scope, up: breadth.up, down: breadth.down, flat: breadth.flat,
        // 美股的指數是用 ETF 代表 → 只給漲跌幅（給價格的話 AI 會把 ETF 價格寫成指數點數）
        idx: index.map((i) => (mkt === 'us' ? `${i.name.replace(/（(\w+)）/, '（用 $1 ETF 代表）')} ${fp(i.pct)}` : `${i.name} ${i.close}（${fp(i.pct)}）`)).join('、'),
        strong: sectors.slice(0, 4).map((x) => `${x.ind}${fp(x.pct)}`).join('、'), weak: sectors.slice(-3).reverse().map((x) => `${x.ind}${fp(x.pct)}`).join('、'),
        hot: hot.map((s) => `${s.n}${fp(s.pct)}`).join('、'),
        notes: focus.slice(0, 8).map((s) => `${s.n}（${fp(s.pct)}）：${first(items[s.c].t)}`),
        news: [...new Set(Object.values(items).flatMap((x) => (x.news || []).slice(0, 2).map((n) => n.title)))].slice(0, 10),
      };
      const i0 = index[0];
      const rule = {
        title: i0 ? `${i0.name}${i0.pct >= 0 ? '上漲' : '下跌'} ${Math.abs(i0.pct)}%` : `今日${G.name}`,
        text: `${f.idx}。收錄的 ${stocks.length} 檔中上漲 ${f.up} 家、下跌 ${f.down} 家。強勢產業是${f.strong}；弱勢產業是${f.weak}。成交值最大的是${f.hot}。`,
      };
      let out = null;
      if (GROQ_KEY) { const t = await groq(Core.dailyPromptG(f), 900); out = Core.parseDaily(t); if (!out && t) log('  日報 AI 不合格：', t.slice(0, 80)); }
      write('daily.json', { date, ai: !!out, ...(out || rule), hot: hot.map((s) => s.c), focus: focus.slice(0, 6).map((s) => s.c) });
      log(`${G.name}日報：`, out ? 'AI' : '規則版', (out || rule).title);
    }
  } catch (e) { log(`${G.name}日報失敗`, e.message); }

  // 5. 個股報告書：成交值前 REPORTS 檔。今天沒做過的先做；AI 結論每天最多 REPORT_AI 篇（越久沒更新越先）
  try {
    const old = read('reports.json', { items: {} }), out = {};
    for (const [c, x] of Object.entries(old.items || {})) if (x.d >= addDays(date, -10)) out[c] = x;
    const top = byVal.slice(0, REPORTS);
    // 今天還沒做的、或今天做了但沒有 AI 結論的（例如先用 --no-ai 跑過）
    const todo = top.filter((s) => out[s.c]?.d !== date || !out[s.c]?.ai).sort((a, b) => (out[a.c]?.d || '').localeCompare(out[b.c]?.d || '') || b.val - a.val);
    let made = 0, aiN2 = 0;
    for (const s of todo) {
      if (out[s.c]?.d === date && !(GROQ_KEY && aiN2 < REPORT_AI)) continue; // 今天已經有程式版、AI 額度也用完 → 不用重做
      const per = s.k.filter((r) => r.PER > 0).slice(-245).map((r) => ({ date: r.date, PER: r2(r.PER), PBR: r.PBR > 0 ? r2(r.PBR) : null }));
      const R = Core.analyze({ prices: s.k, per, cur: G.cur, volFmt: Core.fmtShares });
      if (R.error) continue;
      let ai = null;
      if (GROQ_KEY && aiN2 < REPORT_AI) {
        const t = Core.aiClean(await groq(Core.reportPrompt(s.n, s.c, R, mkt), 900));
        if (Core.aiOk(t, 360, 60)) { ai = t; aiN2++; } else if (t) log('  報告書 AI 不合格', s.c, t.slice(0, 50));
      }
      if (!ai && out[s.c]?.ai && out[s.c].d >= addDays(date, -3)) continue; // 這次沒額度寫 AI：3 天內的舊 AI 版先留著
      const { similar, ...keep } = R;
      out[s.c] = { d: date, ai, R: keep };
      made++;
      if (ai) log(`${G.name}報告書 ${made} ${s.c} ${s.n} AI`);
    }
    write('reports.json', { date, items: out });
    log(`${G.name}個股報告書：今天新做 ${made} 篇（AI ${aiN2}），共 ${Object.keys(out).length} 篇`);
  } catch (e) { log(`${G.name}報告書失敗`, e.message); }
  return market;
}

module.exports = { build, sleep };
