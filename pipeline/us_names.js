// 美股的中文名稱、產業翻譯、自己加的股票（不在 S&P 500 裡，但台灣人常看）
// 沒有中文名稱的股票就顯示英文名稱

// GICS 產業 → 中文（半導體從資訊科技拆出來，台灣人比較常看）
const SECTOR = {
  'Information Technology': '資訊科技', 'Health Care': '醫療保健', Financials: '金融', 'Consumer Discretionary': '非必需消費',
  'Communication Services': '通訊媒體', Industrials: '工業', 'Consumer Staples': '必需消費', Energy: '能源', Utilities: '公用事業',
  'Real Estate': '房地產', Materials: '原物料',
};
const sector = (sec, sub = '') => (/Semiconductor/i.test(sub) ? '半導體' : /Software/i.test(sub) ? '軟體' : SECTOR[sec] || '其他');

// 不在 S&P 500、但要收錄的
const EXTRA = {
  TSM: { en: 'Taiwan Semiconductor Manufacturing', ind: '半導體' }, ASML: { en: 'ASML Holding', ind: '半導體' }, ARM: { en: 'Arm Holdings', ind: '半導體' },
  UMC: { en: 'United Microelectronics', ind: '半導體' }, ASX: { en: 'ASE Technology', ind: '半導體' }, HIMX: { en: 'Himax Technologies', ind: '半導體' },
  SIMO: { en: 'Silicon Motion Technology', ind: '半導體' }, MRVL: { en: 'Marvell Technology', ind: '半導體' }, CHT: { en: 'Chunghwa Telecom', ind: '通訊媒體' },
  BABA: { en: 'Alibaba Group', ind: '非必需消費' }, PDD: { en: 'PDD Holdings', ind: '非必需消費' }, JD: { en: 'JD.com', ind: '非必需消費' },
  BIDU: { en: 'Baidu', ind: '通訊媒體' }, NIO: { en: 'NIO', ind: '非必需消費' }, XPEV: { en: 'XPeng', ind: '非必需消費' }, LI: { en: 'Li Auto', ind: '非必需消費' },
  TCOM: { en: 'Trip.com Group', ind: '非必需消費' }, BEKE: { en: 'KE Holdings', ind: '房地產' },
  MSTR: { en: 'Strategy (MicroStrategy)', ind: '軟體' }, MARA: { en: 'MARA Holdings', ind: '金融' }, RIOT: { en: 'Riot Platforms', ind: '金融' },
  SNOW: { en: 'Snowflake', ind: '軟體' }, SHOP: { en: 'Shopify', ind: '軟體' }, SPOT: { en: 'Spotify', ind: '通訊媒體' }, SE: { en: 'Sea Limited', ind: '非必需消費' },
  MELI: { en: 'MercadoLibre', ind: '非必需消費' }, NVO: { en: 'Novo Nordisk', ind: '醫療保健' }, SONY: { en: 'Sony Group', ind: '非必需消費' },
  TM: { en: 'Toyota Motor', ind: '非必需消費' }, SAP: { en: 'SAP', ind: '軟體' }, RIVN: { en: 'Rivian Automotive', ind: '非必需消費' },
  SOFI: { en: 'SoFi Technologies', ind: '金融' }, RKLB: { en: 'Rocket Lab', ind: '工業' }, IONQ: { en: 'IonQ', ind: '資訊科技' }, ASTS: { en: 'AST SpaceMobile', ind: '通訊媒體' },
  // ETF
  SPY: { en: 'SPDR S&P 500 ETF', etf: 1 }, VOO: { en: 'Vanguard S&P 500 ETF', etf: 1 }, QQQ: { en: 'Invesco QQQ (Nasdaq-100)', etf: 1 }, DIA: { en: 'SPDR Dow Jones ETF', etf: 1 },
  IWM: { en: 'iShares Russell 2000 ETF', etf: 1 }, VTI: { en: 'Vanguard Total Stock Market ETF', etf: 1 }, SOXX: { en: 'iShares Semiconductor ETF', etf: 1 },
  SMH: { en: 'VanEck Semiconductor ETF', etf: 1 }, TLT: { en: 'iShares 20+ Year Treasury Bond ETF', etf: 1 }, GLD: { en: 'SPDR Gold Shares', etf: 1 },
  ARKK: { en: 'ARK Innovation ETF', etf: 1 }, TQQQ: { en: 'ProShares UltraPro QQQ (3x)', etf: 1 }, SOXL: { en: 'Direxion Semiconductor Bull 3X', etf: 1 },
  IBIT: { en: 'iShares Bitcoin Trust', etf: 1 }, SCHD: { en: 'Schwab US Dividend Equity ETF', etf: 1 },
};

// 常見的中文名稱（台灣習慣的叫法）
const zh = {
  AAPL: '蘋果', MSFT: '微軟', NVDA: '輝達', GOOGL: 'Alphabet A（谷歌）', GOOG: 'Alphabet C（谷歌）', AMZN: '亞馬遜', META: 'Meta（臉書）', TSLA: '特斯拉',
  AVGO: '博通', AMD: '超微', INTC: '英特爾', QCOM: '高通', MU: '美光', TXN: '德州儀器', ADI: '亞德諾', AMAT: '應用材料', LRCX: '科林研發', KLAC: '科磊',
  TER: '泰瑞達', MRVL: '邁威爾', ARM: '安謀', ASML: '艾司摩爾', TSM: '台積電 ADR', UMC: '聯電 ADR', ASX: '日月光 ADR', HIMX: '奇景光電', SIMO: '慧榮科技', CHT: '中華電信 ADR',
  SMCI: '美超微', DELL: '戴爾', HPQ: '惠普', HPE: '慧與', ANET: 'Arista 網路', CSCO: '思科', IBM: 'IBM', ORCL: '甲骨文', CRM: 'Salesforce', ADBE: 'Adobe', NOW: 'ServiceNow',
  PLTR: 'Palantir', CRWD: 'CrowdStrike', PANW: 'Palo Alto', SNOW: 'Snowflake', NFLX: '網飛', DIS: '迪士尼', UBER: 'Uber', ABNB: 'Airbnb', SHOP: 'Shopify', SPOT: 'Spotify',
  BRK_B: '波克夏 B', 'BRK.B': '波克夏 B', JPM: '摩根大通', BAC: '美國銀行', WFC: '富國銀行', C: '花旗', GS: '高盛', MS: '摩根士丹利', V: 'Visa', MA: '萬事達卡', AXP: '美國運通', PYPL: 'PayPal',
  COIN: 'Coinbase', HOOD: 'Robinhood', MSTR: 'Strategy（微策略）', MARA: 'MARA 礦機', RIOT: 'Riot 礦機', SOFI: 'SoFi',
  WMT: '沃爾瑪', COST: '好市多', HD: '家得寶', MCD: '麥當勞', SBUX: '星巴克', NKE: 'Nike', KO: '可口可樂', PEP: '百事', PG: '寶僑', TGT: '目標百貨', LULU: 'Lululemon',
  JNJ: '嬌生', LLY: '禮來', PFE: '輝瑞', MRK: '默克', ABBV: '艾伯維', UNH: '聯合健康', NVO: '諾和諾德', ISRG: '直覺手術', AMGN: '安進', MRNA: '莫德納',
  XOM: '埃克森美孚', CVX: '雪佛龍', BA: '波音', CAT: '開拓重工', GE: '奇異航太', LMT: '洛克希德馬丁', RTX: 'RTX 雷神', HON: '漢威聯合', UPS: '優比速', DE: '迪爾',
  T: 'AT&T', VZ: 'Verizon', TMUS: 'T-Mobile', CMCSA: '康卡斯特', F: '福特', GM: '通用汽車', RIVN: 'Rivian', TM: '豐田', SONY: '索尼', SAP: 'SAP',
  BABA: '阿里巴巴', PDD: '拼多多', JD: '京東', BIDU: '百度', NIO: '蔚來', XPEV: '小鵬汽車', LI: '理想汽車', TCOM: '攜程', BEKE: '貝殼', SE: 'Sea（蝦皮母公司）', MELI: 'MercadoLibre',
  VRT: 'Vertiv', ETN: '伊頓', GEV: 'GE Vernova', CEG: 'Constellation 能源', VST: 'Vistra', NEE: 'NextEra 能源', RKLB: 'Rocket Lab', IONQ: 'IonQ', ASTS: 'AST 太空行動',
  SPY: 'S&P 500 ETF（SPY）', VOO: 'S&P 500 ETF（VOO）', QQQ: '那斯達克100 ETF（QQQ）', DIA: '道瓊 ETF（DIA）', IWM: '羅素2000 ETF（IWM）', VTI: '全市場 ETF（VTI）',
  SOXX: '費半 ETF（SOXX）', SMH: '半導體 ETF（SMH）', TLT: '20年美債 ETF（TLT）', GLD: '黃金 ETF（GLD）', ARKK: '方舟創新 ETF', TQQQ: '三倍做多那斯達克（TQQQ）',
  SOXL: '三倍做多半導體（SOXL）', IBIT: '比特幣 ETF（IBIT）', SCHD: '高股息 ETF（SCHD）',
};

module.exports = { sector, EXTRA, zh };
