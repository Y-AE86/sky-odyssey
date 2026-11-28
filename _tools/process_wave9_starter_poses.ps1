$ErrorActionPreference = 'Stop'

$code = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public class Wave9PoseMatter
{
    public class Comp
    {
        public int Id;
        public List<int> Pixels = new List<int>();
        public double SumX, SumY;
        public double Cx { get { return SumX / Math.Max(1, Pixels.Count); } }
        public double Cy { get { return SumY / Math.Max(1, Pixels.Count); } }
    }

    static bool[] FloodExterior(bool[] cand, int w, int h)
    {
        bool[] vis = new bool[w * h];
        int[] q = new int[w * h];
        int head = 0, tail = 0;
        Action<int, int> push = (x, y) => {
            int idx = y * w + x;
            if (cand[idx] && !vis[idx]) { vis[idx] = true; q[tail++] = idx; }
        };
        for (int x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
        for (int y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
        while (head < tail)
        {
            int idx = q[head++];
            int x = idx % w, y = idx / w;
            if (y > 0) push(x, y - 1);
            if (y + 1 < h) push(x, y + 1);
            if (x > 0) push(x - 1, y);
            if (x + 1 < w) push(x + 1, y);
        }
        return vis;
    }

    static bool[] Dilate(bool[] mask, int w, int h, int radius)
    {
        bool[] cur = (bool[])mask.Clone();
        for (int r = 0; r < radius; r++)
        {
            bool[] nxt = new bool[w * h];
            for (int y = 0; y < h; y++)
            {
                int y0 = Math.Max(0, y - 1), y1 = Math.Min(h - 1, y + 1);
                for (int x = 0; x < w; x++)
                {
                    if (!cur[y * w + x]) continue;
                    int x0 = Math.Max(0, x - 1), x1 = Math.Min(w - 1, x + 1);
                    for (int ny = y0; ny <= y1; ny++)
                        for (int nx = x0; nx <= x1; nx++)
                            nxt[ny * w + nx] = true;
                }
            }
            cur = nxt;
        }
        return cur;
    }

    static List<Comp> ConnectedComponents(bool[] mask, int w, int h, bool eightConn)
    {
        int[] labels = new int[w * h];
        int[] q = new int[w * h];
        var comps = new List<Comp>();
        int curId = 0;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int start = y * w + x;
                if (!mask[start] || labels[start] != 0) continue;
                curId++;
                var comp = new Comp { Id = curId };
                int head = 0, tail = 0;
                labels[start] = curId;
                q[tail++] = start;
                while (head < tail)
                {
                    int idx = q[head++];
                    int cx = idx % w, cy = idx / w;
                    comp.Pixels.Add(idx);
                    comp.SumX += cx;
                    comp.SumY += cy;
                    if (eightConn)
                    {
                        int y0 = Math.Max(0, cy - 1), y1 = Math.Min(h - 1, cy + 1);
                        int x0 = Math.Max(0, cx - 1), x1 = Math.Min(w - 1, cx + 1);
                        for (int ny = y0; ny <= y1; ny++)
                            for (int nx = x0; nx <= x1; nx++)
                            {
                                int nidx = ny * w + nx;
                                if (mask[nidx] && labels[nidx] == 0)
                                {
                                    labels[nidx] = curId;
                                    q[tail++] = nidx;
                                }
                            }
                    }
                    else
                    {
                        if (cy > 0) { int n = (cy - 1) * w + cx; if (mask[n] && labels[n] == 0) { labels[n] = curId; q[tail++] = n; } }
                        if (cy + 1 < h) { int n = (cy + 1) * w + cx; if (mask[n] && labels[n] == 0) { labels[n] = curId; q[tail++] = n; } }
                        if (cx > 0) { int n = cy * w + (cx - 1); if (mask[n] && labels[n] == 0) { labels[n] = curId; q[tail++] = n; } }
                        if (cx + 1 < w) { int n = cy * w + (cx + 1); if (mask[n] && labels[n] == 0) { labels[n] = curId; q[tail++] = n; } }
                    }
                }
                comps.Add(comp);
            }
        }
        return comps;
    }

    static double Percentile(List<double> vals, double p)
    {
        if (vals.Count == 0) return 255.0;
        vals.Sort();
        double idx = (vals.Count - 1) * p;
        int lo = (int)Math.Floor(idx), hi = (int)Math.Ceiling(idx);
        if (lo == hi) return vals[lo];
        return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
    }

    static Bitmap MatteSinglePose(byte[] rgb, bool[] fgSeed, int w, int h, int extMinC, int extSat, bool hasHalo, out int removedHoles)
    {
        int n = w * h;
        int[] minC = new int[n];
        int[] sat = new int[n];
        double[] lum = new double[n];
        bool[] extCand = new bool[n];
        for (int i = 0; i < n; i++)
        {
            int b = rgb[i * 3 + 0], g = rgb[i * 3 + 1], r = rgb[i * 3 + 2];
            int mn = Math.Min(r, Math.Min(g, b));
            int mx = Math.Max(r, Math.Max(g, b));
            minC[i] = mn;
            sat[i] = mx - mn;
            lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            extCand[i] = (mn >= extMinC && sat[i] <= extSat);
        }

        bool[] seedDil = Dilate(fgSeed, w, h, 2);
        bool[] bg0 = FloodExterior(extCand, w, h);
        bool[] bgUnion = new bool[n];
        for (int i = 0; i < n; i++) bgUnion[i] = bg0[i] || !seedDil[i] || extCand[i];
        bool[] bg = FloodExterior(bgUnion, w, h);

        // Interior enclosed pure-white pockets (protect white robes/wings/sleeves!)
        bool[] holeCand = new bool[n];
        for (int i = 0; i < n; i++)
        {
            if (!bg[i] && minC[i] >= 251 && sat[i] <= 4)
            {
                int b = rgb[i * 3 + 0], g = rgb[i * 3 + 1], r = rgb[i * 3 + 2];
                // True background white is ultra-neutral (near 254,254,254), not tinted blue/lavender/cream
                if (Math.Abs(r - g) <= 3 && Math.Abs(b - g) <= 3) holeCand[i] = true;
            }
        }

        var holeComps = ConnectedComponents(holeCand, w, h, false);
        removedHoles = 0;
        foreach (var hc in holeComps)
        {
            int area = hc.Pixels.Count;
            if (area < 30) continue;
            // Compute pure253 ratio & neutral RGB average of hole pixels
            int pure253 = 0;
            double avgR = 0, avgG = 0, avgB = 0;
            int minY = h, maxY = 0, minX = w, maxX = 0;
            foreach (int idx in hc.Pixels)
            {
                int b = rgb[idx * 3 + 0], g = rgb[idx * 3 + 1], r = rgb[idx * 3 + 2];
                avgR += r; avgG += g; avgB += b;
                if (minC[idx] >= 253) pure253++;
                int x = idx % w, y = idx / w;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
            }
            avgR /= area; avgG /= area; avgB /= area;
            double pureRatio = (double)pure253 / area;
            bool neutral = (Math.Abs(avgR - avgG) <= 1.6 && Math.Abs(avgB - avgG) <= 1.6 && avgG >= 252.5);

            // Local bounding box for fast ring sampling
            int bx0 = Math.Max(0, minX - 5), bx1 = Math.Min(w - 1, maxX + 5);
            int by0 = Math.Max(0, minY - 5), by1 = Math.Min(h - 1, maxY + 5);
            int bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
            bool[] hm = new bool[bw * bh];
            foreach (int idx in hc.Pixels)
            {
                int lx = (idx % w) - bx0, ly = (idx / w) - by0;
                hm[ly * bw + lx] = true;
            }
            bool[] d1 = Dilate(hm, bw, bh, 1);
            bool[] d2 = Dilate(d1, bw, bh, 1);
            bool[] d4 = Dilate(d2, bw, bh, 2);
            var ringLums = new List<double>();
            var ring3Lums = new List<double>();
            for (int ly = 0; ly < bh; ly++)
            {
                for (int lx = 0; lx < bw; lx++)
                {
                    int li = ly * bw + lx;
                    int gi = (ly + by0) * w + (lx + bx0);
                    if (bg[gi]) continue;
                    if (d2[li] && !hm[li]) ringLums.Add(lum[gi]);
                    if (d4[li] && !d1[li]) ring3Lums.Add(lum[gi]);
                }
            }
            if (ringLums.Count == 0) continue;
            double rp25 = Percentile(ringLums, 0.25);
            double r3p25 = Percentile(ring3Lums, 0.25);
            double cyRel = hc.Cy / Math.Max(1.0, h);
            double cxRel = hc.Cx / Math.Max(1.0, w);

            bool isPocket = false;
            if (neutral && pureRatio >= 0.65)
            {
                if (area >= 95 && rp25 <= 168.0 && r3p25 <= 160.0) isPocket = true;
                else if (area >= 35 && rp25 <= 130.0 && r3p25 <= 115.0) isPocket = true;
                else if (hasHalo && cyRel < 0.145 && cxRel >= 0.26 && cxRel <= 0.74 && area >= 45 && rp25 <= 228.0 && r3p25 <= 190.0) isPocket = true;
            }

            if (isPocket)
            {
                foreach (int idx in hc.Pixels) bg[idx] = true;
                // Absorb immediate 1px near-white inner fringe
                for (int ly = 0; ly < bh; ly++)
                    for (int lx = 0; lx < bw; lx++)
                    {
                        int li = ly * bw + lx;
                        if (d1[li] && !hm[li])
                        {
                            int gi = (ly + by0) * w + (lx + bx0);
                            if (!bg[gi] && minC[gi] >= 244 && sat[gi] <= 12) bg[gi] = true;
                        }
                    }
                removedHoles++;
            }
        }

        // Un-premultiply 1-2px bright white anti-aliased edge fringe
        float[] outR = new float[n], outG = new float[n], outB = new float[n], outA = new float[n];
        for (int i = 0; i < n; i++)
        {
            outB[i] = rgb[i * 3 + 0];
            outG[i] = rgb[i * 3 + 1];
            outR[i] = rgb[i * 3 + 2];
            outA[i] = bg[i] ? 0f : 255f;
        }
        bool[] bgD1 = Dilate(bg, w, h, 1);
        bool[] edge1 = new bool[n];
        for (int i = 0; i < n; i++) edge1[i] = !bg[i] && bgD1[i];
        bool[] e1D1 = Dilate(edge1, w, h, 1);
        bool[] edge2 = new bool[n];
        for (int i = 0; i < n; i++) edge2[i] = !bg[i] && !edge1[i] && e1D1[i];

        Action<bool[], float> dehalo = (mask, thresh) => {
            float denom = 255f - Math.Max(130f, thresh - 45f);
            for (int i = 0; i < n; i++)
            {
                if (!mask[i] || minC[i] < thresh || sat[i] > 26) continue;
                float a = Math.Max(0f, Math.Min(1f, (255f - minC[i]) / denom));
                if (a < 0.04f) { outA[i] = 0f; }
                else
                {
                    outR[i] = Math.Max(0f, Math.Min(255f, (outR[i] - (1f - a) * 255f) / a));
                    outG[i] = Math.Max(0f, Math.Min(255f, (outG[i] - (1f - a) * 255f) / a));
                    outB[i] = Math.Max(0f, Math.Min(255f, (outB[i] - (1f - a) * 255f) / a));
                    outA[i] = a * 255f;
                }
            }
        };
        dehalo(edge1, 188f);
        dehalo(edge2, 232f);

        int fy0 = h, fy1 = 0, fx0 = w, fx1 = 0;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (outA[y * w + x] > 8f)
                {
                    if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
                    if (x < fx0) fx0 = x; if (x > fx1) fx1 = x;
                }
        int cw = fx1 - fx0 + 1, ch = fy1 - fy0 + 1;
        int pad = 16;
        int ow = cw + pad * 2, oh = ch + pad * 2;
        Bitmap dst = new Bitmap(ow, oh, PixelFormat.Format32bppArgb);
        BitmapData dd = dst.LockBits(new Rectangle(0, 0, ow, oh), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[dd.Stride * oh];
        for (int y = 0; y < ch; y++)
        {
            int dstRow = (y + pad) * dd.Stride;
            int srcRow = (y + fy0) * w;
            for (int x = 0; x < cw; x++)
            {
                int si = srcRow + (x + fx0);
                int di = dstRow + (x + pad) * 4;
                buf[di + 0] = (byte)Math.Round(outB[si]);
                buf[di + 1] = (byte)Math.Round(outG[si]);
                buf[di + 2] = (byte)Math.Round(outR[si]);
                buf[di + 3] = (byte)Math.Round(outA[si]);
            }
        }
        Marshal.Copy(buf, 0, dd.Scan0, buf.Length);
        dst.UnlockBits(dd);
        return dst;
    }

    public static Bitmap[] ProcessSheet(string srcPath, string heroId, string outDir, int extMinC, int extSat, bool hasHalo)
    {
        string[] poseNames = new[] { "windup", "atk", "hurt" };
        using (Bitmap bmp = new Bitmap(srcPath))
        {
            int w = bmp.Width, h = bmp.Height;
            BitmapData sd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            byte[] raw = new byte[sd.Stride * h];
            Marshal.Copy(sd.Scan0, raw, 0, raw.Length);
            bmp.UnlockBits(sd);

            byte[] rgb = new byte[w * h * 3];
            bool[] extCand = new bool[w * h];
            for (int y = 0; y < h; y++)
            {
                int sRow = y * sd.Stride;
                int dRow = y * w;
                for (int x = 0; x < w; x++)
                {
                    int b = raw[sRow + x * 3 + 0];
                    int g = raw[sRow + x * 3 + 1];
                    int r = raw[sRow + x * 3 + 2];
                    int idx = dRow + x;
                    rgb[idx * 3 + 0] = (byte)b;
                    rgb[idx * 3 + 1] = (byte)g;
                    rgb[idx * 3 + 2] = (byte)r;
                    int mn = Math.Min(r, Math.Min(g, b));
                    int mx = Math.Max(r, Math.Max(g, b));
                    extCand[idx] = (mn >= extMinC && (mx - mn) <= extSat);
                }
            }

            bool[] extBg = FloodExterior(extCand, w, h);
            bool[] fg = new bool[w * h];
            for (int i = 0; i < w * h; i++) fg[i] = !extBg[i];

            var comps = ConnectedComponents(fg, w, h, true);
            comps.Sort((a, b) => b.Pixels.Count.CompareTo(a.Pixels.Count));
            var main3 = new List<Comp> { comps[0], comps[1], comps[2] };
            main3.Sort((a, b) => a.Cx.CompareTo(b.Cx));

            Console.WriteLine(string.Format("[{0}] Main3 CCs: ({1}px cx={2:F0}), ({3}px cx={4:F0}), ({5}px cx={6:F0})",
                heroId, main3[0].Pixels.Count, main3[0].Cx, main3[1].Pixels.Count, main3[1].Cx, main3[2].Pixels.Count, main3[2].Cx));

            // Subsample points of each main pose for nearest-neighbor shard assignment
            var mainPts = new List<int[]>[3];
            bool[][] poseMasks = new bool[3][];
            for (int k = 0; k < 3; k++)
            {
                poseMasks[k] = new bool[w * h];
                mainPts[k] = new List<int[]>();
                int step = Math.Max(1, main3[k].Pixels.Count / 3000);
                for (int i = 0; i < main3[k].Pixels.Count; i++)
                {
                    int idx = main3[k].Pixels[i];
                    poseMasks[k][idx] = true;
                    if (i % step == 0) mainPts[k].Add(new[] { idx % w, idx / w });
                }
            }

            int[] shards = new int[3];
            int dust = 0;
            for (int c = 3; c < comps.Count; c++)
            {
                if (comps[c].Pixels.Count < 20) { dust++; continue; }
                double scx = comps[c].Cx, scy = comps[c].Cy;
                int best = 0;
                double bestDist = double.MaxValue;
                for (int k = 0; k < 3; k++)
                {
                    foreach (var pt in mainPts[k])
                    {
                        double dx = pt[0] - scx, dy = pt[1] - scy;
                        double d2 = dx * dx + dy * dy;
                        if (d2 < bestDist) { bestDist = d2; best = k; }
                    }
                }
                foreach (int idx in comps[c].Pixels) poseMasks[best][idx] = true;
                shards[best]++;
            }
            Console.WriteLine(string.Format("[{0}] Shards assigned=[{1},{2},{3}], dust dropped={4}", heroId, shards[0], shards[1], shards[2], dust));

            Bitmap[] outputs = new Bitmap[3];
            for (int k = 0; k < 3; k++)
            {
                bool[] pm = poseMasks[k];
                int minX = w, maxX = 0, minY = h, maxY = 0;
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++)
                        if (pm[y * w + x])
                        {
                            if (x < minX) minX = x; if (x > maxX) maxX = x;
                            if (y < minY) minY = y; if (y > maxY) maxY = y;
                        }
                int padBox = 12;
                int x0 = Math.Max(0, minX - padBox), x1 = Math.Min(w - 1, maxX + padBox);
                int y0 = Math.Max(0, minY - padBox), y1 = Math.Min(h - 1, maxY + padBox);
                int cw = x1 - x0 + 1, ch = y1 - y0 + 1;

                bool[] subPm = new bool[cw * ch];
                bool[] subOther = new bool[cw * ch];
                byte[] subRgb = new byte[cw * ch * 3];
                for (int ly = 0; ly < ch; ly++)
                {
                    int gy = ly + y0;
                    for (int lx = 0; lx < cw; lx++)
                    {
                        int gx = lx + x0;
                        int gi = gy * w + gx, li = ly * cw + lx;
                        subPm[li] = pm[gi];
                        bool other = false;
                        for (int j = 0; j < 3; j++) if (j != k && poseMasks[j][gi]) other = true;
                        subOther[li] = other;
                        subRgb[li * 3 + 0] = rgb[gi * 3 + 0];
                        subRgb[li * 3 + 1] = rgb[gi * 3 + 1];
                        subRgb[li * 3 + 2] = rgb[gi * 3 + 2];
                    }
                }
                bool[] otherDil = Dilate(subOther, cw, ch, 1);
                for (int i = 0; i < cw * ch; i++)
                {
                    if (otherDil[i] && !subPm[i])
                    {
                        subRgb[i * 3 + 0] = 255;
                        subRgb[i * 3 + 1] = 255;
                        subRgb[i * 3 + 2] = 255;
                    }
                }

                int holes;
                Bitmap outBmp = MatteSinglePose(subRgb, subPm, cw, ch, extMinC, extSat, hasHalo, out holes);
                string outName = string.Format("chibi_{0}_{1}.png", heroId, poseNames[k]);
                outBmp.Save(Path.Combine(outDir, outName), ImageFormat.Png);
                Console.WriteLine(string.Format("  -> {0}: {1}x{2}, interior holes cleaned={3}", outName, outBmp.Width, outBmp.Height, holes));
                outputs[k] = outBmp;
            }
            return outputs;
        }
    }

    public static void BuildQaSheet(List<Bitmap[]> rows, string[] heroIds, string outPath)
    {
        string[] poseNames = new[] { "windup", "atk", "hurt" };
        int cellW = 540, cellH = 560;
        using (Bitmap sheet = new Bitmap(cellW * 3, cellH * rows.Count, PixelFormat.Format24bppRgb))
        using (Graphics g = Graphics.FromImage(sheet))
        {
            g.Clear(Color.FromArgb(18, 24, 46));
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            using (Pen borderPen = new Pen(Color.FromArgb(60, 78, 120), 1))
            using (Brush textBrush = new SolidBrush(Color.FromArgb(243, 217, 164)))
            using (Font font = new Font("Consolas", 14, FontStyle.Bold))
            {
                for (int r = 0; r < rows.Count; r++)
                {
                    for (int c = 0; c < 3; c++)
                    {
                        Bitmap im = rows[r][c];
                        int ox = c * cellW, oy = r * cellH;
                        g.DrawRectangle(borderPen, ox + 2, oy + 2, cellW - 5, cellH - 5);
                        string label = string.Format("chibi_{0}_{1}.png ({2}x{3})", heroIds[r], poseNames[c], im.Width, im.Height);
                        g.DrawString(label, font, textBrush, ox + 14, oy + 10);
                        int maxW = cellW - 36, maxH = cellH - 56;
                        double sc = Math.Min(1.0, Math.Min((double)maxW / im.Width, (double)maxH / im.Height));
                        int nw = (int)Math.Round(im.Width * sc), nh = (int)Math.Round(im.Height * sc);
                        int px = ox + (cellW - nw) / 2, py = oy + 38 + (maxH - nh) / 2;
                        g.DrawImage(im, px, py, nw, nh);
                        im.Dispose();
                    }
                }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(outPath));
            sheet.Save(outPath, ImageFormat.Png);
            Console.WriteLine("Saved dark-BG QA contact sheet: " + outPath);
        }
    }
}
"@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$repo = Split-Path $PSScriptRoot -Parent
$deskQ = 'C:\Users\Administrator\Desktop\Q版'
$rawChibi = Join-Path $repo 'raw_art\chibi'
$outChibi = Join-Path $repo 'assets\chibi'
$qaPath = 'C:\Users\Administrator\.gemini\antigravity\brain\742cf151-434d-407d-957d-4d7dcf513586\scratch\wave9_poses_qa.png'

$jobs = @(
    @{ hero='h03'; src='86ef130b-4e03-4797-82df-7d02f5187535.png'; arch='03_凌波玉笛_战斗三动作原图.png'; extMinC=244; extSat=14; hasHalo=$false },
    @{ hero='h04'; src='8ed9e72a-1d92-4351-bd9c-8a3bc00b4bd9.png'; arch='04_艾莉娅圣翼_战斗三动作原图.png'; extMinC=245; extSat=14; hasHalo=$true },
    @{ hero='h05'; src='7ac63797-bf3d-4542-b7d4-73d08e5f66bb.png'; arch='05_薇尔星轨_战斗三动作原图.png'; extMinC=247; extSat=12; hasHalo=$false },
    @{ hero='h08'; src='04d5bd88-01d0-4fef-a79b-032440015182.png'; arch='08_苍雷希露_战斗三动作原图.png'; extMinC=244; extSat=14; hasHalo=$true }
)

$rows = New-Object 'System.Collections.Generic.List[System.Drawing.Bitmap[]]'
$ids = @()
foreach ($j in $jobs) {
    $srcPath = Join-Path $deskQ $j.src
    $archPath = Join-Path $rawChibi $j.arch
    if (Test-Path $srcPath) {
        Move-Item -LiteralPath $srcPath -Destination $archPath -Force
        Write-Host "Moved $($j.src) -> raw_art/chibi/$($j.arch)"
    }
    $bmps = [Wave9PoseMatter]::ProcessSheet($archPath, $j.hero, $outChibi, $j.extMinC, $j.extSat, $j.hasHalo)
    $rows.Add($bmps)
    $ids += $j.hero
}
[Wave9PoseMatter]::BuildQaSheet($rows, $ids, $qaPath)
