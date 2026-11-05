// 美股：Massive（原 Polygon.io）免費方案 → global.js 寫出 data/us/
//   收錄：S&P 500 成分股＋台灣人常看的美股（台廠 ADR、中概股、AI、熱門 ETF），約 560 檔
//   免費方案每分鐘 5 次 → 每次呼叫間隔 12.5 秒
//   ・每天收盤：「全市場當日 K 棒」一次拿到全部股票（grouped daily），存在 cache/us_days/
//   ・第一次：往回補約 130 個交易日（約 30 分鐘）；報告書的股票另外補 2 年日 K（cache/us_k/）
//   ・新聞：要做解說的股票各抓一次（英文標題，AI 用中文講重點）
// 金鑰：pipeline/.env 放一行 MASSIVE_API_KEY=...
// 用法：node pipeline/us.js [--no-ai] [--days 130]
const fs = require('fs'), path = require('path');
const Core = require('../core.js');
const { build } = require('./global.js');
const { log, sleep, arg } = require('./ai.js');
const N = require('./us_names.js');

const KEY = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || '';
const API = 'https://api.massive.com';
const CACHE = path.join(__dirname, 'cache');
const DAYS = path.join(CACHE, 'us_days'), KD = path.join(CACHE, 'us_k');
fs.mkdirSync(DAYS, { recursive: true }); fs.mkdirSync(KD, { recursive: true });
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ── API（每分鐘 5 次）──
let last = 0, calls = 0;
async function api(p, q = {}) {
  const u = new URL(API + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', KEY);
  for (let i = 1; ; i++) {
    const wait = 12500 - (Date.now() - last); if (wait > 0) await sleep(wait);
    last = Date.now(); calls++;
    const r = await fetch(u, { headers: { 'User-Agent': 'gushi-baihua daily build' }, signal: AbortSignal.timeout(40000) }).catch((e) => ({ ok: false, status: 0, statusText: e.message }));
    if (r.status === 429 && i < 4) { log('  Massive 太頻繁，等 60 秒'); await sleep(60000); continue; }
    if (!r.ok) { if (i < 3 && r.status >= 500) { await sleep(5000); continue; } throw new Error(`Massive ${p.slice(0, 60)}：${r.status} ${r.statusText || ''}`); }
    return r.json();
  }
}

// ── 收錄的股票：S&P 500（GitHub 上的公開清單，含 GICS 產業，一週更新一次）＋自己加的 ──
async function universe() {
  const f = path.join(CACHE, 'us_universe.json');
  const c = rj(f, null);
  if (c && Date.now() - c.t < 7 * 864e5) return c.list;
  const list = {};
  try {
    const txt = await (await fetch('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv', { signal: AbortSignal.timeout(30000) })).text();
    for (const line of txt.split(/\r?\n/).slice(1)) {
      const m = line.match(/^([^,]+),("[^"]*"|[^,]*),([^,]*),("[^"]*"|[^,]*)/); if (!m) continue;
      const T = m[1].trim().replace('.', '.'), en = m[2].replace(/"/g, ''), sec = m[3], sub = m[4].replace(/"/g, '');
      list[T] = { en, ind: N.sector(sec, sub) };
    }
  } catch (e) { log('S&P 500 清單失敗', e.message); }
  if (Object.keys(list).length < 400 && c) return c.list;
  for (const [T, x] of Object.entries(N.EXTRA)) list[T] = { ...list[T], ...x };
  fs.writeFileSync(f, JSON.stringify({ t: Date.now(), list }));
  return list;
}

// ── 每天的全市場 K 棒（只留收錄的股票）──
async function day(date, U) {
  const f = path.join(DAYS, date + '.json');
  const c = rj(f, null); if (c) return c;
  const j = await api(`/v2/aggs/grouped/locale/us/market/stocks/${date}`, { adjusted: 'true' });
  const out = {};
  for (const r of j.results || []) if (U[r.T]) out[r.T] = [r.o, r.h, r.l, r.c, r.v, r.vw];
  if (Object.keys(out).length > 100) fs.writeFileSync(f, JSON.stringify(out)); // 假日沒資料就不存（之後也不會再抓，因為日期往前走了）
  else fs.writeFileSync(f, '{}');
  return out;
}

// 美東今天的日期；16:00 收盤、資料約 16:30 後才有 → 美東 17:00 前用前一天
function lastClose(now = Date.now()) {
  const ny = Core.nyDate(now), h = new Date(now - (Core.usDST(ny) ? 4 : 5) * 3600e3).getUTCHours();
  let d = h >= 17 ? ny : addDays(ny, -1);
  while ([0, 6].includes(new Date(Date.parse(d)).getUTCDay())) d = addDays(d, -1);
  return d;
}

async function main() {
  if (!KEY) throw new Error('沒有 MASSIVE_API_KEY（pipeline/.env 放一行 MASSIVE_API_KEY=你的金鑰）');
  const U = await universe();
  log('美股收錄', Object.keys(U).length, '檔');
  // 1. 補每天的 K 棒：最新的往回 DAYS 個平日
  const want = +arg('days', 130), dates = [];
  let d = arg('date', lastClose());
  for (let k = 0; dates.length < want && k < want * 2; k++, d = addDays(d, -1)) if (![0, 6].includes(new Date(Date.parse(d)).getUTCDay())) dates.push(d);
  const need = dates.filter((x) => !fs.existsSync(path.join(DAYS, x + '.json')));
  if (need.length) log(`補 ${need.length} 天的全市場 K 棒（約 ${Math.ceil((need.length * 12.5) / 60)} 分鐘）`);
  const D = {};
  for (const x of dates.slice().reverse()) {
    try { D[x] = await day(x, U); } catch (e) { log('  ', x, e.message); if (/403|401|NOT_AUTHORIZED/i.test(e.message)) throw e; }
  }
  const tradeDays = Object.keys(D).filter((x) => Object.keys(D[x]).length > 100).sort();
  const date = tradeDays[tradeDays.length - 1];
  if (!date) throw new Error('沒有任何一天的美股資料');
  log('美股資料日期', date, `（${tradeDays.length} 個交易日）`);

  // 2. 每檔的日 K：報告書的股票（成交值前 70）先補 2 年，其他用每天的 K 棒拼起來
  const rowsOf = (T) => tradeDays.filter((x) => D[x][T]).map((x) => { const [o, h, l, c, v, vw] = D[x][T]; return { date: x, open: o, max: h, min: l, close: c, Trading_Volume: v, amt: (vw || c) * v }; });
  const today = D[date];
  const top = Object.keys(today).filter((T) => !U[T].etf).sort((a, b) => today[b][3] * today[b][4] - today[a][3] * today[a][4]).slice(0, 70);
  const longK = {};
  for (const T of top) {
    const f = path.join(KD, T + '.json');
    let k = rj(f, null);
    if (!k || k.at < addDays(date, -30)) {
      try {
        const j = await api(`/v2/aggs/ticker/${encodeURIComponent(T)}/range/1/day/${addDays(date, -730)}/${date}`, { adjusted: 'true', sort: 'asc', limit: '5000' });
        k = { at: date, k: (j.results || []).map((r) => [new Date(r.t + 12 * 3600e3).toISOString().slice(0, 10), r.o, r.h, r.l, r.c, r.v, r.vw]) };
        fs.writeFileSync(f, JSON.stringify(k));
      } catch (e) { log('  2 年日 K 失敗', T, e.message); continue; }
    }
    longK[T] = k.k.filter((r) => r[0] < tradeDays[0]).map(([x, o, h, l, c, v, vw]) => ({ date: x, open: o, max: h, min: l, close: c, Trading_Volume: v, amt: (vw || c) * v }));
  }

  // 3. 指數：免費方案沒有指數 → 用追蹤指數的 ETF（SPY＝S&P 500、QQQ＝那斯達克 100、DIA＝道瓊）
  const IDX = [['SPY', 'S&P 500（SPY）'], ['QQQ', '那斯達克100（QQQ）'], ['DIA', '道瓊（DIA）'], ['SOXX', '費城半導體（SOXX）']];
  const indexes = IDX.filter(([T]) => today[T]).map(([T, name]) => {
    const r = [...(longK[T] || []), ...rowsOf(T)];
    return { name, k: r.map((x, i) => [x.date, x.close, i ? (x.close / r[i - 1].close - 1) * 100 : NaN]) };
  });

  // 4. 新聞（要做解說的股票才抓；英文標題）
  const news = async (s) => {
    const j = await api('/v2/reference/news', { ticker: s.c, 'published_utc.gte': addDays(date, -2), order: 'desc', limit: '10', sort: 'published_utc' });
    const seen = new Set();
    // 只留標題有提到這家公司的（代號或英文名稱第一個字），選股文、比較文、預測文不算新聞
    const word = (s.en || '').split(/[\s,.(]/)[0];
    const about = new RegExp(`\\b(${s.c.replace('.', '\\.')}${word.length >= 3 ? '|' + word : ''})\\b`, 'i');
    const listicle = /^(is|are|should|could|would|can|will|why|what|how|better|forget|buy|sell|want|prediction|billionaire|\d+ (best|top|stocks?|reasons?))\b|\?$|stocks? to (buy|own|watch)|vs\.? |highlights|if i could only|zacks/i;
    return (j.results || []).filter((x) => about.test(x.title) && !listicle.test(x.title)).filter((x) => { const k = x.title.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8)
      .map((x) => ({ title: x.title, link: x.article_url, src: x.publisher?.name || '', d: x.published_utc.slice(5, 16).replace('T', ' ') }));
  };

  const stocks = Object.keys(U).filter((T) => today[T]).map((T) => {
    const u = U[T];
    return { c: T, n: N.zh[T] || u.en.replace(/,? (Inc\.?|Corporation|Corp\.?|Co\.?|Ltd\.?|plc|Holdings?|Company|Incorporated|N\.V\.|S\.A\.)$/gi, '').replace(/ Class [A-C]$/, ''), en: u.en, ind: u.ind || '其他', ex: u.etf ? 'ETF' : '美股', etf: !!u.etf, k: [...(longK[T] || []), ...rowsOf(T)] };
  });
  await build({ mkt: 'us', date, scope: 'S&P 500 成分股＋台灣人常看的美股', indexes, stocks, news }, { explain: 40, reports: 60, reportAi: 30 });
  log('Massive 共用了', calls, '次');
}

if (require.main === module) main().catch((e) => { console.error('美股失敗：', e.message); process.exit(1); });
module.exports = { lastClose };
