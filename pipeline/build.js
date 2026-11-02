// 每日資料程式：收盤後跑一次（GitHub Actions 自動跑，或自己雙擊「更新資料.cmd」）
//   產生 data/market.json（全部股票今天的行情＋法人）和 data/explain.json（熱門股的白話解說）
// 全部免費：
//   上市 → 證交所網站（每日收盤行情、三大法人）
//   上櫃 → 櫃買中心 OpenAPI
//   產業、個股歷史、新聞 → FinMind（不用註冊每小時 300 次；設 FINMIND_TOKEN 變 600 次）
//   AI 解說 → Groq 免費額度（設 GROQ_API_KEY 才會用；沒有就用規則版解說）
// 用法：node pipeline/build.js [--date 2026-11-02] [--limit 70] [--no-ai]
const fs = require('fs'), path = require('path');
const Core = require('../core.js');
// 本機金鑰檔 pipeline/.env（不會上傳 GitHub）：一行一個 KEY=值
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch (e) {}

const ROOT = path.join(__dirname, '..'), DATA = path.join(ROOT, 'data'), CACHE = path.join(__dirname, 'cache');
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = +arg('limit', 70);
const GROQ_KEY = process.argv.includes('--no-ai') ? '' : (process.env.GROQ_API_KEY || '');
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FM_TOKEN = process.env.FINMIND_TOKEN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = Core.num;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function get(url, { tries = 3, json = true } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (gushi-baihua daily build)' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : await r.text();
    } catch (e) {
      if (i >= tries) throw new Error(`${url.slice(0, 90)}：${e.message}`);
      await sleep(3000 * i);
    }
  }
}
const fm = async (dataset, q) => {
  const u = new URL('https://api.finmindtrade.com/api/v4/data');
  u.searchParams.set('dataset', dataset);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  if (FM_TOKEN) u.searchParams.set('token', FM_TOKEN);
  const j = await get(u.toString());
  if (j.status !== 200) throw new Error(`FinMind ${dataset}：${j.msg}`);
  return j.data;
};
const ymd = (d) => d.replace(/-/g, '');
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

// 一般股票＋ETF（不要權證、債券、特別股）
const isStock = (c) => /^[1-9]\d{3}$/.test(c);
const isEtf = (c) => /^00\d{2,4}[A-Z]?$/.test(c);

// ── 上市：證交所每日收盤行情＋指數＋漲跌家數 ──
async function twse(date) {
  const j = await get(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd(date)}&type=ALLBUT0999&response=json`);
  if (j.stat !== 'OK') return null;
  const T = j.tables || [];
  const q = T.find((t) => (t.fields || [])[0] === '證券代號' && (t.data || []).length > 500);
  const idx = T[0]?.data || [];
  const taiex = idx.find((r) => r[0] === '發行量加權股價指數');
  const rows = {};
  for (const r of q.data) {
    const code = r[0].trim(); if (!isStock(code) && !isEtf(code)) continue;
    const close = n(r[8]); if (!isFinite(close)) continue;
    const sign = /-/.test(stripHtml(r[9])) ? -1 : 1, chg = sign * (n(r[10]) || 0);
    rows[code] = { c: code, n: r[1].trim(), m: 'L', close, chg, pct: (chg / (close - chg)) * 100, vol: n(r[2]) / 1000, val: n(r[4]) / 1e8 };
  }
  const tChg = taiex ? (/-/.test(stripHtml(taiex[2])) ? -1 : 1) * n(taiex[3]) : NaN;
  return { rows, index: taiex ? { name: '加權指數', close: n(taiex[1]), chg: tChg, pct: n(taiex[4]) * (tChg < 0 && n(taiex[4]) > 0 ? -1 : 1) } : null };
}
async function twseInst(date) {
  const j = await get(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd(date)}&selectType=ALL&response=json`);
  const out = {}; if (j.stat !== 'OK') return out;
  for (const r of j.data) out[r[0].trim()] = { f: (n(r[4]) + n(r[7])) / 1000, t: n(r[10]) / 1000, d: n(r[11]) / 1000 };
  return out;
}
// ── 上櫃：櫃買中心 OpenAPI（只有最新一天）──
async function tpex() {
  const [q, inst, idx] = await Promise.all([
    get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
    get('https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading').catch(() => []),
    get('https://www.tpex.org.tw/openapi/v1/tpex_index').catch(() => []),
  ]);
  const roc = q[0]?.Date; const date = roc ? `${+roc.slice(0, 3) + 1911}-${roc.slice(3, 5)}-${roc.slice(5, 7)}` : null;
  const rows = {};
  for (const r of q) {
    const code = r.SecuritiesCompanyCode.trim(); if (!isStock(code) && !isEtf(code)) continue;
    const close = n(r.Close), chg = n(r.Change); if (!isFinite(close) || !isFinite(chg)) continue;
    rows[code] = { c: code, n: r.CompanyName.trim(), m: 'O', close, chg, pct: (chg / (close - chg)) * 100, vol: n(r.TradingShares) / 1000, val: n(r.TransactionAmount) / 1e8 };
  }
  const ins = {};
  for (const r of inst) {
    const code = r.SecuritiesCompanyCode.trim(), keys = Object.keys(r);
    const k = (re) => n(r[keys.find((x) => re.test(x))]);
    ins[code] = { f: k(/^ForeignInvestorsInclude ?MainlandAreaInvestors-Difference/) / 1000, t: k(/^SecuritiesInvestmentTrustCompanies-Difference/) / 1000, d: k(/^Dealers-Difference/) / 1000 };
  }
  const ix = idx[0];
  return { date, rows, inst: ins, index: ix ? { name: '櫃買指數', close: n(ix.Close), chg: n(ix.Change), pct: (n(ix.Change) / (n(ix.Close) - n(ix.Change))) * 100 } : null };
}
// 產業分類（FinMind，一週更新一次快取）
async function industries() {
  const f = path.join(CACHE, 'industry.json');
  try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (Date.now() - c.t < 7 * 864e5) return c.map; } catch {}
  const data = await fm('TaiwanStockInfo', {});
  const map = {};
  for (const r of data) if (!map[r.stock_id] && r.industry_category && !/ETF|ETN|受益證券|Index|大盤|所有證券/.test(r.industry_category)) map[r.stock_id] = r.industry_category;
  fs.writeFileSync(f, JSON.stringify({ t: Date.now(), map }));
  return map;
}

// 證交所／櫃買的官方產業代碼（比 FinMind 的分類整齊，不會有「電子工業」這種重複的大類）
const IND = { '01': '水泥', '02': '食品', '03': '塑膠', '04': '紡織', '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙', '10': '鋼鐵', '11': '橡膠', '12': '汽車', '14': '建材營造', '15': '航運', '16': '觀光餐旅', '17': '金融保險', '18': '貿易百貨', '19': '綜合', '20': '其他', '21': '化學', '22': '生技醫療', '23': '油電燃氣', '24': '半導體', '25': '電腦週邊', '26': '光電', '27': '通信網路', '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意', '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活', '80': '管理股票', '91': '存託憑證' };

// 已發行股數（算市值、熱力圖方塊大小用）：上市＝證交所 OpenAPI、上櫃＝櫃買 OpenAPI，一週更新一次
// 櫃買那份 JSON 有時候格式壞掉（公司名稱裡有怪字元），所以用正規表示式一筆一筆抓
async function shares() {
  const f = path.join(CACHE, 'shares.json');
  try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (c.v === 2 && Date.now() - c.t < 7 * 864e5) return c.map; } catch {}
  const map = {}; // 代號 → { s: 股數, i: 官方產業代碼 }
  try { for (const r of await get('https://openapi.twse.com.tw/v1/opendata/t187ap03_L')) map[r['公司代號'].trim()] = { s: n(r['已發行普通股數或TDR原股發行股數']), i: String(r['產業別'] || '').trim() }; } catch (e) { log('上市股數失敗', e.message); }
  try {
    const txt = await get('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', { json: false });
    for (const m of txt.matchAll(/"SecuritiesCompanyCode":"(\w+)"[\s\S]*?"SecuritiesIndustryCode":"(\w*)"[\s\S]*?"IssueShares":"(\d+)"/g)) map[m[1]] = { s: +m[3], i: m[2] };
  } catch (e) { log('上櫃股數失敗', e.message); }
  if (Object.keys(map).length > 1000) fs.writeFileSync(f, JSON.stringify({ t: Date.now(), v: 2, map }));
  return map;
}

// ── Groq AI ──
let lastAi = 0;
async function groq(prompt) {
  for (let i = 0; i < 4; i++) {
    const wait = 8000 - (Date.now() - lastAi); if (wait > 0) await sleep(wait); // 免費額度每分鐘 token 有限，慢慢送
    lastAi = Date.now();
    const body = { model: GROQ_MODEL, temperature: 0.3, max_tokens: 700, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] };
    if (/gpt-oss/.test(GROQ_MODEL)) body.reasoning_effort = 'low';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.status === 429) { const s = +(r.headers.get('retry-after') || 20); log('  Groq 額度暫時用完，等', s, '秒'); await sleep(s * 1000 + 500); continue; }
    if (!r.ok) { log('  Groq 錯誤', r.status, (await r.text()).slice(0, 150)); return null; }
    const j = await r.json();
    return (j.choices?.[0]?.message?.content || '').replace(/\*\*/g, '').trim();
  }
  return null;
}

(async () => {
  // 1. 找最近有開盤的一天（往前最多 10 天）
  let date = arg('date', Core.today()), L = null;
  for (let k = 0; k < 10 && !L; k++) { L = await twse(date); if (!L) date = addDays(date, -1); }
  if (!L) throw new Error('證交所 10 天內都沒有資料');
  log('上市資料日期', date, Object.keys(L.rows).length, '檔');
  const [instL, O, ind, shr] = await Promise.all([twseInst(date), tpex(), industries().catch((e) => (log('產業資料失敗', e.message), {})), shares()]);
  log('上櫃資料日期', O.date, Object.keys(O.rows).length, '檔');

  // 上櫃日期跟上市不一樣時（櫃買只給最新一天），先只用上市的
  const useO = O.date === date;
  if (!useO) log('⚠ 上櫃日期不同，這次不放上櫃');
  const all = { ...L.rows, ...(useO ? O.rows : {}) };
  const inst = { ...instL, ...(useO ? O.inst : {}) };
  for (const s of Object.values(all)) { const o = shr[s.c] || {}; s.ind = isEtf(s.c) ? 'ETF' : IND[o.i] || ind[s.c] || '其他'; Object.assign(s, inst[s.c] || {}); s.cap = o.s > 0 ? (o.s * s.close) / 1e8 : NaN; }

  // 2. 大盤統計、產業平均
  const stocks = Object.values(all).filter((s) => isStock(s.c));
  const breadth = { up: stocks.filter((s) => s.chg > 0).length, down: stocks.filter((s) => s.chg < 0).length, flat: stocks.filter((s) => s.chg === 0).length };
  const instSum = { f: 0, t: 0, d: 0 };
  for (const s of Object.values(all)) for (const k of ['f', 't', 'd']) if (isFinite(s[k])) instSum[k] += (s[k] * 1000 * s.close) / 1e8; // 億元（估算）
  const indAgg = {};
  for (const s of stocks) { if (s.val < 0.05) continue; const a = (indAgg[s.ind] ||= { t: 0, k: 0 }); a.t += s.pct; a.k++; }
  const indAvg = Object.fromEntries(Object.entries(indAgg).map(([k, v]) => [k, { pct: v.t / v.k, n: v.k }]));
  const sectors = Object.entries(indAvg).filter(([k, v]) => v.n >= 5 && k !== '其他').map(([k, v]) => ({ ind: k, pct: v.pct, n: v.n })).sort((a, b) => b.pct - a.pct);

  // 3. 挑要做 AI 解說的股票：成交值前 30 ＋漲幅前 20 ＋跌幅前 20（成交值 1 億以上才算）
  const liquid = stocks.filter((s) => s.val >= 1);
  const byVal = [...stocks].sort((a, b) => b.val - a.val).slice(0, 30);
  const gain = [...liquid].sort((a, b) => b.pct - a.pct).slice(0, 20), lose = [...liquid].sort((a, b) => a.pct - b.pct).slice(0, 20);
  const pick = [...new Map([...byVal, ...gain, ...lose].map((s) => [s.c, s])).values()].slice(0, LIMIT);
  log('要做解說的股票', pick.length, '檔', GROQ_KEY ? `（AI：${GROQ_MODEL}）` : '（沒有 GROQ_API_KEY，用規則版）');

  // 沿用今天已經做好的 AI 解說（晚上補跑時不重複花額度）
  let prev = {}; try { const e = JSON.parse(fs.readFileSync(path.join(DATA, 'explain.json'), 'utf8')); if (e.date === date) prev = e.items; } catch {}

  const items = {}; let aiN = 0, ruleN = 0;
  for (const [i, s] of pick.entries()) {
    try {
      const [hist, news] = await Promise.all([
        fm('TaiwanStockPrice', { data_id: s.c, start_date: addDays(date, -45), end_date: date }),
        // 新聞一次只給一天、不能帶 end_date；論壇貼文（股市爆料同學會）不算新聞
        fm('TaiwanStockNews', { data_id: s.c, start_date: date }).then((a) => a.filter((x) => !/爆料同學會|forum|PTT|鉅額成交/i.test(x.title + x.link))).catch(() => []),
      ]);
      const vols = hist.filter((r) => r.date < date).map((r) => r.Trading_Volume);
      const v20 = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, vols.length));
      const seen = new Set();
      const nws = news.reverse().filter((x) => { const k = x.title.slice(0, 18); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8)
        .map((x) => ({ title: x.title.replace(/\s*-\s*[^-]{2,15}$/, ''), link: x.link, src: x.source, d: x.date.slice(5, 16) }));
      const ia = indAvg[s.ind] || {};
      const ctx = { code: s.c, name: s.n, close: s.close, chg: s.chg, pct: s.pct, volRatio: v20 ? (s.vol * 1000) / v20 : NaN, f: s.f, t: s.t, d: s.d, mktPct: L.index?.pct, ind: s.ind, indPct: ia.pct, indN: ia.n, news: nws };
      const rule = Core.explainRule(ctx);
      let text = rule.text, ai = false;
      if (prev[s.c]?.ai) { text = prev[s.c].t; ai = true; }
      else if (GROQ_KEY) {
        const t = await groq(Core.aiPrompt(ctx));
        if (Core.aiOk(t)) { text = t; ai = true; } else if (t) log('  AI 回答不合格，改用規則版：', t.slice(0, 60));
      }
      ai ? aiN++ : ruleN++;
      items[s.c] = { t: text, ai, tags: rule.tags, vr: isFinite(ctx.volRatio) ? Math.round(ctx.volRatio * 10) / 10 : null, news: nws.slice(0, 5) };
      log(`${i + 1}/${pick.length} ${s.c} ${s.n} ${Core.fmtPct(s.pct)} ${ai ? 'AI' : '規則'}`);
    } catch (e) { log('  失敗', s.c, e.message); }
    await sleep(FM_TOKEN ? 600 : 1200);
  }

  // 加權指數近 3 個月走勢（證交所 FMTQIK，一次一個月）：首頁畫線用
  const taiex = [];
  for (let k = 2; k >= 0; k--) {
    const d = new Date(Date.parse(date.slice(0, 8) + '01') - k * 27 * 864e5).toISOString().slice(0, 8) + '01';
    try {
      const j = await get(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${ymd(d)}&response=json`);
      for (const r of j.data || []) { const [y, m, dd] = r[0].split('/'); const ad = `${+y + 1911}-${m}-${dd}`; if (ad <= date && !taiex.some((x) => x[0] === ad)) taiex.push([ad, n(r[4]), Math.round(n(r[2]) / 1e8)]); }
    } catch (e) { log('加權指數歷史失敗', e.message); }
    await sleep(800);
  }
  taiex.sort((a, b) => a[0].localeCompare(b[0]));

  // 4. 寫檔（數字縮短，檔案比較小）
  const r2 = (x) => (isFinite(x) ? Math.round(x * 100) / 100 : null), r0 = (x) => (isFinite(x) ? Math.round(x) : null);
  const market = {
    date, updated: new Date().toISOString(), otc: useO,
    index: [L.index, useO ? O.index : null].filter(Boolean).map((x) => ({ ...x, close: r2(x.close), chg: r2(x.chg), pct: r2(x.pct) })),
    breadth, inst: { f: r2(instSum.f), t: r2(instSum.t), d: r2(instSum.d) }, taiex,
    sectors: sectors.map((x) => ({ ...x, pct: r2(x.pct) })),
    // 欄位：代號、名稱、市場(L上市/O上櫃)、產業、收盤、漲跌、漲跌%、成交張數、成交值(億)、外資、投信、自營（張）
    cols: ['c', 'n', 'm', 'ind', 'close', 'chg', 'pct', 'vol', 'val', 'f', 't', 'd', 'cap'], // cap＝市值（億）
    rows: Object.values(all).sort((a, b) => a.c.localeCompare(b.c)).map((s) => [s.c, s.n, s.m, s.ind, s.close, r2(s.chg), r2(s.pct), r0(s.vol), r2(s.val), r0(s.f), r0(s.t), r0(s.d), r0(s.cap)]),
  };
  fs.writeFileSync(path.join(DATA, 'market.json'), JSON.stringify(market));
  fs.writeFileSync(path.join(DATA, 'explain.json'), JSON.stringify({ date, updated: market.updated, model: aiN ? GROQ_MODEL : 'rule', items }));
  log(`完成：${market.rows.length} 檔行情、${aiN} 篇 AI 解說、${ruleN} 篇規則版解說`);
})().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
