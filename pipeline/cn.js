// 陸股：讀 cn_fetch.py 抓好的 pipeline/cache/cn_raw.json → 轉繁體、整理產業 → global.js 寫出 data/cn/
// 用法：python pipeline/cn_fetch.py && node pipeline/cn.js [--no-ai]
const fs = require('fs'), path = require('path');
const OpenCC = require('opencc-js');
const Core = require('../core.js');
const { build } = require('./global.js');
const { log } = require('./ai.js');

const toTw = OpenCC.Converter({ from: 'cn', to: 'tw' }); // 只轉字，不改詞（公司名稱不要被改掉）

// 證監會行業分類（代碼開頭）→ 短的繁體產業名稱
const IND = {
  C39: '電子設備', C35: '專用設備', C26: '化工', I65: '軟體資訊', C38: '電氣設備', C27: '醫藥', C34: '通用設備', C36: '汽車', C29: '橡膠塑膠',
  C30: '建材', C33: '金屬製品', D44: '電力', F51: '批發', F52: '零售', C32: '有色金屬', K70: '房地產', C37: '交通設備軍工', C40: '儀器儀表',
  L72: '商務服務', M74: '技術服務', C14: '食品', E48: '土木工程', N77: '環保', C13: '農產加工', I64: '網路服務', J67: '證券', C15: '酒飲料',
  J66: '銀行', C17: '紡織', C22: '造紙', C18: '服飾', G55: '航運', C31: '鋼鐵', G54: '公路運輸', D45: '燃氣', M73: '研發服務', R86: '出版',
  B09: '有色礦業', B06: '煤炭', C28: '化纖', C21: '家具', N78: '公共設施', E50: '建築裝飾', C24: '文體用品', D46: '水務', R87: '影視',
  C42: '資源回收', Q84: '醫療服務', I63: '電信', C25: '石化', A03: '畜牧', G56: '航空', J68: '保險', J69: '其他金融', B07: '石油天然氣',
  G53: '鐵路', B11: '採礦服務', B08: '鐵礦', G58: '物流', G59: '倉儲', C23: '印刷', C41: '其他製造', C20: '木材', C19: '皮革鞋業', P83: '教育',
  A01: '農業', A04: '漁業', A05: '農業服務', S91: '綜合', E47: '房屋建築', E49: '建築安裝', H61: '住宿', H62: '餐飲', G60: '郵政', L71: '租賃',
  M75: '科技推廣', C43: '設備維修', R88: '文化藝術', R89: '體育',
};
const indName = (s) => { const m = String(s || '').match(/^([A-Z]\d\d)(.*)$/); return m ? IND[m[1]] || toTw(m[2]).replace(/(製造)?業$/, '') : '其他'; };

function load() {
  const f = path.join(__dirname, 'cache', 'cn_raw.json');
  const R = JSON.parse(fs.readFileSync(f, 'utf8'));
  const ci = Object.fromEntries(R.cols.map((k, i) => [k, i]));
  const stocks = Object.entries(R.stocks).map(([code, s]) => {
    const c = code.split('.')[1], n = toTw(s.n);
    const k = s.k.filter((r) => r[ci.status] === '1' && r[ci.close] > 0).map((r) => ({
      date: r[ci.date], open: r[ci.open], max: r[ci.high], min: r[ci.low], close: r[ci.close],
      Trading_Volume: r[ci.vol], amt: r[ci.amt], pct: r[ci.pct], PER: r[ci.pe], PBR: r[ci.pb], turn: r[ci.turn],
    }));
    const L = k[k.length - 1];
    // 流通市值＝收盤價 × 流通股數（流通股數＝成交量 ÷ 換手率）
    const cap = L && L.turn > 0 ? (L.close * (L.Trading_Volume / (L.turn / 100))) / 1e8 : NaN;
    return { c, n, ind: indName(s.ind), ex: code.startsWith('sh') ? '上海' : '深圳', cap, limit: Core.cnLimit(c, s.n), k };
  });
  return {
    mkt: 'cn', date: R.date, scope: '滬深 300＋中證 500 成分股',
    indexes: R.index.map((x) => ({ name: x.name, k: x.k.map((r) => [r[0], r[1], r[2]]) })),
    stocks,
  };
}

if (require.main === module) {
  build(load(), { explain: 50, reports: 60, reportAi: 30 }).then((m) => log('陸股完成', m.date)).catch((e) => { console.error('陸股失敗：', e.message); process.exit(1); });
}
module.exports = { load, indName };
