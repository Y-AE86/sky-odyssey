import os
import shutil
import numpy as np
from PIL import Image
from scipy import ndimage

raw = r"C:\Users\EDY\.gemini\antigravity\scratch\sky-odyssey\raw_art"
assets = r"C:\Users\EDY\.gemini\antigravity\scratch\sky-odyssey\assets"
xiantu_assets = r"C:\Users\EDY\Documents\Codex\2026-11-22\new-chat\work\xiantu-collab\assets"

for d in ["scenes", "posters", "ui", "chibi", "avatars"]:
    os.makedirs(os.path.join(assets, d), exist_ok=True)

# 1. Archive 1:1 lossless posters & scenes
shutil.copy2(os.path.join(raw, "76247d62-63d9-4ffa-bcc3-2f0e854dadd9.png"), os.path.join(assets, "posters", "lobby_cg_protag.png"))
shutil.copy2(os.path.join(raw, "3f19db5d-996b-4325-bbb0-3acc2b1a63d1.png"), os.path.join(assets, "posters", "lobby_cg_c07.png"))
shutil.copy2(os.path.join(raw, "440bcf92-dd4c-496f-b523-226dcff8c05c.png"), os.path.join(assets, "posters", "lobby_cg_c15.png"))
shutil.copy2(os.path.join(raw, "bg_roster.png"), os.path.join(assets, "scenes", "bg_roster.png"))
shutil.copy2(os.path.join(raw, "2c9a9f8e-5f76-4d8b-8a6e-43368697ca3f.png"), os.path.join(assets, "scenes", "bg_roster_alt.png"))
shutil.copy2(os.path.join(raw, "bg_battle.png"), os.path.join(assets, "scenes", "bg_battle.png"))

# 2. Copy 3 existing lossless chibi sprites (read-only from xiantu)
shutil.copy2(os.path.join(xiantu_assets, "cultivator_chibi.png"), os.path.join(assets, "chibi", "chibi_protag.png"))
shutil.copy2(os.path.join(xiantu_assets, "comp_c07_chibi.png"), os.path.join(assets, "chibi", "chibi_c07.png"))
shutil.copy2(os.path.join(xiantu_assets, "comp_c15_chibi.png"), os.path.join(assets, "chibi", "chibi_c15.png"))


def black_to_alpha(rgb_arr, preserve_interior=False):
    """Convert pure-black-background glowing UI piece to crisp RGBA."""
    f = rgb_arr.astype(np.float32) / 255.0
    mx = np.max(f, axis=2)
    base_a = np.clip((mx - 4.0 / 255.0) / (1.0 - 4.0 / 255.0), 0.0, 1.0)
    interior = np.zeros_like(mx, dtype=bool)
    if preserve_interior:
        border_mask = mx > 0.14
        filled = ndimage.binary_fill_holes(ndimage.binary_closing(border_mask, iterations=2))
        interior = filled & (~ndimage.binary_dilation(~filled, iterations=2))
        glass_a = np.where(interior, np.clip(0.84 + 0.16 * base_a, 0.0, 1.0), base_a)
        alpha = np.where(interior, glass_a, np.power(base_a, 0.85))
    else:
        alpha = np.clip(np.power(base_a, 0.78) * 1.18, 0.0, 1.0)
        alpha = np.where(mx <= 6.0 / 255.0, 0.0, alpha)

    out_rgb = np.zeros_like(f)
    denom = np.maximum(alpha, 0.22)
    scale = np.where(interior, 1.0, 1.0 / denom) if preserve_interior else (1.0 / denom)
    for c in range(3):
        out_rgb[:, :, c] = np.clip(f[:, :, c] * scale, 0.0, 1.0)
    rgba = np.dstack([
        np.round(out_rgb * 255).astype(np.uint8),
        np.round(alpha * 255).astype(np.uint8),
    ])
    return rgba


def find_boxes(img_arr, thresh=14, min_area=3000):
    mask = np.max(img_arr, axis=2) > thresh
    labeled, n = ndimage.label(ndimage.binary_dilation(mask, iterations=1))
    boxes = []
    for i in range(1, n + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < min_area:
            continue
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1, len(xs)))
    return boxes


# 3. Slice ui_buttons_sheet.png
btn_img = np.array(Image.open(os.path.join(raw, "ui_buttons_sheet.png")).convert("RGB"))
btn_boxes = find_boxes(btn_img, thresh=14, min_area=4000)
btn_boxes.sort(key=lambda b: (b[1] // 120, b[0]))
print("BUTTON BOXES:", len(btn_boxes))
for idx, b in enumerate(btn_boxes):
    print(f"  [{idx}] x={b[0]}..{b[2]} (w={b[2]-b[0]}), y={b[1]}..{b[3]} (h={b[3]-b[1]}), px={b[4]}")

btn_names = [
    ("ui_btn_gold.png", True),
    ("ui_btn_cyan.png", True),
    ("ui_btn_crimson.png", True),
    ("ui_btn_dark.png", True),
    ("ui_tab_active.png", True),
    ("ui_tab_idle.png", True),
    ("ui_badge_circle.png", False),
    ("ui_bar_gold.png", False),
    ("ui_bar_cyan.png", False),
]
if len(btn_boxes) == len(btn_names):
    for (x0, y0, x1, y1, _), (name, keep_in) in zip(btn_boxes, btn_names):
        pad = 2
        x0p, y0p = max(0, x0 - pad), max(0, y0 - pad)
        x1p, y1p = min(btn_img.shape[1], x1 + pad), min(btn_img.shape[0], y1 + pad)
        crop = btn_img[y0p:y1p, x0p:x1p]
        rgba = black_to_alpha(crop, preserve_interior=keep_in)
        Image.fromarray(rgba, "RGBA").save(os.path.join(assets, "ui", name))
        print(f"  Saved {name}: {rgba.shape[1]}x{rgba.shape[0]}")
else:
    print("WARNING: button box count mismatch!", len(btn_boxes), "vs", len(btn_names))

# 4. Slice ui_frames_sheet.png and align all 4 frames by hollow interior center onto 620x620 canvas
frm_img = np.array(Image.open(os.path.join(raw, "ui_frames_sheet.png")).convert("RGB"))
frm_boxes = find_boxes(frm_img, thresh=14, min_area=10000)
frm_boxes.sort(key=lambda b: (b[1] // 300, b[0]))
print("FRAME BOXES:", len(frm_boxes))
for idx, b in enumerate(frm_boxes):
    print(f"  [{idx}] x={b[0]}..{b[2]} (w={b[2]-b[0]}), y={b[1]}..{b[3]} (h={b[3]-b[1]}), px={b[4]}")

frm_names = ["frame_r.png", "frame_sr.png", "frame_ssr.png", "frame_ur.png"]
if len(frm_boxes) == 4:
    CANVAS = 620
    for (x0, y0, x1, y1, _), name in zip(frm_boxes, frm_names):
        crop = frm_img[y0:y1, x0:x1]
        rgba = black_to_alpha(crop, preserve_interior=False)
        dark = np.max(crop, axis=2) <= 15
        filled = ndimage.binary_fill_holes(~dark)
        hollow = filled & dark
        hl, hn = ndimage.label(hollow)
        best_cx, best_cy = crop.shape[1] / 2.0, crop.shape[0] / 2.0
        best_area = 0
        inner_w = inner_h = 0
        for hi in range(1, hn + 1):
            hys, hxs = np.where(hl == hi)
            if len(hxs) > best_area:
                best_area = len(hxs)
                best_cx = (hxs.min() + hxs.max()) / 2.0
                best_cy = (hys.min() + hys.max()) / 2.0
                inner_w = hxs.max() - hxs.min() + 1
                inner_h = hys.max() - hys.min() + 1
        canvas = np.zeros((CANVAS, CANVAS, 4), dtype=np.uint8)
        ox = int(round(CANVAS / 2.0 - best_cx))
        oy = int(round(CANVAS / 2.0 - best_cy))
        sx0 = max(0, -ox)
        sy0 = max(0, -oy)
        dx0 = max(0, ox)
        dy0 = max(0, oy)
        cw = min(rgba.shape[1] - sx0, CANVAS - dx0)
        ch = min(rgba.shape[0] - sy0, CANVAS - dy0)
        canvas[dy0:dy0 + ch, dx0:dx0 + cw] = rgba[sy0:sy0 + ch, sx0:sx0 + cw]
        Image.fromarray(canvas, "RGBA").save(os.path.join(assets, "ui", name))
        print(f"  Saved {name}: {CANVAS}x{CANVAS} (hollow inner ~{inner_w}x{inner_h}, center={best_cx:.1f},{best_cy:.1f})")
else:
    print("WARNING: frame box count mismatch!", len(frm_boxes))
