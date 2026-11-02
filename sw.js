// 離線也能用：先用網路、失敗再用快取（行情資料也一樣，沒網路時顯示上次的）
const C = 'gushi-v4';
const FILES = ['./', 'index.html', 'core.js', 'fx.js', 'ads.js', 'live.js', 'app.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/__mis/')) return;
  const key = u.pathname.includes('/data/') ? u.origin + u.pathname : e.request; // 資料檔不管 ?t= 都存同一份
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(C).then((c) => c.put(key, copy)); return r; }).catch(() => caches.match(key)));
});
