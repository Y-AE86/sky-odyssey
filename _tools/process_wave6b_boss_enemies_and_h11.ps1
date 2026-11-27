$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class EnemyMatter {
    public static string MatteWhiteUnit(string srcPath, string dstPath, bool strictMode, int extMin, int extSat) {
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

            // 1) Exterior 4-connected flood-fill
            bool[] bgMask = new bool[n];
            Queue<int> q = new Queue<int>(w * 4);
            Action<int> trySeed = (idx) => {
                if (!bgMask[idx] && minC[idx] >= extMin && sat[idx] <= extSat) {
                    bgMask[idx] = true;
                    q.Enqueue(idx);
                }
            };
            for (int x = 0; x < w; x++) { trySeed(x); trySeed((h - 1) * w + x); }
            for (int y = 0; y < h; y++) { trySeed(y * w); trySeed(y * w + (w - 1)); }
            while (q.Count > 0) {
                int idx = q.Dequeue();
                int x = idx % w, y = idx / w;
                if (x > 0) trySeed(idx - 1);
                if (x < w - 1) trySeed(idx + 1);
                if (y > 0) trySeed(idx - w);
                if (y < h - 1) trySeed(idx + w);
            }

            double bgRSum = 0, bgGSum = 0, bgBSum = 0;
            int bgCnt = 0;
            for (int i = 0; i < n; i++) {
                if (bgMask[i]) { bgRSum += R[i]; bgGSum += G[i]; bgBSum += B[i]; bgCnt++; }
            }
            float bgR = bgCnt > 0 ? (float)(bgRSum / bgCnt) : 254f;
            float bgG = bgCnt > 0 ? (float)(bgGSum / bgCnt) : 254f;
            float bgB = bgCnt > 0 ? (float)(bgBSum / bgCnt) : 254f;

            // 2) Enclosed pure-white background pockets (eroded exact-bg core check)
            int holesCleared = 0;
            bool[] visited = new bool[n];
            int minHolePx = strictMode ? 45 : 15;
            float holeMinC = strictMode ? 245f : 242f;
            float holeSat = strictMode ? 8f : 12f;

            for (int start = 0; start < n; start++) {
                if (bgMask[start] || visited[start]) continue;
                if (minC[start] < holeMinC || sat[start] > holeSat) continue;

                List<int> comp = new List<int>();
                Queue<int> hq = new Queue<int>();
                visited[start] = true;
                hq.Enqueue(start);
                double sumR = 0, sumG = 0, sumB = 0;
                int pure253 = 0;

                while (hq.Count > 0) {
                    int idx = hq.Dequeue();
                    comp.Add(idx);
                    sumR += R[idx]; sumG += G[idx]; sumB += B[idx];
                    if (R[idx] >= 253f && G[idx] >= 253f && B[idx] >= 253f) pure253++;
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
                double avgR = sumR / comp.Count, avgG = sumG / comp.Count, avgB = sumB / comp.Count;
                double pureRatio = (double)pure253 / comp.Count;
                bool isNeutral = Math.Abs(avgR - avgG) <= 1.2 && Math.Abs(avgB - avgG) <= 1.2;

                HashSet<int> cur = compSet;
                int erSteps = strictMode ? 2 : 1;
                for (int er = 0; er < erSteps; er++) {
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
                if (cur.Count < 12) continue;
                int exactBgPx = 0;
                foreach (int idx in cur) {
                    if (Math.Abs(R[idx] - bgR) <= 2.2f && Math.Abs(G[idx] - bgG) <= 2.2f && Math.Abs(B[idx] - bgB) <= 2.2f) {
                        exactBgPx++;
                    }
                }
                double bgMatchRatio = (double)exactBgPx / cur.Count;
                if (bgMatchRatio < 0.80 && !(pureRatio >= 0.60 && isNeutral)) continue;

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
            }

            // 3) 2px rim anti-aliasing & white-halo decontamination
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

            float aaLo = 228.0f;
            byte[] outBuf = new byte[n * 4];
            int minX = w, minY = h, maxX = -1, maxY = -1;

            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    float a = bgMask[i] ? 0.0f : 1.0f;
                    if (nearBg[i] && minC[i] >= aaLo && sat[i] <= 38.0f) {
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
$srcDir = "C:\Users\Administrator\Desktop\Q版"
$rawPosters = Join-Path $root "raw_art\posters"
$rawEnemies = Join-Path $root "raw_art\enemies"
$scratch = "C:\Users\Administrator\.gemini\antigravity\brain\742cf151-434d-407d-957d-4d7dcf513586\scratch"
New-Item -ItemType Directory -Force -Path $rawPosters, $rawEnemies, $scratch | Out-Null

# 1. Install h11 lossless 16:9 poster
$h11Src = Join-Path $srcDir "88e0d4e7-a7a9-47ed-b5e3-707d5fbc3ef7.png"
$h11Raw = Join-Path $rawPosters "11_赛琳娜暗冕_主城海报_16x9.png"
$h11Dst = Join-Path $root "assets\posters\lobby_cg_h11.png"
Copy-Item -Force $h11Src $h11Raw
Copy-Item -Force $h11Raw $h11Dst
$h1 = (Get-FileHash $h11Raw -Algorithm SHA256).Hash
$h2 = (Get-FileHash $h11Dst -Algorithm SHA256).Hash
Write-Output ("POSTER lobby_cg_h11.png <- 11_赛琳娜暗冕_主城海报_16x9.png | SHA256={0} match={1} | {2:N1} KB" -f $h1.Substring(0,12), ($h1 -eq $h2), ((Get-Item $h11Dst).Length/1KB))

# 2. Archive & matte 4 enemies (1 Boss + 3 Troopers)
$enemies = @(
  @("2bd8610b-b9bc-45cf-8195-194c42e7133b.png", "01_天城首领_浮空机神BOSS_1x1.png", "enemy_boss_mech.png", $false, 248, 10),
  @("29ac855f-aac0-4e98-9b62-d5bb61d28bf4.png", "02_敌方前排_星骸重盾卫_1x1.png", "enemy_vanguard.png", $true, 248, 10),
  @("33d9a6c4-1e02-49fe-bda6-492ca04c9758.png", "03_敌方后排_虚空星术士_1x1.png", "enemy_caster.png", $true, 248, 10),
  @("a11f3ddd-6cd5-42e2-8a49-80372cb4cee0.png", "04_敌方猎手_齿轮浮游猎手_1x1.png", "enemy_striker.png", $true, 248, 10)
)
$qaInputs = @()
foreach ($e in $enemies) {
  $src = Join-Path $srcDir $e[0]
  $rawDst = Join-Path $rawEnemies $e[1]
  $assetDst = Join-Path $root "assets\chibi\$($e[2])"
  Copy-Item -Force $src $rawDst
  $info = [EnemyMatter]::MatteWhiteUnit($rawDst, $assetDst, $e[3], $e[4], $e[5])
  Write-Output ("ENEMY  {0} <- {1} | {2} | {3:N1} KB" -f $e[2], $e[1], $info, ((Get-Item $assetDst).Length/1KB))
  $qaInputs += $assetDst
}

$qaPath = Join-Path $scratch "qa_wave6b_enemies_on_dark.png"
[EnemyMatter]::BuildDarkQaSheet($qaInputs, $qaPath)
Write-Output "QA_SHEET: $qaPath"
