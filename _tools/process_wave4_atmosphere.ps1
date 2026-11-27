$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class BlackBadgeSlicer {
    public static string SliceAndMatteBlack(string sheetPath, int x0, int y0, int x1, int y1, string dstPath, int minCanvas, float holeMaxC, double holeMeanMax) {
        using (Bitmap sheet = new Bitmap(sheetPath)) {
            int cw = x1 - x0;
            int ch = y1 - y0;
            using (Bitmap crop = new Bitmap(cw, ch, PixelFormat.Format32bppArgb)) {
                using (Graphics g = Graphics.FromImage(crop)) {
                    g.DrawImage(sheet, new Rectangle(0, 0, cw, ch), new Rectangle(x0, y0, cw, ch), GraphicsUnit.Pixel);
                }

                int n = cw * ch;
                BitmapData bd = crop.LockBits(new Rectangle(0, 0, cw, ch), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                byte[] buf = new byte[n * 4];
                Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
                crop.UnlockBits(bd);

                float[] R = new float[n];
                float[] G = new float[n];
                float[] B = new float[n];
                float[] maxC = new float[n];
                for (int i = 0; i < n; i++) {
                    float b = buf[i * 4 + 0];
                    float g = buf[i * 4 + 1];
                    float r = buf[i * 4 + 2];
                    R[i] = r; G[i] = g; B[i] = b;
                    maxC[i] = Math.Max(r, Math.Max(g, b));
                }

                // 1) Exterior 4-connected flood-fill of pure/near black
                bool[] bgBlack = new bool[n];
                Queue<int> q = new Queue<int>(cw * 4);
                Action<int> trySeed = (idx) => {
                    if (!bgBlack[idx] && maxC[idx] <= 16f) {
                        bgBlack[idx] = true;
                        q.Enqueue(idx);
                    }
                };
                for (int x = 0; x < cw; x++) { trySeed(x); trySeed((ch - 1) * cw + x); }
                for (int y = 0; y < ch; y++) { trySeed(y * cw); trySeed(y * cw + (cw - 1)); }
                while (q.Count > 0) {
                    int idx = q.Dequeue();
                    int x = idx % cw, y = idx / cw;
                    if (x > 0) trySeed(idx - 1);
                    if (x < cw - 1) trySeed(idx + 1);
                    if (y > 0) trySeed(idx - cw);
                    if (y < ch - 1) trySeed(idx + cw);
                }

                // 2) Enclosed pure/glow-tinted black pockets (inside wings/wreath/dragon coils/gear spokes)
                int holesCleared = 0;
                bool[] vis = new bool[n];
                for (int start = 0; start < n; start++) {
                    if (bgBlack[start] || vis[start] || maxC[start] > holeMaxC) continue;
                    List<int> comp = new List<int>();
                    Queue<int> hq = new Queue<int>();
                    vis[start] = true;
                    hq.Enqueue(start);
                    double sumRgb = 0;
                    while (hq.Count > 0) {
                        int idx = hq.Dequeue();
                        comp.Add(idx);
                        sumRgb += (R[idx] + G[idx] + B[idx]) / 3.0;
                        int x = idx % cw, y = idx / cw;
                        int[] nbs = { x > 0 ? idx - 1 : -1, x < cw - 1 ? idx + 1 : -1, y > 0 ? idx - cw : -1, y < ch - 1 ? idx + cw : -1 };
                        foreach (int nb in nbs) {
                            if (nb >= 0 && !bgBlack[nb] && !vis[nb] && maxC[nb] <= holeMaxC) {
                                vis[nb] = true;
                                hq.Enqueue(nb);
                            }
                        }
                    }
                    if (comp.Count >= 40 && (sumRgb / comp.Count) <= holeMeanMax) {
                        foreach (int idx in comp) bgBlack[idx] = true;
                        holesCleared++;
                    }
                }

                // 3) Soft glow halo propagation reachable from exterior/hole black
                bool[] softReach = new bool[n];
                Queue<int> sq = new Queue<int>();
                for (int i = 0; i < n; i++) {
                    if (bgBlack[i]) { softReach[i] = true; sq.Enqueue(i); }
                }
                while (sq.Count > 0) {
                    int idx = sq.Dequeue();
                    int x = idx % cw, y = idx / cw;
                    int[] nbs = { x > 0 ? idx - 1 : -1, x < cw - 1 ? idx + 1 : -1, y > 0 ? idx - cw : -1, y < ch - 1 ? idx + cw : -1 };
                    foreach (int nb in nbs) {
                        if (nb >= 0 && !softReach[nb] && maxC[nb] <= 52f) {
                            softReach[nb] = true;
                            sq.Enqueue(nb);
                        }
                    }
                }

                byte[] outBuf = new byte[n * 4];
                int minX = cw, minY = ch, maxX = -1, maxY = -1;
                for (int y = 0; y < ch; y++) {
                    for (int x = 0; x < cw; x++) {
                        int i = y * cw + x;
                        float a = bgBlack[i] ? 0f : 1f;
                        if (!bgBlack[i] && softReach[i]) {
                            a = (maxC[i] - 10f) / 42f;
                            if (a < 0f) a = 0f;
                            if (a > 1f) a = 1f;
                        }
                        float r = R[i], g = G[i], b = B[i];
                        if (a > 0.02f && a < 0.995f) {
                            float denom = Math.Max(a, 0.12f);
                            r = Math.Min(255f, r / denom);
                            g = Math.Min(255f, g / denom);
                            b = Math.Min(255f, b / denom);
                        } else if (a <= 0.02f) {
                            a = 0f; r = 0f; g = 0f; b = 0f;
                        }
                        byte ab = (byte)Math.Round(a * 255f);
                        outBuf[i * 4 + 0] = (byte)Math.Round(b);
                        outBuf[i * 4 + 1] = (byte)Math.Round(g);
                        outBuf[i * 4 + 2] = (byte)Math.Round(r);
                        outBuf[i * 4 + 3] = ab;
                        if (ab > 12) {
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                        }
                    }
                }

                int tw = maxX - minX + 1;
                int th = maxY - minY + 1;
                int side = Math.Max(minCanvas, Math.Max(tw, th) + 20);
                int ox = (side - tw) / 2;
                int oy = (side - th) / 2;
                byte[] sqBuf = new byte[side * side * 4];
                for (int y = 0; y < th; y++) {
                    int srcOff = ((minY + y) * cw + minX) * 4;
                    int dstOff = ((oy + y) * side + ox) * 4;
                    Buffer.BlockCopy(outBuf, srcOff, sqBuf, dstOff, tw * 4);
                }

                using (Bitmap outBmp = new Bitmap(side, side, PixelFormat.Format32bppArgb)) {
                    BitmapData obd = outBmp.LockBits(new Rectangle(0, 0, side, side), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                    Marshal.Copy(sqBuf, 0, obd.Scan0, sqBuf.Length);
                    outBmp.UnlockBits(obd);
                    outBmp.Save(dstPath, ImageFormat.Png);
                }
                return string.Format("trimmed={0}x{1}, canvas={2}x{2}, holes={3}", tw, th, side, holesCleared);
            }
        }
    }

    public static void BuildBadgeQaSheet(string[] paths, string dstPath) {
        int cell = 320;
        using (Bitmap canvas = new Bitmap(cell * 3, cell * 3, PixelFormat.Format24bppRgb))
        using (Graphics g = Graphics.FromImage(canvas)) {
            g.Clear(Color.FromArgb(18, 24, 46));
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            for (int i = 0; i < paths.Length; i++) {
                int r = i / 3, c = i % 3;
                using (Bitmap im = new Bitmap(paths[i])) {
                    double scale = Math.Min((double)(cell - 28) / im.Width, (double)(cell - 28) / im.Height);
                    int tw = (int)Math.Round(im.Width * scale);
                    int th = (int)Math.Round(im.Height * scale);
                    int ox = c * cell + (cell - tw) / 2;
                    int oy = r * cell + (cell - th) / 2;
                    g.DrawImage(im, ox, oy, tw, th);
                }
            }
            canvas.Save(dstPath, ImageFormat.Png);
        }
    }
}
"@

$root = "C:\Users\Administrator\.gemini\antigravity\scratch\sky-odyssey"
$rawAv = Join-Path $root "raw_art\avatars"
$rawScenes = Join-Path $root "raw_art\scenes"
$rawBanners = Join-Path $root "raw_art\banners"
$rawSheets = Join-Path $root "raw_art\ui_sheets"
$assetScenes = Join-Path $root "assets\scenes"
$assetBanners = Join-Path $root "assets\banners"
$assetBadges = Join-Path $root "assets\badges"
$scratch = "C:\Users\Administrator\.gemini\antigravity\brain\742cf151-434d-407d-957d-4d7dcf513586\scratch"
New-Item -ItemType Directory -Force -Path $rawScenes, $rawBanners, $rawSheets, $assetScenes, $assetBanners, $assetBadges, $scratch | Out-Null

# 1. Move & 1:1 lossless copy the 4 16:9 scenes & event tile
$fullImages = @(
  @("de4f2974-18fd-40d3-b558-d08415a48d3f.png", (Join-Path $rawScenes "05_航线浮空群岛大地图_16x9.png"), (Join-Path $assetScenes "bg_worldmap.png")),
  @("b10f9748-79ad-46e3-bfa5-aaf2e38c86ee.png", (Join-Path $rawScenes "06_第2章齿轮云巅战台_16x9.png"), (Join-Path $assetScenes "bg_battle_ch2.png")),
  @("19637d3f-bd63-46ad-adbb-aaae0e73f208.png", (Join-Path $rawScenes "07_天城首领星穹祭坛战台_16x9.png"), (Join-Path $assetScenes "bg_battle_boss.png")),
  @("8c964b77-2162-4d15-a907-a1927f6cec3d.png", (Join-Path $rawBanners "07_主城磁贴_限时活动七日启航_16x9.png"), (Join-Path $assetBanners "tile_event.png"))
)
foreach ($f in $fullImages) {
  $src = Join-Path $rawAv $f[0]
  if (Test-Path $src) { Move-Item -Force -Path $src -Destination $f[1] }
  Copy-Item -Force -Path $f[1] -Destination $f[2]
  $h1 = (Get-FileHash $f[1] -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $f[2] -Algorithm SHA256).Hash
  Write-Output ("INSTALL {0,-18} | SHA256 match={1} ({2}) | {3:N1} KB" -f (Split-Path $f[2] -Leaf), ($h1 -eq $h2), $h1.Substring(0,12), ((Get-Item $f[2]).Length/1KB))
}

# 2. Move 3x3 black-bg badge sheet & slice 9 lossless transparent RGBA badges
$sheetSrc = Join-Path $rawAv "4540de06-3c0e-4b66-be3c-9ef3c02e1955.png"
$sheetDst = Join-Path $rawSheets "合图_4阵营与5技能共鸣纹章_纯黑底_3x3.png"
if (Test-Path $sheetSrc) { Move-Item -Force -Path $sheetSrc -Destination $sheetDst }

$xs = @(0, 407, 836, 1254)
$ys = @(0, 394, 810, 1254)
$names = @(
  "faction_donghuang.png", "faction_shenghui.png", "faction_jiqiao.png",
  "faction_miying.png",    "skill_basic.png",      "skill_ult.png",
  "skill_passive.png",     "skill_awaken.png",     "badge_resonance.png"
)
$outPaths = @()
for ($i = 0; $i -lt 9; $i++) {
  $r = [int][Math]::Floor($i / 3)
  $c = $i % 3
  $outP = Join-Path $assetBadges $names[$i]
  $isHollowTinted = ($i -eq 0 -or $i -eq 2)
  $hMax = if ($isHollowTinted) { 30.0 } else { 14.0 }
  $hMean = if ($isHollowTinted) { 20.0 } else { 8.5 }
  $info = [BlackBadgeSlicer]::SliceAndMatteBlack($sheetDst, $xs[$c], $ys[$r], $xs[$c+1], $ys[$r+1], $outP, 440, $hMax, $hMean)
  $outPaths += $outP
  Write-Output ("BADGE   {0,-22} | {1} | {2:N1} KB" -f $names[$i], $info, ((Get-Item $outP).Length/1KB))
}

$qaPath = Join-Path $scratch "qa_wave4_badges_on_dark.png"
[BlackBadgeSlicer]::BuildBadgeQaSheet($outPaths, $qaPath)
Write-Output "QA_SHEET: $qaPath"
