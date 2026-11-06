# -*- coding: utf-8 -*-
"""把白底人像照片处理成透明底的游戏素材（不用分割模型，纯连通域抠白底）。

用法：
    python scripts/prep-subway-assets.py <front.jpg> <back.jpg>

输出 docs/subway/assets/ 下：
    student-front.webp  正面全身（菜单用）
    student-back.webp   背面全身（游戏内奔跑用）
    student-face.webp   头部方形特写（头像 / 结算页）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "subway" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

WHITE_MIN = 236      # 三通道都 >= 这个值视为“白底候选”
SOFT_BAND = 28.0     # 边缘软化的过渡宽度
STEP = 8             # 连通域在 1/8 分辨率上算，够用且快


def _dilate(m):
    d = m.copy()
    d[1:, :] |= m[:-1, :]
    d[:-1, :] |= m[1:, :]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    return d


def border_connected_white(near_white):
    """只把和画面四边连通的白像素当成背景，避免把白鞋底、白 Logo 挖掉。"""
    h, w = near_white.shape
    hs, ws = h // STEP, w // STEP
    if hs < 2 or ws < 2:
        return near_white.copy()
    coarse = near_white[: hs * STEP, : ws * STEP].reshape(hs, STEP, ws, STEP).all(axis=(1, 3))

    cur = np.zeros_like(coarse)
    cur[0, :] |= coarse[0, :]
    cur[-1, :] |= coarse[-1, :]
    cur[:, 0] |= coarse[:, 0]
    cur[:, -1] |= coarse[:, -1]
    cur &= coarse

    while True:
        nxt = _dilate(cur) & coarse
        if np.array_equal(nxt, cur):
            break
        cur = nxt

    up = Image.fromarray(cur.astype(np.uint8) * 255).resize((w, h), Image.NEAREST)
    return np.asarray(up) > 127


def cutout(path):
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im).astype(np.int16)
    h, w, _ = rgb.shape
    minc = rgb.min(axis=2)

    near_white = minc >= WHITE_MIN
    bg = border_connected_white(near_white) & near_white

    # 背景外扩几像素当作边缘带，带内用亮度做软 alpha 并去掉白边
    bg_img = Image.fromarray((bg * 255).astype(np.uint8))
    band = np.asarray(bg_img.filter(ImageFilter.MaxFilter(5))) > 0
    band &= ~bg

    alpha = np.ones((h, w), dtype=np.float32)
    alpha[bg] = 0.0
    soft = np.clip((255.0 - minc[band]) / SOFT_BAND, 0.0, 1.0)
    alpha[band] = soft

    rgbf = rgb[band].astype(np.float32)
    a = np.maximum(soft, 0.04)[:, None]
    clean = (rgbf - 255.0 * (1.0 - a)) / a
    rgb[band] = np.clip(clean, 0, 255).astype(np.int16)

    out = np.dstack([rgb.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    img = Image.fromarray(out, "RGBA")

    bbox = img.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
    return img.crop(bbox)


def save_body(img, name, height):
    w, h = img.size
    scale = height / h
    resized = img.resize((max(1, round(w * scale)), height), Image.LANCZOS)
    p = OUT / name
    resized.save(p, "WEBP", quality=88, method=6)
    print(f"{name:20s} {resized.size[0]}x{resized.size[1]}  {p.stat().st_size/1024:.0f} KB")


def save_face(front, name, size=320):
    """从头图中取头顶 16% 的区域做方形头像（用 alpha 包围盒居中对齐）。"""
    w, h = front.size
    top = front.crop((0, 0, w, int(h * 0.19)))
    bbox = top.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
    if not bbox:
        bbox = (0, 0, w, int(h * 0.19))
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) // 2
    side = int((y1 - y0) * 1.06)
    left = max(0, min(w - side, cx - side // 2))
    face = front.crop((left, 0, left + side, side))
    face = face.resize((size, size), Image.LANCZOS)
    p = OUT / name
    face.save(p, "WEBP", quality=90, method=6)
    print(f"{name:20s} {size}x{size}  {p.stat().st_size/1024:.0f} KB")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    front = cutout(sys.argv[1])
    back = cutout(sys.argv[2])
    save_body(front, "student-front.webp", 820)
    save_body(back, "student-back.webp", 820)
    save_face(front, "student-face.webp", 320)


if __name__ == "__main__":
    main()
