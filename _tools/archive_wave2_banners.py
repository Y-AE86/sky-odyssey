import hashlib
import os
import shutil

ROOT = r"C:\Users\EDY\.gemini\antigravity\scratch\sky-odyssey"
RAW = os.path.join(ROOT, "raw_art")
RAW_BANNERS = os.path.join(RAW, "banners")
RAW_ARCHIVE = os.path.join(RAW, "_archive")
ASSETS_BANNERS = os.path.join(ROOT, "assets", "banners")

os.makedirs(RAW_BANNERS, exist_ok=True)
os.makedirs(RAW_ARCHIVE, exist_ok=True)
os.makedirs(ASSETS_BANNERS, exist_ok=True)

WINNERS = [
    ("c8cf09d7-4670-4a6a-8ddc-a10568f0eb98.png", "试炼横幅_星穹高塔.png", "banner_tower.png"),
    ("3e3fea5f-8e91-4db7-b424-c61a57eed4e9.png", "试炼横幅_天城首领.png", "banner_boss.png"),
    ("ae2f7239-1086-40fd-b26e-5c9b00ccb045.png", "试炼横幅_星环演武.png", "banner_arena.png"),
    ("c82a33a8-9e9e-4f28-956c-3afe63cac233.png", "主城磁贴_航线飞艇.png", "tile_campaign.png"),
    ("d5d68574-3de2-4e0b-9642-e9552e9189bb.png", "主城磁贴_星匣宝箱.png", "tile_idle_box.png"),
    ("da25a8fc-3d81-4b0b-be50-54a95fff7d13.png", "主城磁贴_星港商铺.png", "tile_shop.png"),
]

ARCHIVES = [
    ("c7ce8b7d-c2e2-449c-aed9-f3c66e7adfe8.png", "备选_试炼横幅_天城首领_旧版.png"),
    ("8623fef7-f1c4-4f1d-a88a-1558e0b3be0a.png", "备选_试炼横幅_星环演武_旧版.png"),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


for src_name, raw_cn_name, asset_name in WINNERS:
    src = os.path.join(RAW, src_name)
    raw_dst = os.path.join(RAW_BANNERS, raw_cn_name)
    asset_dst = os.path.join(ASSETS_BANNERS, asset_name)
    if os.path.exists(src):
        shutil.move(src, raw_dst)
    assert os.path.exists(raw_dst), f"Missing {raw_dst}"
    shutil.copy2(raw_dst, asset_dst)
    h1, h2 = sha256(raw_dst), sha256(asset_dst)
    assert h1 == h2, f"SHA mismatch on {asset_name}"
    print(f"OK {asset_name:18s} <- {raw_cn_name} ({os.path.getsize(asset_dst)//1024} KB, sha={h1[:10]})")

for src_name, arch_cn_name in ARCHIVES:
    src = os.path.join(RAW, src_name)
    arch_dst = os.path.join(RAW_ARCHIVE, arch_cn_name)
    if os.path.exists(src):
        shutil.move(src, arch_dst)
    assert os.path.exists(arch_dst), f"Missing {arch_dst}"
    print(f"ARCHIVED {arch_cn_name}")

leftover = [f for f in os.listdir(RAW) if os.path.isfile(os.path.join(RAW, f))]
print("Leftover files in raw_art root:", leftover)
