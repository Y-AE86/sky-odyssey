$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ChibiMatter {
    public static string MatteWhiteChibi(string srcPath, string dstPath, bool strictMode, int extMin, int extSat, bool clearTopHalo) {
        using (Bitmap srcOrig = new Bitmap(srcPath))
        using (Bitmap src = new Bitmap(srcOrig.Width, srcOrig.Height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(src)) {
                g.DrawImage(srcOrig, 0, 0, srcOrig.Width, srcOrig.Height);
            }
            int w = src.Width;
            int h = src.Height;
            int n = w * h;

            BitmapData bd = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] buf = new byte[n * 4];
            Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
            src.UnlockBits(bd);

            float[] R = new float[n];
            float[] G = new float[n];
            float[] B = new float[n];
            float[] minC = new float[n];
            float[] sat = new float[n];
            float[] lum = new float[n];

            for (int i = 0; i < n; i++) {
                float b = buf[i * 4 + 0];
                float g = buf[i * 4 + 1];
                float r = buf[i * 4 + 2];
                R[i] = r; G[i] = g; B[i] = b;
                float mn = Math.Min(r, Math.Min(g, b));
                float mx = Math.Max(r, Math.Max(g, b));
                minC[i] = mn;
                sat[i] = mx - mn;
                lum[i] = 0.299f * r + 0.587f * g + 0.114f * b;
            }

            // 1) Exterior 4-connected flood-fill from image border
            bool[] bgMask = new bool[n];
            Queue<int> q = new Queue<int>(w * 4);
            Action<int> trySeed = (idx) => {
                if (!bgMask[idx] && minC[idx] >= extMin && sat[idx] <= extSat) {
                    bgMask[idx] = true;
                    q.Enqueue(idx);
                }
            };
            for (int x = 0; x < w; x++) {
                trySeed(x);
                trySeed((h - 1) * w + x);
            }
            for (int y = 0; y < h; y++) {
                trySeed(y * w);
                trySeed(y * w + (w - 1));
            }
            while (q.Count > 0) {
                int idx = q.Dequeue();
                int x = idx % w, y = idx / w;
                if (x > 0) trySeed(idx - 1);
                if (x < w - 1) trySeed(idx + 1);
                if (y > 0) trySeed(idx - w);
                if (y < h - 1) trySeed(idx + w);
            }

            // Measure exact exterior background color from bgMask
            double bgRSum = 0, bgGSum = 0, bgBSum = 0;
            int bgCnt = 0;
            for (int i = 0; i < n; i++) {
                if (bgMask[i]) { bgRSum += R[i]; bgGSum += G[i]; bgBSum += B[i]; bgCnt++; }
            }
            float bgR = bgCnt > 0 ? (float)(bgRSum / bgCnt) : 254f;
            float bgG = bgCnt > 0 ? (float)(bgGSum / bgCnt) : 254f;
            float bgB = bgCnt > 0 ? (float)(bgBSum / bgCnt) : 254f;

            // 2) Enclosed pure-white background pockets
            int holesCleared = 0;
            bool[] visited = new bool[n];
            int minHolePx = strictMode ? 65 : 10;
            float holeMinC = strictMode ? 245f : 242f;
            float holeSat = strictMode ? 6f : 10f;

            for (int start = 0; start < n; start++) {
                if (bgMask[start] || visited[start]) continue;
                if (minC[start] < holeMinC || sat[start] > holeSat) continue;

                List<int> comp = new List<int>();
                Queue<int> hq = new Queue<int>();
                visited[start] = true;
                hq.Enqueue(start);
                double sumLum = 0;
                float maxRgb = 0;

                while (hq.Count > 0) {
                    int idx = hq.Dequeue();
                    comp.Add(idx);
                    sumLum += lum[idx];
                    float mx = Math.Max(R[idx], Math.Max(G[idx], B[idx]));
                    if (mx > maxRgb) maxRgb = mx;

                    int x = idx % w, y = idx / w;
                    int[] nbs = { x > 0 ? idx - 1 : -1, x < w - 1 ? idx + 1 : -1, y > 0 ? idx - w : -1, y < h - 1 ? idx + w : -1 };
                    foreach (int nb in nbs) {
                        if (nb >= 0 && !bgMask[nb] && !visited[nb] && minC[nb] >= holeMinC && sat[nb] <= holeSat) {
                            visited[nb] = true;
                            hq.Enqueue(nb);
                        }
                    }
                }

                if (comp.Count < minHolePx) continue;
                HashSet<int> compSet = new HashSet<int>(comp);

                if (strictMode) {
                    // Erode 2px inward so thin white specular streaks/lace/feathers are 100% protected,
                    // while true enclosed background pockets retain an ultra-flat background-matched core!
                    HashSet<int> cur = compSet;
                    for (int er = 0; er < 2; er++) {
                        HashSet<int> next = new HashSet<int>();
                        foreach (int idx in cur) {
                            int x = idx % w, y = idx / w;
                            if (x > 0 && x < w - 1 && y > 0 && y < h - 1 &&
                                cur.Contains(idx - 1) && cur.Contains(idx + 1) &&
                                cur.Contains(idx - w) && cur.Contains(idx + w)) {
                                next.Add(idx);
                            }
                        }
                        cur = next;
                    }
                    if (cur.Count < 16) continue;
                    int exactBgPx = 0;
                    foreach (int idx in cur) {
                        if (Math.Abs(R[idx] - bgR) <= 1.8f && Math.Abs(G[idx] - bgG) <= 1.8f && Math.Abs(B[idx] - bgB) <= 1.8f) {
                            exactBgPx++;
                        }
                    }
                    double bgMatchRatio = (double)exactBgPx / cur.Count;
                    if (bgMatchRatio < 0.85) continue;

                    // Verify 3px ring is bounded by real artwork (not bright white garment interior)
                    HashSet<int> frontier = new HashSet<int>(comp);
                    HashSet<int> ringSet = new HashSet<int>();
                    for (int iter = 0; iter < 3; iter++) {
                        HashSet<int> nextF = new HashSet<int>();
                        foreach (int idx in frontier) {
                            int x = idx % w, y = idx / w;
                            int[] nbs = { x > 0 ? idx - 1 : -1, x < w - 1 ? idx + 1 : -1, y > 0 ? idx - w : -1, y < h - 1 ? idx + w : -1 };
                            foreach (int nb in nbs) {
                                if (nb >= 0 && !compSet.Contains(nb) && !bgMask[nb] && ringSet.Add(nb)) nextF.Add(nb);
                            }
                        }
                        frontier = nextF;
                    }
                    if (ringSet.Count > 0) {
                        double ringLum = 0;
                        foreach (int ridx in ringSet) ringLum += lum[ridx];
                        if (ringLum / ringSet.Count < 228.0) {
                            foreach (int cidx in comp) bgMask[cidx] = true;
                            holesCleared++;
                        }
                    }
                } else {
                    if (!(maxRgb >= 250.0f && (sumLum / comp.Count) >= 246.0)) continue;
                    HashSet<int> frontier = new HashSet<int>(comp);
                    HashSet<int> ringSet = new HashSet<int>();
                    for (int iter = 0; iter < 3; iter++) {
                        HashSet<int> nextF = new HashSet<int>();
                        foreach (int idx in frontier) {
                            int x = idx % w, y = idx / w;
                            int[] nbs = { x > 0 ? idx - 1 : -1, x < w - 1 ? idx + 1 : -1, y > 0 ? idx - w : -1, y < h - 1 ? idx + w : -1 };
                            foreach (int nb in nbs) {
                                if (nb >= 0 && !compSet.Contains(nb) && !bgMask[nb] && ringSet.Add(nb)) nextF.Add(nb);
                            }
                        }
                        frontier = nextF;
                    }
                    if (ringSet.Count > 0) {
                        double ringLum = 0;
                        foreach (int ridx in ringSet) ringLum += lum[ridx];
                        if (ringLum / ringSet.Count < 195.0) {
                            foreach (int cidx in comp) bgMask[cidx] = true;
                            holesCleared++;
                        }
                    }
                }
            }

            // 2b) Optional surgical top-halo warm-white interior clearing (h04 gold halo)
            if (clearTopHalo) {
                int maxHaloY = (int)(h * 0.14);
                bool[] haloVis = new bool[n];
                for (int y = 0; y < maxHaloY; y++) {
                    for (int x = 0; x < w; x++) {
                        int start = y * w + x;
                        if (bgMask[start] || haloVis[start]) continue;
                        if (minC[start] < 225f || sat[start] > 32f) continue;
                        List<int> comp = new List<int>();
                        Queue<int> hq = new Queue<int>();
                        haloVis[start] = true;
                        hq.Enqueue(start);
                        bool staysTop = true;
                        while (hq.Count > 0) {
                            int idx = hq.Dequeue();
                            comp.Add(idx);
                            int cx = idx % w, cy = idx / w;
                            if (cy >= maxHaloY) staysTop = false;
                            int[] nbs = { cx > 0 ? idx - 1 : -1, cx < w - 1 ? idx + 1 : -1, cy > 0 ? idx - w : -1, cy < maxHaloY ? idx + w : -1 };
                            foreach (int nb in nbs) {
                                if (nb >= 0 && !bgMask[nb] && !haloVis[nb] && minC[nb] >= 225f && sat[nb] <= 32f) {
                                    haloVis[nb] = true;
                                    hq.Enqueue(nb);
                                }
                            }
                        }
                        if (staysTop && comp.Count >= 150) {
                            foreach (int cidx in comp) bgMask[cidx] = true;
                            holesCleared++;
                        }
                    }
                }
            }

            // 3) 2px rim anti-aliasing & white-halo color decontamination
            bool[] dil1 = new bool[n];
            bool[] nearBg = new bool[n];
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    if (bgMask[i] || (x > 0 && bgMask[i - 1]) || (x < w - 1 && bgMask[i + 1]) || (y > 0 && bgMask[i - w]) || (y < h - 1 && bgMask[i + w])) {
                        dil1[i] = true;
                    }
                }
            }
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    if (!bgMask[i] && (dil1[i] || (x > 0 && dil1[i - 1]) || (x < w - 1 && dil1[i + 1]) || (y > 0 && dil1[i - w]) || (y < h - 1 && dil1[i + w]))) {
                        nearBg[i] = true;
                    }
                }
            }

            float aaLo = strictMode ? 232.0f : 218.0f;
            byte[] outBuf = new byte[n * 4];
            int minX = w, minY = h, maxX = -1, maxY = -1;

            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    float a = bgMask[i] ? 0.0f : 1.0f;
                    if (nearBg[i] && minC[i] >= aaLo && sat[i] <= 35.0f) {
                        a = (253.0f - lum[i]) / (253.0f - aaLo);
                        if (a < 0f) a = 0f;
                        if (a > 1f) a = 1f;
                    }
                    float r = R[i], g = G[i], b = B[i];
                    if (a > 0.02f && a < 0.995f) {
                        float denom = Math.Max(a, 0.14f);
                        r = Math.Max(0f, Math.Min(255f, (r - (1f - a) * 254f) / denom));
                        g = Math.Max(0f, Math.Min(255f, (g - (1f - a) * 254f) / denom));
                        b = Math.Max(0f, Math.Min(255f, (b - (1f - a) * 254f) / denom));
                    } else if (a <= 0.02f) {
                        a = 0f; r = 0f; g = 0f; b = 0f;
                    }
                    byte ab = (byte)Math.Round(a * 255.0f);
                    outBuf[i * 4 + 0] = (byte)Math.Round(b);
                    outBuf[i * 4 + 1] = (byte)Math.Round(g);
                    outBuf[i * 4 + 2] = (byte)Math.Round(r);
                    outBuf[i * 4 + 3] = ab;

                    if (ab > 10) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            // 4) Crop to alpha > 10 bounding box + exact 16px transparent padding
            int cw = maxX - minX + 1;
            int ch = maxY - minY + 1;
            int pad = 16;
            int outW = cw + pad * 2;
            int outH = ch + pad * 2;
            byte[] cropBuf = new byte[outW * outH * 4];
            for (int y = 0; y < ch; y++) {
                int srcOff = ((minY + y) * w + minX) * 4;
                int dstOff = ((pad + y) * outW + pad) * 4;
                Buffer.BlockCopy(outBuf, srcOff, cropBuf, dstOff, cw * 4);
            }

            using (Bitmap outBmp = new Bitmap(outW, outH, PixelFormat.Format32bppArgb)) {
                BitmapData obd = outBmp.LockBits(new Rectangle(0, 0, outW, outH), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                Marshal.Copy(cropBuf, 0, obd.Scan0, cropBuf.Length);
                outBmp.UnlockBits(obd);
                outBmp.Save(dstPath, ImageFormat.Png);
            }
            return string.Format("{0}x{1}, holes_cleared={2}", outW, outH, holesCleared);
        }
    }

    public static void BuildDarkQaSheet(string[] paths, string dstPath) {
        int cellW = 460, cellH = 520;
        using (Bitmap canvas = new Bitmap(cellW * paths.Length, cellH, PixelFormat.Format24bppRgb))
        using (Graphics g = Graphics.FromImage(canvas)) {
            g.Clear(Color.FromArgb(18, 24, 46));
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            for (int i = 0; i < paths.Length; i++) {
                using (Bitmap im = new Bitmap(paths[i])) {
                    double scale = Math.Min((double)(cellW - 20) / im.Width, (double)(cellH - 20) / im.Height);
                    int tw = (int)Math.Round(im.Width * scale);
                    int th = (int)Math.Round(im.Height * scale);
                    int ox = i * cellW + (cellW - tw) / 2;
                    int oy = cellH - 10 - th;
                    g.DrawImage(im, ox, oy, tw, th);
                }
            }
            canvas.Save(dstPath, ImageFormat.Png);
        }
    }
}
"@

$root = "C:\Users\Administrator\.gemini\antigravity\scratch\sky-odyssey"
$raw = Join-Path $root "raw_art"
$archive = Join-Path $raw "_archive"
$scratch = "C:\Users\Administrator\.gemini\antigravity\brain\742cf151-434d-407d-957d-4d7dcf513586\scratch"
New-Item -ItemType Directory -Force -Path $archive, $scratch | Out-Null

# 1. Archive old painterly avatars & chibis
$oldMoves = @(
  @("avatars\头像_艾莉娅.png", "旧版厚涂_头像_艾莉娅.png"),
  @("avatars\头像_薇尔.png", "旧版厚涂_头像_薇尔.png"),
  @("avatars\头像_莉莉丝.png", "旧版厚涂_头像_莉莉丝.png"),
  @("chibi\战斗Q版_艾莉娅.png", "旧版厚涂_战斗Q版_艾莉娅.png"),
  @("chibi\战斗Q版_薇尔.png", "旧版厚涂_战斗Q版_薇尔.png"),
  @("chibi\战斗Q版_莉莉丝.png", "旧版厚涂_战斗Q版_莉莉丝.png")
)
foreach ($m in $oldMoves) {
  $src = Join-Path $raw $m[0]
  if (Test-Path $src) {
    Move-Item -Force -Path $src -Destination (Join-Path $archive $m[1])
    Write-Output "ARCHIVED: $($m[0]) -> _archive\$($m[1])"
  }
}

# 2. Rename & byte-for-byte copy 3 new lossless avatars
$avatars = @(
  @("cf2837f3-9024-4cde-b395-0bad4c74c108.png", "04_艾莉娅圣翼_头像_1x1.png", "avatar_h04.png"),
  @("577b73a5-f630-4a42-9a69-dd4acab275bd.png", "05_薇尔星轨_头像_1x1.png", "avatar_h05.png"),
  @("be11e527-0c5f-4003-b757-4a493a0f9525.png", "06_莉莉丝绯月_头像_1x1.png", "avatar_h06.png")
)
foreach ($a in $avatars) {
  $src = Join-Path $raw "avatars\$($a[0])"
  $renamed = Join-Path $raw "avatars\$($a[1])"
  $dst = Join-Path $root "assets\avatars\$($a[2])"
  if (Test-Path $src) { Move-Item -Force -Path $src -Destination $renamed }
  Copy-Item -Force -Path $renamed -Destination $dst
  $h1 = (Get-FileHash $renamed -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $dst -Algorithm SHA256).Hash
  Write-Output ("AVATAR {0} <- {1} | SHA256 match={2} ({3}) | {4:N1} KB" -f $a[2], $a[1], ($h1 -eq $h2), $h1.Substring(0,12), ((Get-Item $dst).Length/1KB))
}

# 3. Rename & matte 3 new chibis
$chibis = @(
  @("9a8406d6-8966-4769-b95f-4d4695c0f3f8.png", "04_艾莉娅圣翼_战斗Q版_1x1.png", "chibi_h04.png", $true, 251, 4, $true),
  @("27b2181a-42ca-4a2d-b580-e5c8758aa121.png", "05_薇尔星轨_战斗Q版_1x1.png", "chibi_h05.png", $true, 250, 6, $false),
  @("47603ce7-9577-4b05-a781-8149cb68fd9b.png", "06_莉莉丝绯月_战斗Q版_1x1.png", "chibi_h06.png", $false, 247, 8, $false)
)
foreach ($c in $chibis) {
  $src = Join-Path $raw "chibi\$($c[0])"
  $renamed = Join-Path $raw "chibi\$($c[1])"
  $dst = Join-Path $root "assets\chibi\$($c[2])"
  if (Test-Path $src) { Move-Item -Force -Path $src -Destination $renamed }
  $info = [ChibiMatter]::MatteWhiteChibi($renamed, $dst, $c[3], $c[4], $c[5], $c[6])
  Write-Output ("CHIBI  {0} <- {1} | {2} | {3:N1} KB" -f $c[2], $c[1], $info, ((Get-Item $dst).Length/1KB))
}

# 4. Build dark-bg QA contact sheet alongside chibi_protag.png
$qaPath = Join-Path $scratch "qa_wave3b_chibis_on_dark.png"
[ChibiMatter]::BuildDarkQaSheet(@(
  (Join-Path $root "assets\chibi\chibi_protag.png"),
  (Join-Path $root "assets\chibi\chibi_h04.png"),
  (Join-Path $root "assets\chibi\chibi_h05.png"),
  (Join-Path $root "assets\chibi\chibi_h06.png")
), $qaPath)
Write-Output "QA_SHEET: $qaPath"
