$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Wave6ChibiMatter {
    public static string MatteWhiteChibi(string srcPath, string dstPath, bool strictMode, int extMin, int extSat, bool clearTopHalo, bool clearLeftCrescent) {
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
            int minHolePx = strictMode ? 55 : 10;
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
                        if (Math.Abs(R[idx] - bgR) <= 2.0f && Math.Abs(G[idx] - bgG) <= 2.0f && Math.Abs(B[idx] - bgB) <= 2.0f) {
                            exactBgPx++;
                        }
                    }
                    double bgMatchRatio = (double)exactBgPx / cur.Count;
                    if (bgMatchRatio < 0.85) continue;

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
                        if (ringLum / ringSet.Count < 230.0) {
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

            if (clearTopHalo) {
                int maxHaloY = (int)(h * 0.16);
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
                        if (staysTop && comp.Count >= 120) {
                            foreach (int cidx in comp) bgMask[cidx] = true;
                            holesCleared++;
                        }
                    }
                }
            }

            if (clearLeftCrescent) {
                int maxXZone = (int)(w * 0.47);
                int minYZone = (int)(h * 0.06);
                int maxYZone = (int)(h * 0.82);
                bool[] cVis = new bool[n];
                for (int y = minYZone; y < maxYZone; y++) {
                    for (int x = 0; x < maxXZone; x++) {
                        int start = y * w + x;
                        if (bgMask[start] || cVis[start]) continue;
                        if (minC[start] < 244f || sat[start] > 12f) continue;
                        List<int> comp = new List<int>();
                        Queue<int> hq = new Queue<int>();
                        cVis[start] = true;
                        hq.Enqueue(start);
                        bool staysInZone = true;
                        double sumR = 0, sumG = 0, sumB = 0;
                        int pure253 = 0;
                        while (hq.Count > 0) {
                            int idx = hq.Dequeue();
                            comp.Add(idx);
                            sumR += R[idx]; sumG += G[idx]; sumB += B[idx];
                            if (R[idx] >= 253f && G[idx] >= 253f && B[idx] >= 253f) pure253++;
                            int cx = idx % w, cy = idx / w;
                            if (cx >= maxXZone - 1 || cy <= minYZone || cy >= maxYZone - 1) staysInZone = false;
                            int[] nbs = { cx > 0 ? idx - 1 : -1, cx < maxXZone - 1 ? idx + 1 : -1, cy > minYZone ? idx - w : -1, cy < maxYZone - 1 ? idx + w : -1 };
                            foreach (int nb in nbs) {
                                if (nb >= 0 && !bgMask[nb] && !cVis[nb] && minC[nb] >= 244f && sat[nb] <= 12f) {
                                    cVis[nb] = true;
                                    hq.Enqueue(nb);
                                }
                            }
                        }
                        double avgR = sumR / comp.Count, avgG = sumG / comp.Count, avgB = sumB / comp.Count;
                        double pureRatio = (double)pure253 / comp.Count;
                        bool isNeutral = Math.Abs(avgR - avgG) <= 0.9 && Math.Abs(avgB - avgG) <= 0.9;
                        if (staysInZone && comp.Count >= 550 && pureRatio >= 0.54 && isNeutral) {
                            foreach (int cidx in comp) bgMask[cidx] = true;
                            holesCleared++;
                        }
                    }
                }
                // Extra surgical pass solely for warm-white pockets inside top crescent hook & gold chains (y: 85..265, x: 280..575)
                int tx0 = (int)(w * 0.22), tx1 = (int)(w * 0.46), ty0 = (int)(h * 0.06), ty1 = (int)(h * 0.22);
                bool[] tVis = new bool[n];
                for (int y = ty0; y < ty1; y++) {
                    for (int x = tx0; x < tx1; x++) {
                        int start = y * w + x;
                        if (bgMask[start] || tVis[start]) continue;
                        if (minC[start] < 244f || sat[start] > 14f) continue;
                        List<int> comp = new List<int>();
                        Queue<int> hq = new Queue<int>();
                        tVis[start] = true;
                        hq.Enqueue(start);
                        bool stays = true;
                        float maxRgb = 0;
                        while (hq.Count > 0) {
                            int idx = hq.Dequeue();
                            comp.Add(idx);
                            float mx = Math.Max(R[idx], Math.Max(G[idx], B[idx]));
                            if (mx > maxRgb) maxRgb = mx;
                            int cx = idx % w, cy = idx / w;
                            if (cx <= tx0 || cx >= tx1 - 1 || cy <= ty0 || cy >= ty1 - 1) stays = false;
                            int[] nbs = { cx > tx0 ? idx - 1 : -1, cx < tx1 - 1 ? idx + 1 : -1, cy > ty0 ? idx - w : -1, cy < ty1 - 1 ? idx + w : -1 };
                            foreach (int nb in nbs) {
                                if (nb >= 0 && !bgMask[nb] && !tVis[nb] && minC[nb] >= 244f && sat[nb] <= 14f) {
                                    tVis[nb] = true;
                                    hq.Enqueue(nb);
                                }
                            }
                        }
                        if (stays && comp.Count >= 110 && maxRgb >= 252f) {
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

            float aaLo = strictMode ? 232.0f : 220.0f;
            byte[] outBuf = new byte[n * 4];
            int minX = w, minY = h, maxX = -1, maxY = -1;

            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    float a = bgMask[i] ? 0.0f : 1.0f;
                    if (nearBg[i] && minC[i] >= aaLo && sat[i] <= 36.0f) {
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
$rawChibi = Join-Path $root "raw_art\chibi"
$archive = Join-Path $root "raw_art\_archive"
$scratch = "C:\Users\Administrator\.gemini\antigravity\brain\742cf151-434d-407d-957d-4d7dcf513586\scratch"
New-Item -ItemType Directory -Force -Path $rawChibi, $archive, $scratch | Out-Null

# Backup old placeholder h07/h08 chibis once if not archived yet
foreach ($oldName in @("chibi_h07.png", "chibi_h08.png")) {
  $oldPath = Join-Path $root "assets\chibi\$oldName"
  $bakPath = Join-Path $archive "旧版剪影_$oldName"
  if ((Test-Path $oldPath) -and -not (Test-Path $bakPath)) {
    Copy-Item -Path $oldPath -Destination $bakPath
    Write-Output "BACKED UP OLD: $oldName -> _archive\旧版剪影_$oldName"
  }
}

$items = @(
  @("a8a6b6e0-d55f-4288-9e76-d14fe5441b14.png", "07_望舒星渊_战斗Q版_1x1.png", "chibi_h07.png", $true, 249, 8, $false, $true),
  @("2e8c84bd-67a1-4b61-a24f-efa10ce53892.png", "08_苍雷希露_战斗Q版_1x1.png", "chibi_h08.png", $true, 249, 8, $true, $false),
  @("bc740ea8-092a-4a89-986f-dc31f202625e.png", "09_离火凰姬_战斗Q版_1x1.png", "chibi_h09.png", $true, 249, 8, $false, $false),
  @("4f4167a8-35cd-4c94-95c1-cd5187c42d8a.png", "10_汐月瑶光_战斗Q版_1x1.png", "chibi_h10.png", $true, 249, 8, $false, $false),
  @("a60c61af-a034-4c0c-a29f-c033636f9b9c.png", "11_赛琳娜暗冕_战斗Q版_1x1.png", "chibi_h11.png", $true, 249, 8, $false, $false)
)

$qaInputs = @((Join-Path $root "assets\chibi\chibi_protag.png"))
foreach ($it in $items) {
  $src = Join-Path $srcDir $it[0]
  $rawDst = Join-Path $rawChibi $it[1]
  $assetDst = Join-Path $root "assets\chibi\$($it[2])"
  if (Test-Path $src) {
    Copy-Item -Force -Path $src -Destination $rawDst
  }
  $info = [Wave6ChibiMatter]::MatteWhiteChibi($rawDst, $assetDst, $it[3], $it[4], $it[5], $it[6], $it[7])
  Write-Output ("CHIBI {0} <- {1} | {2} | {3:N1} KB" -f $it[2], $it[1], $info, ((Get-Item $assetDst).Length / 1KB))
  $qaInputs += $assetDst
}

$qaPath = Join-Path $scratch "qa_wave6_chibis_h07_h10_on_dark.png"
[Wave6ChibiMatter]::BuildDarkQaSheet($qaInputs, $qaPath)
Write-Output "QA_SHEET: $qaPath"
