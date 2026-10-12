# 开发环境记录

> 所有新下载内容均放在 F 盘(开发者要求,见 DECISIONS D-005 / D-009)。

## 1. 机器与工具链

| 项目 | 版本 / 位置 |
|---|---|
| 系统 | Windows 11(10.0.26200),PowerShell 5.1 |
| Node | v24.21.0(`F:\agent_study\node.exe`) |
| npm | 11.19.0(默认**不运行**依赖的安装脚本,需 `npm install-scripts approve`) |
| git | Scoop 安装,SSH 认证 GitHub 已验证 |
| GPU | Intel UHD Graphics、NVIDIA GTX 1650 Ti(驱动 457.07) |

## 2. 缓存与下载目录(全部在 F 盘)

| 用途 | 变量 | 位置 |
|---|---|---|
| npm 缓存 | `npm_config_cache` | `F:\devcache\npm` |
| Electron 二进制 | `electron_config_cache`(**注意小写,见下**) | `F:\devcache\electron` |
| electron-builder | `ELECTRON_BUILDER_CACHE` | `F:\devcache\electron-builder` |
| Playwright | `PLAYWRIGHT_BROWSERS_PATH` | `F:\devcache\playwright` |
| 临时目录 | `TEMP` / `TMP` | `F:\devcache\temp` |

每个新终端先执行:`. .\scripts\env.ps1`(注意开头的 `. `)。

## 3. 项目依赖

**运行时**:`react`、`react-dom`、`antd`、`zustand`、`ffmpeg-static`、`@ffprobe-installer/ffprobe`

**开发**:`electron@44.7.0`、`electron-vite@5.0.0`、`vite@7`(electron-vite 5 的上限)、`@vitejs/plugin-react@5`、`typescript`、`electron-builder@26`、`vitest`、`@playwright/test`、`eslint` + `typescript-eslint`、`prettier`

## 4. 内置 ffmpeg 二进制(已实测)

| 组件 | 来源 | 版本 |
|---|---|---|
| ffmpeg.exe | `ffmpeg-static@5.3.0` | 6.1.1-essentials_build-www.gyan.dev(GPL,含 x264/x265/vpx/aom/opus/mp3lame/nvenc/amf/libvpl) |
| ffprobe.exe | `@ffprobe-installer/ffprobe` | 2023-02-13 gyan essentials 构建 |

## 5. 环境验证记录

| 验证项 | 结果 |
|---|---|
| Electron 启动 | 通过:Electron 44.7.0 / Node 24.21.0 / Chrome 152 |
| 路径含中文+空格时生成视频、探测、抽缩略图、转码 | 通过 |
| `-progress pipe:1` 输出 `out_time_us` 与 `progress=end` | 通过 |
| 编码器可用性(列表):libx264 / libx265 / libvpx-vp9 / libopus / libmp3lame / aac | 全部存在 |
| 硬件编码(**真实小样本编码**) | **仅 QSV(Intel)可用**;NVENC 与 AMF 失败 |

## 6. 踩坑记录(对后续开发和文档都有价值)

1. **npm 11 默认不运行依赖安装脚本**:`ffmpeg-static`、`electron`、`esbuild` 的二进制/校验依赖安装脚本。处理:`ffmpeg-static`、`esbuild` 已用 `npm install-scripts approve` 写入 `package.json` 的 `allowScripts`;`electron-winstaller` 拒绝(只用 NSIS);**Electron 二进制需手动执行 `node node_modules\electron\install.js`**。
2. **`electron_config_cache` 必须小写**:只设置 `ELECTRON_CACHE` 时,151 MB 的 Electron zip 实际写到了 C 盘 `%LOCALAPPDATA%\electron`。已把文件移到 F 盘并修正 `env.ps1`。
3. **`ffprobe-static` 的 ffprobe 是 4.0.2(2018)**,与 ffmpeg 6.1.1 相差过大,改用 `@ffprobe-installer/ffprobe`。
4. **`electron-vite@5` 不支持 vite 8**:`npm` 默认会装 vite 8 导致 `ERESOLVE`,需固定 `vite@^7` 与 `@vitejs/plugin-react@^5`。
5. **PowerShell 5.1 读无 BOM 的 UTF-8 脚本会按 GBK 解析**:含中文的 `.ps1` 必须保存为 UTF-8 **带 BOM**,否则报解析错误。
6. **编码器出现在 `-encoders` 里不等于可用**(本机实测:NVENC/AMF/QSV 都在列表里,只有 QSV 能用)。失败的真实报错见下,将作为错误翻译模块的测试样本:
   - NVENC:`Driver does not support the required nvenc API version. Required: 12.1 Found: 11.0`(驱动过旧)
   - AMF:`DLL amfrt64.dll failed to open`(没有 AMD 显卡)
7. **C 盘余量会波动**(开工时 120 MB,随后恢复到 1.6 GB),`env.ps1` 内置余量检查。
