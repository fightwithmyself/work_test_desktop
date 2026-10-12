import { resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * e2e 用的夹具路径。夹具由 `npm run fixtures`(scripts/make-fixtures.ts)生成,
 * `npm run test:e2e` 会先执行它。这里不直接 import 生成脚本,因为它依赖 import.meta,
 * 而 Playwright 把 .ts 当 CJS 转译。
 */
export const fixture = (...parts: string[]): string =>
  resolve(process.cwd(), 'tests', 'fixtures', 'generated', ...parts)

export const FIXTURES = {
  normal: fixture('normal.mp4'),
  noAudio: fixture('no-audio.mp4'),
  portrait: fixture('portrait.mp4'),
  rotated: fixture('rotated.mp4'),
  tiny: fixture('tiny.mp4'),
  colorBands: fixture('color-bands.mp4'),
  audioOnly: fixture('audio-only.mp3'),
  coverArt: fixture('cover-art.mp3'),
  chinesePath: fixture('中文 目录 with space', '视频 样本 (1).mp4'),
  specialChars: fixture("special 'dir' [x] 100%", "a'b [c] 50% & more.mp4"),
  corruptRandom: fixture('corrupt-random.mp4'),
  truncated: fixture('truncated.mp4'),
  empty: fixture('empty.mp4'),
  textFile: fixture('notes.txt'),
  textAsMp4: fixture('fake-video.mp4'),
  picture: fixture('picture.png'),
  directoryNamedMp4: fixture('folder.mp4'),
  missing: fixture('does-not-exist.mp4')
}

export const screenshotPath = (name: string): string =>
  resolve(process.cwd(), 'docs', 'screenshots', name)

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  // 如果外部环境设置了 ELECTRON_RUN_AS_NODE,Electron 会退化成 Node,必须去掉
  const env = { ...process.env } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({ args: [process.cwd()], env })
  const page = await app.firstWindow()
  await page.waitForSelector('#root > *')
  return { app, page }
}

/**
 * 替换"打开文件"系统对话框的返回值。
 * 原生对话框无法被自动化操作;替换的是对话框本身,
 * 而点击按钮 → IPC → 主进程 → 路径校验 → 探测 → 缩略图 的整条链路都是真实的。
 */
export async function mockOpenDialog(
  app: ElectronApplication,
  result: { canceled: boolean; filePaths: string[] }
): Promise<void> {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = (async () => value) as typeof dialog.showOpenDialog
  }, result)
}
