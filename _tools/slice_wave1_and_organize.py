import os
import shutil
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = r"C:\Users\EDY\.gemini\antigravity\scratch\sky-odyssey"
RAW = os.path.join(ROOT, "raw_art")
ASSETS = os.path.join(ROOT, "assets")


def organize_raw_art():
    """Organize messy UUID files in raw_art/ into clean categorized subfolders with readable names."""
    subdirs = ["posters", "avatars", "scenes", "ui_sheets", "_archive"]
    for sd in subdirs:
        os.makedirs(os.path.join(RAW, sd), exist_ok=True)

    moves = {
        # Posters
        "3f19db5d-996b-4325-bbb0-3acc2b1a63d1.png": ("posters", "01_幽冥墨姬_主城海报_16x9.png"),
        "76247d62-63d9-4ffa-bcc3-2f0e854dadd9.png": ("posters", "02_冰灵霜华_主城海报_16x9.png"),
        "440bcf92-dd4c-496f-b523-226dcff8c05c.png": ("posters", "03_凌波玉笛_主城海报_16x9.png"),
        # Avatars
        "0649e1c5-928c-4881-86dc-99d6df2440d3.png": ("avatars", "01_幽冥墨姬_头像_1x1.png"),
        "641f502c-1da0-4ff1-b548-b26d8c233803.png": ("avatars", "02_冰灵霜华_头像_1x1.png"),
        "dcdb24ba-8c1d-4286-acbc-f26407d29695.png": ("avatars", "03_凌波玉笛_头像_1x1.png"),
        # Scenes
        "bg_battle.png": ("scenes", "bg_battle_6v6浮空战台.png"),
        "bg_roster.png": ("scenes", "bg_roster_星灵养成舞台.png"),
        "2c9a9f8e-5f76-4d8b-8a6e-43368697ca3f.png": ("scenes", "bg_roster_alt_星穹圣殿备用.png"),
        "bg_gacha.png": ("scenes", "bg_gacha_星穹召唤星门.png"),
        # UI & Icon Sheets
        "ui_buttons_sheet.png": ("ui_sheets", "sheet_01_基础按钮与进度条_原版.png"),
        "ui_frames_sheet.png": ("ui_sheets", "sheet_02_四档品质框_R_SR_SSR_UR.png"),
        "133a0619-bb4a-4baf-bcf3-423049f48735.png": ("ui_sheets", "sheet_03_核心货币与道具_9件套.png"),
        "15a63ca1-13cb-4fba-bf5b-4439244a771a.png": ("ui_sheets", "sheet_04_主城鎏金功能图标_9件套.png"),
        "6b7bff5d-27f6-4d7b-81a0-54dbaeb038b2.png": ("ui_sheets", "sheet_05_胜负徽章与洁净按钮页签_9件套.png"),
        "d7cbc3e0-3771-42d5-bfc8-fe6f44abb338.png": ("ui_sheets", "sheet_06_四大星装_8件套_高清版.png"),
        # Superseded smaller variant archived cleanly
        "73145fb5-e9f5-415f-ae2d-596257145dd7.png": ("_archive", "淘汰小尺寸_星装8件套_旧版.png"),
    }

    moved_count = 0
    for old_name, (sub, new_name) in moves.items():
        src = os.path.join(RAW, old_name)
        dst = os.path.join(RAW, sub, new_name)
        if os.path.exists(src):
            shutil.move(src, dst)
            moved_count += 1
    print(f"Organized raw_art: moved {moved_count} files.")


def smart_black_to_rgba(rgb_arr, dark_thresh=14, solid_core=True, glow_gamma=0.82):
    """
    Convert pure-black-background painterly icons / dark-center glass buttons to crisp lossless RGBA.
    - Flood-fills ONLY exterior pure-black background from image edges so dark-indigo / espresso
      interiors (cloaks, bags, dark glass buttons) stay 100% rich and opaque!
    - Exterior soft glow/anti-aliased fringe uses smooth screen-luma alpha + gentle un-premultiply.
    """
    h, w, _ = rgb_arr.shape
    f = rgb_arr.astype(np.float32) / 255.0
    mx = np.max(f, axis=2)

    # Pad by 1px true-black border to guarantee border flood-fill connects all sides
    padded_dark = np.ones((h + 2, w + 2), dtype=bool)
    padded_dark[1:-1, 1:-1] = mx <= (dark_thresh / 255.0)
    lbl, _ = ndimage.label(padded_dark)
    bg_label = lbl[0, 0]
    ext_bg = (lbl[1:-1, 1:-1] == bg_label)

    # Foreground mask = anything not reachable from pure-black exterior
    fg_raw = ~ext_bg
    # Fill tiny enclosed black gaps inside solid icons/buttons (e.g., inside dark button or velvet pouch)
    if solid_core:
        fg_filled = ndimage.binary_fill_holes(ndimage.binary_closing(fg_raw, iterations=1))
        # Erode slightly to identify true solid interior vs soft glowing outer rim (within 4px of exterior)
        dist_from_bg = ndimage.distance_transform_edt(fg_filled)
        core_mask = dist_from_bg >= 4.0
        # Soft luma alpha for outer halo/anti-alias zone
        base_a = np.clip((mx - 4.0 / 255.0) / (1.0 - 4.0 / 255.0), 0.0, 1.0)
        glow_a = np.clip(np.power(base_a, glow_gamma) * 1.25, 0.0, 1.0)
        # Smoothly blend core (opaque=1.0) with outer halo across 1..4px distance
        core_blend = np.clip((dist_from_bg - 1.0) / 3.0, 0.0, 1.0)
        alpha = np.where(ext_bg, 0.0, np.maximum(glow_a, core_blend))
        # Keep true interior opaque
        alpha = np.where(core_mask, 1.0, alpha)
    else:
        base_a = np.clip((mx - 5.0 / 255.0) / (1.0 - 5.0 / 255.0), 0.0, 1.0)
        alpha = np.where(ext_bg, 0.0, np.clip(np.power(base_a, glow_gamma) * 1.22, 0.0, 1.0))
        core_mask = alpha >= 0.96

    # Un-premultiply only semi-transparent outer glow pixels so black fringe never appears
    out_rgb = np.zeros_like(f)
    denom = np.maximum(alpha, 0.20)
    scale = np.where(core_mask, 1.0, 1.0 / denom)
    for c in range(3):
        out_rgb[:, :, c] = np.clip(f[:, :, c] * scale, 0.0, 1.0)

    rgba = np.dstack([
        np.round(out_rgb * 255).astype(np.uint8),
        np.round(alpha * 255).astype(np.uint8),
    ])
    return rgba


def trim_and_pad(rgba, pad=6, square_size=None):
    """Trim fully transparent outer margin; optionally center onto a uniform square canvas."""
    ys, xs = np.where(rgba[:, :, 3] > 6)
    if len(xs) == 0:
        return rgba
    x0, x1 = max(0, int(xs.min()) - pad), min(rgba.shape[1], int(xs.max()) + 1 + pad)
    y0, y1 = max(0, int(ys.min()) - pad), min(rgba.shape[0], int(ys.max()) + 1 + pad)
    trimmed = rgba[y0:y1, x0:x1]
    if square_size is None:
        return trimmed
    th, tw, _ = trimmed.shape
    side = max(square_size, tw + 12, th + 12)
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    ox = (side - tw) // 2
    oy = (side - th) // 2
    canvas[oy:oy + th, ox:ox + tw] = trimmed
    return canvas


def slice_grid_by_cuts(img_path, y_cuts, x_cuts_per_row, names_per_row, out_dir, square_size=None, solid_core=True):
    os.makedirs(out_dir, exist_ok=True)
    img = np.array(Image.open(img_path).convert("RGB"))
    h, w, _ = img.shape
    y_bounds = [0] + list(y_cuts) + [h]
    saved = []
    for r in range(len(names_per_row)):
        y0, y1 = y_bounds[r], y_bounds[r + 1]
        x_bounds = [0] + list(x_cuts_per_row[r]) + [w]
        for c, name in enumerate(names_per_row[r]):
            x0, x1 = x_bounds[c], x_bounds[c + 1]
            cell = img[y0:y1, x0:x1]
            rgba = smart_black_to_rgba(cell, dark_thresh=14, solid_core=solid_core)
            out = trim_and_pad(rgba, pad=6, square_size=square_size)
            out_path = os.path.join(out_dir, name)
            Image.fromarray(out, "RGBA").save(out_path)
            opaque_pct = float(np.mean(out[:, :, 3] > 200) * 100.0)
            saved.append((name, out.shape[1], out.shape[0], opaque_pct))
    return saved


def main():
    organize_raw_art()
    ui_sheets = os.path.join(RAW, "ui_sheets")

    # 1. Currency & Core Items (3x3) -> assets/items/
    s1 = slice_grid_by_cuts(
        os.path.join(ui_sheets, "sheet_03_核心货币与道具_9件套.png"),
        y_cuts=[375, 768],
        x_cuts_per_row=[[425, 800], [430, 780], [360, 810]],
        names_per_row=[
            ["item_gem.png", "item_coin.png", "item_ticket.png"],
            ["item_core.png", "item_shard.png", "item_chest.png"],
            ["item_dew.png", "item_dust.png", "item_stamina.png"],
        ],
        out_dir=os.path.join(ASSETS, "items"),
        square_size=400,
        solid_core=True,
    )
    print(f"Sliced {len(s1)} currency/item icons:")
    for n, w, h, op in s1:
        print(f"  {n}: {w}x{h} (opaque {op:.1f}%)")

    # 2. 4-Slot Star Gears (2x4 high-res) -> assets/items/
    s2 = slice_grid_by_cuts(
        os.path.join(ui_sheets, "sheet_06_四大星装_8件套_高清版.png"),
        y_cuts=[430],
        x_cuts_per_row=[[438, 912, 1328], [441, 905, 1310]],
        names_per_row=[
            ["gear_weapon_sr.png", "gear_armor_sr.png", "gear_accessory_sr.png", "gear_relic_sr.png"],
            ["gear_weapon_ur.png", "gear_armor_ur.png", "gear_accessory_ur.png", "gear_relic_ur.png"],
        ],
        out_dir=os.path.join(ASSETS, "items"),
        square_size=450,
        solid_core=True,
    )
    print(f"Sliced {len(s2)} gear icons:")
    for n, w, h, op in s2:
        print(f"  {n}: {w}x{h} (opaque {op:.1f}%)")

    # 3. Lobby Gold Navigation Icons (3x3) -> assets/icons/
    s3 = slice_grid_by_cuts(
        os.path.join(ui_sheets, "sheet_04_主城鎏金功能图标_9件套.png"),
        y_cuts=[412, 804],
        x_cuts_per_row=[[434, 827], [418, 844], [415, 838]],
        names_per_row=[
            ["icon_quest.png", "icon_reward.png", "icon_codex.png"],
            ["icon_bag.png", "icon_shop.png", "icon_formation.png"],
            ["icon_roster.png", "icon_gacha.png", "icon_settings.png"],
        ],
        out_dir=os.path.join(ASSETS, "icons"),
        square_size=380,
        solid_core=True,
    )
    print(f"Sliced {len(s3)} lobby nav icons:")
    for n, w, h, op in s3:
        print(f"  {n}: {w}x{h} (opaque {op:.1f}%)")

    # 4. Battle Emblems (4) + Upgraded Clean Dark-Center Buttons (3) + Clean Tabs (2) -> assets/ui/
    s4 = slice_grid_by_cuts(
        os.path.join(ui_sheets, "sheet_05_胜负徽章与洁净按钮页签_9件套.png"),
        y_cuts=[468, 755],
        x_cuts_per_row=[[487, 857, 1180], [492, 957], [715]],
        names_per_row=[
            ["emblem_victory.png", "emblem_defeat.png", "emblem_mvp.png", "emblem_star.png"],
            ["ui_btn_gold.png", "ui_btn_cyan.png", "ui_btn_crimson.png"],
            ["ui_tab_active.png", "ui_tab_idle.png"],
        ],
        out_dir=os.path.join(ASSETS, "ui"),
        square_size=None,
        solid_core=True,
    )
    print(f"Sliced {len(s4)} emblems + upgraded clean buttons/tabs:")
    for n, w, h, op in s4:
        print(f"  {n}: {w}x{h} (opaque {op:.1f}%)")


if __name__ == "__main__":
    main()
