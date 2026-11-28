param(
    [string]$ProjectName = 'sky-odyssey',
    [string]$Branch = 'main',
    [string]$CustomDomain = 'https://sky.xiaoye-workbench.cn'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'sky-odyssey-cf-deploy'
$dist = Join-Path $stageRoot 'cf-dist'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Set-Location $repo
$ver = (git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $ver) { throw 'Unable to determine git short HEAD commit.' }
Write-Host "=== Staging Cloudflare Pages bundle ($ver) ==="

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item (Join-Path $repo 'index.html') (Join-Path $dist 'index.html') -Force

foreach ($dir in @('css', 'lib', 'assets')) {
    robocopy (Join-Path $repo $dir) (Join-Path $dist $dir) /MIR /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dir ($LASTEXITCODE)" }
}
robocopy (Join-Path $repo 'js') (Join-Path $dist 'js') /MIR /XF 'offline-*.js' /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed for js ($LASTEXITCODE)" }

# Stamp ?v=<git-sha> on static & dynamic CSS/JS/manifest references so Cloudflare CDN & browser caches refresh immediately
$indexPath = Join-Path $dist 'index.html'
$indexHtml = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
$indexHtml = [regex]::Replace($indexHtml, '(href|src)="((?:css|js)/[^"?]+\.(?:css|js)|assets/(?:videos|audio)/manifest\.js)"', "`$1=`"`$2?v=$ver`"")
[System.IO.File]::WriteAllText($indexPath, $indexHtml, $utf8NoBom)

$mainPath = Join-Path $dist 'js\main.js'
$mainJs = [System.IO.File]::ReadAllText($mainPath, $utf8NoBom)
$mainJs = $mainJs.Replace("'js/battle-vfx.js'", "'js/battle-vfx.js?v=$ver'").Replace("'js/battle-pixi.js'", "'js/battle-pixi.js?v=$ver'")
[System.IO.File]::WriteAllText($mainPath, $mainJs, $utf8NoBom)

$assetsPath = Join-Path $dist 'js\assets.js'
$assetsJs = [System.IO.File]::ReadAllText($assetsPath, $utf8NoBom)
$assetsJs = $assetsJs.Replace("'js/chibi-poses.js'", "'js/chibi-poses.js?v=$ver'")
[System.IO.File]::WriteAllText($assetsPath, $assetsJs, $utf8NoBom)

$headers = @'
/
  Cache-Control: public, max-age=0, must-revalidate
/index.html
  Cache-Control: public, max-age=0, must-revalidate
/css/*
  Cache-Control: public, max-age=0, must-revalidate
/js/*
  Cache-Control: public, max-age=0, must-revalidate
/assets/videos/manifest.js
  Cache-Control: public, max-age=0, must-revalidate
/assets/audio/manifest.js
  Cache-Control: public, max-age=0, must-revalidate
/assets/posters/*
  Cache-Control: public, max-age=31536000, immutable
/assets/avatars/*
  Cache-Control: public, max-age=31536000, immutable
/assets/chibi/*
  Cache-Control: public, max-age=31536000, immutable
/assets/domains/*
  Cache-Control: public, max-age=31536000, immutable
/assets/bgs/*
  Cache-Control: public, max-age=31536000, immutable
/assets/weapons/*
  Cache-Control: public, max-age=31536000, immutable
/assets/items/*
  Cache-Control: public, max-age=31536000, immutable
/assets/ui/*
  Cache-Control: public, max-age=31536000, immutable
/assets/vfx/*
  Cache-Control: public, max-age=31536000, immutable
/assets/videos/*.mp4
  Cache-Control: public, max-age=31536000, immutable
/assets/audio/*.mp3
  Cache-Control: public, max-age=31536000, immutable
/lib/*
  Cache-Control: public, max-age=31536000, immutable
'@
[System.IO.File]::WriteAllText((Join-Path $dist '_headers'), $headers, $utf8NoBom)

$files = Get-ChildItem -Path $dist -Recurse -File
$oversize = $files | Where-Object { $_.Length -gt 25MB }
Write-Host "Staged files: $($files.Count), >25MB count: $($oversize.Count)"
if ($oversize.Count -gt 0) {
    $oversize | ForEach-Object { Write-Error "Oversize (>25MB): $($_.FullName)" }
    exit 1
}

Write-Host "=== Deploying to Cloudflare Pages ($ProjectName / $Branch) ==="
Set-Location $stageRoot
wrangler pages deploy $dist --project-name=$ProjectName --branch=$Branch --commit-dirty=true
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($CustomDomain) {
    Write-Host "=== Verifying $CustomDomain ==="
    Start-Sleep -Seconds 2
    $liveIndex = (Invoke-WebRequest -Uri "$CustomDomain/" -UseBasicParsing).Content
    $okIndex = $liveIndex.Contains("assets/videos/manifest.js?v=$ver")
    $liveManifest = (Invoke-WebRequest -Uri "$CustomDomain/assets/videos/manifest.js?v=$ver" -UseBasicParsing).Content
    Write-Host "index stamped ?v=$ver : $okIndex"
    Write-Host $liveManifest.Trim()
}
