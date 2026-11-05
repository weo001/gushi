// 核心規則（不碰畫面，App、每日資料程式、測試都共用）
//   1. 積分經濟：看廣告賺點、用點解鎖報告、每日上限
//   2. 插頁廣告頻率：查股票時偶爾跳，不能太煩
//   3. 分析：白話解說（規則版）、深度報告、歷史相似情境
// 原則：只描述資料，不給買賣建議（台灣投顧法規）。
(function (root) {
  const C = {};

  // ───────────── 1. 積分經濟 ─────────────
  // 數字都集中在這裡，之後要調整只改這裡。
  C.ECON = {
    START: 10,            // 新使用者送的點數
    AD_REWARD: 3,         // 看完一支獎勵廣告給幾點
    AD_DAILY_MAX: 10,     // 每天最多看幾支獎勵廣告
    CHECKIN: 1,           // 每日簽到
    COST: { explain: 1, deep: 3, weekly: 2 }, // 白話解說 1 點、個股報告書 3 點、概念股週報 2 點
    GAME_FREE: 5,         // 盲測每天免費幾局
    GAME_AD_BONUS: 5,     // 看一支廣告多幾局
    INTER_EVERY: 3,       // 每查 3 檔股票跳 1 次插頁廣告
    INTER_GAP_MS: 120000, // 兩次插頁至少隔 2 分鐘
    INTER_AFTER_REWARD_MS: 60000, // 剛看完獎勵廣告 1 分鐘內不跳插頁
    INTER_NEW_FREE: 3,    // 新使用者前 3 次查詢不跳
  };
  C.KIND_NAME = { explain: '白話解說', deep: '個股報告書', weekly: '概念股週報' };

  // 台灣時間的日期字串 YYYY-MM-DD
  C.today = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);

  C.newState = (now = Date.now()) => ({
    v: 1, pts: C.ECON.START, day: C.today(now),
    adsToday: 0, checkinDay: '', unlocked: {}, opens: 0, opensSinceInter: 0, lastInter: 0, lastReward: 0,
    gameToday: 0, gameBonus: 0, game: { n: 0, win: 0, streak: 0, best: 0 },
    watch: ['2330', '2317', '0050'],
    log: [{ t: now, d: C.ECON.START, why: '新手禮' }],
    stats: { adsDone: 0, adsSkip: 0, adsNofill: 0, inter: 0, spent: 0 },
  });

  // 讀進來的存檔可能是舊版或壞掉的：補齊欄位
  C.load = (raw, now = Date.now()) => {
    let s; try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { s = null; }
    const base = C.newState(now);
    if (!s || typeof s !== 'object' || typeof s.pts !== 'number' || !isFinite(s.pts)) return base;
    const out = { ...base, ...s, game: { ...base.game, ...(s.game || {}) }, stats: { ...base.stats, ...(s.stats || {}) } };
    if (!Array.isArray(out.watch)) out.watch = base.watch;
    if (!Array.isArray(out.log)) out.log = [];
    if (!out.unlocked || typeof out.unlocked !== 'object') out.unlocked = {};
    out.pts = Math.max(0, Math.floor(out.pts));
    return C.rollDay(out, now);
  };

  // 換日：重置每日次數，清掉過期的解鎖（只保留今天的）
  C.rollDay = (s, now = Date.now()) => {
    const d = C.today(now);
    if (s.day !== d) {
      s.day = d; s.adsToday = 0; s.gameToday = 0; s.gameBonus = 0;
      for (const k of Object.keys(s.unlocked)) if (!k.endsWith('|' + d)) delete s.unlocked[k];
    }
    return s;
  };

  const addLog = (s, d, why, now) => { s.log.unshift({ t: now, d, why }); s.log.length = Math.min(s.log.length, 50); };

  C.adsLeft = (s) => Math.max(0, C.ECON.AD_DAILY_MAX - s.adsToday);

  // 看完獎勵廣告（只有「看完」才呼叫）
  C.grantAd = (s, now = Date.now()) => {
    C.rollDay(s, now);
    s.lastReward = now;
    if (C.adsLeft(s) <= 0) return { ok: false, why: 'cap' };
    s.adsToday++; s.pts += C.ECON.AD_REWARD; s.stats.adsDone++;
    addLog(s, C.ECON.AD_REWARD, '看廣告', now);
    return { ok: true, got: C.ECON.AD_REWARD };
  };

  C.canCheckin = (s, now = Date.now()) => s.checkinDay !== C.today(now);
  C.checkin = (s, now = Date.now()) => {
    if (!C.canCheckin(s, now)) return { ok: false };
    s.checkinDay = C.today(now); s.pts += C.ECON.CHECKIN;
    addLog(s, C.ECON.CHECKIN, '每日簽到', now);
    return { ok: true, got: C.ECON.CHECKIN };
  };

  // 解鎖：同一檔股票、同一種報告、同一個資料日，付一次當天都能重看
  const ukey = (code, kind, date) => `${code}|${kind}|${date}`;
  C.isUnlocked = (s, code, kind, dataDate, now = Date.now()) => !!s.unlocked[ukey(code, kind, dataDate) + '|' + C.today(now)];
  C.unlock = (s, code, kind, dataDate, now = Date.now()) => {
    C.rollDay(s, now);
    if (C.isUnlocked(s, code, kind, dataDate, now)) return { ok: true, paid: 0 };
    const cost = C.ECON.COST[kind];
    if (cost == null) return { ok: false, why: 'kind' };
    if (s.pts < cost) return { ok: false, why: 'pts', need: cost - s.pts, cost };
    s.pts -= cost; s.stats.spent += cost;
    s.unlocked[ukey(code, kind, dataDate) + '|' + C.today(now)] = true;
    addLog(s, -cost, `${C.KIND_NAME[kind]}・${code}`, now);
    return { ok: true, paid: cost };
  };

  // 廣告播不出來（沒廣告或壞掉）時不能讓人卡住：每天最多 FREE_PASS 次直接免費解鎖
  C.ECON.FREE_PASS = 3;
  C.unlockFree = (s, code, kind, dataDate, now = Date.now()) => {
    C.rollDay(s, now);
    if (s.passDay !== s.day) { s.passDay = s.day; s.passN = 0; }
    if (s.passN >= C.ECON.FREE_PASS) return { ok: false, why: 'pass' };
    s.passN++;
    s.unlocked[ukey(code, kind, dataDate) + '|' + C.today(now)] = true;
    addLog(s, 0, `${C.KIND_NAME[kind]}・${code}（廣告播不出來，免費）`, now);
    return { ok: true, paid: 0 };
  };

  // 打開一檔股票時呼叫：回傳要不要先跳插頁廣告
  C.onOpenStock = (s, now = Date.now()) => {
    s.opens++; s.opensSinceInter++;
    const E = C.ECON;
    if (s.opens <= E.INTER_NEW_FREE) return false;
    if (s.opensSinceInter < E.INTER_EVERY) return false;
    if (now - s.lastInter < E.INTER_GAP_MS) return false;
    if (now - s.lastReward < E.INTER_AFTER_REWARD_MS) return false;
    return true;
  };
  // 插頁真的播了（不管看完沒）才呼叫
  C.interShown = (s, now = Date.now()) => { s.lastInter = now; s.opensSinceInter = 0; s.stats.inter++; };

  // 盲測次數
  C.gameLeft = (s, now = Date.now()) => { C.rollDay(s, now); return Math.max(0, C.ECON.GAME_FREE + s.gameBonus - s.gameToday); };
  C.gameUse = (s, now = Date.now()) => { if (C.gameLeft(s, now) <= 0) return false; s.gameToday++; return true; };
  C.gameAdBonus = (s, now = Date.now()) => { C.rollDay(s, now); s.lastReward = now; s.gameBonus += C.ECON.GAME_AD_BONUS; s.stats.adsDone++; };
  // 盲測結果：方向對就算贏；方向對而且差距在 GAME_SHARP% 以內是「神準」，送 GAME_SHARP_BONUS 點
  C.ECON.GAME_SHARP = 3; C.ECON.GAME_SHARP_BONUS = 1;
  C.gameResult = (s, win, close = false, now = Date.now()) => {
    const g = s.game; g.n++;
    if (win) { g.win++; g.streak++; g.best = Math.max(g.best, g.streak); } else g.streak = 0;
    const sharp = !!(win && close);
    if (sharp) { g.sharp = (g.sharp || 0) + 1; s.pts += C.ECON.GAME_SHARP_BONUS; addLog(s, C.ECON.GAME_SHARP_BONUS, '盲測神準', now); }
    return { win: !!win, sharp };
  };

  C.toggleWatch = (s, code) => {
    const i = s.watch.indexOf(code);
    if (i >= 0) s.watch.splice(i, 1); else s.watch.unshift(code);
    return i < 0;
  };

  // ───────────── 2. 數字小工具 ─────────────
  const num = (x) => { if (x == null) return NaN; const n = parseFloat(String(x).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
  C.num = num;
  C.sma = (arr, n, end = arr.length) => { if (end < n) return NaN; let t = 0; for (let i = end - n; i < end; i++) t += arr[i]; return t / n; };
  const pct = (a, b) => (b ? (a / b - 1) * 100 : NaN);
  const r1 = (x) => Math.round(x * 10) / 10;
  const sgn = (x, d = 1) => { const t = x.toFixed(d); return /^-?0\.?0*$/.test(t) ? (0).toFixed(d) : (x > 0 ? '+' : '') + t; };
  const px = (v) => +(+v).toFixed(2);
  C.fmtPct = (x, d = 2) => (isFinite(x) ? sgn(x, d) + '%' : '—');
  C.fmtLots = (x) => { const a = Math.abs(Math.round(x)); return a >= 10000 ? r1(a / 10000) + ' 萬張' : a.toLocaleString('en-US') + ' 張'; };
  const upDown = (x) => (x > 0 ? '漲' : x < 0 ? '跌' : '平');

  // ───────────── 3. 白話解說（規則版；AI 版失敗或沒有金鑰時用）─────────────
  // ctx：{ code, name, close, chg, pct, volRatio, f, t, d (三大法人今天買賣超，張), mktPct, ind, indPct, indN, news:[{title}] }
  C.explainRule = (x) => {
    const out = [], tags = [];
    const p = x.pct;
    if (!isFinite(p)) return { text: `${x.name}今天沒有成交資料。`, tags: [] };
    // 漲跌停：台股 10%、陸股主板 10%／創業板科創板 20%／ST 5%；美股沒有（limit＝Infinity）
    const lim = Math.abs(p) >= (x.limit || 10) * 0.95;
    out.push(`${x.name}今天${p === 0 ? '平盤' : (lim ? (p > 0 ? '漲停' : '跌停') : upDown(p) + ' ' + Math.abs(p).toFixed(2) + '%')}，收 ${x.close} ${x.cur || '元'}。`);
    if (lim) tags.push(p > 0 ? '漲停' : '跌停');

    // 跟大盤、跟族群比
    const m = x.mktPct, ip = x.indPct;
    if (isFinite(ip) && x.indN >= 5 && Math.sign(ip) === Math.sign(p) && Math.abs(ip) >= 1 && Math.abs(p - ip) < Math.max(2, Math.abs(ip))) {
      out.push(`同產業（${x.ind}）${x.indN} 檔平均${upDown(ip)} ${Math.abs(ip).toFixed(1)}%，比較像是整個族群一起${upDown(p)}。`); tags.push('族群連動');
    } else if (isFinite(m) && Math.sign(m) === Math.sign(p) && Math.abs(p - m) < 1) {
      out.push(`大盤今天${upDown(m)} ${Math.abs(m).toFixed(2)}%，這檔大致跟著大盤走。`); tags.push('跟大盤');
    } else if (isFinite(m) && Math.abs(p - m) >= 2) {
      out.push(`大盤${upDown(m)} ${Math.abs(m).toFixed(2)}%，這檔${p > m ? '明顯比大盤強' : '明顯比大盤弱'}，比較可能是個股自己的消息。`); tags.push(p > m ? '比大盤強' : '比大盤弱');
    }

    // 成交量
    if (x.volRatio >= 2) { out.push(`成交量是最近 20 天平均的 ${r1(x.volRatio)} 倍，買賣非常熱絡。`); tags.push('爆量'); }
    else if (x.volRatio > 0 && x.volRatio < 0.6) { out.push(`成交量只有平常的 ${Math.round(x.volRatio * 100)}%，參與的人不多，${Math.abs(p) >= 3 ? '量小的漲跌比較不穩' : '走勢偏觀望'}。`); tags.push('量縮'); }

    // 三大法人
    const parts = [];
    const big = (v) => Math.abs(v) >= 200;
    if (isFinite(x.f) && big(x.f)) { parts.push(`外資${x.f > 0 ? '買超' : '賣超'} ${C.fmtLots(x.f)}`); tags.push(x.f > 0 ? '外資買' : '外資賣'); }
    if (isFinite(x.t) && big(x.t)) { parts.push(`投信${x.t > 0 ? '買超' : '賣超'} ${C.fmtLots(x.t)}`); tags.push(x.t > 0 ? '投信買' : '投信賣'); }
    if (isFinite(x.d) && big(x.d)) parts.push(`自營商${x.d > 0 ? '買超' : '賣超'} ${C.fmtLots(x.d)}`);
    if (parts.length) {
      const big3 = [x.f, x.t, x.d].filter((v) => isFinite(v) && big(v));
      const allSame = big3.every((v) => Math.sign(v) === Math.sign(big3[0]));
      const sum = (x.f || 0) + (x.t || 0) + (x.d || 0);
      let tail;
      if (!allSame) tail = '，法人之間看法分歧。';
      else if (Math.sign(sum) === Math.sign(p) && p !== 0) tail = `，方向和股價一致，法人${p > 0 ? '買盤' : '賣壓'}可能是主要力量之一。`;
      else tail = '，和股價方向相反，今天的漲跌比較不是法人造成的。';
      out.push(`法人方面：${parts.join('、')}${tail}`);
    }

    // 新聞
    const news = (x.news || []).slice(0, 2);
    if (news.length) out.push(`相關新聞：${news.map((n) => { const t = String(n.title).replace(/\s*-\s*[^-]{2,15}$/, ''); return '「' + (t.length > 34 ? t.slice(0, 33) + '…' : t) + '」'; }).join('、')}。`);
    else if (out.length <= 2) out.push('從公開資料看不出明確原因，可能是一般的買賣波動。');

    return { text: out.join(''), tags };
  };

  // 給 AI 的提示詞（每日資料程式用）
  C.aiPrompt = (x) => {
    if (x.mkt && x.mkt !== 'tw') return C.aiPromptG(x);
    const lines = [
      `股票：${x.name}（${x.code}），產業：${x.ind || '未知'}`,
      `今日收盤：${x.close} 元，漲跌 ${C.fmtPct(x.pct)}`,
      `大盤：${C.fmtPct(x.mktPct)}；同產業 ${x.indN || 0} 檔平均：${C.fmtPct(x.indPct)}`,
      `成交量是近 20 日平均的 ${isFinite(x.volRatio) ? r1(x.volRatio) : '未知'} 倍`,
      `三大法人今日買賣超（張）：外資 ${Math.round(x.f || 0)}、投信 ${Math.round(x.t || 0)}、自營商 ${Math.round(x.d || 0)}`,
      `今天的新聞標題：` + ((x.news || []).slice(0, 8).map((n, i) => `\n${i + 1}. ${n.title}`).join('') || '無'),
    ];
    return {
      system: '你是台股解說員，對象是投資新手。只能根據使用者提供的資料解釋這檔股票今天為什麼漲跌，資料裡沒有的事情不准猜、不准編造新聞或數字。只有在資料完全看不出原因時，才說「從公開資料看不出明確原因」；已經說明原因的話就不要再加這句。數字照資料寫，不要自己換算或加上資料沒有的點位。不可以給任何買進、賣出、目標價或預測建議。用繁體中文（台灣用語），寫 2 到 4 句，總共 150 字以內（一定要短），不要用條列、不要用 markdown。',
      user: lines.join('\n'),
    };
  };
  // 檢查 AI 回答能不能用（太短、太長、有建議字眼、簡體字太多就不用）
  // AI 已經講了原因，最後又補「看不出明確原因」→ 把那句拿掉（前後矛盾）
  C.aiClean = (t) => {
    if (!t) return t;
    const parts = t.split(/(?<=[。！])/);
    if (parts.length < 2) return t;
    const kept = parts.filter((x) => !/看不出明確原因/.test(x));
    return kept.length && kept.join('').length >= 40 ? kept.join('').trim() : t;
  };
  C.aiOk = (t, max = 320, min = 20) => {
    if (typeof t !== 'string') return false;
    t = t.trim();
    if (t.length < min || t.length > max) return false;
    if (/(建議|可以考慮|適合)(買進|進場|布局|加碼|賣出|減碼)|目標價|逢低買|逢高賣/.test(t)) return false;
    if (/可推測|暗示市場|推測是/.test(t)) return false; // 資料沒有的原因不准猜
    if (/(回升|上漲|上攻|反彈)空間|有望(上漲|回升|反彈|走高)/.test(t)) return false; // 不准預測會漲
    const simp = (t.match(/[这们说为时会来对个发经过还进间们后]/g) || []).length;
    return simp <= 2;
  };

  // ───────────── 3b. 盤後 AI 報告（伺服器每天產生）─────────────
  const RULES = '只能根據使用者提供的資料寫，資料裡沒有的事情不准猜、不准編造新聞或數字，數字照資料寫。不可以給任何買進、賣出、目標價、會漲會跌的預測或建議。用繁體中文（台灣用語），對象是投資新手，不要用條列、不要用 markdown。';
  // 個股報告書的「AI 結論」：讀規則版分析的結果，寫成一段有重點的總結
  C.reportPrompt = (name, code, R, mkt) => ({
    system: `你是${mkt && mkt !== 'tw' ? C.MARKETS[mkt].name : '台股'}研究助理，幫新手把一份分析資料整理成「結論」。寫 3 到 5 句、220 字以內：先講整體資料偏多還是偏空（照資料的訊號數），再挑最重要的 2 到 3 個重點，最後講最需要注意的風險。` + RULES,
    user: [`股票：${name}（${code}），資料日期 ${R.date}`, `整體：${R.summary}（偏多訊號 ${R.bull} 個、偏空訊號 ${R.bear} 個）`,
      ...R.sections.map((x) => `【${x.title}】${x.lines.join(' ')}`), `【風險】${R.risks.join(' ')}`].join('\n'),
  });
  // 盤後日報：第一行「標題：…」，接著內文
  C.dailyPrompt = (f) => ({
    system: '你是台股盤後日報的編輯，幫新手寫今天台股發生了什麼事。第一行寫「標題：」加 18 字以內的標題，下一行開始寫內文 4 到 6 句、300 字以內，依序講大盤和漲跌家數、三大法人、強勢和弱勢族群、焦點個股和原因（原因只能用資料裡的個股解說和新聞）。' + RULES,
    user: [`日期：${f.date}`, `加權指數 ${f.taiex}；櫃買指數 ${f.otc || '無資料'}`, `上漲 ${f.up} 家、下跌 ${f.down} 家、平盤 ${f.flat} 家`,
      `三大法人買賣超（估算，億元）：外資 ${f.inst.f}、投信 ${f.inst.t}、自營商 ${f.inst.d}`, `強勢族群：${f.strong}`, `弱勢族群：${f.weak}`,
      `成交值最大：${f.hot}`, `焦點個股解說：` + f.notes.map((x, i) => `\n${i + 1}. ${x}`).join(''), `新聞標題：` + f.news.map((x, i) => `\n${i + 1}. ${x}`).join('')].join('\n'),
  });
  C.parseDaily = (t) => {
    if (typeof t !== 'string') return null;
    const m = t.trim().match(/^標題[:：]\s*(.{4,30})\n+([\s\S]+)$/);
    if (!m) return null;
    const title = m[1].trim(), text = C.aiClean(m[2].trim());
    return C.aiOk(text, 420, 80) && C.aiOk(title, 30, 4) ? { title, text } : null;
  };
  // 概念股週報：一個族群一段
  C.groupPrompt = (g) => ({
    system: '你是台股族群觀察員，用 2 到 3 句、140 字以內，說明這個概念股族群這一週的表現：整體漲跌、誰最強誰最弱、有資料的話說明原因。' + RULES,
    user: [`族群：${g.name}`, `近 5 個交易日平均漲跌：${C.fmtPct(g.pct5)}（${g.from}～${g.to}）`,
      `成員近 5 日漲跌：` + g.members.map((m) => `${m[1]}${C.fmtPct(m[2])}`).join('、'),
      `本週相關個股解說：` + (g.notes.length ? g.notes.map((x, i) => `\n${i + 1}. ${x}`).join('') : '無')].join('\n'),
  });
  // ISO 週次，例如 2026-W45
  C.weekKey = (date) => {
    const d = new Date(Date.parse(date.slice(0, 10) + 'T00:00:00Z'));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // 移到同一週的星期四
    const y = d.getUTCFullYear();
    return y + '-W' + String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0');
  };
  // 族群近 n 日漲跌：hist = { dates:[...], c:{ code:[close,...] } }（跟 dates 對齊）
  C.groupWeek = (g, hist, names, n = 5) => {
    const L = hist.dates.length; if (L < 2) return null;
    const k = Math.max(0, L - 1 - n);
    const members = g.codes.map((c) => { const a = hist.c[c]; if (!a || !(a[k] > 0) || !(a[L - 1] > 0)) return null; return [c, names[c] || c, ((a[L - 1] / a[k]) - 1) * 100]; }).filter(Boolean);
    if (!members.length) return null;
    members.sort((a, b) => b[2] - a[2]);
    return { id: g.id, name: g.name, from: hist.dates[k], to: hist.dates[L - 1], pct5: members.reduce((a, b) => a + b[2], 0) / members.length, members };
  };

  // ───────────── 4. 深度報告 ─────────────
  // 輸入 FinMind 原始資料：prices（3 年日 K）、inst（三大法人）、margin（融資融券）、rev（月營收）、per（本益比）
  // 回傳 { summary, bull, bear, sections:[{icon,title,lines,tone}], risks:[], similar }
  C.analyze = (raw) => {
    const P = (raw.prices || []).filter((r) => r.close > 0);
    const cur = raw.cur || '元', vfmt = raw.volFmt || ((v) => C.fmtLots(v / 1000)); // 台股用「張」，陸股、美股用「股」
    if (P.length < 30) return { error: '歷史資料不足（上市未滿 30 個交易日）' };
    const close = P.map((r) => r.close), n = close.length, last = P[n - 1], c = last.close;
    const sections = [], risks = [];
    let bull = 0, bear = 0;
    const sig = (b) => { if (b > 0) bull++; else if (b < 0) bear++; };

    // 股價位置
    const ma20 = C.sma(close, 20), ma60 = C.sma(close, 60), ma240 = C.sma(close, 240);
    const yr = P.slice(-240), hi = Math.max(...yr.map((r) => r.max || r.close)), lo = Math.min(...yr.map((r) => r.min || r.close));
    const pos = hi > lo ? (c - lo) / (hi - lo) : 0.5;
    const ret = (k) => (n > k ? pct(c, close[n - 1 - k]) : NaN);
    const r5 = ret(5), r20 = ret(20), r60 = ret(60), r240 = ret(240);
    const L = [];
    L.push(`近 1 週 ${C.fmtPct(r5, 1)}、近 1 月 ${C.fmtPct(r20, 1)}、近 3 月 ${C.fmtPct(r60, 1)}${isFinite(r240) ? '、近 1 年 ' + C.fmtPct(r240, 1) : ''}。`);
    L.push(`在過去一年的高低區間（${px(lo)}～${px(hi)} ${cur}）裡，現在位於 ${Math.round(pos * 100)}% 的位置${pos >= 0.9 ? '，接近一年高點' : pos <= 0.1 ? '，接近一年低點' : ''}。`);
    const above = (m) => (isFinite(m) ? (c >= m ? '之上' : '之下') : null);
    const mas = [['月線（20 日）', ma20], ['季線（60 日）', ma60], ['年線（240 日）', ma240]].filter(([, m]) => isFinite(m));
    L.push('股價在' + mas.map(([k, m]) => `${k}${above(m)}`).join('、') + '。');
    if (isFinite(ma60)) sig(c >= ma60 ? 1 : -1);
    if (isFinite(ma240)) sig(c >= ma240 ? 1 : -1);
    const bias20 = pct(c, ma20);
    if (bias20 >= 15) { risks.push(`股價比月線高 ${r1(bias20)}%，短期漲多，波動可能變大。`); }
    if (bias20 <= -15) risks.push(`股價比月線低 ${r1(-bias20)}%，短期跌深，賣壓還沒穩定前波動大。`);
    if (isFinite(ma60) && c < ma60 && close[n - 2] >= C.sma(close, 60, n - 1)) risks.push('今天剛跌破季線（60 日均線）。');
    sections.push({ icon: '📈', title: '股價位置', lines: L, tone: isFinite(ma60) ? (c >= ma60 ? 1 : -1) : 0 });

    // 成交量
    const vol = P.map((r) => r.Trading_Volume || 0);
    const v20 = C.sma(vol, 20, n - 1), vr = v20 ? vol[n - 1] / v20 : NaN;
    if (isFinite(vr)) sections.push({ icon: '📊', title: '成交量', tone: 0, lines: [`最近一天成交 ${vfmt(vol[n - 1])}，是前 20 天平均的 ${r1(vr)} 倍${vr >= 2 ? '（爆量）' : vr < 0.6 ? '（量縮）' : ''}。`] });

    // 三大法人
    const inst = raw.inst || [];
    if (inst.length) {
      const byDay = {};
      for (const r of inst) {
        const d = (byDay[r.date] ||= { f: 0, t: 0, d: 0 });
        const v = ((r.buy || 0) - (r.sell || 0)) / 1000;
        if (r.name === 'Foreign_Investor' || r.name === 'Foreign_Dealer_Self') d.f += v;
        else if (r.name === 'Investment_Trust') d.t += v;
        else if (/^Dealer/.test(r.name)) d.d += v;
      }
      const days = Object.keys(byDay).sort(), D = days.map((k) => byDay[k]);
      const sum = (key, k) => D.slice(-k).reduce((a, b) => a + b[key], 0);
      let streak = 0; const s0 = Math.sign(D[D.length - 1].f);
      for (let i = D.length - 1; i >= 0 && s0 && Math.sign(D[i].f) === s0; i--) streak++;
      const f5 = sum('f', 5), f20 = sum('f', 20), t5 = sum('t', 5), t20 = sum('t', 20);
      const LL = [
        `外資：近 5 天${f5 >= 0 ? '買超' : '賣超'} ${C.fmtLots(f5)}，近 20 天${f20 >= 0 ? '買超' : '賣超'} ${C.fmtLots(f20)}${streak >= 3 ? `，已經連續 ${streak} 天${s0 > 0 ? '買超' : '賣超'}` : ''}。`,
        `投信：近 5 天${t5 >= 0 ? '買超' : '賣超'} ${C.fmtLots(t5)}，近 20 天${t20 >= 0 ? '買超' : '賣超'} ${C.fmtLots(t20)}。`,
      ];
      const avgVol20 = v20 / 1000 || 1;
      const strong = (x) => Math.abs(x) >= avgVol20 * 0.5; // 20 天累計超過半天的量才算明顯
      if (strong(f20)) sig(Math.sign(f20));
      if (strong(t20)) sig(Math.sign(t20));
      if (streak >= 5 && s0 < 0) risks.push(`外資已經連續 ${streak} 天賣超。`);
      sections.push({ icon: '🏦', title: '法人籌碼', lines: LL, tone: Math.sign(f20 + t20) });
    }

    // 融資
    const mg = (raw.margin || []).filter((r) => r.MarginPurchaseTodayBalance != null);
    if (mg.length >= 2) {
      const a = mg[Math.max(0, mg.length - 21)].MarginPurchaseTodayBalance, b = mg[mg.length - 1].MarginPurchaseTodayBalance;
      const ch = pct(b, a);
      const LL = [`融資餘額 ${C.fmtLots(b)}，近 20 天${isFinite(ch) ? (ch >= 0 ? '增加 ' : '減少 ') + Math.abs(r1(ch)) + '%' : '變化不明'}。`];
      if (isFinite(ch) && ch >= 20 && r20 < 5) { risks.push(`融資近 20 天增加 ${r1(ch)}%，但股價沒有跟著漲，散戶追價的籌碼變多。`); sig(-1); }
      if (isFinite(ch) && ch <= -15 && r20 > 0) LL.push('融資減少、股價上漲，籌碼比較乾淨。');
      sections.push({ icon: '💳', title: '融資（散戶借錢買）', lines: LL, tone: 0 });
    }

    // 月營收
    const rv = (raw.rev || []).filter((r) => r.revenue > 0);
    if (rv.length >= 13) {
      const key = (r) => r.revenue_year * 100 + r.revenue_month;
      const map = new Map(rv.map((r) => [key(r), r.revenue]));
      const yoy = (r) => { const p = map.get((r.revenue_year - 1) * 100 + r.revenue_month); return p ? pct(r.revenue, p) : NaN; };
      const last3 = rv.slice(-3), y3 = last3.map(yoy);
      const lr = rv[rv.length - 1];
      const max12 = Math.max(...rv.slice(-13, -1).map((r) => r.revenue));
      const LL = [`最新月營收（${lr.revenue_year} 年 ${lr.revenue_month} 月）${r1(lr.revenue / 1e8).toLocaleString('en-US')} 億元，比去年同月 ${C.fmtPct(y3[2], 1)}。`,
        `近 3 個月年增率：${y3.map((x) => C.fmtPct(x, 1)).join('、')}。`];
      if (lr.revenue > max12) LL.push('創下最近一年新高。');
      const good = y3.filter((x) => x > 0).length, avg = y3.filter(isFinite).reduce((a, b) => a + b, 0) / 3;
      if (good === 3 && avg > 10) sig(1);
      if (good === 0) { sig(-1); risks.push('月營收已經連續 3 個月比去年衰退。'); }
      sections.push({ icon: '💰', title: '月營收', lines: LL, tone: good >= 2 ? 1 : good === 0 ? -1 : 0 });
    }

    // 本益比
    const pe = (raw.per || []).filter((r) => r.PER > 0);
    if (pe.length >= 20) {
      const now = pe[pe.length - 1], arr = pe.map((r) => r.PER).sort((a, b) => a - b);
      const rank = arr.filter((x) => x <= now.PER).length / arr.length;
      const LL = [`本益比 ${now.PER} 倍${now.PBR != null ? `、股價淨值比 ${now.PBR} 倍` : ''}${now.dividend_yield != null ? `、殖利率 ${now.dividend_yield}%` : ''}。`,
        `本益比在自己過去一年的區間（${arr[0]}～${arr[arr.length - 1]} 倍）中位於 ${Math.round(rank * 100)}% 的位置${rank >= 0.9 ? '，比過去一年大部分時候都貴' : rank <= 0.1 ? '，比過去一年大部分時候都便宜' : ''}。`];
      if (rank >= 0.9) risks.push('本益比接近一年最高，市場已經給了比較高的期待。');
      sections.push({ icon: '🏷️', title: '評價（貴不貴）', lines: LL, tone: rank >= 0.9 ? -1 : rank <= 0.2 ? 1 : 0 });
    }

    // 歷史相似情境
    const similar = C.similar(P);
    if (similar) sections.push({
      icon: '🔁', title: '歷史相似情境', tone: 0,
      lines: [`過去 ${similar.years} 年裡，這檔股票有 ${similar.n} 次走勢和現在很像（近 1 週、近 1 月漲跌和離季線的距離）。`,
        `那些時候之後 10 個交易日：上漲 ${similar.up} 次、下跌 ${similar.n - similar.up} 次，平均 ${C.fmtPct(similar.avg, 1)}，最好 ${C.fmtPct(similar.best, 1)}、最差 ${C.fmtPct(similar.worst, 1)}。`,
        '這是過去的統計，不代表未來一定這樣走。'],
    });

    if (!risks.length) risks.push('目前資料裡沒有看到特別明顯的警訊，但這不代表沒有風險。');
    const summary = bull > bear + 1 ? `資料面偏多：${bull} 個偏多訊號、${bear} 個偏空訊號。`
      : bear > bull + 1 ? `資料面偏弱：${bear} 個偏空訊號、${bull} 個偏多訊號。`
        : `資料面多空差不多：偏多 ${bull} 個、偏空 ${bear} 個。`;
    return { date: last.date, close: c, summary, bull, bear, sections, risks, similar };
  };

  // 找歷史上和現在最像的時候，看之後 h 天的漲跌
  C.similar = (P, h = 10, k = 20) => {
    const close = P.map((r) => r.close), n = close.length;
    if (n < 140) return null;
    const feat = (i) => { const m = C.sma(close, 60, i + 1); return [pct(close[i], close[i - 5]), pct(close[i], close[i - 20]), pct(close[i], m)]; };
    const rows = [];
    for (let i = 60; i < n - h; i++) rows.push({ i, f: feat(i), out: pct(close[i + h], close[i]) });
    const cur = feat(n - 1);
    const sd = [0, 1, 2].map((j) => { const xs = rows.map((r) => r.f[j]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; });
    rows.forEach((r) => { r.dist = Math.hypot(...r.f.map((v, j) => (v - cur[j]) / sd[j])); });
    rows.sort((a, b) => a.dist - b.dist);
    const pick = [];
    for (const r of rows) { if (pick.length >= k) break; if (pick.every((p) => Math.abs(p.i - r.i) >= 5)) pick.push(r); }
    if (pick.length < 8) return null;
    const outs = pick.map((p) => p.out);
    return {
      n: pick.length, up: outs.filter((x) => x > 0).length, avg: outs.reduce((a, b) => a + b, 0) / outs.length,
      best: Math.max(...outs), worst: Math.min(...outs), years: Math.max(1, Math.round(n / 245)), dates: pick.map((p) => P[p.i].date),
    };
  };

  // ───────────── 4b. 多市場：台股、美股、陸股 ─────────────
  // 三個市場都是「盤後」：收盤後伺服器統一抓資料、寫 AI 報告；App 上寫清楚各市場幾點收盤（換成台灣時間）
  C.MARKETS = {
    tw: { id: 'tw', name: '台股', flag: '🇹🇼', cur: '元', idxName: '加權指數', limit: 10, src: '臺灣證券交易所、證券櫃檯買賣中心、FinMind' },
    us: { id: 'us', name: '美股', flag: '🇺🇸', cur: '美元', idxName: 'S&P 500', limit: Infinity, newsEn: true, valUnit: '億美元', capUnit: '億美元', src: 'Massive（Polygon.io）' },
    cn: { id: 'cn', name: '陸股', flag: '🇨🇳', cur: '人民幣', idxName: '上證指數', limit: 10, valUnit: '億人民幣', capUnit: '億人民幣', src: 'BaoStock（證券寶）' },
  };
  C.MKT_IDS = ['tw', 'us', 'cn'];
  // 陸股漲跌停：主板 10%、創業板（300/301）和科創板（688）20%、ST 股 5%
  C.cnLimit = (code, name) => (/ST/.test(name || '') ? 5 : /^(30|688)/.test(code) ? 20 : 10);
  // 美國夏令時間：3 月第二個星期日 ～ 11 月第一個星期日（用美東日期判斷）
  C.usDST = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    const sun = (mon, k) => { const w = new Date(Date.UTC(y, mon - 1, 1)).getUTCDay(); return 1 + ((7 - w) % 7) + (k - 1) * 7; };
    if (m > 3 && m < 11) return true;
    if (m === 3) return d >= sun(3, 2);
    if (m === 11) return d < sun(11, 1);
    return false;
  };
  // 美東現在的日期（先用冬令 -5 小時算日期，再看那天是不是夏令）
  C.nyDate = (now = Date.now()) => { const d0 = new Date(now - 5 * 3600e3).toISOString().slice(0, 10); return new Date(now - (C.usDST(d0) ? 4 : 5) * 3600e3).toISOString().slice(0, 10); };
  // 收盤時間說明（台灣時間）：short＝頂部的一小段字，lines＝首頁說明卡
  C.closeInfo = (mkt, now = Date.now()) => {
    if (mkt === 'us') {
      const dst = C.usDST(C.nyDate(now)), close = dst ? '04:00' : '05:00', open = dst ? '21:30' : '22:30';
      return {
        short: `台灣 ${close} 收盤`, dst,
        title: `美股收盤＝台灣清晨 ${close}`,
        lines: [`美股（紐約證交所、那斯達克）美東時間 09:30 開盤、16:00 收盤。`,
          `現在是美國${dst ? '夏令' : '冬令'}時間：台灣晚上 ${open} 開盤、隔天清晨 ${close} 收盤。`,
          `夏令時間（3 月第二個週日～11 月第一個週日）收盤是台灣 04:00，冬令時間是 05:00。`,
          `本 App 約台灣早上 06:30 更新，所以台灣白天看到的是「前一晚」的美股。`],
      };
    }
    if (mkt === 'cn') return {
      short: '台灣 15:00 收盤', title: '陸股收盤＝台灣 15:00',
      lines: ['陸股（上海、深圳交易所）09:30 開盤、15:00 收盤，中午 11:30～13:00 休息。', '北京時間和台灣時間一樣，不用換算。', '本 App 收盤後約台灣 17:30 更新。'],
    };
    return {
      short: '台灣 13:30 收盤', title: '台股收盤＝台灣 13:30',
      lines: ['台股（證交所、櫃買中心）09:00 開盤、13:30 收盤。', '三大法人買賣超約 16:00 後才公布，所以本 App 約 17:30 更新、20:30 再補一次。'],
    };
  };
  // 資料日期的說法：美股是「美東 11/04 收盤（台灣 11/05 清晨）」
  C.dateLabel = (mkt, date) => {
    if (!date) return '';
    const md = (d) => d.slice(5).replace('-', '/');
    if (mkt === 'us') return `美東 ${md(date)} 收盤（台灣 ${md(new Date(Date.parse(date) + 864e5).toISOString().slice(0, 10))} 清晨）`;
    return `${md(date)} 收盤`;
  };

  // 美股、陸股的白話解說提示詞（沒有三大法人，改給近 5／20 日漲跌）
  C.aiPromptG = (x) => {
    const g = C.MARKETS[x.mkt];
    const lines = [
      `股票：${x.name}（${x.code}），產業：${x.ind || '未知'}`,
      `今日收盤：${x.close} ${g.cur}，漲跌 ${C.fmtPct(x.pct)}`,
      `大盤（${g.idxName}）：${C.fmtPct(x.mktPct)}；同產業 ${x.indN || 0} 檔平均：${C.fmtPct(x.indPct)}`,
      `成交量是近 20 日平均的 ${isFinite(x.volRatio) ? r1(x.volRatio) : '未知'} 倍`,
      `近 5 個交易日 ${C.fmtPct(x.r5)}、近 20 個交易日 ${C.fmtPct(x.r20)}`,
      `今天的新聞標題${g.newsEn ? '（英文）' : ''}：` + ((x.news || []).slice(0, 8).map((n, i) => `\n${i + 1}. ${n.title}`).join('') || '無'),
    ];
    return {
      system: `你是${g.name}解說員，對象是台灣的投資新手。只能根據使用者提供的資料解釋這檔股票今天為什麼漲跌，資料裡沒有的事情不准猜、不准編造新聞或數字。先照數字比較：漲跌幅比大盤、比同產業是強還是弱（跌得比較多就是比較弱）。${g.newsEn ? '新聞標題是英文，請用中文講重點，不要直接貼英文句子；只有標題講到這家公司具體發生的事（財報、產品、合約、法規、併購、分析師調整評等…）才拿來說明原因，一般評論文章就不要提。不准用「暗示」「可推測」「可能是因為市場對…」這種猜測。' :'資料沒有新聞，就從大盤、同產業、成交量、近期漲跌來說明，不要提到「沒有新聞」。'}只有在資料完全看不出原因時，才說「從公開資料看不出明確原因」；已經說明原因的話就不要再加這句。數字照資料寫。不可以給任何買進、賣出、目標價或預測建議。用繁體中文（台灣用語），寫 2 到 4 句，總共 150 字以內（一定要短），不要用條列、不要用 markdown。`,
      user: lines.join('\n'),
    };
  };
  // 美股、陸股的盤後日報
  C.dailyPromptG = (f) => {
    const g = C.MARKETS[f.mkt];
    return {
      system: `你是${g.name}盤後日報的編輯，幫台灣的投資新手寫${g.name}今天發生了什麼事。第一行寫「標題：」加 18 字以內的標題，下一行開始寫內文 4 到 6 句、300 字以內，依序講主要指數和漲跌家數、強勢和弱勢產業、焦點個股和原因（原因只能用資料裡的個股解說和新聞${g.newsEn ? '；新聞是英文，用中文講重點' : ''}）。內文一定要在 300 字以內。${f.mkt === 'us' ? '指數是用追蹤指數的 ETF 代表，只寫漲跌幅，不要寫點數。' : ''}` + RULES,
      user: [`日期：${f.date}（${g.name}當地收盤）`, `主要指數：${f.idx}`, `上漲 ${f.up} 家、下跌 ${f.down} 家、平盤 ${f.flat} 家（收錄範圍：${f.scope}）`,
        `強勢產業：${f.strong}`, `弱勢產業：${f.weak}`, `成交值最大：${f.hot}`,
        `焦點個股解說：` + (f.notes.map((x, i) => `\n${i + 1}. ${x}`).join('') || '無'), `新聞標題：` + (f.news.map((x, i) => `\n${i + 1}. ${x}`).join('') || '無')].join('\n'),
    };
  };
  // 美股、陸股的概念股群組（熱力圖用；收錄範圍外的代號會自動略過）
  C.GROUPS_BY = {
    us: [
      { id: 'm7', name: '七巨頭', codes: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'] },
      { id: 'aichip', name: 'AI 晶片', codes: ['NVDA', 'AMD', 'AVGO', 'TSM', 'MRVL', 'ARM', 'QCOM', 'INTC', 'MU'] },
      { id: 'semieq', name: '半導體設備', codes: ['ASML', 'AMAT', 'LRCX', 'KLAC', 'TER'] },
      { id: 'soft', name: '雲端軟體', codes: ['ORCL', 'CRM', 'NOW', 'ADBE', 'SNOW', 'PLTR', 'CRWD', 'PANW', 'DDOG'] },
      { id: 'twadr', name: '台灣相關 ADR', codes: ['TSM', 'UMC', 'ASX', 'HIMX', 'CHT', 'SIMO'] },
      { id: 'china', name: '中概股', codes: ['BABA', 'PDD', 'JD', 'BIDU', 'NIO', 'XPEV', 'LI', 'TCOM', 'BEKE'] },
      { id: 'crypto', name: '加密貨幣概念', codes: ['COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT'] },
      { id: 'bank', name: '金融', codes: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA'] },
      { id: 'etf', name: '熱門 ETF', codes: ['SPY', 'VOO', 'QQQ', 'DIA', 'IWM', 'SOXX', 'SMH', 'TLT'] },
    ],
    cn: [
      { id: 'liquor', name: '白酒', codes: ['600519', '000858', '000568', '600809', '002304', '000596'] },
      { id: 'ev', name: '新能源車', codes: ['300750', '002594', '601127', '002460', '002466', '601633', '600104'] },
      { id: 'semi', name: '半導體', codes: ['688981', '603501', '002371', '688012', '603986', '688256', '600584'] },
      { id: 'ai', name: 'AI 算力', codes: ['688256', '601138', '300308', '300502', '000977', '603019', '002230'] },
      { id: 'solar', name: '光伏', codes: ['601012', '600438', '300274', '002129', '688599'] },
      { id: 'bank', name: '銀行', codes: ['601398', '601288', '601939', '601988', '600036', '601166', '000001'] },
      { id: 'broker', name: '券商保險', codes: ['600030', '300059', '601688', '601318', '601628'] },
      { id: 'home', name: '家電消費', codes: ['000333', '000651', '600690', '603288', '600887'] },
    ],
  };
  C.groupsOf = (mkt) => (mkt && mkt !== 'tw' ? C.GROUPS_BY[mkt] || [] : C.GROUPS);
  // 成交量：美股、陸股用「股」
  C.fmtShares = (v) => { const a = Math.abs(v || 0); return a >= 1e8 ? r1(a / 1e8) + ' 億股' : a >= 1e4 ? Math.round(a / 1e4).toLocaleString('en-US') + ' 萬股' : Math.round(a).toLocaleString('en-US') + ' 股'; };

  // ───────────── 5. 熱力圖 ─────────────
  // Squarified treemap：把一群數值切成「盡量接近正方形」的方塊，面積和數值成正比
  // items：[{ v, ... }]（v 要 > 0），回傳每個加上 x, y, w, h
  C.squarify = (items, x, y, w, h) => {
    const list = items.filter((it) => it.v > 0).sort((a, b) => b.v - a.v);
    const total = list.reduce((a, b) => a + b.v, 0);
    if (!total || w <= 0 || h <= 0) return [];
    const k = (w * h) / total;
    const nodes = list.map((it) => ({ it, a: it.v * k }));
    const out = [], R = { x, y, w, h };
    const worst = (row, side) => {
      let s = 0, mx = 0, mn = Infinity;
      for (const r of row) { s += r.a; if (r.a > mx) mx = r.a; if (r.a < mn) mn = r.a; }
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    const lay = (row) => {
      const s = row.reduce((a, b) => a + b.a, 0);
      if (R.w >= R.h) { // 直的一欄放左邊
        const cw = s / R.h; let yy = R.y;
        for (const r of row) { const hh = r.a / cw; out.push({ ...r.it, x: R.x, y: yy, w: cw, h: hh }); yy += hh; }
        R.x += cw; R.w -= cw;
      } else {           // 橫的一列放上面
        const rh = s / R.w; let xx = R.x;
        for (const r of row) { const ww = r.a / rh; out.push({ ...r.it, x: xx, y: R.y, w: ww, h: rh }); xx += ww; }
        R.y += rh; R.h -= rh;
      }
    };
    let row = [];
    for (let i = 0; i < nodes.length;) {
      const side = Math.min(R.w, R.h);
      if (!row.length || worst([...row, nodes[i]], side) <= worst(row, side)) row.push(nodes[i++]);
      else { lay(row); row = []; }
    }
    if (row.length) lay(row);
    return out;
  };

  // 顏色：台股紅漲綠跌；越深代表漲跌越多。scale＝顏色到最深的漲跌幅（預設 ±6%），漲停跌停另外加深
  C.heatColor = (p, scale = 6) => {
    if (p == null || !isFinite(p)) return '#2a3040';
    const base = [42, 48, 64], up = [229, 56, 59], dn = [22, 163, 92];
    if (Math.abs(p) >= 9.5) return p > 0 ? '#ff1f3d' : '#00c46a';
    const t = Math.pow(Math.min(1, Math.abs(p) / scale), 0.7), to = p > 0 ? up : dn;
    return 'rgb(' + base.map((b, i) => Math.round(b + (to[i] - b) * t)).join(',') + ')';
  };

  // 概念股群組（人工整理，只放代表性的股票；成分會變，App 上有註明「僅供參考」）
  C.GROUPS = [
    { id: 'ai', name: 'AI 伺服器', codes: ['2317', '2382', '3231', '6669', '2356', '2376', '2357', '3706', '6414', '2324'] },
    { id: 'cool', name: '散熱', codes: ['3017', '3324', '3653', '2421', '6230', '8996', '3338'] },
    { id: 'cowos', name: 'CoWoS 先進封裝', codes: ['2330', '3711', '3131', '3583', '6187', '3680', '6515', '2449'] },
    { id: 'cpo', name: '矽光子 CPO', codes: ['3363', '4979', '3081', '3450', '6442', '2455', '4908', '3163'] },
    { id: 'asic', name: 'IC 設計', codes: ['2454', '3443', '3661', '3035', '5269', '2379', '3034', '6415', '8299'] },
    { id: 'pcb', name: 'PCB／CCL', codes: ['2383', '6274', '6213', '3037', '8046', '3189', '2368', '1815', '4958'] },
    { id: 'mem', name: '記憶體', codes: ['2408', '2344', '2337', '3260', '4967', '8299', '3006'] },
    { id: 'power', name: '重電／電網', codes: ['1503', '1504', '1513', '1519', '1514', '1609'] },
    { id: 'robot', name: '機器人', codes: ['2049', '1590', '4583', '2359', '8374', '2365'] },
    { id: 'ship', name: '航運', codes: ['2603', '2609', '2615', '2618', '2610', '2606', '2637', '5608'] },
    { id: 'fin', name: '金控', codes: ['2881', '2882', '2891', '2886', '2884', '2885', '2892', '2880', '2887', '2883', '2890', '5880'] },
    { id: 'etf', name: '熱門 ETF', codes: ['0050', '0056', '00878', '00919', '00929', '006208', '00713', '00940', '00981A'] },
  ];

  if (typeof module === 'object' && module.exports) module.exports = C; else root.Core = C;
})(typeof window !== 'undefined' ? window : globalThis);
