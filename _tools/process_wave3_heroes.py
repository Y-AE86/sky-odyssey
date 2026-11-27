import hashlib
import os
import shutil
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = r"C:\Users\EDY\.gemini\antigravity\scratch\sky-odyssey"
RAW = os.path.join(ROOT, "raw_art")
SCRATCH = r"C:\Users\EDY\.gemini\antigravity\brain\3aa0f3bc-c79a-4dca-b8d1-13c3fc178cdc\scratch"
os.makedirs(SCRATCH, exist_ok=True)

DIRS = {
    "posters": os.path.join(RAW, "posters"),
    "avatars": os.path.join(RAW, "avatars"),
    "chibi": os.path.join(RAW, "chibi"),
    "weapons": os.path.join(RAW, "weapons"),
}
for d in DIRS.values():
    os.makedirs(d, exist_ok=True)

POSTERS = [
    ("aed1cc4f-ed88-4d8c-9801-b3c992f6f7bb.png", "看板海报_艾莉娅.png", "lobby_cg_h04.png"),
    ("fe73bbd2-72cb-49a7-ad9f-587cefa7a612.png", "看板海报_薇尔.png", "lobby_cg_h05.png"),
    ("7a99f163-16d4-4c60-8b5d-13043062239a.png", "看板海报_莉莉丝.png", "lobby_cg_h06.png"),
]

AVATARS = [
    ("636a54ae-1759-4852-b815-84965aefe6d0.png", "头像_艾莉娅.png", "avatar_h04.png"),
    ("28c1e4ea-71ab-407d-b2d2-89f17a8c778d.png", "头像_薇尔.png", "avatar_h05.png"),
    ("b7a28c9e-2fab-437f-9755-6611583b9935.png", "头像_莉莉丝.png", "avatar_h06.png"),
]

CHIBIS = [
    ("a52ee9ce-54cd-4546-8114-2aa65e3e6527.png", "战斗Q版_艾莉娅.png", "chibi_h04.png", "strict", 251, 4),
    ("bdd16e9a-5fbb-4874-8281-1a4cfc62db36.png", "战斗Q版_薇尔.png", "chibi_h05.png", "normal", 246, 10),
    ("e9d095f2-92e1-4303-893e-4b6454a8cef5.png", "战斗Q版_莉莉丝.png", "chibi_h06.png", "normal", 246, 10),
]

WEAPON_SHEET = ("fb1caf20-9e21-4909-9f8a-36d42ec77035.png", "合图_6把本命专武_纯黑底.png")

REJECTS = [
    "40da2271-38bb-4990-a641-e8c9f6e1658c.png",
    "af43cb0e-3560-4675-b2c8-dfd3b7f7d6c1.png",
    "048dbfe3-137f-4e71-928a-f05f20a32677.png",
    "8e4f6abc-6126-4385-a6c9-44f026554e68.png",
    "75c14481-3ef8-48fe-b73c-3d4f01038ba0.png",
    "717a3fa9-0a46-41ee-b27c-b135a6d99308.png",
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def move_if_in_root(src_uuid, dst_path):
    src = os.path.join(RAW, src_uuid)
    if os.path.exists(src):
        shutil.move(src, dst_path)
    assert os.path.exists(dst_path), f"Missing {dst_path}"


def matte_white_chibi(src_path, dst_path, clear_pure_holes=True, ext_min=246, ext_sat=10):
    im = Image.open(src_path).convert("RGB")
    rgb = np.array(im, dtype=np.float32)
    h, w, _ = rgb.shape

    min_c = rgb.min(axis=2)
    max_c = rgb.max(axis=2)
    sat = max_c - min_c
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]

    # 1) Border-connected exterior white background floodfill (strict on Aelia to protect white wings!)
    cand_ext = (min_c >= ext_min) & (sat <= ext_sat)
    lbl, _ = ndimage.label(cand_ext)
    border_labels = set(np.unique(np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])))
    border_labels.discard(0)
    bg_mask = np.isin(lbl, list(border_labels))

    # 2) Enclosed pure-white background pockets (between hair curls, trigger guards, legs)
    holes_cleared = 0
    if clear_pure_holes == "strict":
        # Ultra-strict for Aelia: only remove true flat GPT backdrop RGB(>=250) sat<=4 pockets (>=25px, mean>=252.5)
        # while leaving warm cream/ivory wing feathers 100% untouched!
        pure_flat = (min_c >= 250) & (sat <= 4) & (~bg_mask)
        hlbl, n_holes = ndimage.label(pure_flat)
        if n_holes > 0:
            counts = np.bincount(hlbl.ravel())
            for hid in range(1, n_holes + 1):
                if counts[hid] >= 25:
                    comp = (hlbl == hid)
                    if rgb[comp].mean() >= 252.5:
                        ring = ndimage.binary_dilation(comp, iterations=3) & (~comp) & (~bg_mask)
                        if np.any(ring) and lum[ring].mean() < 230.0:
                            bg_mask |= comp
                            holes_cleared += 1
    elif clear_pure_holes == "normal":
        pure_flat = (min_c >= 240) & (sat <= 12) & (~bg_mask)
        hlbl, n_holes = ndimage.label(pure_flat)
        if n_holes > 0:
            counts = np.bincount(hlbl.ravel())
            for hid in range(1, n_holes + 1):
                if counts[hid] >= 8:
                    comp = (hlbl == hid)
                    if rgb[comp].max() >= 250.0 and lum[comp].mean() >= 245.5:
                        ring = ndimage.binary_dilation(comp, iterations=3) & (~comp) & (~bg_mask)
                        if np.any(ring) and lum[ring].mean() < 195.0:
                            bg_mask |= comp
                            holes_cleared += 1

    # 3) Soft anti-aliased edge + white-fringe color decontamination ONLY on 2px rim adjacent to bg_mask
    alpha = np.where(bg_mask, 0.0, 1.0).astype(np.float32)
    near_bg = ndimage.binary_dilation(bg_mask, iterations=2) & (~bg_mask)

    aa_lo = 232.0 if clear_pure_holes == "strict" else 215.0
    aa_edge = near_bg & (min_c >= aa_lo) & (sat <= 35)
    edge_a = np.clip((253.0 - lum) / (253.0 - aa_lo), 0.0, 1.0)
    alpha[aa_edge] = edge_a[aa_edge]

    # Color decontamination on partially transparent edge pixels (remove white BG bleed)
    decon_mask = (alpha > 0.02) & (alpha < 0.995)
    out_rgb = rgb.copy()
    if np.any(decon_mask):
        a_col = alpha[decon_mask][:, None]
        bg_col = 254.0
        fg = (rgb[decon_mask] - (1.0 - a_col) * bg_col) / np.maximum(a_col, 0.14)
        out_rgb[decon_mask] = np.clip(fg, 0.0, 255.0)

    # Zero out RGB on completely transparent pixels for crisp lossless compression
    zero_a = alpha <= 0.02
    alpha[zero_a] = 0.0
    out_rgb[zero_a] = 0.0

    rgba = np.dstack([np.round(out_rgb).astype(np.uint8), np.round(alpha * 255.0).astype(np.uint8)])

    # 4) Crop cleanly to alpha > 10 bounding box + exact 16px transparent margin (matching chibi_c07/protag/c15)
    ys, xs = np.where(rgba[:, :, 3] > 10)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    crop = rgba[y0:y1, x0:x1]
    pad = 16
    canvas = np.zeros((crop.shape[0] + pad * 2, crop.shape[1] + pad * 2, 4), dtype=np.uint8)
    canvas[pad:pad + crop.shape[0], pad:pad + crop.shape[1]] = crop

    out_im = Image.fromarray(canvas, "RGBA")
    out_im.save(dst_path, "PNG", optimize=True)
    print(f"CHIBI {os.path.basename(dst_path):14s}: {out_im.size}, holes_cleared={holes_cleared}, {os.path.getsize(dst_path)//1024}KB")
    return out_im


def matte_black_weapon(crop_rgb, canvas_size=520, blue_tint_holes=False):
    rgb = np.array(crop_rgb, dtype=np.float32)
    max_c = rgb.max(axis=2)

    # 1) Exterior flood-fill of pure/near black
    dark = max_c <= 16
    lbl, _ = ndimage.label(dark)
    border_labels = set(np.unique(np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])))
    border_labels.discard(0)
    bg_black = np.isin(lbl, list(border_labels))

    # 2) Enclosed pure-black background pockets (inside ribbons, water loops, trigger guards, snowflake ring)
    if blue_tint_holes:
        # Snowflake staff interior ring has faint blue glow bleed over black background (R<=8, G<=16, B<=26)
        inner_cand = (rgb[:, :, 0] <= 8) & (rgb[:, :, 1] <= 16) & (rgb[:, :, 2] <= 26) & (~bg_black)
    else:
        inner_cand = (max_c <= 14) & (~bg_black)
    hlbl, n_holes = ndimage.label(inner_cand)
    holes_cleared = 0
    if n_holes > 0:
        counts = np.bincount(hlbl.ravel())
        for hid in range(1, n_holes + 1):
            # Ignore tiny flute finger holes (<45 px) while clearing all real enclosed loops
            if counts[hid] >= 45:
                comp = (hlbl == hid)
                if rgb[comp].mean() <= (13.0 if blue_tint_holes else 8.5):
                    bg_black |= comp
                    holes_cleared += 1

    # 3) Glow halo band connected to BOTH exterior AND cleared enclosed black pockets
    soft_band = (max_c <= 52) & (~bg_black)
    reachable = ndimage.binary_propagation(bg_black, mask=(bg_black | soft_band)) & soft_band

    alpha = np.where(bg_black, 0.0, 1.0).astype(np.float32)
    alpha[reachable] = np.clip((max_c[reachable] - 10.0) / 42.0, 0.0, 1.0)

    out_rgb = rgb.copy()
    glow_m = (alpha > 0.02) & (alpha < 0.995)
    if np.any(glow_m):
        a_col = alpha[glow_m][:, None]
        out_rgb[glow_m] = np.clip(rgb[glow_m] / np.maximum(a_col, 0.12), 0.0, 255.0)
    zero_a = alpha <= 0.02
    alpha[zero_a] = 0.0
    out_rgb[zero_a] = 0.0

    rgba = np.dstack([np.round(out_rgb).astype(np.uint8), np.round(alpha * 255.0).astype(np.uint8)])
    ys, xs = np.where(rgba[:, :, 3] > 12)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    trimmed = rgba[y0:y1, x0:x1]
    th, tw = trimmed.shape[:2]
    side = max(canvas_size, max(th, tw) + 24)
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    oy = (side - th) // 2
    ox = (side - tw) // 2
    canvas[oy:oy + th, ox:ox + tw] = trimmed
    return Image.fromarray(canvas, "RGBA"), (tw, th), holes_cleared


def main():
    # 1. Delete rejected duplicates
    deleted = 0
    for fn in REJECTS:
        p = os.path.join(RAW, fn)
        if os.path.exists(p):
            os.remove(p)
            deleted += 1
            print(f"DELETED reject: {fn}")
    print(f"Total rejected duplicates deleted: {deleted}")

    # 2. Posters (1:1 lossless copy)
    for src_u, cn_name, asset_name in POSTERS:
        raw_dst = os.path.join(DIRS["posters"], cn_name)
        asset_dst = os.path.join(ROOT, "assets", "posters", asset_name)
        move_if_in_root(src_u, raw_dst)
        shutil.copy2(raw_dst, asset_dst)
        assert sha256(raw_dst) == sha256(asset_dst)
        print(f"POSTER {asset_name:18s} <- {cn_name} ({os.path.getsize(asset_dst)//1024}KB)")

    # 3. Avatars (1:1 lossless copy)
    for src_u, cn_name, asset_name in AVATARS:
        raw_dst = os.path.join(DIRS["avatars"], cn_name)
        asset_dst = os.path.join(ROOT, "assets", "avatars", asset_name)
        move_if_in_root(src_u, raw_dst)
        shutil.copy2(raw_dst, asset_dst)
        assert sha256(raw_dst) == sha256(asset_dst)
        print(f"AVATAR {asset_name:18s} <- {cn_name} ({os.path.getsize(asset_dst)//1024}KB)")

    # 4. Chibis (move raw + matte white -> transparent RGBA + contact QA preview on dark bg)
    chibi_imgs = []
    for src_u, cn_name, asset_name, clear_holes, ext_min, ext_sat in CHIBIS:
        raw_dst = os.path.join(DIRS["chibi"], cn_name)
        asset_dst = os.path.join(ROOT, "assets", "chibi", asset_name)
        move_if_in_root(src_u, raw_dst)
        out_im = matte_white_chibi(raw_dst, asset_dst, clear_pure_holes=clear_holes, ext_min=ext_min, ext_sat=ext_sat)
        chibi_imgs.append((asset_name, out_im))

    # Build dark-background QA sheet for the 3 matted chibis (side-by-side with chibi_protag.png!)
    protag_im = Image.open(os.path.join(ROOT, "assets", "chibi", "chibi_protag.png")).convert("RGBA")
    all_chibis = [("anchor:protag", protag_im)] + chibi_imgs
    cell_w, cell_h = 460, 520
    qa_chibi = Image.new("RGB", (cell_w * 4, cell_h), (18, 24, 46))
    for i, (name, cim) in enumerate(all_chibis):
        thumb = cim.copy()
        thumb.thumbnail((cell_w - 20, cell_h - 20), Image.Resampling.LANCZOS)
        ox = i * cell_w + (cell_w - thumb.width) // 2
        oy = cell_h - 10 - thumb.height
        qa_chibi.paste(thumb, (ox, oy), thumb)
    qa_chibi_path = os.path.join(SCRATCH, "qa_wave3_chibis_on_dark.png")
    qa_chibi.save(qa_chibi_path)
    print(f"Saved chibi QA sheet: {qa_chibi_path}")

    # 5. 6 Exclusive Weapons (move raw + exact safe cuts y=455, x=566, x=1119 + matte black -> RGBA)
    w_raw_dst = os.path.join(DIRS["weapons"], WEAPON_SHEET[1])
    move_if_in_root(WEAPON_SHEET[0], w_raw_dst)
    sheet = Image.open(w_raw_dst).convert("RGB")
    sw, sh = sheet.size
    boxes = [
        ("weapon_h01.png", (0, 0, 566, 455)),
        ("weapon_h02.png", (566, 0, 1119, 455)),
        ("weapon_h03.png", (1119, 0, sw, 455)),
        ("weapon_h04.png", (0, 455, 566, sh)),
        ("weapon_h05.png", (566, 455, 1119, sh)),
        ("weapon_h06.png", (1119, 455, sw, sh)),
    ]
    qa_weapons = Image.new("RGB", (360 * 3, 360 * 2), (20, 26, 48))
    for idx, (wname, box) in enumerate(boxes):
        crop = sheet.crop(box)
        wim, trimmed_sz, wh = matte_black_weapon(crop, canvas_size=520, blue_tint_holes=(wname == "weapon_h02.png"))
        wdst = os.path.join(ROOT, "assets", "weapons", wname)
        wim.save(wdst, "PNG", optimize=True)
        print(f"WEAPON {wname:15s}: trimmed={trimmed_sz}, canvas={wim.size}, holes_cleared={wh}, {os.path.getsize(wdst)//1024}KB")
        thumb = wim.copy()
        thumb.thumbnail((320, 320), Image.Resampling.LANCZOS)
        r, c = divmod(idx, 3)
        qa_weapons.paste(thumb, (c * 360 + (360 - thumb.width) // 2, r * 360 + (360 - thumb.height) // 2), thumb)
    qa_w_path = os.path.join(SCRATCH, "qa_wave3_weapons_on_dark.png")
    qa_weapons.save(qa_w_path)
    print(f"Saved weapon QA sheet: {qa_w_path}")

    leftover = [f for f in os.listdir(RAW) if os.path.isfile(os.path.join(RAW, f))]
    print("Leftover files in raw_art root:", leftover)


if __name__ == "__main__":
    main()
