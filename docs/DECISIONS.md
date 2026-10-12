# 决策与反馈记录

> 规则:每次开发者做出选择或给出反馈,都按下面格式追加一条。不改写历史,被推翻的决策标注"已被 D-xxx 取代"。

| 字段 | 含义 |
|---|---|
| 决策点 | 要决定什么 |
| 备选 | 考虑过哪些方案 |
| 结论 | 最后选了什么 |
| 理由 | 为什么 |
| 来源 | 开发者决定 / AI 建议被采纳 / AI 自行决定 |

---

## D-001 技术栈
- **时间**:2026-10-12
- **决策点**:桌面客户端用什么技术栈
- **备选**:Electron+React+TS、Qt6+C++、PySide6、Tauri、WPF/WinUI、wxWidgets/ImGui
- **开发者反馈**:先问"有没有 C++ 方案";看完对比后选择 **Electron**
- **结论**:Electron + React + TypeScript
- **理由**:加权得分最高(4.65);Node 环境已具备;三天内交付把握最大;子进程管理与测试生态成熟
- **来源**:开发者决定(AI 推荐被采纳)
- **遗留风险**:可能被质疑"Web 壳不够原生" → 在文档中说明使用的原生桌面能力

## D-002 代码托管
- **决策点**:GitHub 如何提交
- **结论**:开发者自建仓库,地址 `git@github.com:fightwithmyself/work_test_desktop.git`(SSH),由 AI 执行 push
- **核实**:SSH 认证已验证通过;**远程并非空仓库,已有 1 个仅含 `README.md` 的 Initial commit**,首次推送需先合并(见风险文档 R-02)
- **来源**:开发者决定

## D-003 优化范围
- **结论**:全做:任务队列、硬件加速检测、命令预览、体积预估,以及需求文档 P1 表中其余项
- **来源**:开发者决定
- **AI 补充**:详细设计中把"暂停任务"修正为"暂停队列(不再启动新任务)"。原因:Windows 没有可靠、简单的方式暂停 ffmpeg 子进程,强行实现风险大于收益

## D-004 交付形式
- **结论**:需要打包 Windows 安装包(.exe),并同时提供源码
- **来源**:开发者决定

## D-005 环境与安装位置
- **反馈**:本机缺少的软件可以下载安装,**必须下载到 F 盘**
- **AI 核实后补充约束**:C 盘仅剩 1.6 GB。npm 缓存与 TEMP 已在 F 盘,但 npm 全局前缀在 C 盘 → **不做任何 `npm -g` 全局安装**,所有工具作为项目本地依赖;Electron/electron-builder 等缓存目录显式指向 F 盘
- **来源**:开发者决定 + AI 补充

## D-006 先方案、后开发
- **反馈**:先给需求分析与方案选型,再给项目结构、目录结构与风险点,不要一上来就写代码
- **做法**:本阶段只产出文档(`01-需求分析与方案选型.md`、`02-项目结构与风险.md`),待开发者确认后开始 Day 1
- **来源**:开发者决定

## D-007 UI 库、README、应用名
- **时间**:2026-10-12
- **决策点**:UI 组件库;远程仓库已有 README 如何处理;应用名称
- **结论**:UI 用 **Ant Design**;README **用本项目自己写的覆盖远程原有内容**;应用名暂定 **VideoConverter**
- **来源**:开发者决定(AI 方案被采纳)

## D-008 开发顺序
- **反馈**:"首先环境依赖,然后按模块开发与测试"
- **做法**:先完成环境与依赖并验证(Electron 能启动、ffmpeg 能运行),再按模块逐个开发,**每个模块完成时先跑通对应测试再进入下一个**
- **来源**:开发者决定

## D-009 环境核实发现:C 盘余量极低
- **核实**:开工时 C 盘仅剩约 120 MB(此前测得 1.6 GB,说明在持续减少)
- **决策**:所有缓存与下载产物强制放 F 盘(`F:\devcache\...`);`scripts/env.ps1` 内置 C 盘余量检查;不清理任何非本项目文件,是否清理 C 盘交由开发者决定
- **来源**:AI 发现并采取预防措施,告知开发者

## D-010 ffprobe 来源与 npm 安装脚本策略(环境阶段 AI 自行决定)
- **决策点**:`ffprobe-static` 自带的 ffprobe 为 4.0.2(2018),与 ffmpeg 6.1.1 版本相差过大
- **备选**:继续用 ffprobe-static / 手动下载 gyan 完整包取 ffprobe / 换用 `@ffprobe-installer/ffprobe`
- **结论**:换用 `@ffprobe-installer/ffprobe`(2023-02 gyan 构建,同一来源,版本接近)
- **理由**:旧版 ffprobe 对新编码与旋转元数据识别可能不准,会直接影响"视频信息显示";且该包是 npm 依赖,可复现
- **附带**:npm 11 默认不跑安装脚本,对 `ffmpeg-static`、`esbuild` 显式放行并写入 `package.json`,`electron-winstaller` 拒绝
- **来源**:AI 自行决定,已在 ENVIRONMENT.md 记录

## D-011 硬件加速设计被本机实测验证
- **事实**:本机 NVENC/AMF/QSV 在编码器列表中都存在,真实编码只有 QSV 可用(NVENC 驱动过旧 457.07,AMF 无 AMD 显卡)
- **结论**:设计文档 4.6 的"真实小样本编码验证 + 失败自动回退软件编码"是必须项,不是可选项;本机的真实报错用作错误翻译与硬件检测的测试样本
- **来源**:AI 实测发现

## D-012 交付"提示词剧本",用于展示 vibe coding 过程
- **时间**:2026-10-12
- **开发者反馈**:这是面试官考验 vibe coding 能力的题目,希望得到可以逐步复制的提问命令,一步一步完成项目、测试与修复
- **结论**:新增 `docs/03-提示词剧本.md`:P0-P13 共 14 步 + 6 个通用修复提示词;每步统一为"目标-背景约束-验收-交付证据"
- **设计取舍**:要求 AI 每步贴出真实命令输出和截图(防止"看起来对");换会话用 P0 恢复上下文(文档作为 AI 的外部记忆)
- **来源**:开发者提出,AI 设计

## D-013 P1 脚手架阶段的决策与发现
- **时间**:2026-10-12
- **开发者输入**:按提示词剧本 P1 执行,要求空窗口带安全配置、单实例锁、Ant Design 页面
- **决策与理由**:
  1. **CSP 用 Vite 插件注入 `<meta>`,开发/生产两套策略**。生产严格(无内联脚本、无 unsafe-eval、不允许任何外连);开发放宽以支持 HMR。备选"主进程 onHeadersReceived 改响应头"被放弃,因为对 `file://` 加载是否生效没有把握。策略字符串抽成纯函数 `src/shared/csp.ts` 并有单元测试。
  2. **`style-src` 保留 `'unsafe-inline'`**:Ant Design 的 CSS-in-JS 运行时注入 `<style>`。只影响样式不影响脚本,风险可接受,已写入代码注释。
  3. **去掉 `frame-ancestors`**:通过 meta 下发会被浏览器忽略并在控制台报警告,在本应用无意义。
  4. **安全策略双层实现**:窗口 webPreferences(contextIsolation / sandbox / 关闭 nodeIntegration)+ 全局 `web-contents-created` 钩子(拒绝导航、重定向、window.open、webview、所有权限请求),新建的任何窗口都自动受保护。
  5. **脚手架里放了一个 `app:info` IPC**:不是业务需要,而是为了"端到端自检"渲染层→preload→主进程整条链路,避免后面才发现链路不通。
  6. **e2e 测试提前到 P1**(原计划 P4):空窗口也需要"窗口确实出现、配置确实生效"的证据。
  7. **eslint 配置用 `.mjs`**:package.json 不是 `type: module`,避免 ESM 语法歧义。
  8. **tsconfig 拆成 node / web / e2e 三份**:e2e 里 `page.evaluate` 的回调在浏览器里执行,需要 DOM 类型,但不能让 main 进程代码也能用到 DOM 全局。
- **发现的问题与修正**:
  - TypeScript 抓到:Electron 44 的类型里**不存在 `webContents.getLastWebPreferences`**。原计划靠它断言安全配置,改为**行为证据**:沙箱用 `app.getAppMetrics()` 的 `sandboxed` 字段;contextIsolation 用"`exposeInMainWorld` 仅在隔离开启时才成功"反推;nodeIntegration 用页面内 `require/process` 为 undefined。比读配置值更有说服力。
  - 版本现状:antd 6、React 19、TypeScript 6、Vitest 5、ESLint 10(比设计文档编写时假设的大版本更新),当前全部兼容。
- **测试有效性验证(变异测试)**:故意把 `sandbox` 改成 false、去掉 `will-navigate` 拦截、去掉单实例锁,对应 3 个测试**全部如期失败**;恢复后 7 项重新全绿。证明测试不是摆设。
- **验收结果**:typecheck、lint、format:check 退出码 0;单元 5/5;e2e 7/7;build 成功;`npm run dev` 实际弹出标题为 VideoConverter 的窗口(截图见 `docs/screenshots/`)。
- **来源**:AI 决定并执行,开发者审阅

## 待开发者确认的事项
- `docs/03-提示词剧本.md` 在工作区中被删除(最近一次提交里仍然存在)。AI 未执行过该删除,因此本次提交**未包含**该删除,也未擅自恢复。如需恢复:`git restore docs/03-提示词剧本.md`。

## D-014 P2 core 基础:类型、格式化、ffprobe 解析
- **时间**:2026-10-12
- **开发者输入**:按 P2 要求完成 `types.ts`、`format-utils.ts`、`probe-parser.ts`,覆盖指定的 8 类边界,样本来自本机 ffprobe 的真实输出
- **关键决策**:
  1. **`VideoInfo.rotation` 定义为"为了正确显示需要顺时针旋转的角度"**。ffprobe 的符号约定不能凭文档记忆,所以做了**实验验证**:用 `-display_rotation 90` 生成文件,让 ffmpeg 自动旋转解码,再与手动 `transpose=1`(顺时针)/`transpose=2`(逆时针)逐像素比对 MD5,结果与**逆时针**一致。结论:`side_data.rotation` 是逆时针角度(取反得顺时针),旧式 `tags.rotate` 是顺时针角度(直接用)。因此真实样本 `rotation=90` 解析为 270,手机竖屏常见的 `-90` 解析为 90。
  2. **"拿不到"统一用 `null`,不用 0 / NaN**。时长、码率、宽高、帧率为 0 都视为未知,避免界面出现"0:00""0×0"这类看似有值实则无效的显示。
  3. **封面图(`attached_pic=1`)不算视频流**,只设 `hasCoverArt`。否则 mp3 会被误判为"视频文件",还会拿封面图去做缩略图和转换。判断依据只用 `disposition.attached_pic`,不靠编码名猜测(mjpeg 也可能是真正的运动 JPEG 视频,有专门用例)。
  4. **时长回退链**:`format.duration` → 各流时长中最长者 → null;MKV/WebM 的流时长回退到 `tags.DURATION`(真实样本里流上根本没有 duration 字段)。**码率回退**:容器没给时用 大小×8÷时长 估算,缺任一项则 null。
  5. **解析器不判断"是不是有效视频"**,只返回事实(`hasVideo`/`hasAudio`)。有效性判断(都为 false 即不是媒体文件)留给 P3 的 probe-service,职责更清晰。
  6. **`FFPROBE_JSON_ARGS` 常量**与样本生成脚本共用同一组参数,并有测试守护两者不会漂移。
  7. **样本生成脚本 `scripts/gen-probe-fixtures.mjs`** 可复现:用 ffmpeg 生成 12 种媒体(含 NTSC 帧率、片段化 MP4、裸 H.264 码流、字幕轨、封面图、旋转、多音轨 MKV、WebM、GIF),用 ffprobe 导出 JSON,抹掉本机绝对路径后提交 JSON 文本;媒体文件本身不进仓库。
- **自我审查发现并修复的缺陷**(都是测试写之前通过 review 发现的):
  - 文件大小在进位边界会显示 `1024 KB`(1048575 字节应为 `1.00 MB`)
  - 码率在进位边界会显示 `1000 kbps`(999999 bps 应为 `1 Mbps`)
- **测试有效性验证(变异测试)**:向 core 代码植入 13 种缺陷(旋转符号取反、不识别封面图、不回退 tags.DURATION、时长 0 当有效、取最短流时长、270° 不互换宽高、码率漏乘 8、不过滤 und、对 null 不防御、帧率不回退、分母 0 不处理、两个进位边界),**13/13 全部被测试抓住**。其中"帧率回退"一项首次因 Prettier 重排了代码导致自动脚本匹配不到,被标为 SKIP,随后手动补做并确认被抓住,没有留下未验证项。
- **主动删掉的凑数用例**:曾写了"音频流不会产生帧率"一条,实质是在测类型定义里没有某字段,而不是行为,已删除。
- **验收结果**:`npm run test:unit` 155/155(csp 5 + format-utils 76 + probe-parser 74);typecheck、lint、format:check、build 退出码均为 0;e2e 7/7。
- **工程小插曲**:`.mjs` 脚本未被 ESLint 配成 Node 环境导致 `console` 报 no-undef,修配置而不是加豁免;含中文的临时 PowerShell 脚本再次因缺 BOM 解析失败(ENVIRONMENT.md 第 6 条已记录的同类问题)。
- **已知限制**:HDR、色彩空间、章节、多视频流选择策略暂不解析,后续有需要再加;码率估算只是估算。
- **来源**:AI 决定并执行,开发者审阅

## D-015 P3 主进程服务层:ffmpeg-locator、process-runner、probe-service、thumbnail-service
- **时间**:2026-10-12
- **开发者要求**:在主进程实现与 ffmpeg 交互的服务层,并用真实 ffmpeg 做集成测试;必须覆盖"路径含中文和空格""损坏文件(随机字节)""不存在的文件""取消后无残留 ffmpeg 进程"。
- **关键决策**:
  1. **进程只用 `spawn(file, args[], { shell: false })`**。集成测试用 `node -e` 回显参数,验证 `& | > $() % 引号 中文 空格` 原样到达目标程序;可执行文件不存在时抛 `SpawnError`(ENOENT),不会挂起。
  2. **Windows 取消 = `taskkill /PID <pid> /T /F`**。`child.kill()` 只杀直接子进程,会留下孙进程。测试用 `cmd.exe /c ffmpeg ...` 造出"父进程+孙进程"两层,取消前断言 ≥2 个带标记的进程,取消后断言 0 个。非 Windows 分支只是 `SIGKILL` 单进程,**本机无法验证,未测试**(项目目标平台为 Windows)。
  3. **进程追踪表 + `killAllRunning()`**:退出应用时一次结束所有存活子进程,避免残留(P9 的退出流程会调用)。
  4. **stdin 写 `q` 可让 ffmpeg 优雅退出(退出码 0)**,已用真实 ffmpeg 验证;P6 取消转换时将先发 `q` 再兜底 taskkill,这样输出文件有机会被正确收尾。
  5. **按行读取处理 `\n`、`\r\n`、`\r`**(ffmpeg 进度用 `\r` 刷新),且 `\r` 与 `\n` 被拆在两个数据块之间时不产生空行;中文被拆在块边界也不乱码(`StringDecoder`,并在 close 时 `end()` 冲刷)。
  6. **自定义路径不存在时明确报错,不静默回退到内置版本**。否则用户设置了错误路径却悄悄用了别的程序,出问题时无法排查。只自定义 ffmpeg 时,优先用同目录的 ffprobe(版本更可能匹配),没有再回退内置。
  7. **asar 路径替换放在 core 纯函数 `toUnpackedPath`**,可单测;集成测试用模拟的 `app.asar` 目录结构验证实际使用的是 `app.asar.unpacked` 里的文件(风险 R-04)。
  8. **probe-service 的失败分类顺序**:路径非绝对→INVALID_PATH;stat 失败→FILE_NOT_FOUND/NO_PERMISSION;目录→NOT_A_FILE;0 字节→EMPTY_FILE;再读 512 字节文件头并运行 ffprobe;失败后按"stderr 权限/不存在 → 文件头嗅探或扩展名属于媒体格式则 CORRUPT,否则 NOT_MEDIA"判定。**设计取舍**:用户把一个文本文件改名为 `.mp4`,在他眼里就是"坏掉的视频",所以判为 CORRUPT 而不是 NOT_MEDIA;`.png` 等静态图片单独提示"这是一张图片,不是视频"。
  9. **所有服务函数永不抛异常**,返回结构化结果(`ProbeResult` / `Thumbnail`),方便 IPC 层直接透传。
  10. **缩略图**:`-ss` 放在 `-i` 前(输入级 seek,快);宽度用 `min(320,iw)` 避免放大小视频;高度 `-2` 保证偶数;`format=yuvj420p` + `-f mjpeg pipe:1` 直接从 stdout 取 JPEG,不写临时文件(省去清理和路径问题)。时长 <1s 或未知取第 0 帧。带封面图的 mp3 使用封面(`kind: 'cover'`);纯音频/损坏文件返回内联 SVG 占位图,并带 `reason`(`no-visual` / `extract-failed`)供 UI 区分。
  11. **seek 失败兜底**:元数据声称很长但实际文件很短时,目标时间点取不到帧,自动退回第 0 帧重试;测试里用伪造的 `durationSec: 1000` 复现。
  12. **集成测试夹具**由 `scripts/make-fixtures.ts` 用 ffmpeg lavfi 生成(`FIXTURE_VERSION` 版本戳避免重复生成),通过 vitest `globalSetup` 自动确保存在;输出在已被 `.gitignore` 忽略的 `tests/fixtures/generated`。包含正常 / 无音轨 / 竖屏 / 旋转元数据 / 极短 / 红绿蓝分段(验证取帧位置)/ 纯音频 / 封面 mp3 / 中文+空格路径 / 特殊字符路径 / 随机字节损坏 / 截断 / 0 字节 / 文本 / 假 mp4 / PNG / 目录。随机字节用固定种子的 LCG 生成,保证每次一致;文件头强制为 `00 01 02 03`,避免偶然像某种媒体格式。
  13. **脚本直接用 Node 24 原生 TypeScript 运行**(`node scripts/make-fixtures.ts`),不引入 tsx / ts-node;不设置 package.json 的 `"type": "module"`(会破坏 electron-vite 的 CJS preload),因此加 `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`。
  14. **vitest 拆为 `unit` 与 `integration` 两个 project**(`npm run test:unit` / `npm run test:integration`),集成测试单测超时 60s。
- **测试自身的错误(不是产品缺陷,已修正)**:
  - 红绿蓝夹具我以为恰好 10s,实际 10.04s,"取帧在 10%"的断言由等于 1 改为 `toBeCloseTo(1, 1)`。
  - 我断言"绿色通道 > 150",但 ffmpeg 的 `green` 颜色名是 `(0,128,0)`;改为"目标通道比其他通道至少高 80"。红色同理。
  - 一个缩略图用例的名称与内容不符(写成"缩小",实际测竖屏),已改名。
  - 变异脚本第一版有 bug(单元素嵌套数组被 PowerShell 展平,导致源码根本没被修改,15 个变异被**误报**为"未抓到");修好后重跑,没有因此降低判定标准。
- **本步自查中发现并修复**:
  - `core/thumbnail.ts` 里曾用 `Buffer`,core 同时被 web tsconfig 编译,会类型报错 → 把 `toJpegDataUrl` 移到 thumbnail-service。
  - ESLint 两处:`preserve-caught-error`(抛新错误时补 `{ cause }`)、`no-useless-assignment`(去掉多余初值)。
- **变异验证(故意植入缺陷)**:16 个缺陷 **16/16 被抓到**:`shell:true`、taskkill 去掉 `/T`、取消不标记 canceled、逐块解码造成乱码、结束的进程不出追踪表、空文件检查失效、静态图片判定失效、取帧失败不退回第 0 帧、不校验 JPEG 内容、跳过 asar 路径替换、`-ss` 放在 `-i` 之后、小视频被放大、允许奇数高度、极短视频阈值 1s→0、CR/LF 跨块产生空行、丢掉"扩展名属于媒体格式"规则。
- **最终结果**:`test:unit` 230/230;`test:integration` 69/69(约 8 秒);`test:e2e` 7/7;typecheck、lint、format:check、build 退出码均为 0;测试结束后系统中无残留 ffmpeg 进程。
- **已知局限 / 待后续验证**:
  - 服务层此刻还没被 main 进程引用,所以 `npm run build` 并未打包它们;`ffmpeg-locator` 里用 `createRequire(__filename)` 在 electron-vite 打包产物中的行为,要等 P4 接入 IPC 后才能实际验证(风险已记入,P12 打包后再验一次)。
  - 超时(`timedOut`)和 `AbortSignal` 都走同一个 killProcessTree,已测试;但"进程在被杀前已退出"的竞态只测了 cancel-after-exit 一种。
  - 硬件加速的可用性探测不在本步,留给 P8。
- **来源**:AI 起草并执行,开发者审阅

## D-016 P4 第一个可演示版本:IPC 契约、导入、信息展示、缩略图
- **时间**:2026-10-12
- **开发者要求**:导入视频 → 显示信息 → 显示缩略图;类型化 IPC、最小 preload 接口、主进程校验载荷;拖拽必须用 `webUtils.getPathForFile`;点击选择、多文件;空状态、列表、信息面板、移除;人话错误;不阻塞界面;e2e。
- **关键决策**:
  1. **IPC 契约集中在 `shared/ipc-channels.ts` 的 `IpcContract`**(通道名 → 请求/响应类型)。preload 的 `invoke<K>()` 和 main 的 `handle<K>()` 都由它约束,新增通道漏写类型会在编译期报错。
  2. **渲染层只传路径,不传 `VideoInfo`**。缩略图请求只带 `{ path }`,主进程按"路径 + 大小 + 修改时间"缓存探测结果并自己取用;渲染层传回来的任何"信息"都不可信,也不应由它决定取帧位置。文件被替换后缓存自动失效(有测试)。
  3. **载荷校验分两层**:`main/ipc/validate.ts` 校验"形状与路径写法"(必须是对象、`path` 是字符串、非空、≤32767、无空字符、非设备路径 `\\.\`、是绝对路径、Windows 下必须带盘符或 UNC);路径"是否存在"由服务层返回结构化错误(`FILE_NOT_FOUND` 等),这样用户看到的是"找不到这个文件,它可能已被移动或删除",而不是一个被静默丢弃的请求。**与要求的字面差异**:要求写"路径必须存在"校验,我没有在 IPC 层直接拒绝不存在的路径,理由同上;如果开发者希望改成 IPC 层直接拒绝,改动很小。
  4. **IPC 发送方检查**:只接受 `file://` 页面或 dev server 同源页面的调用(`isTrustedSenderUrl`)。
  5. **所有 handler 兜底**:出意外只返回 fallback(占位图 / `INVALID_PATH` 错误)并在主进程日志里记录,不把堆栈抛给渲染层。
  6. **preload 不暴露 `ipcRenderer`**,只暴露 `app` / `files` / `media` 三组共 5 个函数;e2e 里断言了 `Object.keys`,多暴露任何东西都会失败。
  7. **拖拽**:整个窗口都是拖放区;必须对 `dragover` 和 `drop` 调用 `preventDefault`(否则浏览器会"导航到该文件",e2e 里验证了 `defaultPrevented`);`dragenter/leave` 用计数器避免子元素间抖动;路径通过 preload 的 `webUtils.getPathForFile` 取得。从网页拖来的图片等拿不到磁盘路径的,给出"没有读到文件的位置"提示,而不是静默失败。
  8. **点击选择**:系统对话框,多选,过滤器"视频文件 + 所有文件"(不会把用户拦住)。
  9. **并发限制**:主进程 `createLimiter(3)`,probe 与 thumbnail 共用额度,一次拖入几十个文件也最多同时 3 个子进程(集成测试里采样 `runningProcessCount` 验证峰值 ≤ 2 的设定值)。限流器采用"任务结束时把名额直接交给队首"的写法,避免"先减后加"的窗口里被新任务抢占。
  10. **加载状态**:条目在 IPC 返回之前就同步插入(骨架屏立刻出现);信息先到、缩略图后到(缩略图有独立骨架);e2e 用 MutationObserver 记录经历过的状态,断言先 `loading` 后 `ready` 且出现过缩略图骨架。
  11. **错误展示**:列表里一行人话;信息面板里是 `Alert` + 路径 + **默认折叠**的"技术细节"(ffprobe 末尾 stderr)。e2e 断言列表文案里不含 `Error:`、调用栈、`ffprobe`、`moov atom` 等。IPC 本身异常时,主提示是通用的"读取视频信息时出现未知错误",原始异常文本只放在技术细节里(有单测)。
  12. **列表里的分辨率用"显示分辨率"**(已考虑旋转元数据),`rotated.mp4`(存储 640×360)显示 360×640;信息面板里额外列出"存储分辨率 + 旋转角度"。纯音频显示"仅音频"。
  13. **状态管理**:`zustand` 的 `createFilesStore(api)` 工厂,API 以参数注入,所以单测能用可控的假 API 精确观察 loading → ready 的中间态、加载途中被移除不会"复活"、IPC 抛异常等。去重键 `pathKey`:Windows 路径不区分大小写、两种斜杠等价;POSIX 区分大小写。
  14. **信息面板文案放在 core**(`core/info-sections.ts`),单测覆盖:无音轨("无声")、纯音频("纯音频文件")、封面 mp3、多音轨(分组带序号)、旋转(存储分辨率行)、字幕条数、字段缺失显示"—"。
  15. **新增依赖 `@ant-design/icons`**:原本是 antd 的传递依赖,现在显式声明,避免被上游调整后消失。
- **e2e 的"拖拽"是如何验证的(局限说明)**:Playwright 无法驱动系统级拖放。做法是用 `setInputFiles` 得到一个**由真实磁盘文件支撑**的 File(与系统拖拽得到的是同一类对象),放入 `DataTransfer` 后派发 `dragenter/dragover/drop`。此后的 `webUtils.getPathForFile` → 主进程校验 → ffprobe → 缩略图都是真实链路。**真正的"从资源管理器拖进来"我没有人工验证过**,建议你在演示前自己拖一次。同理,"点击选择文件"替换的是系统对话框本身(`dialog.showOpenDialog`),其余链路真实。
- **本步发现并修复的问题**:
  - 设计测试时发现:Windows 下 `\a.mp4`(有根无盘符)会被 `path.isAbsolute` 判为绝对路径,但含义取决于当前盘符 → `validate.ts` 里明确拒绝。
  - 变异验证第一轮漏掉 1 个:"探测缓存永不失效"。原因是我写的"文件被替换"测试是空的(换成垃圾数据后,无论缓存是否过期取帧都会失败,结果相同)。改为"换成另一个有效视频(10 秒)",过期缓存会让取帧时间点停在 0.3 秒而不是 ≈1 秒,重新验证后被抓到。
  - `react-hooks/preserve-manual-memoization`:从 `getState()` 解构 action 会被 React Compiler 视为可变依赖 → 改用 selector 订阅。
  - 第一次用 `connectOverCDP` 验证 dev 模式拖拽时失败,原因是 Playwright 默认把浏览器当远程机器,`setInputFiles` 会把文件内容(而不是路径)塞进页面;加 `isLocal: true` 后通过。是验证脚本的问题,不是产品缺陷。
- **变异验证(故意植入缺陷)**:20 个缺陷全部被抓到(15 个由单元/集成测试抓到,5 个由 e2e 抓到):绝对路径检查/空字符检查/设备路径检查/盘符检查被移除、发送方同源检查被削弱、限流器失效或名额不交接、去重失效、移除选中项不清选中、旋转信息行丢失、并发限制失效、定位失败不记忆、缓存永不失效(修正测试后)、缓存从不命中;e2e:主进程 probe 跳过校验、preload 拖拽路径恒为空、drop 不再 `preventDefault`、文件对话框结果被丢弃、列表显示存储分辨率而非显示分辨率。
- **dev 模式单独验证**:e2e 跑的是生产构建,而 dev 模式的发送方可信检查走的是"dev server 同源"分支。用 `electron-vite dev` 开远程调试端口并连接,确认 IPC、`webUtils` 拖拽(含中文路径)、成功/失败两种状态在 dev 下同样正常。
- **最终结果**:`test:unit` 321/321;`test:integration` 83/83;`test:e2e` 21/21;typecheck、lint、format:check、build 退出码均为 0;`npm audit --omit=dev`:0 个漏洞;测试后无残留 ffmpeg/electron 进程。
- **已知局限 / 待办**:
  - 界面文案里中英文逗号混用(core 里的错误文案用的是半角逗号),只是排版问题,暂不处理。
  - 列表很长时没有虚拟滚动(几十个文件没问题)。
  - 没有"在文件夹中显示"、"复制路径"等便利功能,留给 P9。
  - 设置里的自定义 ffmpeg 路径尚未接入 UI(`locateBinaries` 已支持),留给 P9。
- **来源**:AI 起草并执行,开发者审阅
