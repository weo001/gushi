// 把網頁版和每日資料放到 site/，給 Cloudflare Pages 上傳（免費方案可以商用；GitHub Pages 不能當主要做生意的主機）
// 只放台股資料（data/*.json）；美股、陸股授權沒確認，不放
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'site');
const files = ['index.html', 'core.js', 'fx.js', 'ads.js', 'live.js', 'news.js', 'studio-news.js', 'app.js', 'manifest.json', 'icon.svg', 'sw.js', 'privacy.html', 'support.html', 'icon-1024.png'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'data'), { recursive: true });
for (const f of files) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(out, f));
let n = 0;
for (const f of fs.readdirSync(path.join(root, 'data'))) if (f.endsWith('.json')) { fs.copyFileSync(path.join(root, 'data', f), path.join(out, 'data', f)); n++; }
// App 從別的網域讀資料：允許跨網域、不要快取太久
fs.writeFileSync(path.join(out, '_headers'), '/data/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n');
console.log(`site/：${files.length} 個網頁檔、${n} 個資料檔`);
