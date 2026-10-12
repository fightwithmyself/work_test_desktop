# 开发环境脚本:把所有缓存/下载目录定向到 F 盘,避免写满 C 盘。
# 用法(在项目根目录,每个新终端执行一次):  . .\scripts\env.ps1
# 注意前面的 ". "(点 空格),这样环境变量才会留在当前会话里。

$cacheRoot = 'F:\devcache'

# --- 缓存目录(全部在 F 盘)---
$env:npm_config_cache         = "$cacheRoot\npm"
$env:ELECTRON_CACHE           = "$cacheRoot\electron"
# @electron/get 实际读取的是下面这个小写变量名(已实测:只设 ELECTRON_CACHE 会写到 C 盘)
$env:electron_config_cache    = "$cacheRoot\electron"
$env:ELECTRON_BUILDER_CACHE   = "$cacheRoot\electron-builder"
$env:PLAYWRIGHT_BROWSERS_PATH = "$cacheRoot\playwright"
$env:TEMP = "$cacheRoot\temp"
$env:TMP  = "$cacheRoot\temp"

# --- 二进制下载镜像(国内更快)---
$env:ELECTRON_MIRROR                   = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR  = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

# --- Playwright 只用于驱动 Electron,不需要下载浏览器 ---
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

foreach ($d in $env:npm_config_cache, $env:ELECTRON_CACHE, $env:ELECTRON_BUILDER_CACHE,
               $env:PLAYWRIGHT_BROWSERS_PATH, $env:TEMP) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

# --- C 盘余量检查 ---
$cFreeMB = [math]::Round((Get-PSDrive C).Free / 1MB)
if ($cFreeMB -lt 500) {
  Write-Warning "C 盘仅剩 $cFreeMB MB,系统与部分工具仍可能写入 C 盘,请尽快清理空间。"
} else {
  Write-Host "C 盘余量 $cFreeMB MB" -ForegroundColor Green
}
Write-Host "缓存目录已指向 $cacheRoot" -ForegroundColor Green
