# 產生 App 圖示 icon-1024.png（不透明、正方形，iPhone 會自己切圓角）
from PIL import Image, ImageDraw, ImageFilter
import os
S = 4; W = 1024 * S
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
# 背景：深藍漸層
bg = Image.new('RGB', (W, W))
d = ImageDraw.Draw(bg)
for y in range(W):
    d.line([(0, y), (W, y)], fill=lerp((22, 34, 72), (8, 12, 28), y / W))
# 光暈
glow = Image.new('L', (W, W), 0); ImageDraw.Draw(glow).ellipse([W*0.15, W*0.05, W*0.95, W*0.85], fill=90)
glow = glow.filter(ImageFilter.GaussianBlur(W * 0.12))
bg = Image.composite(Image.new('RGB', (W, W), (70, 110, 255)), bg, glow)
# 對話框（白）
m = Image.new('L', (W, W), 0); md = ImageDraw.Draw(m)
x0, y0, x1, y1 = W*0.14, W*0.17, W*0.86, W*0.72
md.rounded_rectangle([x0, y0, x1, y1], radius=W*0.12, fill=255)
md.polygon([(W*0.26, y1 - 10), (W*0.42, y1 - 10), (W*0.22, W*0.86)], fill=255)
shadow = m.filter(ImageFilter.GaussianBlur(W * 0.02))
bg = Image.composite(Image.new('RGB', (W, W), (0, 0, 0)), bg, shadow.point(lambda v: v * 0.45))
bg = Image.composite(Image.new('RGB', (W, W), (246, 248, 255)), bg, m)
d = ImageDraw.Draw(bg)
# K 棒（紅漲綠跌）
cw = W * 0.06
bars = [(0.28, 0.52, 0.62, 0.47, 0.66, 'g'), (0.39, 0.46, 0.56, 0.42, 0.60, 'r'), (0.50, 0.49, 0.58, 0.45, 0.62, 'g'), (0.61, 0.36, 0.50, 0.32, 0.54, 'r')]
for cx, top, bot, wt, wb, c in bars:
    col = (235, 64, 64) if c == 'r' else (30, 170, 110)
    X = W * cx
    d.line([(X, W*wt), (X, W*wb)], fill=col, width=int(W*0.012))
    d.rounded_rectangle([X - cw/2, W*top, X + cw/2, W*bot], radius=W*0.01, fill=col)
# 上漲箭頭線
pts = [(W*0.24, W*0.58), (W*0.40, W*0.44), (W*0.52, W*0.50), (W*0.74, W*0.28)]
d.line(pts, fill=(255, 176, 32), width=int(W*0.035), joint='curve')
for p in pts[:-1]: d.ellipse([p[0]-W*0.0175, p[1]-W*0.0175, p[0]+W*0.0175, p[1]+W*0.0175], fill=(255, 176, 32))
ax, ay = pts[-1]
d.polygon([(ax + W*0.05, ay - W*0.045), (ax - W*0.045, ay - W*0.02), (ax + W*0.015, ay + W*0.06)], fill=(255, 176, 32))
img = bg.resize((1024, 1024), Image.LANCZOS)
img.save(os.path.join(root, 'icon-1024.png'))
img.resize((512, 512), Image.LANCZOS).save(os.path.join(here, 'icon-512.png'))
print('ok')
