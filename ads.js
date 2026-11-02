// 廣告模組：app 只呼叫 Ads.rewarded() 和 Ads.interstitial()，不管背後是哪家廣告商。
// - 網頁版／模擬器：播假廣告（測試用）
// - 包成 App（Capacitor 7）後：自動改用 Google AdMob（@capacitor-community/admob 7.2.0）
//   寫法照「萬劍誅魔」（已在真機跑通）：不用 registerPlugin，直接 Capacitor.nativePromise('AdMob', …)。
//   帳號和串接步驟：Desktop\claude\筆記本\AdMob 帳號資料與串接方法.md
// 回傳結果：completed＝看完了　skipped＝中途關掉　nofill＝沒有廣告可播　error＝廣告壞掉
// 「沒廣告可播」和「廣告壞掉」不能卡住使用者：查股票照樣能查，只是領不到點數。
(function () {
  // AdMob 帳號 brucectobnb@gmail.com（發布商 pub-4447189266414871）。
  // 「股市白話通」還沒在 AdMob 建 App：建好後把下面 PROD 換成正式編號，ADS_TEST 改成 false。
  // 自己的手機測正式廣告前，要先在 AdMob「設定→測試裝置」加上這台手機，不然會被當成無效流量。
  const ADS_TEST = true;
  const TEST = {
    ios: { rewarded: 'ca-app-pub-3940256099942544/1712485313', interstitial: 'ca-app-pub-3940256099942544/4411468910' },
    android: { rewarded: 'ca-app-pub-3940256099942544/5224354917', interstitial: 'ca-app-pub-3940256099942544/1033173712' },
  };
  const PROD = { // TODO：在 AdMob 建好「股市白話通」後填入
    ios: { rewarded: '', interstitial: '' },
    android: { rewarded: '', interstitial: '' },
  };

  // 假廣告的模式（測試工具和模擬器可以切換；三台模擬手機共用）
  const MODE_KEY = 'gushi-admode';
  const MODES = { normal: '正常（15 秒）', fast: '快速（3 秒，測試用）', nofill: '沒有廣告可播', error: '廣告載入失敗' };
  const mode = () => { try { return localStorage.getItem(MODE_KEY) || 'normal'; } catch { return 'normal'; } };
  const setMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch {} };

  const LABEL = { points: '領取點數', game: '多玩 5 局' };
  let lastAdAt = 0;            // 上一則「獎勵廣告」播完的時間（剛看完獎勵廣告不接著跳插頁；插頁頻率在 core.js）
  let onEvent = () => {};      // app 用來記錄廣告數據

  // ── 真的 AdMob（包成 App 後才會走這裡）──
  const CAP = window.Capacitor;
  const native = () => !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform() && typeof CAP.nativePromise === 'function');
  const platform = () => (CAP && CAP.getPlatform && CAP.getPlatform() === 'android' ? 'android' : 'ios');
  const unit = (kind) => { const p = (ADS_TEST ? TEST : PROD)[platform()][kind]; return p || TEST[platform()][kind]; };
  const call = (m, o) => CAP.nativePromise('AdMob', m, o || {});
  const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('逾時')), ms))]);
  let inited = false, ready = false, loading = null;
  async function init() {
    if (inited) return;
    // 1. 歐洲等地區：Google 的同意視窗（台灣通常不會出現）
    try { const c = await timed(call('requestConsentInfo'), 10000); if (c.isConsentFormAvailable && c.status === 'REQUIRED') await call('showConsentForm'); } catch (e) {}
    // 2. iPhone「是否允許追蹤」視窗（只問一次；不允許也能看廣告）
    try { const t = await call('trackingAuthorizationStatus'); if (t.status === 'notDetermined') await call('requestTrackingAuthorization'); } catch (e) {}
    await call('initialize', { initializeForTesting: ADS_TEST });
    inited = true;
  }
  // 先在背景載好一支獎勵廣告，按「送出」時不用等
  function load() {
    if (ready) return Promise.resolve();
    if (!loading) loading = timed(call('prepareRewardVideoAd', { adId: unit('rewarded'), isTesting: ADS_TEST }), 20000)
      .then(() => { ready = true; }).catch(() => {}).finally(() => { loading = null; });
    return loading;
  }
  async function nativeRewarded() {
    try { await init(); await load(); } catch (e) { return 'error'; }
    if (!ready) return 'nofill';
    ready = false;
    // showRewardVideoAd 只在「看完」時才回傳；中途關掉要靠 Dismissed 事件
    return new Promise((res) => {
      let got = false, done = false; const ls = [];
      const end = () => { if (done) return; done = true; ls.forEach((l) => l && l.remove && l.remove()); setTimeout(() => res(got ? 'completed' : 'skipped'), 300); setTimeout(load, 1500); };
      if (CAP.addListener) for (const ev of ['onRewardedVideoAdDismissed', 'onRewardedVideoAdFailedToShow']) ls.push(CAP.addListener('AdMob', ev, end));
      call('showRewardVideoAd').then(() => { got = true; if (!CAP.addListener) end(); }).catch(end);
    });
  }
  async function nativeInterstitial() {
    try { await init(); await timed(call('prepareInterstitial', { adId: unit('interstitial'), isTesting: ADS_TEST }), 15000); await call('showInterstitial'); return 'completed'; }
    catch (e) { return 'nofill'; }
  }
  // App 開起來就先在背景載好（不跳任何視窗：同意／追蹤視窗等第一次播廣告才問）
  function preload() { if (native() && inited) load(); }

  // ── 假廣告（網頁版／測試）──
  function mockRewarded(placement) {
    return new Promise((done) => {
      const m = mode();
      if (m === 'nofill' || m === 'error') return setTimeout(() => done(m), 600);
      const secs = m === 'fast' ? 3 : 15;
      const what = LABEL[placement] || '領取獎勵';
      const el = document.createElement('div'); el.className = 'inter rew';
      el.innerHTML = `<div class="rtop"><span class="rlbl">贊助廣告</span><span class="rleft"><b class="num">${secs}</b> 秒後可${what}</span><button class="x">✕</button></div>
        <div class="adbox"><span style="font-size:34px">📺</span>獎勵廣告位<small>AdMob Rewarded（測試用假廣告）</small></div>
        <div class="rbar"><i></i></div>
        <div class="rask" hidden><b>現在關掉，就領不到獎勵</b><div class="row"><button class="btn gold" data-a="stay">繼續看</button><button class="btn line" data-a="quit">放棄</button></div></div>`;
      document.body.append(el);
      const left = el.querySelector('.rleft'), bar = el.querySelector('.rbar i'), ask = el.querySelector('.rask'), x = el.querySelector('.x');
      let t = 0, paused = false, finished = false;
      const end = (r) => { clearInterval(tick); el.remove(); done(r); };
      const tick = setInterval(() => {
        if (paused || finished) return;
        t += 0.1; bar.style.width = Math.min(100, t / secs * 100) + '%';
        if (t >= secs) { finished = true; left.innerHTML = '✓ 看完了'; x.textContent = '領取 ✓'; x.classList.add('ok'); }
        else left.innerHTML = `<b class="num">${Math.ceil(secs - t)}</b> 秒後可${what}`;
      }, 100);
      x.onclick = () => { if (finished) return end('completed'); paused = true; ask.hidden = false; };
      ask.onclick = (e) => { const a = e.target.closest('button')?.dataset.a; if (a === 'stay') { paused = false; ask.hidden = true; } if (a === 'quit') end('skipped'); };
    });
  }
  function mockInterstitial() {
    return new Promise((done) => {
      const el = document.createElement('div'); el.className = 'inter';
      el.innerHTML = `<button class="x" disabled>3</button><div class="adbox"><span style="font-size:34px">📺</span>插頁式廣告位<small>AdMob Interstitial（測試用假廣告）</small></div><small>查詢股票時偶爾出現・3 秒後可關閉</small>`;
      document.body.append(el); const b = el.querySelector('.x'); let n = 3;
      const t = setInterval(() => { n--; if (n > 0) b.textContent = n; else { clearInterval(t); b.disabled = false; b.textContent = '關閉 ✕'; b.onclick = () => { el.remove(); done('completed'); }; } }, 1000);
    });
  }

  let busy = false;
  async function rewarded(placement = 'points') {
    if (busy) return 'busy'; busy = true;
    try {
      onEvent('rewarded_request', placement);
      const r = native() ? await nativeRewarded() : await mockRewarded(placement);
      if (r === 'completed' || r === 'skipped') lastAdAt = Date.now();
      onEvent('rewarded_' + r, placement);
      return r;
    } finally { busy = false; }
  }
  async function interstitial(gapMs = 60000) {
    if (busy || Date.now() - lastAdAt < gapMs) return 'gap'; // 剛看完獎勵廣告就不跳
    busy = true;
    try {
      const r = native() ? await nativeInterstitial() : await mockInterstitial();
      onEvent('interstitial_' + r);
      return r;
    } finally { busy = false; }
  }

  window.Ads = { rewarded, interstitial, mode, setMode, MODES, MODE_KEY, isNative: native, preload, set onEvent(f) { onEvent = f; } };
})();
