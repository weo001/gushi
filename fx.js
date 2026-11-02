// 互動效果（參考「讓 AI 做的 App 更精緻的 6 個交互」）
//   1. 完成回饋按鈕：解鎖時按鈕縮成圓、畫出打勾、噴金幣粒子      FX.unlock(btn)
//   2. 勾選連動：點數數字滾動、進度環長大                         FX.count(el, to)、FX.ring(...)
//   3. 疊卡展開：深度報告疊成一疊，點開依序展開、收起整齊疊回      FX.deck(el)
//   4. 吸附卡＋畫線：指數卡片左右滑會吸附，走勢線逐段畫出          FX.carousel(el, dots)；所有 .ln 線自動畫
//   5. 慣性尺規：拖動有慣性、減速吸附刻度、拉過頭彈回             FX.ruler(el, opts)
//   6. 圓形擴散轉場：換分頁時新頁面從手指按的位置擴散開            FX.circle(x, y)
// 使用者在系統設定「減少動態效果」時，全部直接跳到結果。
(function () {
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raf = (f) => requestAnimationFrame(f);
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const FX = {};

  FX.haptic = (ms = 8) => {
    try {
      const H = window.Capacitor?.Plugins?.Haptics; // 包成 App 後如果有裝 Haptics 外掛就用它
      if (H) return H.impact({ style: ms > 12 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch {}
  };

  // ── 粒子：從某個點往外噴 ──
  FX.burst = (x, y, { n = 14, colors = ['#ffc85b', '#ffe7a8', '#5b9dff', '#ff5b5b'], dist = 60, coin = true } = {}) => {
    if (reduce()) return;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'fx-p' + (coin && i % 3 === 0 ? ' coin' : '');
      p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]}`;
      document.body.append(p);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5, d = dist * (0.6 + Math.random() * 0.7);
      p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.3)`, opacity: 0 }],
        { duration: 550 + Math.random() * 250, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
    }
  };

  // ── 1. 完成回饋按鈕 ──
  FX.unlock = (btn) => new Promise((done) => {
    if (!btn || reduce()) return done();
    FX.haptic(14);
    const w = btn.offsetWidth, h = btn.offsetHeight;
    btn.style.width = w + 'px'; btn.style.height = h + 'px';
    btn.disabled = true;
    raf(() => {
      btn.classList.add('morph');
      btn.style.width = h + 'px';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path class="ck" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    });
    setTimeout(() => { const r = btn.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2); }, 330);
    setTimeout(done, 780);
  });

  // ── 2. 數字滾動 ──
  FX.count = (el, to, { dur = 650, dec = 0, sign = false, suffix = '' } = {}) => {
    if (!el) return;
    const from = el.dataset.v != null ? +el.dataset.v : parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')) || 0;
    el.dataset.v = to;
    const fmt = (v) => (sign && v > 0 ? '+' : '') + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
    if (reduce() || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = fmt(from + (to - from) * ease(k)); if (k < 1) raf(step); };
    raf(step);
  };
  // 進度環（用 CSS 變數 --p 從 0 長到目標）
  FX.ring = (p, inner, size = 92) => {
    const r = size / 2 - 7, c = 2 * Math.PI * r;
    return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--s3)" stroke-width="7" fill="none"/>
      <circle class="ring-v" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#ringg)" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-to="${c * (1 - Math.max(0, Math.min(1, p)))}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <defs><linearGradient id="ringg"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ffc85b"/></linearGradient></defs></svg><div class="ring-t">${inner}</div></div>`;
  };

  // ── 4. 畫線：所有 path.ln 出現在畫面上時逐段畫出來 ──
  FX.draw = (path, dur = 900) => {
    if (!path.getTotalLength || reduce()) return;
    const L = path.getTotalLength();
    path.style.transition = 'none'; path.style.strokeDasharray = L; path.style.strokeDashoffset = L;
    path.getBoundingClientRect();
    raf(() => { path.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(.4,.1,.2,1)`; path.style.strokeDashoffset = 0; });
    const area = path.parentNode?.querySelector('.area');
    if (area) area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: 'ease-out' });
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const svg = e.target; io.unobserve(svg);
    svg.querySelectorAll('.ln').forEach((p, i) => setTimeout(() => FX.draw(p, p.classList.contains('fut') ? 700 : 900), p.classList.contains('fut') ? 150 : i * 120));
    svg.querySelectorAll('.ring-v').forEach((c) => raf(() => { c.style.strokeDashoffset = c.dataset.to; }));
  }), { threshold: 0.3 }) : null;
  const watch = (root) => root.querySelectorAll && root.querySelectorAll('svg.chart:not([data-fx]), .ring svg:not([data-fx])').forEach((s) => {
    s.dataset.fx = 1;
    if (io && !reduce()) io.observe(s); else s.querySelectorAll('.ring-v').forEach((c) => { c.style.strokeDashoffset = c.dataset.to; });
  });
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && watch(n)))).observe(document.documentElement, { childList: true, subtree: true });

  // ── 4. 吸附卡片：左右滑、點點跟著動、滑到的那張重畫走勢線 ──
  FX.carousel = (track, dots) => {
    if (!track) return;
    const cards = [...track.children];
    let cur = 0, t;
    const set = (i) => {
      if (i === cur) return; cur = i;
      dots && [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      cards[i].querySelectorAll('.ln').forEach((p) => FX.draw(p, 800));
      FX.haptic(4);
    };
    track.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => set(Math.round(track.scrollLeft / (cards[0].offsetWidth + 10))), 60); }, { passive: true });
    dots && dots.addEventListener('click', (e) => { const i = [...dots.children].indexOf(e.target); if (i >= 0) track.scrollTo({ left: i * (cards[0].offsetWidth + 10), behavior: 'smooth' }); });
  };

  // ── 3. 疊卡：收起時疊成一疊，展開時依序攤開 ──
  FX.deck = (deck) => {
    const items = [...deck.querySelectorAll(':scope > .deck-i')];
    items.forEach((el, i) => el.style.setProperty('--i', i));
    const btn = deck.querySelector('.deck-btn');
    const open = () => {
      deck.classList.add('open'); FX.haptic(6);
      if (!reduce()) items.forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(-26px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 70, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }));
    };
    const close = () => {
      if (reduce()) return deck.classList.remove('open');
      const n = items.length;
      items.forEach((el, i) => el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-20px) scale(.96)' }], { duration: 220, delay: (n - 1 - i) * 30, easing: 'ease-in', fill: 'forwards' }));
      setTimeout(() => { items.forEach((el) => el.getAnimations().forEach((a) => a.cancel())); deck.classList.remove('open'); deck.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 220 + n * 30);
    };
    deck.querySelector('.deck-stack')?.addEventListener('click', open);
    btn?.addEventListener('click', () => (deck.classList.contains('open') ? close() : open()));
  };

  // ── 5. 慣性尺規 ──
  // opts：{ min, max, step, value, gap（刻度間距 px）, onChange(v) }
  FX.ruler = (el, o) => {
    const { min, max, step = 1, gap = 14 } = o;
    const N = Math.round((max - min) / step);
    const track = document.createElement('div'); track.className = 'rl-track';
    let html = '';
    for (let k = 0; k <= N; k++) {
      const v = +(min + k * step).toFixed(4), major = v % 5 === 0;
      html += `<i class="${major ? 'mj' : ''} ${v > 0 ? 'u' : v < 0 ? 'd' : 'z'}" style="left:${k * gap}px">${major ? `<b>${v > 0 ? '+' : ''}${v}</b>` : ''}</i>`;
    }
    track.innerHTML = html; track.style.width = N * gap + 'px';
    el.innerHTML = '<div class="rl-mid"></div>'; el.prepend(track); el.classList.add('ruler');
    const W = () => el.clientWidth;
    const posOf = (v) => W() / 2 - ((v - min) / step) * gap;
    const lo = () => posOf(max), hi = () => posOf(min); // 位置的範圍（pos 越小值越大）
    let pos = posOf(o.value ?? 0), val = o.value ?? 0, anim = 0;
    const valueAt = (p) => Math.max(min, Math.min(max, +(min + Math.round((W() / 2 - p) / gap) * step).toFixed(4)));
    const paint = () => {
      track.style.transform = `translateX(${pos}px)`;
      const v = valueAt(pos);
      if (v !== val) { val = v; FX.haptic(3); o.onChange && o.onChange(v); }
    };
    const rubber = (p) => (p > hi() ? hi() + (p - hi()) * 0.35 : p < lo() ? lo() + (p - lo()) * 0.35 : p);
    const snapTo = (target) => {
      const from = pos, t0 = performance.now(), dur = reduce() ? 1 : 320;
      const f = (t) => { const k = Math.min(1, (t - t0) / dur); pos = from + (target - from) * (1 - Math.pow(1 - k, 3) * (1 - k * 0.0) ); paint(); if (k < 1) anim = raf(f); };
      anim = raf(f);
    };
    const settle = () => snapTo(posOf(valueAt(Math.max(lo(), Math.min(hi(), pos)))));
    let down = false, sx = 0, sp = 0, samples = [];
    el.addEventListener('pointerdown', (e) => { cancelAnimationFrame(anim); down = true; sx = e.clientX; sp = pos; samples = [[e.timeStamp, e.clientX]]; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      pos = rubber(sp + (e.clientX - sx)); paint();
      samples.push([e.timeStamp, e.clientX]); if (samples.length > 6) samples.shift();
    });
    const up = () => {
      if (!down) return; down = false;
      const [a, b] = [samples[0], samples[samples.length - 1]];
      let v = b && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; // px/ms
      v = Math.max(-1.6, Math.min(1.6, v)); // 甩太快也不會一路飛到底
      if (Math.abs(v) < 0.08 || reduce()) return settle();
      let last = performance.now();
      const f = (t) => {
        const dt = t - last; last = t;
        const out = pos > hi() || pos < lo();
        v *= Math.pow(out ? 0.8 : 0.925, dt / 16); // 出界減速很快，然後彈回
        pos += v * dt; paint();
        if (Math.abs(v) < 0.03) return settle();
        anim = raf(f);
      };
      anim = raf(f);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    // 鍵盤也能用（左右鍵）
    el.tabIndex = 0;
    el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); snapTo(posOf(Math.max(min, Math.min(max, val + (e.key === 'ArrowRight' ? step : -step))))); } });
    paint();
    return { get value() { return val; }, set: (v) => snapTo(posOf(v)) };
  };

  // ── 6. 圓形擴散轉場 ──
  FX.circle = (el, x, y) => {
    if (!el || reduce() || !el.animate) return;
    const r = el.getBoundingClientRect(), cx = x - r.left, cy = y - r.top;
    const R = Math.hypot(Math.max(cx, r.width - cx), Math.max(cy, Math.min(r.height, innerHeight) - cy)) + 40;
    el.animate([{ clipPath: `circle(0px at ${cx}px ${cy}px)` }, { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }], { duration: 480, easing: 'cubic-bezier(.4,0,.2,1)' });
  };

  window.FX = FX;
})();
