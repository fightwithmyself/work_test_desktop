import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

let app: ElectronApplication

test.beforeAll(async () => {
  // 如果外部环境设置了 ELECTRON_RUN_AS_NODE,Electron 会退化成 Node,必须去掉
  const env = { ...process.env } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  app = await electron.launch({ args: [process.cwd()], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('空窗口启动,标题与内容正确,且 preload→主进程 IPC 链路通', async () => {
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('VideoConverter')
  await expect(page.getByRole('heading', { name: 'VideoConverter' })).toBeVisible()
  // 这一项由主进程返回,证明 渲染层 → preload → IPC → 主进程 整条链路可用
  await expect(page.getByTestId('app-info')).toContainText('Electron')
  await page.screenshot({ path: 'docs/screenshots/p1-empty-window.png' })
})

// Electron 44 的类型里没有 getLastWebPreferences,所以用"行为证据"验证安全配置,比读配置值更有说服力。
test('安全配置:渲染进程运行在沙箱中', async () => {
  const sandboxed = await app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter((m) => m.type === 'Tab')
      .map((m) => m.sandboxed)
  )
  expect(sandboxed.length).toBeGreaterThan(0)
  expect(sandboxed.every((s) => s === true)).toBe(true)
})

test('安全配置:contextIsolation 开启(exposeInMainWorld 只有在隔离开启时才能成功)', async () => {
  const page = await app.firstWindow()
  expect(await page.evaluate(() => typeof window.api)).toBe('object')
})

test('渲染层拿不到 Node 能力,只有白名单 API', async () => {
  const page = await app.firstWindow()
  const result = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    apiKeys: Object.keys(window.api),
    appKeys: Object.keys(window.api.app)
  }))
  expect(result.require).toBe('undefined')
  expect(result.process).toBe('undefined')
  expect(result.apiKeys).toEqual(['app'])
  expect(result.appKeys).toEqual(['getInfo'])
})

test('拒绝 window.open 和页面导航', async () => {
  const page = await app.firstWindow()
  const urlBefore = page.url()

  const opened = await page.evaluate(() => window.open('https://example.com') === null)
  expect(opened).toBe(true)
  expect(app.windows()).toHaveLength(1)

  await page.evaluate(() => {
    window.location.href = 'https://example.com'
  })
  await page.waitForTimeout(800)
  expect(page.url()).toBe(urlBefore)
})

test('生产构建的 CSP 严格:无 unsafe-eval,脚本不允许内联', async () => {
  const page = await app.firstWindow()
  const csp = await page.evaluate(
    () =>
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? ''
  )
  expect(csp).toContain("script-src 'self';")
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).not.toContain('ws://')
})

test('单实例锁:第二个实例会立刻退出', async () => {
  const env = { ...process.env } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  const second = await electron.launch({ args: [process.cwd()], env }).then(
    (a) => a,
    () => null
  )
  // 第二个实例拿不到锁:要么启动即退出(launch 失败),要么进程很快结束
  if (second) {
    const exited = await Promise.race([
      new Promise<boolean>((r) => second.process().once('exit', () => r(true))),
      new Promise<boolean>((r) => setTimeout(() => r(false), 8000))
    ])
    if (!exited) await second.close()
    expect(exited).toBe(true)
  }
  // 原实例仍然存活且只有一个窗口
  expect(app.windows()).toHaveLength(1)
})
