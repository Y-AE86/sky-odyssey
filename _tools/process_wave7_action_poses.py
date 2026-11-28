import os
import shutil
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(REPO_ROOT, "raw_art")
RAW_CHIBI_DIR = os.path.join(RAW_DIR, "chibi")
OUT_CHIBI_DIR = os.path.join(REPO_ROOT, "assets", "chibi")
QA_SHEET_PATH = r"C:\Users\EDY\.gemini\antigravity\brain\3aa0f3bc-c79a-4dca-b8d1-13c3fc178cdc\scratch\wave7_poses_qa.png"

JOBS = [
    {
        "hero": "h01",
        "src_uuid": "1d79c186-4566-4f0c-a376-2bedc91b9796.png",
        "archive_name": "01_幽冥墨姬_战斗三动作原图.png",
        "strict_white": False,  # h01 has dark outfit, pale lavender hair, tiny white leg lace
    },
    {
        "hero": "h02",
        "src_uuid": "1ea6b9f6-0466-43ac-b546-0dff9b983696.png",
        "archive_name": "02_冰灵霜华_战斗三动作原图.png",
        "strict_white": True,   # h02 has pure-white sleeves & heels + ahoge ring + detached ice shards
    },
]

POSE_NAMES = ["windup", "atk", "hurt"]


def flood_exterior(is_bg_cand):
    h, w = is_bg_cand.shape
    vis = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        if is_bg_cand[0, x] and not vis[0, x]:
            vis[0, x] = True
            q.append((0, x))
        if is_bg_cand[h - 1, x] and not vis[h - 1, x]:
            vis[h - 1, x] = True
            q.append((h - 1, x))
    for y in range(h):
        if is_bg_cand[y, 0] and not vis[y, 0]:
            vis[y, 0] = True
            q.append((y, 0))
        if is_bg_cand[y, w - 1] and not vis[y, w - 1]:
            vis[y, w - 1] = True
            q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if y > 0 and is_bg_cand[y - 1, x] and not vis[y - 1, x]:
            vis[y - 1, x] = True
            q.append((y - 1, x))
        if y + 1 < h and is_bg_cand[y + 1, x] and not vis[y + 1, x]:
            vis[y + 1, x] = True
            q.append((y + 1, x))
        if x > 0 and is_bg_cand[y, x - 1] and not vis[y, x - 1]:
            vis[y, x - 1] = True
            q.append((y, x - 1))
        if x + 1 < w and is_bg_cand[y, x + 1] and not vis[y, x + 1]:
            vis[y, x + 1] = True
            q.append((y, x + 1))
    return vis


def connected_components_8(mask):
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
                ys = []
                xs = []
                while q:
                    cy, cx = q.popleft()
                    ys.append(cy)
                    xs.append(cx)
                    for ny in range(max(0, cy - 1), min(h, cy + 2)):
                        for nx in range(max(0, cx - 1), min(w, cx + 2)):
                            if mask[ny, nx] and labels[ny, nx] == 0:
                                labels[ny, nx] = cur
                                q.append((ny, nx))
                comps.append({
                    "id": cur,
                    "area": len(ys),
                    "ys": np.array(ys, dtype=np.int32),
                    "xs": np.array(xs, dtype=np.int32),
                    "cx": float(np.mean(xs)),
                    "cy": float(np.mean(ys)),
                })
    return labels, comps


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
                ys = []
                xs = []
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
                comps.append({
                    "id": cur,
                    "area": len(ys),
                    "ys": np.array(ys, dtype=np.int32),
                    "xs": np.array(xs, dtype=np.int32),
                })
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


def matte_single_pose(rgb_crop, fg_seed_mask, strict_white=False):
    """
    rgb_crop: (H, W, 3) uint8 where other poses are already painted pure white (255,255,255)
    fg_seed_mask: (H, W) bool for this pose's foreground connected components
    """
    h, w, _ = rgb_crop.shape
    r = rgb_crop[:, :, 0].astype(np.int16)
    g = rgb_crop[:, :, 1].astype(np.int16)
    b = rgb_crop[:, :, 2].astype(np.int16)
    min_c = np.minimum(np.minimum(r, g), b)
    max_c = np.maximum(np.maximum(r, g), b)
    sat = max_c - min_c
    lum = (0.299 * r + 0.587 * g + 0.114 * b)

    # Exterior background is everything outside fg_seed_mask (already white), plus border floodfill
    ext_cand = (min_c >= 242) & (sat <= 16)
    bg = flood_exterior(ext_cand) | (~dilate_bool(fg_seed_mask, 2))
    bg = flood_exterior(bg | ext_cand)

    # Interior enclosed white pockets check (strict pure-white background match)
    hole_cand = (~bg) & (min_c >= 250) & (sat <= 4)

    _, hole_comps = connected_components_4(hole_cand)
    removed_holes = 0
    for hc in hole_comps:
        area = hc["area"]
        if area < 30:
            continue
        hm = np.zeros((h, w), dtype=bool)
        hm[hc["ys"], hc["xs"]] = True
        ring = dilate_bool(hm, 2) & (~hm) & (~bg)
        ring3 = dilate_bool(hm, 4) & (~dilate_bool(hm, 1)) & (~bg)
        if not np.any(ring):
            continue
        ring_p25 = float(np.percentile(lum[ring], 25))
        ring3_p25 = float(np.percentile(lum[ring3], 25)) if np.any(ring3) else 255.0
        cy = float(np.mean(hc["ys"]))

        if strict_white:
            # h02 has pure-white sleeves (y ~ 270..460) and white heels (y > 600).
            # True enclosed background pockets (ahoge loop, halo/tassel gaps, ribbon/spear loops)
            # are either large dark-outlined loops (area>=95, rp25<=168, r3p25<=162),
            # small high-contrast ink gaps (area>=35, rp25<=125, r3p25<=105),
            # or bright-halo-adjacent background pockets above the sleeves (y<260, area>=60, r3p25<=176, rp25<=222).
            is_pocket = (
                (area >= 95 and ring_p25 <= 168.0 and ring3_p25 <= 162.0)
                or (area >= 35 and ring_p25 <= 125.0 and ring3_p25 <= 105.0)
                or (cy < 260.0 and area >= 60 and ring_p25 <= 222.0 and ring3_p25 <= 176.0)
            )
        else:
            # h01: protect pale lavender bangs, skin/chin/mouth, eye sclera, and white shin lace
            # All true scythe/lantern/ribbon/hair gaps have dark ink outlines (rp25<=166, r3p25<=155).
            is_pocket = (
                (area >= 60 and ring_p25 <= 168.0 and ring3_p25 <= 156.0)
                or (area >= 30 and ring_p25 <= 150.0 and ring3_p25 <= 135.0)
            )

        if is_pocket:
            # Also absorb 1px immediate near-white inner fringe touching this pocket
            fringe = dilate_bool(hm, 1) & (~hm) & (~bg) & (min_c >= 242) & (sat <= 12)
            bg[hm | fringe] = True
            removed_holes += 1

    # Soften 1-2px bright white anti-aliased fringe directly adjacent to transparent bg
    alpha = np.where(bg, 0.0, 255.0).astype(np.float32)
    out_rgb = rgb_crop.astype(np.float32)

    edge1 = (~bg) & dilate_bool(bg, 1)
    edge2 = (~bg) & (~edge1) & dilate_bool(edge1, 1)

    # Un-premultiply white matte on bright anti-aliased edge pixels
    for edge_mask, thresh in [(edge1, 185), (edge2, 228)]:
        ey, ex = np.where(edge_mask & (min_c >= thresh) & (sat <= 26))
        for y, x in zip(ey, ex):
            c_min = float(min_c[y, x])
            # Estimate coverage against white (255)
            # If pixel is near 255 -> alpha approaches 0; if ~thresh -> alpha stays high
            a = np.clip((255.0 - c_min) / (255.0 - max(130.0, thresh - 45.0)), 0.0, 1.0)
            if a < 0.04:
                alpha[y, x] = 0.0
            else:
                # De-halo white background contribution: C = a*Fg + (1-a)*255 => Fg = (C - (1-a)*255)/a
                fg = (out_rgb[y, x] - (1.0 - a) * 255.0) / a
                out_rgb[y, x] = np.clip(fg, 0.0, 255.0)
                alpha[y, x] = a * 255.0

    rgba = np.dstack([
        np.clip(out_rgb[:, :, 0], 0, 255).astype(np.uint8),
        np.clip(out_rgb[:, :, 1], 0, 255).astype(np.uint8),
        np.clip(out_rgb[:, :, 2], 0, 255).astype(np.uint8),
        np.clip(alpha, 0, 255).astype(np.uint8),
    ])

    # Tight crop + 16px uniform padding
    ys, xs = np.where(rgba[:, :, 3] > 8)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    cropped = rgba[y0:y1, x0:x1]
    pad = 16
    out = np.zeros((cropped.shape[0] + pad * 2, cropped.shape[1] + pad * 2, 4), dtype=np.uint8)
    out[pad:pad + cropped.shape[0], pad:pad + cropped.shape[1]] = cropped
    return Image.fromarray(out, "RGBA"), removed_holes


def process_job(job):
    src_uuid_path = os.path.join(RAW_DIR, job["src_uuid"])
    archive_path = os.path.join(RAW_CHIBI_DIR, job["archive_name"])
    os.makedirs(RAW_CHIBI_DIR, exist_ok=True)
    os.makedirs(OUT_CHIBI_DIR, exist_ok=True)

    if os.path.exists(src_uuid_path):
        shutil.copy2(src_uuid_path, archive_path)
        os.remove(src_uuid_path)
        print(f"Archived {job['src_uuid']} -> raw_art/chibi/{job['archive_name']}")
    elif not os.path.exists(archive_path):
        raise FileNotFoundError(f"Missing both {src_uuid_path} and {archive_path}")

    im = Image.open(archive_path).convert("RGB")
    arr = np.array(im)
    h, w, _ = arr.shape
    r, g, b = arr[:, :, 0].astype(np.int16), arr[:, :, 1].astype(np.int16), arr[:, :, 2].astype(np.int16)
    min_c = np.minimum(np.minimum(r, g), b)
    max_c = np.maximum(np.maximum(r, g), b)
    sat = max_c - min_c

    # Identify exterior background on full sheet
    ext_bg = flood_exterior((min_c >= 242) & (sat <= 16))
    fg = ~ext_bg

    labels, comps = connected_components_8(fg)
    comps_sorted_area = sorted(comps, key=lambda c: c["area"], reverse=True)
    main3 = sorted(comps_sorted_area[:3], key=lambda c: c["cx"])
    print(f"[{job['hero']}] Main 3 CCs: " + ", ".join(f"id={c['id']} area={c['area']} cx={c['cx']:.1f}" for c in main3))

    # Build pose pixel sets: sample boundary/pixels of each main3 component for accurate nearest-neighbor shard assignment
    main_pts = []
    for c in main3:
        # Subsample up to 4000 evenly-spaced pixels of the main pose for super-fast exact proximity
        step = max(1, len(c["xs"]) // 4000)
        pts = np.stack([c["xs"][::step], c["ys"][::step]], axis=1).astype(np.float32)
        main_pts.append(pts)

    pose_masks = [np.zeros((h, w), dtype=bool) for _ in range(3)]
    for idx, c in enumerate(main3):
        pose_masks[idx][c["ys"], c["xs"]] = True

    assigned_shards = [0, 0, 0]
    dropped_dust = 0
    for c in comps_sorted_area[3:]:
        if c["area"] < 30:
            dropped_dust += 1
            continue
        # Distance from shard centroid (and sampled shard points) to each of the 3 main poses
        sc = np.array([[c["cx"], c["cy"]]], dtype=np.float32)
        dists = [float(np.min(np.sum((pts - sc) ** 2, axis=1))) for pts in main_pts]
        best = int(np.argmin(dists))
        pose_masks[best][c["ys"], c["xs"]] = True
        assigned_shards[best] += 1

    print(f"[{job['hero']}] Detached shards assigned={assigned_shards}, dust dropped(<30px)={dropped_dust}")

    results = []
    for idx, pname in enumerate(POSE_NAMES):
        pm = pose_masks[idx]
        ys, xs = np.where(pm)
        pad_box = 12
        y0, y1 = max(0, int(ys.min()) - pad_box), min(h, int(ys.max()) + 1 + pad_box)
        x0, x1 = max(0, int(xs.min()) - pad_box), min(w, int(xs.max()) + 1 + pad_box)

        # Paint pixels belonging to OTHER poses pure white so X-overlap never leaks!
        other_mask = np.zeros((h, w), dtype=bool)
        for j in range(3):
            if j != idx:
                other_mask |= pose_masks[j]
        # Dilate other_mask by 1px to also erase anti-aliased fringe of neighboring pose
        other_sub = dilate_bool(other_mask[y0:y1, x0:x1], 1) & (~pm[y0:y1, x0:x1])

        crop = arr[y0:y1, x0:x1].copy()
        crop[other_sub] = 255

        out_im, holes = matte_single_pose(crop, pm[y0:y1, x0:x1], strict_white=job["strict_white"])
        out_name = f"chibi_{job['hero']}_{pname}.png"
        out_path = os.path.join(OUT_CHIBI_DIR, out_name)
        out_im.save(out_path, "PNG")
        print(f"  -> {out_name}: {out_im.size}, interior holes cleaned={holes}")
        results.append((out_name, out_im))
    return results


def build_qa_sheet(all_results):
    # 2 rows x 3 cols on dark midnight blue #12182E
    cell_w, cell_h = 560, 620
    sheet = Image.new("RGB", (cell_w * 3, cell_h * 2), (18, 24, 46))
    draw = ImageDraw.Draw(sheet)
    for r_idx, row in enumerate(all_results):
        for c_idx, (name, im) in enumerate(row):
            ox, oy = c_idx * cell_w, r_idx * cell_h
            # Subtle border & label
            draw.rectangle([ox + 2, oy + 2, ox + cell_w - 3, oy + cell_h - 3], outline=(60, 78, 120), width=1)
            draw.text((ox + 14, oy + 10), f"{name} ({im.size[0]}x{im.size[1]})", fill=(243, 217, 164))
            # Scale down to fit cell nicely with margin
            max_w, max_h = cell_w - 36, cell_h - 56
            sc = min(max_w / im.size[0], max_h / im.size[1], 1.0)
            nw, nh = int(im.size[0] * sc), int(im.size[1] * sc)
            resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
            px = ox + (cell_w - nw) // 2
            py = oy + 38 + (max_h - nh) // 2
            sheet.paste(resized, (px, py), resized)
    os.makedirs(os.path.dirname(QA_SHEET_PATH), exist_ok=True)
    sheet.save(QA_SHEET_PATH, "PNG")
    print(f"Saved dark-BG QA contact sheet: {QA_SHEET_PATH}")


if __name__ == "__main__":
    all_res = [process_job(job) for job in JOBS]
    build_qa_sheet(all_res)
