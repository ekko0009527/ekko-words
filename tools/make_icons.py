"""Draw the app icons into icons/ (run from the repo root): python tools/make_icons.py

Dark tile with a white "E" and the app's green check dot. `icon-*.png` have rounded
corners; the maskable and apple-touch versions are full-bleed (the OS crops them).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG, FG, GOOD = (18, 20, 24), (255, 255, 255), (52, 162, 87)
FONT_CANDIDATES = ["C:/Windows/Fonts/seguibl.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf",
                   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def font(size):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    raise SystemExit("no bold font found; edit FONT_CANDIDATES")


def draw(size, rounded, content=1.0):
    s = size * 4  # supersample, then downscale for smooth edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, s, s], fill=BG)
    k = s * content  # content box, centred (smaller for maskable safe zone)
    f = font(int(k * 0.62))
    l, t, r, b = d.textbbox((0, 0), "E", font=f)
    x = (s - (r - l)) / 2 - l - k * 0.05
    y = (s - (b - t)) / 2 - t
    d.text((x, y), "E", font=f, fill=FG)
    rad = k * 0.085
    cx, cy = x + l + (r - l) + rad * 1.25, y + b - rad
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=GOOD)
    return im.resize((size, size), Image.LANCZOS)


def main():
    out = Path("icons")
    out.mkdir(exist_ok=True)
    draw(192, True).save(out / "icon-192.png")
    draw(512, True).save(out / "icon-512.png")
    draw(512, False, content=0.78).convert("RGB").save(out / "icon-maskable-512.png")
    draw(180, False, content=0.9).convert("RGB").save(out / "apple-touch-icon.png")
    print("icons written to", out.resolve())


if __name__ == "__main__":
    main()
