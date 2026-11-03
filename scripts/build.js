// 把 App 用到的檔案複製到 www/，給 Capacitor 打包成 iPhone App
// （資料 data/*.json 不放進 App，App 會到 GitHub Pages 抓每天最新的）
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
const files = ['index.html', 'core.js', 'fx.js', 'ads.js', 'live.js', 'news.js', 'studio-news.js', 'app.js', 'manifest.json', 'icon.svg', 'sw.js'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log('已複製到 www/：' + files.length + ' 個檔案');
