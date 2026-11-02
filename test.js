// 測試：node test.js（會連 FinMind 抓台積電真實資料，測深度報告）
const C = require('./core.js');
let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) ok++; else { bad++; console.log('✗', name); } };
const T0 = Date.parse('2026-11-02T02:00:00Z'); // 台灣 10:00
const H = 3600e3;

// ── 積分 ──
let s = C.newState(T0);
t('新手送點', s.pts === C.ECON.START);
t('台灣日期', C.today(T0) === '2026-11-02' && C.today(Date.parse('2026-11-02T16:30:00Z')) === '2026-11-03');
let r = C.unlock(s, '2330', 'deep', '2026-11-02', T0);
t('解鎖扣點', r.ok && r.paid === 3 && s.pts === 7);
r = C.unlock(s, '2330', 'deep', '2026-11-02', T0 + H);
t('同一天重看不扣', r.ok && r.paid === 0 && s.pts === 7);
t('換資料日要重付', !C.isUnlocked(s, '2330', 'deep', '2026-11-03', T0));
t('解說另外算', !C.isUnlocked(s, '2330', 'explain', '2026-11-02', T0));
s.pts = 2; r = C.unlock(s, '2454', 'deep', '2026-11-02', T0);
t('點數不夠不給看', !r.ok && r.why === 'pts' && r.need === 1 && s.pts === 2);
t('不知道的種類', !C.unlock(s, '2330', 'xxx', 'd', T0).ok);
for (let i = 0; i < 12; i++) C.grantAd(s, T0 + i);
t('廣告每天上限', s.adsToday === C.ECON.AD_DAILY_MAX && s.pts === 2 + C.ECON.AD_DAILY_MAX * C.ECON.AD_REWARD);
t('廣告剩餘 0', C.adsLeft(s) === 0);
C.rollDay(s, T0 + 24 * H);
t('隔天重置廣告', C.adsLeft(s) === C.ECON.AD_DAILY_MAX);
t('隔天清掉昨天的解鎖', !C.isUnlocked(s, '2330', 'deep', '2026-11-02', T0 + 24 * H) && Object.keys(s.unlocked).length === 0);
s = C.newState(T0);
t('簽到', C.checkin(s, T0).ok && s.pts === C.ECON.START + C.ECON.CHECKIN && !C.checkin(s, T0 + H).ok);
t('隔天能再簽', C.checkin(s, T0 + 24 * H).ok);
// 免費通行（廣告播不出來）
s = C.newState(T0); s.pts = 0;
let n = 0; for (let i = 0; i < 5; i++) if (C.unlockFree(s, 'X' + i, 'deep', 'd', T0).ok) n++;
t('廣告壞掉每天最多免費 3 次', n === 3 && s.pts === 0);
t('免費解鎖有效', C.isUnlocked(s, 'X0', 'deep', 'd', T0));
// 插頁頻率
s = C.newState(T0);
const shows = []; let now = T0;
for (let i = 0; i < 20; i++) { now += 30000; if (C.onOpenStock(s, now)) { C.interShown(s, now); shows.push(i + 1); } }
t('新手前 3 次不跳', shows[0] > C.ECON.INTER_NEW_FREE);
t('插頁間隔至少 2 分鐘', shows.every((x, i) => !i || (x - shows[i - 1]) * 30000 >= C.ECON.INTER_GAP_MS));
t('20 次查詢跳 4～5 次', shows.length >= 4 && shows.length <= 5);
s = C.newState(T0); s.opens = 10; s.opensSinceInter = 5; s.lastReward = T0;
t('剛看完獎勵廣告不跳插頁', !C.onOpenStock(s, T0 + 30000) && C.onOpenStock(s, T0 + 70000));
// 盲測
s = C.newState(T0);
let g = 0; while (C.gameUse(s, T0)) g++;
t('盲測每天免費題數', g === C.ECON.GAME_FREE);
C.gameAdBonus(s, T0); t('看廣告多題', C.gameLeft(s, T0) === C.ECON.GAME_AD_BONUS);
C.gameResult(s, true); C.gameResult(s, true); C.gameResult(s, false);
t('盲測戰績', s.game.n === 3 && s.game.win === 2 && s.game.best === 2 && s.game.streak === 0);
let p0 = s.pts, gr = C.gameResult(s, true, true, T0);
t('神準加點', gr.sharp && s.pts === p0 + C.ECON.GAME_SHARP_BONUS && s.game.sharp === 1);
gr = C.gameResult(s, false, true, T0);
t('方向錯不算神準', !gr.sharp && s.pts === p0 + C.ECON.GAME_SHARP_BONUS);
// 自選
t('加自選', C.toggleWatch(s, '2603') && s.watch[0] === '2603');
t('移出自選', !C.toggleWatch(s, '2603') && !s.watch.includes('2603'));
// 存檔壞掉
t('壞存檔重來', C.load('{壞掉', T0).pts === C.ECON.START);
t('舊存檔補欄位', C.load(JSON.stringify({ pts: 5.7, day: '2026-11-01' }), T0).game.n === 0);
t('負點數歸零', C.load({ pts: -3 }, T0).pts === 0);

// ── 熱力圖 ──
const sq = C.squarify([{ v: 6 }, { v: 3 }, { v: 2 }, { v: 1 }, { v: 0 }, { v: -1 }], 0, 0, 120, 100);
t('熱力圖：0 和負數不畫', sq.length === 4);
t('熱力圖：面積和數值成正比', sq.every((r) => Math.abs(r.w * r.h - (r.v / 12) * 12000) < 1e-6));
t('熱力圖：不超出範圍', sq.every((r) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 120 + 1e-6 && r.y + r.h <= 100 + 1e-6));
const ov = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
t('熱力圖：方塊不重疊', sq.every((a, i) => sq.every((b, j) => i === j || !ov(a, b))));
const big = C.squarify(Array.from({ length: 300 }, (_, i) => ({ v: 1000 / (i + 1) })), 0, 0, 400, 580);
t('熱力圖：300 個方塊都畫出來', big.length === 300 && big.every((r) => r.w > 0 && r.h > 0));
const ratio = big.slice(0, 20).map((r) => Math.max(r.w / r.h, r.h / r.w));
t('熱力圖：大方塊接近正方形', Math.max(...ratio) < 3.5);
t('熱力圖：空資料', C.squarify([], 0, 0, 100, 100).length === 0);
t('顏色：紅漲綠跌', /^rgb\((\d+)/.exec(C.heatColor(3))[1] > 150 && /rgb\(\d+,(\d+)/.exec(C.heatColor(-3))[1] > 100);
t('顏色：漲停跌停最深', C.heatColor(9.9) === '#ff1f3d' && C.heatColor(-10) === '#00c46a');
t('顏色：沒資料', C.heatColor(NaN) === '#2a3040');
t('概念股群組代號都是 4～6 碼', C.GROUPS.every((g) => g.codes.length >= 5 && g.codes.every((c) => /^\d{4}|^00/.test(c))));

// ── 白話解說（規則版）──
const base = { code: '1234', name: '測試', close: 100, chg: 5, pct: 5.26, volRatio: 1, f: 0, t: 0, d: 0, mktPct: -0.6, ind: '半導體業', indPct: 0, indN: 30, news: [] };
let e = C.explainRule(base);
t('比大盤強', /明顯比大盤強/.test(e.text) && e.tags.includes('比大盤強'));
e = C.explainRule({ ...base, pct: 9.9 }); t('漲停', /漲停/.test(e.text));
e = C.explainRule({ ...base, pct: 3, indPct: 3.2, indN: 20, mktPct: 0.2 }); t('族群連動', e.tags.includes('族群連動'));
e = C.explainRule({ ...base, volRatio: 3.4 }); t('爆量', e.tags.includes('爆量') && /3.4 倍/.test(e.text));
e = C.explainRule({ ...base, f: 5000, t: 1000 }); t('法人同向', /主要力量/.test(e.text));
e = C.explainRule({ ...base, f: -5000, t: 4000 }); t('法人分歧', /看法分歧/.test(e.text));
e = C.explainRule({ ...base, f: -5000, t: 0, d: 0 }); t('法人反向', /方向相反/.test(e.text));
e = C.explainRule({ ...base, pct: -0.5, mktPct: -0.6 }); t('跟大盤', e.tags.includes('跟大盤'));
e = C.explainRule({ ...base, pct: 0.1, mktPct: -0.1, news: [] }); t('看不出原因', /看不出明確原因/.test(e.text));
e = C.explainRule({ ...base, news: [{ title: '很長很長的新聞標題'.repeat(6) + ' - 某某新聞' }] }); t('新聞標題截斷', /…」/.test(e.text) && !/某某新聞/.test(e.text));
t('沒成交', /沒有成交/.test(C.explainRule({ ...base, pct: NaN }).text));
// AI 回答檢查
t('AI 正常', C.aiOk('台積電今天跌 1.7%，主要是外資賣超 1.5 萬張，加上大盤也走弱，屬於跟著大盤下跌。'));
t('AI 給建議擋掉', !C.aiOk('台積電今天跌 1.7%，外資賣超，建議逢低買進，目標價 3000 元，可以長期持有。'));
t('AI 簡體擋掉', !C.aiOk('台积电今天跌了，这是因为外资卖超，们说时会来对个发经过还进间后。'));
t('AI 太短擋掉', !C.aiOk('跌了'));
const pr = C.aiPrompt({ ...base, news: [{ title: '新聞A' }] });
t('提示詞有資料和規則', /新聞A/.test(pr.user) && /不准猜/.test(pr.system) && /不可以給任何買進/.test(pr.system));

// ── 深度報告：假資料 ──
const mk = (k, f) => Array.from({ length: k }, (_, i) => { const c = f(i); return { date: new Date(Date.parse('2023-01-02') + i * 864e5).toISOString().slice(0, 10), close: c, max: c * 1.01, min: c * 0.99, Trading_Volume: 1e6 + (i % 7) * 1e5 }; });
let R = C.analyze({ prices: mk(10, () => 50) });
t('資料不足', !!R.error);
R = C.analyze({ prices: mk(700, (i) => 100 + i * 0.2 + Math.sin(i / 9) * 5) });
t('上升趨勢在季線之上', R.sections[0].tone === 1 && R.bull >= 2);
t('有歷史相似', R.similar && R.similar.n >= 8 && R.similar.up <= R.similar.n);
t('相似日期不重疊', R.similar.dates.length === R.similar.n);
R = C.analyze({ prices: mk(700, (i) => 300 - i * 0.3 + Math.sin(i / 7) * 4) });
t('下跌趨勢偏空', R.bear >= 2 && /偏弱|差不多/.test(R.summary));
t('一定有風險清單', R.risks.length >= 1);

(async () => {
  // ── 深度報告：台積電真實資料 ──
  try {
    const fm = async (ds, start) => { const j = await (await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=${ds}&data_id=2330&start_date=${start}`)).json(); return j.data || []; };
    const [prices, inst, margin, rev, per] = await Promise.all([fm('TaiwanStockPrice', '2023-11-01'), fm('TaiwanStockInstitutionalInvestorsBuySell', '2026-09-20'), fm('TaiwanStockMarginPurchaseShortSale', '2026-09-20'), fm('TaiwanStockMonthRevenue', '2025-06-01'), fm('TaiwanStockPER', '2025-11-01')]);
    const R = C.analyze({ prices, inst, margin, rev, per });
    t('真實資料：6 段以上', R.sections.length >= 6);
    t('真實資料：數字沒有 NaN', !JSON.stringify(R).includes('NaN'));
    console.log('\n── 台積電深度報告 ──\n' + R.summary);
    for (const x of R.sections) console.log(x.icon, x.title, '\n  ' + x.lines.join('\n  '));
    console.log('😈', R.risks.join(' / '));
  } catch (e) { console.log('（沒網路，跳過真實資料測試）', e.message); }
  console.log(`\n${ok} 項通過，${bad} 項失敗`);
  process.exit(bad ? 1 : 0);
})();
