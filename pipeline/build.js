// 台股每日資料程式（2026-11-05 起：全部改用「政府資料開放授權條款」的開放資料）
//   來源：臺灣證券交易所 OpenAPI（openapi.twse.com.tw）、證券櫃檯買賣中心 OpenAPI（tpex.org.tw/openapi）
//   授權：政府資料開放授權條款第 1 版，免費、可商用，**一定要標示資料提供機關**（App 和網站的免責聲明有寫）
//   不再用：證交所網站版（條款禁止程式自動下載）、FinMind 免費版（商用要付費）、上市個股三大法人（證交所付費資料）
//
// 開放資料只有「最新一天」→ 每次執行都把抓到的資料依日期存到 store/tw/days/（會上傳 GitHub，累積歷史）
//   走勢圖、量比、報告書、週報都用這份自己累積的歷史；剛開始幾週資料會比較短
// 證交所的開放資料比櫃買晚更新（晚上 8 點還是前一天的）→ 以證交所的日期為準，櫃買用同一天存下來的那份
//
// 產生 data/：market.json、explain.json、daily.json、weekly.json、hist.json、reports.json、chart.json
// 用法：node pipeline/build.js [--limit 70] [--no-ai] [--no-reports]
const fs = require('fs'), path = require('path');
const Core = require('../core.js');
const Reports = require('./reports.js');
const { groq, GROQ_KEY, GROQ_MODEL, modelName, log, sleep, arg } = require('./ai.js');

const ROOT = path.join(__dirname, '..'), DATA = path.join(ROOT, 'data');
const STORE = path.join(ROOT, 'store', 'tw'), DAYS = path.join(STORE, 'days');
for (const d of [DATA, DAYS]) fs.mkdirSync(d, { recursive: true });
const LIMIT = +arg('limit', 70);
const n = Core.num;
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wj = (f, o) => fs.writeFileSync(f, JSON.stringify(o));
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
// 民國 1151104 → 2026-11-04；西元 20261104 → 2026-11-04
const ad = (s) => { s = String(s || '').trim(); if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`; const m = s.match(/^(\d{2,3})(\d{2})(\d{2})$/); return m ? `${+m[1] + 1911}-${m[2]}-${m[3]}` : null; };
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null), r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null);

async function get(url, { tries = 3, json = true } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'gushi-baihua daily build (open data)' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      if (!json) return t;
      return JSON.parse(t);
    } catch (e) {
      if (i >= tries) throw new Error(`${url.slice(0, 90)}：${e.message}`);
      await sleep(4000 * i);
    }
  }
}
const TW = 'https://openapi.twse.com.tw/v1', TP = 'https://www.tpex.org.tw/openapi/v1';
const isStock = (c) => /^[1-9]\d{3}$/.test(c);
const isEtf = (c) => /^00\d{2,4}[A-Z]?$/.test(c);
const keep = (c) => isStock(c) || isEtf(c);

// 證交所／櫃買的官方產業代碼
const IND = { '01': '水泥', '02': '食品', '03': '塑膠', '04': '紡織', '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙', '10': '鋼鐵', '11': '橡膠', '12': '汽車', '14': '建材營造', '15': '航運', '16': '觀光餐旅', '17': '金融保險', '18': '貿易百貨', '19': '綜合', '20': '其他', '21': '化學', '22': '生技醫療', '23': '油電燃氣', '24': '半導體', '25': '電腦週邊', '26': '光電', '27': '通信網路', '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意', '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活', '80': '管理股票', '91': '存託憑證' };

// ── 1. 抓開放資料，依日期存起來 ──
// 一天一個檔：{ L: {代號: [名稱, 收, 漲跌, 股數, 金額, 高, 低]}, O: {代號: [名稱, 收, 漲跌, 股數, 金額, 高, 低, 外資, 投信, 自營(張)]},
//              pe: {代號: [本益比, 殖利率, 淨值比]}, mg: {代號: 融資餘額(張)}, ix: { taiex: [收, 漲跌, %], otc: [...] }, oInst: {f,t,d}(億) }
function mergeDay(date, part) {
  if (!date) return;
  const f = path.join(DAYS, date + '.json'), o = rj(f, {});
  for (const [k, v] of Object.entries(part)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(o[k] || {}), ...v } : v;
  wj(f, o);
}
async function fetchAll() {
  const got = {};
  const safe = async (name, fn) => { try { await fn(); } catch (e) { log(`  ${name} 失敗：`, e.message); } };
  // 上市行情
  await safe('上市行情', async () => {
    const a = await get(`${TW}/exchangeReport/STOCK_DAY_ALL`);
    const date = ad(a[0]?.Date), L = {};
    for (const r of a) { const c = String(r.Code).trim(); if (!keep(c)) continue; const close = n(r.ClosingPrice); if (!(close > 0)) continue;
      L[c] = [String(r.Name).trim(), close, n(r.Change) || 0, n(r.TradeVolume), n(r.TradeValue), n(r.HighestPrice) || close, n(r.LowestPrice) || close]; }
    if (Object.keys(L).length > 500) { mergeDay(date, { L }); got.L = date; }
  });
  // 上市指數（加權指數）
  await safe('上市指數', async () => {
    const a = await get(`${TW}/exchangeReport/MI_INDEX`);
    const t = a.find((x) => x['指數'] === '發行量加權股價指數'); if (!t) return;
    const sign = /-/.test(t['漲跌']) ? -1 : 1;
    mergeDay(ad(t['日期']), { ix: { taiex: [n(t['收盤指數']), sign * n(t['漲跌點數']), sign * Math.abs(n(t['漲跌百分比']))] } });
  });
  // 加權指數本月每天收盤（首頁走勢線第一次補資料用）
  await safe('加權指數本月', async () => {
    for (const r of await get(`${TW}/exchangeReport/FMTQIK`)) { const d = ad(r.Date); if (d) mergeDay(d, { ix: { taiexClose: n(r.TAIEX), turnover: n(r.TradeValue) } }); }
  });
  // 上市本益比、殖利率、淨值比；融資餘額
  await safe('上市本益比', async () => {
    const a = await get(`${TW}/exchangeReport/BWIBBU_ALL`); const date = ad(a[0]?.Date), pe = {};
    for (const r of a) pe[String(r.Code).trim()] = [n(r.PEratio) || null, n(r.DividendYield) || null, n(r.PBratio) || null];
    mergeDay(date, { pe });
  });
  await safe('上市融資', async () => {
    const a = await get(`${TW}/exchangeReport/MI_MARGN`), mg = {};
    for (const r of a) { const c = String(r['股票代號']).trim(); if (keep(c)) mg[c] = n(r['融資今日餘額']); }
    if (got.L) mergeDay(got.L, { mg }); // 這份沒有日期欄位：跟上市行情同一天
  });
  // 上櫃行情
  await safe('上櫃行情', async () => {
    const a = await get(`${TP}/tpex_mainboard_daily_close_quotes`);
    const date = ad(a[0]?.Date), O = {};
    for (const r of a) { const c = String(r.SecuritiesCompanyCode).trim(); if (!keep(c)) continue; const close = n(r.Close), chg = n(r.Change); if (!(close > 0) || !Number.isFinite(chg)) continue;
      O[c] = [String(r.CompanyName).trim(), close, chg, n(r.TradingShares), n(r.TransactionAmount), n(r.High) || close, n(r.Low) || close, null, null, null]; }
    if (Object.keys(O).length > 300) { mergeDay(date, { O }); got.O = date; }
  });
  // 上櫃三大法人（開放資料）
  await safe('上櫃三大法人', async () => {
    const a = await get(`${TP}/tpex_3insti_daily_trading`); const date = ad(a[0]?.Date);
    const day = rj(path.join(DAYS, date + '.json'), {}); if (!day.O) return;
    for (const r of a) {
      const c = String(r.SecuritiesCompanyCode).trim(), o = day.O[c]; if (!o) continue;
      const keys = Object.keys(r), k = (re) => n(r[keys.find((x) => re.test(x.replace(/\s/g, '')))]);
      o[7] = k(/^ForeignInvestorsIncludeMainlandAreaInvestors-Difference/) / 1000; o[8] = k(/^SecuritiesInvestmentTrustCompanies-Difference/) / 1000; o[9] = k(/^Dealers-Difference/) / 1000;
    }
    mergeDay(date, { O: day.O });
  });
  await safe('上櫃三大法人金額', async () => {
    const a = await get(`${TP}/tpex_3insti_summary`); const date = ad(a[0]?.Date);
    const v = (re) => { const x = a.find((r) => re.test(r.Investor)); return x ? n(x.Net) / 1e8 : 0; };
    mergeDay(date, { oInst: { f: v(/^外資及陸資合計/), t: v(/^投信/), d: v(/^自營商合計|^自營商$/) } });
  });
  // 櫃買指數（本月每天）
  await safe('櫃買指數', async () => {
    for (const r of await get(`${TP}/tpex_index`)) { const d = ad(r.Date), c = n(r.Close), ch = n(r.Change); if (d && c > 0) mergeDay(d, { ix: { otc: [c, ch, (ch / (c - ch)) * 100] } }); }
  });
  await safe('上櫃本益比', async () => {
    const a = await get(`${TP}/tpex_mainboard_peratio_analysis`); const date = ad(a[0]?.Date), pe = {};
    for (const r of a) pe[String(r.SecuritiesCompanyCode).trim()] = [n(r.PriceEarningRatio) || null, n(r.YieldRatio) || null, n(r.PriceBookRatio) || null];
    mergeDay(date, { pe });
  });
  await safe('上櫃融資', async () => {
    const a = await get(`${TP}/tpex_mainboard_margin_balance`); const date = ad(a[0]?.Date), mg = {};
    for (const r of a) { const c = String(r.SecuritiesCompanyCode).trim(); if (keep(c)) mg[c] = n(r.MarginPurchaseBalance); }
    mergeDay(date, { mg });
  });
  // 公司基本資料（產業、股數）一週一次；月營收、重大訊息每次
  const meta = rj(path.join(STORE, 'meta.json'), { t: 0, co: {} });
  if (Date.now() - meta.t > 6 * 864e5) await safe('公司基本資料', async () => {
    const co = {};
    for (const r of await get(`${TW}/opendata/t187ap03_L`)) co[String(r['公司代號']).trim()] = { i: String(r['產業別'] || '').trim(), s: n(r['已發行普通股數或TDR原股發行股數']) };
    const txt = await get(`${TP}/mopsfin_t187ap03_O`, { json: false }); // 這份 JSON 有時格式壞掉 → 一筆一筆抓
    for (const m of txt.matchAll(/"SecuritiesCompanyCode":"(\w+)"[\s\S]*?"SecuritiesIndustryCode":"(\w*)"[\s\S]*?"IssueShares":"(\d+)"/g)) co[m[1]] = { i: m[2], s: +m[3] };
    if (Object.keys(co).length > 1000) wj(path.join(STORE, 'meta.json'), { t: Date.now(), co });
  });
  await safe('月營收', async () => {
    const rev = rj(path.join(STORE, 'rev.json'), {}); // { 代號: { 'YYYY-MM': [營收(千元), 年增%, 月增%, 累計年增%] } }
    for (const u of [`${TW}/opendata/t187ap05_L`, `${TP}/mopsfin_t187ap05_O`]) for (const r of await get(u)) {
      const c = String(r['公司代號']).trim(), ym = String(r['資料年月']), y = +ym.slice(0, -2) + 1911, m = ym.slice(-2);
      (rev[c] ||= {})[`${y}-${m}`] = [n(r['營業收入-當月營收']), r2(n(r['營業收入-去年同月增減(%)'])), r2(n(r['營業收入-上月比較增減(%)'])), r2(n(r['累計營業收入-前期比較增減(%)']))];
    }
    for (const c in rev) { const ks = Object.keys(rev[c]).sort(); for (const k of ks.slice(0, -15)) delete rev[c][k]; }
    wj(path.join(STORE, 'rev.json'), rev);
  });
  await safe('重大訊息', async () => {
    const ann = rj(path.join(STORE, 'ann.json'), {}); // { 日期: { 代號: [主旨...] } }
    for (const u of [`${TW}/opendata/t187ap04_L`, `${TP}/mopsfin_t187ap04_O`]) for (const r of await get(u)) {
      const d = ad(r['發言日期']), c = String(r['公司代號'] || r.SecuritiesCompanyCode || '').trim(), t = String(r['主旨 '] || r['主旨'] || '').replace(/\s+/g, ' ').trim();
      if (!d || !c || !t) continue; const arr = ((ann[d] ||= {})[c] ||= []); if (!arr.includes(t)) arr.push(t.slice(0, 120));
    }
    for (const d of Object.keys(ann).sort().slice(0, -10)) delete ann[d];
    wj(path.join(STORE, 'ann.json'), ann);
  });
  return got;
}

(async () => {
  if (!process.argv.includes('--no-fetch')) { log('抓開放資料…'); const g = await fetchAll(); log('上市資料日期', g.L || '（沒抓到）', '・上櫃資料日期', g.O || '（沒抓到）'); }

  // ── 2. 以「上市和上櫃都有資料」的最新一天為準 ──
  const days = fs.readdirSync(DAYS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 10)).sort();
  const full = days.filter((d) => { const x = rj(path.join(DAYS, d + '.json'), {}); return x.L && x.O; });
  const date = arg('date', full[full.length - 1] || days.filter((d) => rj(path.join(DAYS, d + '.json'), {}).L).pop());
  if (!date) throw new Error('還沒有任何一天的上市資料');
  const DAY = rj(path.join(DAYS, date + '.json'), {});
  const useO = !!DAY.O;
  log('這次產生', date, useO ? '（上市＋上櫃）' : '（只有上市，上櫃那天沒存到）');
  const meta = rj(path.join(STORE, 'meta.json'), { co: {} }).co, rev = rj(path.join(STORE, 'rev.json'), {}), ann = rj(path.join(STORE, 'ann.json'), {});

  const all = {};
  const put = (c, r, m) => {
    const [nm, close, chg, vol, val] = r, o = meta[c] || {};
    all[c] = { c, n: nm, m, close, chg, pct: close - chg ? (chg / (close - chg)) * 100 : 0, vol: vol / 1000, val: val / 1e8,
      ind: isEtf(c) ? 'ETF' : IND[o.i] || '其他', cap: o.s > 0 ? (o.s * close) / 1e8 : NaN, f: m === 'O' ? r[7] : null, t: m === 'O' ? r[8] : null, d: m === 'O' ? r[9] : null };
  };
  for (const [c, r] of Object.entries(DAY.L || {})) put(c, r, 'L');
  if (useO) for (const [c, r] of Object.entries(DAY.O)) put(c, r, 'O');

  // 歷史（自己每天存的）：最近 260 個有資料的交易日
  const hist = days.filter((d) => d <= date).slice(-260).map((d) => [d, rj(path.join(DAYS, d + '.json'), {})]);
  const series = (c) => hist.map(([d, x]) => { const r = x.L?.[c] || x.O?.[c]; return r ? { date: d, close: r[1], max: r[5], min: r[6], Trading_Volume: r[3] } : null; }).filter(Boolean);
  log('累積的歷史：', hist.length, '天（', hist[0]?.[0], '～', date, '）');

  // ── 3. 大盤統計、產業平均 ──
  const stocks = Object.values(all).filter((s) => isStock(s.c));
  const breadth = { up: stocks.filter((s) => s.chg > 0).length, down: stocks.filter((s) => s.chg < 0).length, flat: stocks.filter((s) => s.chg === 0).length };
  const indAgg = {};
  for (const s of stocks) { if (s.val < 0.05) continue; const a = (indAgg[s.ind] ||= { t: 0, k: 0 }); a.t += s.pct; a.k++; }
  const indAvg = Object.fromEntries(Object.entries(indAgg).map(([k, v]) => [k, { pct: v.t / v.k, n: v.k }]));
  const sectors = Object.entries(indAvg).filter(([k, v]) => v.n >= 5 && k !== '其他').map(([k, v]) => ({ ind: k, pct: v.pct, n: v.n })).sort((a, b) => b.pct - a.pct);
  const ix = DAY.ix || {};
  const index = [];
  if (ix.taiex) index.push({ name: '加權指數', close: ix.taiex[0], chg: ix.taiex[1], pct: ix.taiex[2] });
  if (useO && ix.otc) index.push({ name: '櫃買指數', close: ix.otc[0], chg: ix.otc[1], pct: ix.otc[2] });
  // 首頁加權指數走勢線：存下來的每天收盤（最近 3 個月）
  const taiex = days.filter((d) => d <= date && d >= addDays(date, -92)).map((d) => { const x = rj(path.join(DAYS, d + '.json'), {}).ix || {}; const c = x.taiex?.[0] || x.taiexClose; return c ? [d, c, Math.round((x.turnover || 0) / 1e8)] : null; }).filter(Boolean);
  // 三大法人：上市個股的是證交所付費資料，沒有開放 → 只放上櫃的（App 1.2 起會標「上櫃」）
  const instSum = DAY.oInst || { f: 0, t: 0, d: 0 };

  // ── 4. 白話解說：成交值前 30 ＋漲幅前 20 ＋跌幅前 20（成交值 1 億以上）──
  const liquid = stocks.filter((s) => s.val >= 1);
  const byVal = [...stocks].sort((a, b) => b.val - a.val);
  const pick = [...new Map([...byVal.slice(0, 30), ...[...liquid].sort((a, b) => b.pct - a.pct).slice(0, 20), ...[...liquid].sort((a, b) => a.pct - b.pct).slice(0, 20)].map((s) => [s.c, s])).values()].slice(0, LIMIT);
  log('要做解說的股票', pick.length, '檔', GROQ_KEY ? `（AI：${GROQ_MODEL}）` : '（沒有 GROQ_API_KEY，用規則版）');
  let prev = {}; { const e = rj(path.join(DATA, 'explain.json'), {}); if (e.date === date && e.src === 'open') prev = e.items || {}; }
  const MOPS = 'https://mops.twse.com.tw/mops/#/web/t05sr01_1';
  const annOf = (c) => [...new Set([...(ann[date]?.[c] || []), ...(ann[addDays(date, -1)]?.[c] || [])])].slice(0, 5).map((t) => ({ title: t, link: MOPS, src: '公開資訊觀測站重大訊息' }));
  const items = {}; let aiN = 0, ruleN = 0;
  for (const [i, s] of pick.entries()) {
    if (prev[s.c]?.ai) { items[s.c] = prev[s.c]; aiN++; continue; }
    const h = series(s.c), past = h.filter((r) => r.date < date).slice(-20).map((r) => r.Trading_Volume);
    const v20 = past.length >= 5 ? past.reduce((a, b) => a + b, 0) / past.length : NaN; // 少於 5 天就不算量比
    const news = annOf(s.c), ia = indAvg[s.ind] || {};
    const ctx = { code: s.c, name: s.n, close: s.close, chg: s.chg, pct: s.pct, volRatio: v20 ? (s.vol * 1000) / v20 : NaN, f: s.f, t: s.t, d: s.d, mktPct: index[0]?.pct, ind: s.ind, indPct: ia.pct, indN: ia.n, news, noInst: s.m === 'L' };
    const rule = Core.explainRule(ctx);
    let text = rule.text, ai = false;
    if (GROQ_KEY) { const t = Core.aiClean(await groq(Core.aiPrompt(ctx))); if (Core.aiOk(t)) { text = t; ai = true; } else if (t) log('  AI 回答不合格，改用規則版：', t.slice(0, 60)); }
    ai ? aiN++ : ruleN++;
    items[s.c] = { t: text, ai, tags: rule.tags, vr: Number.isFinite(ctx.volRatio) ? Math.round(ctx.volRatio * 10) / 10 : null, news };
    log(`${i + 1}/${pick.length} ${s.c} ${s.n} ${Core.fmtPct(s.pct)} ${ai ? 'AI' : '規則'}`);
  }

  // ── 5. 寫檔（欄位跟以前一樣，舊版 App 也看得懂）──
  const market = {
    date, updated: new Date().toISOString(), otc: useO, src: 'open', histDays: hist.length, instScope: 'otc',
    index: index.map((x) => ({ ...x, close: r2(x.close), chg: r2(x.chg), pct: r2(x.pct) })),
    breadth, inst: { f: r2(instSum.f), t: r2(instSum.t), d: r2(instSum.d) }, taiex,
    sectors: sectors.map((x) => ({ ...x, pct: r2(x.pct) })),
    cols: ['c', 'n', 'm', 'ind', 'close', 'chg', 'pct', 'vol', 'val', 'f', 't', 'd', 'cap'],
    rows: Object.values(all).sort((a, b) => a.c.localeCompare(b.c)).map((s) => [s.c, s.n, s.m, s.ind, s.close, r2(s.chg), r2(s.pct), r0(s.vol), r2(s.val), r0(s.f), r0(s.t), r0(s.d), r0(s.cap)]),
  };
  wj(path.join(DATA, 'market.json'), market);
  wj(path.join(DATA, 'explain.json'), { date, updated: market.updated, src: 'open', model: aiN ? modelName() : 'rule', items });
  // 走勢圖（App 1.2 起用；取代手機直接連 FinMind）：近 125 個交易日的收盤和成交量
  const cd = hist.map(([d]) => d).slice(-125), chart = { date, dates: cd, c: {}, v: {} };
  const H = hist.slice(-125);
  for (const s of Object.values(all)) {
    chart.c[s.c] = H.map(([, x]) => { const r = x.L?.[s.c] || x.O?.[s.c]; return r ? r2(r[1]) : null; });
    chart.v[s.c] = H.map(([, x]) => { const r = x.L?.[s.c] || x.O?.[s.c]; return r ? r0(r[3] / 100) : null; });
  }
  wj(path.join(DATA, 'chart.json'), chart);
  log(`完成：${market.rows.length} 檔行情、${aiN} 篇 AI 解說、${ruleN} 篇規則版解說`);

  // ── 6. 盤後 AI 報告：日報、概念股週報、個股報告書（資料都來自自己累積的開放資料）──
  if (!process.argv.includes('--no-reports')) {
    const g = GROQ_KEY ? groq : null, explain = { items };
    try { await Reports.daily({ date, market, stocks, explain, groq: g, log }); } catch (e) { log('日報失敗', e.message); }
    try { await Reports.weekly({ date, all, explain, groq: g, log, hist }); } catch (e) { log('週報失敗', e.message); }
    const extra = (c) => ({
      per: hist.map(([d, x]) => (x.pe?.[c]?.[0] ? { date: d, PER: x.pe[c][0], PBR: x.pe[c][2], dividend_yield: x.pe[c][1] } : null)).filter(Boolean),
      margin: hist.map(([d, x]) => (Number.isFinite(x.mg?.[c]) ? { date: d, MarginPurchaseTodayBalance: x.mg[c] } : null)).filter(Boolean),
      inst: hist.flatMap(([d, x]) => { const r = x.O?.[c]; if (!r || r[7] == null) return []; const row = (name, v) => ({ date: d, name, buy: Math.max(v, 0) * 1000, sell: Math.max(-v, 0) * 1000 }); return [row('Foreign_Investor', r[7]), row('Investment_Trust', r[8]), row('Dealer_self', r[9])]; }),
      revOpen: rev[c],
    });
    try { await Reports.stockReports({ date, stocks, series, extra, groq: g, log }); } catch (e) { log('報告書失敗', e.message); }
  }
})().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
