import hashlib
import os
import shutil
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(REPO_ROOT, "raw_art")
ARCHIVE_DIR = os.path.join(RAW_DIR, "_archive")
RAW_DOMAINS = os.path.join(RAW_DIR, "domains")
RAW_VFX = os.path.join(RAW_DIR, "vfx")
RAW_WEAPONS = os.path.join(RAW_DIR, "weapons")
OUT_DOMAINS = os.path.join(REPO_ROOT, "assets", "domains")
OUT_VFX = os.path.join(REPO_ROOT, "assets", "vfx")
OUT_WEAPONS = os.path.join(REPO_ROOT, "assets", "weapons")
QA_WEAPONS_PATH = r"C:\Users\EDY\.gemini\antigravity\brain\3aa0f3bc-c79a-4dca-b8d1-13c3fc178cdc\scratch\wave8_weapons_qa.png"

DOMAINS = [
    ("domain_h01", "01_幽冥墨姬_忘川墨莲冥域.png", ["a17fbe78-e5c1-40af-9212-850a344f185d.png", "e68e9073-ff4b-4c06-b73a-445f659f6717.png"]),
    ("domain_h02", "02_冰灵霜华_极夜冰穹星环.png", ["596b688d-e8a0-4eb6-9d93-1eeed1a3b12b.png", "f7f1c38f-e764-4046-a3da-96c5fd390d12.png"]),
    ("domain_h03", "03_凌波玉笛_子夜月镜莲湖.png", ["d69fc91d-c5a1-4a01-a330-535e95998a00.png"]),
    ("domain_h04", "04_艾莉娅_暗夜圣殿鎏金裂云.png", ["98acaa3a-c65d-4d79-9943-f1bd8fd2ddd5.png"]),
    ("domain_h05", "05_薇尔_深空星轨齿轮矩阵.png", ["daf5d90f-15e2-49a6-b714-e94bfc6552c6.png"]),
    ("domain_h06", "06_莉莉丝_猩红血月哥特玫瑰夜.png", ["6ab16d26-5db2-45c5-a8ba-4dfcdd9b41da.png"]),
    ("domain_h07", "07_望舒_紫渊银河黄道星幕.png", ["2c9caf02-34d4-4e25-b26e-c1e0a7c73f5f.png"]),
    ("domain_h08", "08_苍雷希露_墨黑苍穹高压雷狱.png", ["185dedc3-6de2-481a-b202-d002fd3e2dcf.png"]),
    ("domain_h09", "09_离火凰姬_焦黑凤凰日蚀离火.png", ["9a102122-4323-4d91-bed9-cd2a4dd27842.png"]),
    ("domain_h11", "11_赛琳娜_荆棘王冠黑鸦裂空.png", ["e36d2480-a63a-49d4-b655-e30580bdee48.png"]),
]

IMPACT_CRACK_UUID = "8dafbd28-d0f2-492f-9023-33747a48cb7d.png"
IMPACT_CRACK_RAW = "vfx_impact_crack_全屏黑白碎屏冲击裂纹.png"

WEAPONS_SHEET_UUID = "ceca6c99-1713-47d6-b2ee-7f421a643b98.png"
WEAPONS_SHEET_RAW = "新五女神专武合图_2x3_h07至h11与星典.png"

WEAPON_SLOTS = [
    (0, 0, "weapon_h07.png", "h07 望舒·星渊浑天星杖"),
    (0, 1, "weapon_h08.png", "h08 希露·苍雷电磁太刀"),
    (0, 2, "weapon_h09.png", "h09 凰姬·离火凤羽焚天枪"),
    (1, 0, "weapon_h10.png", "h10 瑶光·月潮琉璃长剑"),
    (1, 1, "weapon_h11.png", "h11 赛琳娜·暗冕鸦羽长镰"),
    (1, 2, "weapon_grimoire_reserve.png", "备用·星穹启明魔导星典"),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def flood_exterior(is_bg):
    h, w = is_bg.shape
    vis = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        if is_bg[0, x] and not vis[0, x]:
            vis[0, x] = True
            q.append((0, x))
        if is_bg[h - 1, x] and not vis[h - 1, x]:
            vis[h - 1, x] = True
            q.append((h - 1, x))
    for y in range(h):
        if is_bg[y, 0] and not vis[y, 0]:
            vis[y, 0] = True
            q.append((y, 0))
        if is_bg[y, w - 1] and not vis[y, w - 1]:
            vis[y, w - 1] = True
            q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if y > 0 and is_bg[y - 1, x] and not vis[y - 1, x]:
            vis[y - 1, x] = True
            q.append((y - 1, x))
        if y + 1 < h and is_bg[y + 1, x] and not vis[y + 1, x]:
            vis[y + 1, x] = True
            q.append((y + 1, x))
        if x > 0 and is_bg[y, x - 1] and not vis[y, x - 1]:
            vis[y, x - 1] = True
            q.append((y, x - 1))
        if x + 1 < w and is_bg[y, x + 1] and not vis[y, x + 1]:
            vis[y, x + 1] = True
            q.append((y, x + 1))
    return vis


def connected_components_4(mask):
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    comps = []
    cur = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and labels[y, x] == 0:
                cur += 1
                q = deque([(y, x)])
                labels[y, x] = cur
                ys, xs = [], []
                while q:
                    cy, cx = q.popleft()
                    ys.append(cy)
                    xs.append(cx)
                    if cy > 0 and mask[cy - 1, cx] and labels[cy - 1, cx] == 0:
                        labels[cy - 1, cx] = cur
                        q.append((cy - 1, cx))
                    if cy + 1 < h and mask[cy + 1, cx] and labels[cy + 1, cx] == 0:
                        labels[cy + 1, cx] = cur
                        q.append((cy + 1, cx))
                    if cx > 0 and mask[cy, cx - 1] and labels[cy, cx - 1] == 0:
                        labels[cy, cx - 1] = cur
                        q.append((cy, cx - 1))
                    if cx + 1 < w and mask[cy, cx + 1] and labels[cy, cx + 1] == 0:
                        labels[cy, cx + 1] = cur
                        q.append((cy, cx + 1))
                comps.append({"id": cur, "area": len(ys), "ys": np.array(ys), "xs": np.array(xs)})
    return labels, comps


def dilate_bool(mask, radius=1):
    out = mask.copy()
    for _ in range(radius):
        p = np.pad(out, 1, mode="constant", constant_values=False)
        out = (
            p[1:-1, 1:-1]
            | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
            | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        )
    return out


def matte_black_weapon(rgb_crop, out_size=520, mode="standard"):
    h, w, _ = rgb_crop.shape
    r = rgb_crop[:, :, 0].astype(np.int16)
    g = rgb_crop[:, :, 1].astype(np.int16)
    b = rgb_crop[:, :, 2].astype(np.int16)
    max_c = np.maximum(np.maximum(r, g), b)
    min_c = np.minimum(np.minimum(r, g), b)
    sat = max_c - min_c
    lum = 0.299 * r + 0.587 * g + 0.114 * b

    # Exterior pure black floodfill (tighter on dark-feather weapons so black feathers stay 100% intact)
    if mode == "dark_feathers":
        ext_cand = (max_c <= 6) & (sat <= 5)
    else:
        ext_cand = (max_c <= 14) & (sat <= 10)
    bg = flood_exterior(ext_cand)

    # Interior enclosed pure-black pockets (disabled for solid closed books; bright-ring guarded for dark feathers)
    cleaned_holes = 0
    if mode != "solid_book":
        hole_cand = (~bg) & (max_c <= 8) & (sat <= 6)
        _, hcs = connected_components_4(hole_cand)
        for hc in hcs:
            if hc["area"] < 24:
                continue
            hm = np.zeros((h, w), dtype=bool)
            hm[hc["ys"], hc["xs"]] = True
            if mode == "dark_feathers":
                ring = dilate_bool(hm, 2) & (~hm) & (~bg)
                if not np.any(ring):
                    continue
                # Only clear pockets framed by bright gold crown / crimson blade / thorn metal, never dark raven feathers
                ring_p75 = float(np.percentile(lum[ring], 75))
                ring_mean = float(np.mean(lum[ring]))
                if ring_mean < 52.0 or ring_p75 < 75.0:
                    continue
            fringe = dilate_bool(hm, 1) & (~hm) & (~bg) & (max_c <= 14) & (sat <= 10)
            bg[hm | fringe] = True
            cleaned_holes += 1

    # Soften outer black anti-aliased edge cleanly (un-premultiply black matte)
    alpha = np.where(bg, 0.0, 255.0).astype(np.float32)
    out_rgb = rgb_crop.astype(np.float32)

    edge1 = (~bg) & dilate_bool(bg, 1)
    edge2 = (~bg) & (~edge1) & dilate_bool(edge1, 1)

    edge_cfg = [(edge1, 22.0), (edge2, 12.0)] if mode == "dark_feathers" else [(edge1, 48.0), (edge2, 24.0)]
    for emask, hi in edge_cfg:
        ey, ex = np.where(emask & (max_c <= hi))
        for y, x in zip(ey, ex):
            mc = float(max_c[y, x])
            a = np.clip((mc - 3.0) / (hi - 3.0), 0.0, 1.0)
            if a < 0.04:
                alpha[y, x] = 0.0
            else:
                fg = out_rgb[y, x] / a
                out_rgb[y, x] = np.clip(fg, 0.0, 255.0)
                alpha[y, x] = a * 255.0

    rgba = np.dstack([
        np.clip(out_rgb[:, :, 0], 0, 255).astype(np.uint8),
        np.clip(out_rgb[:, :, 1], 0, 255).astype(np.uint8),
        np.clip(out_rgb[:, :, 2], 0, 255).astype(np.uint8),
        np.clip(alpha, 0, 255).astype(np.uint8),
    ])

    # Tight crop to weapon, then center cleanly inside 520x520 canvas with balanced padding (zero downscale if <=488)
    ys, xs = np.where(rgba[:, :, 3] > 10)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    cropped = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")
    cw, ch = cropped.size
    max_dim = out_size - 32
    if cw > max_dim or ch > max_dim:
        sc = min(max_dim / cw, max_dim / ch)
        cropped = cropped.resize((int(round(cw * sc)), int(round(ch * sc))), Image.Resampling.LANCZOS)
        cw, ch = cropped.size
    canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    canvas.paste(cropped, ((out_size - cw) // 2, (out_size - ch) // 2), cropped)
    return canvas, (x1 - x0, y1 - y0), cleaned_holes


def find_split_lines(arr):
    """Find cleanest pure-black horizontal (1) and vertical (2) split lines on the 2x3 sheet."""
    max_c = arr.max(axis=2)
    h, w = max_c.shape
    row_energy = max_c.mean(axis=1)
    col_energy = max_c.mean(axis=0)
    # Horizontal split around h/2
    y_mid = int(h * 0.35) + int(np.argmin(row_energy[int(h * 0.35):int(h * 0.65)]))
    # Vertical splits around w/3 and 2*w/3
    x1 = int(w * 0.25) + int(np.argmin(col_energy[int(w * 0.25):int(w * 0.42)]))
    x2 = int(w * 0.58) + int(np.argmin(col_energy[int(w * 0.58):int(w * 0.75)]))
    return y_mid, x1, x2, float(row_energy[y_mid]), float(col_energy[x1]), float(col_energy[x2])


def main():
    for d in (ARCHIVE_DIR, RAW_DOMAINS, RAW_VFX, RAW_WEAPONS, OUT_DOMAINS, OUT_VFX, OUT_WEAPONS):
        os.makedirs(d, exist_ok=True)

    # 1. Archive & install 10 Domain backdrops (dedupe exact duplicates cleanly)
    print("=== 1. DOMAINS ===")
    for dom_id, cn_name, uuids in DOMAINS:
        existing = [os.path.join(RAW_DIR, u) for u in uuids if os.path.exists(os.path.join(RAW_DIR, u))]
        raw_target = os.path.join(RAW_DOMAINS, cn_name)
        out_target = os.path.join(OUT_DOMAINS, f"{dom_id}.png")
        if existing:
            # Keep first as primary, check others for duplicate vs alternate
            primary = existing[0]
            p_hash = sha256(primary)
            shutil.copy2(primary, raw_target)
            shutil.copy2(primary, out_target)
            os.remove(primary)
            print(f"  {dom_id}.png <- {os.path.basename(primary)} (sha={p_hash[:10]})")
            for idx, extra in enumerate(existing[1:], start=2):
                e_hash = sha256(extra)
                if e_hash == p_hash:
                    os.remove(extra)
                    print(f"    Removed exact duplicate {os.path.basename(extra)}")
                else:
                    alt_name = cn_name.replace(".png", f"_备选{idx}.png")
                    shutil.move(extra, os.path.join(ARCHIVE_DIR, alt_name))
                    print(f"    Archived distinct alternate -> raw_art/_archive/{alt_name} (sha={e_hash[:10]})")
        elif os.path.exists(raw_target):
            shutil.copy2(raw_target, out_target)
            print(f"  {dom_id}.png synced from existing raw_art/domains/{cn_name}")

    # 2. Archive & install Shattered Impact Crack
    print("\n=== 2. IMPACT CRACK VFX ===")
    crack_src = os.path.join(RAW_DIR, IMPACT_CRACK_UUID)
    crack_raw = os.path.join(RAW_VFX, IMPACT_CRACK_RAW)
    crack_out = os.path.join(OUT_VFX, "vfx_impact_crack.png")
    if os.path.exists(crack_src):
        shutil.copy2(crack_src, crack_raw)
        shutil.copy2(crack_src, crack_out)
        os.remove(crack_src)
        print(f"  vfx_impact_crack.png <- {IMPACT_CRACK_UUID} (sha={sha256(crack_out)[:10]})")

    # 3. Backup old unused Gabriel/Noah weapon_h07 & weapon_h08 before replacing
    print("\n=== 3. WEAPONS 2x3 SLICE & MATTE ===")
    for old_w in ("weapon_h07.png", "weapon_h08.png"):
        old_p = os.path.join(OUT_WEAPONS, old_w)
        bak_p = os.path.join(ARCHIVE_DIR, f"旧版_{old_w}")
        if os.path.exists(old_p) and not os.path.exists(bak_p):
            shutil.copy2(old_p, bak_p)
            print(f"  Backed up old {old_w} -> raw_art/_archive/旧版_{old_w}")

    ws_src = os.path.join(RAW_DIR, WEAPONS_SHEET_UUID)
    ws_raw = os.path.join(RAW_WEAPONS, WEAPONS_SHEET_RAW)
    if os.path.exists(ws_src):
        shutil.copy2(ws_src, ws_raw)
        os.remove(ws_src)
        print(f"  Archived weapons sheet -> raw_art/weapons/{WEAPONS_SHEET_RAW}")

    im = Image.open(ws_raw).convert("RGB")
    arr = np.array(im)
    y_mid, x1, x2, re, c1e, c2e = find_split_lines(arr)
    print(f"  Split lines: y={y_mid} (mean={re:.2f}), x1={x1} (mean={c1e:.2f}), x2={x2} (mean={c2e:.2f})")

    ys_bounds = [(0, y_mid), (y_mid, arr.shape[0])]
    xs_bounds = [(0, x1), (x1, x2), (x2, arr.shape[1])]

    qa_cells = []
    for r_i, c_i, fname, label in WEAPON_SLOTS:
        y0, y1 = ys_bounds[r_i]
        x0, x1_b = xs_bounds[c_i]
        crop = arr[y0:y1, x0:x1_b]
        mode = "dark_feathers" if fname == "weapon_h11.png" else ("solid_book" if fname == "weapon_grimoire_reserve.png" else "standard")
        w_im, orig_wh, holes = matte_black_weapon(crop, out_size=520, mode=mode)
        out_p = os.path.join(OUT_WEAPONS, fname)
        w_im.save(out_p, "PNG")
        print(f"  -> {fname} ({label}): raw_bbox={orig_wh}, saved=520x520, black_holes_cleaned={holes}")
        qa_cells.append((r_i, c_i, fname, w_im))

    # Build dark-blue #12182E QA contact sheet for the 6 sliced weapons
    cw, ch = 540, 580
    sheet = Image.new("RGB", (cw * 3, ch * 2), (18, 24, 46))
    draw = ImageDraw.Draw(sheet)
    for r_i, c_i, fname, w_im in qa_cells:
        ox, oy = c_i * cw, r_i * ch
        draw.rectangle([ox + 2, oy + 2, ox + cw - 3, oy + ch - 3], outline=(60, 78, 120), width=1)
        draw.text((ox + 14, oy + 12), f"{fname} (520x520)", fill=(243, 217, 164))
        sheet.paste(w_im, (ox + 10, oy + 44), w_im)
    os.makedirs(os.path.dirname(QA_WEAPONS_PATH), exist_ok=True)
    sheet.save(QA_WEAPONS_PATH, "PNG")
    print(f"\nSaved dark-BG weapons QA sheet: {QA_WEAPONS_PATH}")


if __name__ == "__main__":
    main()
