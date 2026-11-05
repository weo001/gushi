// 共用：讀本機金鑰檔、Groq AI、小工具（台股 build.js、美股 us.js、陸股 cn.js 都用）
const fs = require('fs'), path = require('path');
// 本機金鑰檔 pipeline/.env（不會上傳 GitHub）：一行一個 KEY=值
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch (e) {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GROQ_KEY = process.argv.includes('--no-ai') ? '' : (process.env.GROQ_API_KEY || '');
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// ── Groq AI ──
let lastAi = 0;
// 主模型每天 token 額度用完 → 換備用模型（各自有額度）
const MODELS = [GROQ_MODEL, 'openai/gpt-oss-20b'];
let mi = 0;
async function groq(prompt, maxTokens = 700) {
  if (!GROQ_KEY) return null;
  for (let i = 0; i < 6; i++) {
    const model = MODELS[mi]; if (!model) return null;
    const wait = 8000 - (Date.now() - lastAi); if (wait > 0) await sleep(wait); // 免費額度每分鐘 token 有限，慢慢送
    lastAi = Date.now();
    const body = { model, temperature: 0.3, max_tokens: maxTokens, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] };
    if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.status === 429) {
      const s = +(r.headers.get('retry-after') || 20), txt = await r.text().catch(() => '');
      if (s > 120 || /per day|TPD|RPD/i.test(txt)) { log('  Groq', model, '今天額度用完，換', MODELS[mi + 1] || '（沒有了，改規則版）'); mi++; continue; }
      log('  Groq 額度暫時用完，等', s, '秒'); await sleep(s * 1000 + 500); continue;
    }
    if (!r.ok) { log('  Groq 錯誤', r.status, (await r.text()).slice(0, 150)); return null; }
    const j = await r.json();
    return (j.choices?.[0]?.message?.content || '').replace(/\*\*/g, '').trim();
  }
  return null;
}
const modelName = () => MODELS[mi] || 'rule';

module.exports = { groq, GROQ_KEY, GROQ_MODEL, modelName, sleep, log, arg };
