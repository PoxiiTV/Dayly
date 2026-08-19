"""Generate Dayly PWA icons as PNGs (no external deps)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "client", "public", "icons")
os.makedirs(OUT, exist_ok=True)

def lerp(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def gradient(size):
    img = Image.new("RGB", (size, size))
    dr = ImageDraw.Draw(img)
    top = (29, 78, 216)   # #1d4ed8
    bot = (124, 58, 237)  # #7c3aed
    for y in range(size):
        c = lerp(top, bot, y / size)
        dr.line([(0, y), (size, y)], fill=c)
    return img

def rounded_corner_alpha(w, h, r):
    a = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(a)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return a

def draw_d(width_in_px):
    scale = width_in_px / 512.0
    img = gradient(width_in_px)
    a = rounded_corner_alpha(width_in_px, width_in_px, int(112 * scale))
    img.putalpha(a)
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    # stem
    w = int(22 * scale)
    d.rectangle([150 * scale + 8*scale, 150 * scale, 150 * scale + w + 8*scale, 360 * scale], fill=white)
    # bowl arc (right side)
    bbox = [178 * scale, 138 * scale, 368 * scale, 372 * scale]
    d.arc(bbox, start=90, end=270, fill=white, width=int(22 * scale))
    return img

for name, size in [("icon-192", 192), ("icon-512", 512), ("apple-touch-icon", 180)]:
    img = draw_d(size)
    img.save(os.path.join(OUT, name + ".png"))

# maskable: full-bleed background (no transparency) + safe-area logo
def draw_maskable(size):
    img = gradient(size)
    d = ImageDraw.Draw(img)
    scale = size / 512.0
    white = (255, 255, 255, 255)
    pad = 0.18 * size  # keep glyph inside safe zone
    w = int(26 * scale)
    x0 = pad + 18 * scale
    y0, y1 = pad + 26 * scale, size - pad - 26 * scale
    d.rectangle([x0, y0, x0 + w, y1], fill=white)
    cx = size / 2 + 40 * scale
    r = (y1 - y0) / 2
    bbox = [cx - r - w / 2, (y0 + y1) / 2 - r, cx + r - w / 2, (y0 + y1) / 2 + r]
    d.arc(bbox, start=90, end=270, fill=white, width=w)
    return img

draw_maskable(512).save(os.path.join(OUT, "icon-512-maskable.png"))
print("Icons generated:", sorted(os.listdir(OUT)))