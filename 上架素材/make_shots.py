# 股市白話通：產生 App Store 宣傳截圖（1320×2868，6.9 吋 iPhone）
# 用法：本機伺服器要開著（APP專案\start.cmd，http://localhost:5189），在這個資料夾執行 python make_shots.py
# 做法：用 Playwright 開 Chrome 跑真的 App，截圖後加上標題
import os, sys, io
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:' + (sys.argv[1] if len(sys.argv) > 1 else '5189') + '/'
FONT = 'C:/Windows/Fonts/msjhbd.ttc'
OUT = os.path.join(HERE, '截圖')
W, H = 1320, 2868
ACC, WHITE = (255, 186, 48), (236, 241, 255)

def font(size): return ImageFont.truetype(FONT, size)

def text_c(d, y, s, size, fill):
    f = font(size); w = d.textlength(s, font=f)
    d.text(((W - w) / 2, y), s, font=f, fill=fill)

def compose(png, title, sub, name):
    shot = Image.open(io.BytesIO(png)).convert('RGB')
    bg = Image.new('RGB', (W, H))
    px = ImageDraw.Draw(bg)
    for y in range(H):
        k = y / H; px.line([(0, y), (W, y)], fill=(int(30 - 20 * k), int(52 - 38 * k), int(120 - 88 * k)))
    sw = 1040; sh = int(shot.height * sw / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x0, y0 = (W - sw) // 2, 560
    m = Image.new('L', (sw, sh), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, sw - 1, sh - 1], 60, fill=255)
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(glow).rounded_rectangle([x0 - 10, y0 - 10, x0 + sw + 10, y0 + sh + 10], 70, fill=(90, 150, 255, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(30))
    bg = Image.alpha_composite(bg.convert('RGBA'), glow).convert('RGB')
    ImageDraw.Draw(bg).rounded_rectangle([x0 - 6, y0 - 6, x0 + sw + 6, y0 + sh + 6], 66, fill=(60, 80, 130))
    bg.paste(shot, (x0, y0), m)
    d = ImageDraw.Draw(bg)
    text_c(d, 150, title, 128, ACC)
    text_c(d, 340, sub, 66, WHITE)
    bg.save(os.path.join(OUT, name + '.png'))
    print('saved', name)

def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome', headless=True)
        ctx = b.new_context(viewport={'width': 430, 'height': 900}, device_scale_factor=3, service_workers='block', is_mobile=True, has_touch=True, reduced_motion='reduce')
        ctx.add_init_script("try{localStorage.clear()}catch(e){}")
        p = ctx.new_page()
        p.goto(URL + '#home')
        p.wait_for_function("() => window.__app && window.__app.M", timeout=30000)
        p.evaluate("() => { const S = __app.S; S.pts = 286; S.opens = 0; S.watch = ['2330','2454','2317','3231','2308']; location.hash = '#me'; }")
        p.wait_for_timeout(800)
        def go(h, wait=2500):
            p.evaluate("(h) => { location.hash = h; }", h); p.wait_for_timeout(wait)
            p.evaluate("() => document.querySelectorAll('.toast,.inter,.modal').forEach(e => e.remove())")
        def snap(): return p.screenshot()

        go('#home', 3500)
        compose(snap(), '台股今天發生什麼事', '大盤、法人、族群強弱　一眼看懂', '01')

        go('#s/2454', 4000)
        p.evaluate("() => { const b = document.querySelector('[data-unlock]'); b && b.click(); }")
        p.wait_for_timeout(3500)
        p.evaluate("() => { const e = document.querySelector('.explain, [data-k=explain], .lock, .ai'); if (e) window.scrollTo(0, Math.max(0, e.getBoundingClientRect().top + scrollY - 260)); }")
        p.wait_for_timeout(800)
        compose(snap(), 'AI 白話解說', '這檔股票今天為什麼漲跌？說給你聽', '02')

        go('#s/2330', 4000)
        for i in range(2):
            p.evaluate("() => { const b = document.querySelector('[data-unlock]'); b && b.click(); }")
            p.wait_for_timeout(6000)
        p.evaluate("() => { const d = document.querySelector('.deck'); if (d) { d.querySelector('.deck-stack').click(); const h = d.parentElement; window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 70); } }")
        p.wait_for_timeout(2500)
        compose(snap(), '深度報告', '多空訊號、法人籌碼、歷史相似情境', '03')

        go('#heat', 3500)
        compose(snap(), '台股熱力圖', '產業、概念股強弱　一張圖看完', '04')

        go('#game', 2500)
        p.evaluate("() => document.querySelector('#go').click()")
        p.wait_for_timeout(5000)
        compose(snap(), '歷史盲測', '遮住股名和日期　猜猜之後漲還跌', '05')

        go('#me', 2500)
        compose(snap(), '看廣告賺點數', '免費解鎖白話解說和深度報告', '06')
        b.close()

if __name__ == '__main__':
    main()
