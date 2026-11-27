$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PureBlackVfxSlicer {
    public static string SliceAdditiveBlack(string sheetPath, int x0, int y0, int x1, int y1, string dstPath, bool makeSquare) {
        using (Bitmap sheet = new Bitmap(sheetPath)) {
            int cw = x1 - x0;
            int ch = y1 - y0;
            using (Bitmap crop = new Bitmap(cw, ch, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(crop)) {
                    g.DrawImage(sheet, new Rectangle(0, 0, cw, ch), new Rectangle(x0, y0, cw, ch), GraphicsUnit.Pixel);
                }
                BitmapData bd = crop.LockBits(new Rectangle(0, 0, cw, ch), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                int stride = bd.Stride;
                byte[] buf = new byte[stride * ch];
                Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
                crop.UnlockBits(bd);

                int minX = cw, minY = ch, maxX = -1, maxY = -1;
                for (int y = 0; y < ch; y++) {
                    int row = y * stride;
                    for (int x = 0; x < cw; x++) {
                        int i = row + x * 3;
                        int m = Math.Max(buf[i], Math.Max(buf[i + 1], buf[i + 2]));
                        if (m > 8) {
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                        }
                    }
                }

                int tw = maxX - minX + 1;
                int th = maxY - minY + 1;
                int pad = 16;
                int outW = makeSquare ? (Math.Max(tw, th) + pad * 2) : (tw + pad * 2);
                int outH = makeSquare ? (Math.Max(tw, th) + pad * 2) : (th + pad * 2);
                int ox = (outW - tw) / 2;
                int oy = (outH - th) / 2;

                using (Bitmap outBmp = new Bitmap(outW, outH, PixelFormat.Format24bppRgb)) {
                    using (Graphics g = Graphics.FromImage(outBmp)) {
                        g.Clear(Color.Black);
                        g.DrawImage(crop, new Rectangle(ox, oy, tw, th), new Rectangle(minX, minY, tw, th), GraphicsUnit.Pixel);
                    }
                    outBmp.Save(dstPath, ImageFormat.Png);
                }
                return string.Format("trimmed={0}x{1}, out={2}x{3}", tw, th, outW, outH);
            }
        }
    }
}
"@

$root = "C:\Users\Administrator\.gemini\antigravity\scratch\sky-odyssey"
$srcDir = "C:\Users\Administrator\Desktop\技能特效"
$rawVfx = Join-Path $root "raw_art\vfx"
$assetVfx = Join-Path $root "assets\vfx"
New-Item -ItemType Directory -Force -Path $rawVfx, $assetVfx | Out-Null

# 1. Archive raw full sheets
$projRaw = Join-Path $rawVfx "合图_6系普攻飞行弹道_纯黑底_2x3.png"
$statRaw = Join-Path $rawVfx "合图_4大护盾冰封与脚底法阵_纯黑底_2x2.png"
Copy-Item -Force (Join-Path $srcDir "c8fdb3f4-6344-46b2-8c3a-802d549aa24d.png") $projRaw
Copy-Item -Force (Join-Path $srcDir "4b4e46b4-94d7-47a1-99d0-7e4672d7d8de.png") $statRaw

# 2. Slice 6 horizontal projectiles (X=0,608,1254; Y=0,360,770,1254)
$pxs = @(0, 608, 1254)
$pys = @(0, 360, 770, 1254)
$pNames = @("proj_h01.png","proj_h02.png","proj_h03.png","proj_h04.png","proj_h05.png","proj_h06.png")
for ($i = 0; $i -lt 6; $i++) {
  $r = [int][Math]::Floor($i / 2); $c = $i % 2
  $dst = Join-Path $assetVfx $pNames[$i]
  $info = [PureBlackVfxSlicer]::SliceAdditiveBlack($projRaw, $pxs[$c], $pys[$r], $pxs[$c+1], $pys[$r+1], $dst, $false)
  Write-Output ("PROJ   {0,-20} | {1} | {2:N1} KB" -f $pNames[$i], $info, ((Get-Item $dst).Length/1KB))
}

# 3. Slice 4 square status/magic circles (X=0,584,1254; Y=0,561,1254)
$sxs = @(0, 584, 1254)
$sys = @(0, 561, 1254)
$sNames = @("status_shield.png","status_freeze.png","status_curse.png","status_heal_ring.png")
for ($i = 0; $i -lt 4; $i++) {
  $r = [int][Math]::Floor($i / 2); $c = $i % 2
  $dst = Join-Path $assetVfx $sNames[$i]
  $info = [PureBlackVfxSlicer]::SliceAdditiveBlack($statRaw, $sxs[$c], $sys[$r], $sxs[$c+1], $sys[$r+1], $dst, $true)
  Write-Output ("STATUS {0,-20} | {1} | {2:N1} KB" -f $sNames[$i], $info, ((Get-Item $dst).Length/1KB))
}
