import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { FIXTURES, launchApp, mockOpenDialog, screenshotPath } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
})

const rows = (): ReturnType<Page['getByTestId']> => page.getByTestId('file-row')
const rowOf = (name: string): ReturnType<Page['locator']> =>
  page.getByTestId('file-row').filter({ hasText: name })

async function importViaDialog(paths: string[]): Promise<void> {
  await mockOpenDialog(app, { canceled: false, filePaths: paths })
  await page.getByTestId('add-button').click()
}

/** 等所有行都离开 loading 状态(探测完成) */
async function waitAllSettled(): Promise<void> {
  await expect(page.locator('[data-testid=file-row][data-status=loading]')).toHaveCount(0, {
    timeout: 30_000
  })
}

/** 缩略图是一张真正解码成功的图片,而不是破图 */
async function expectThumbLoaded(row: ReturnType<Page['locator']>, width?: number): Promise<void> {
  const img = row.getByTestId('file-thumb')
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true)
  if (width !== undefined) {
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(width)
  }
}

test('点击"添加视频" → 信息与缩略图出现,且先出现骨架屏(加载状态不阻塞界面)', async () => {
  // 在导入之前装一个观察器,记录行与缩略图经历过的状态
  await page.evaluate(() => {
    const seen: { rowStatuses: string[]; sawThumbSkeleton: boolean } = {
      rowStatuses: [],
      sawThumbSkeleton: false
    }
    ;(window as unknown as { __seen: typeof seen }).__seen = seen
    const record = (): void => {
      for (const el of document.querySelectorAll('[data-testid=file-row]')) {
        const s = el.getAttribute('data-status') ?? ''
        if (seen.rowStatuses[seen.rowStatuses.length - 1] !== s) seen.rowStatuses.push(s)
      }
      if (document.querySelector('[data-testid=thumb-loading]')) seen.sawThumbSkeleton = true
    }
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true
    })
  })

  await importViaDialog([FIXTURES.normal])

  const row = rowOf('normal.mp4')
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('file-duration')).toHaveText('0:03')
  await expect(row.getByTestId('file-resolution')).toHaveText('640×360')
  await expect(row.getByTestId('file-size')).toHaveText(/\d+(\.\d+)? (KB|MB)/)
  await expectThumbLoaded(row, 320)

  const seen = await page.evaluate(
    () =>
      (window as unknown as { __seen: { rowStatuses: string[]; sawThumbSkeleton: boolean } }).__seen
  )
  expect(seen.rowStatuses[0]).toBe('loading')
  expect(seen.rowStatuses).toContain('ready')
  expect(seen.sawThumbSkeleton).toBe(true)
})

test('点击"添加视频"支持多文件;逐一导入各类 fixture,记录每一种的实际现象', async () => {
  const cases: Array<{
    name: string
    file: string
    /** ok = 成功;否则是界面上应出现的人话提示 */
    expected: 'ok' | RegExp
    note: string
  }> = [
    { name: 'normal.mp4', file: FIXTURES.normal, expected: 'ok', note: '常规 640×360' },
    {
      name: '视频 样本 (1).mp4',
      file: FIXTURES.chinesePath,
      expected: 'ok',
      note: '路径含中文和空格'
    },
    {
      name: "a'b [c] 50% & more.mp4",
      file: FIXTURES.specialChars,
      expected: 'ok',
      note: "路径含 ' [ ] % &"
    },
    { name: 'no-audio.mp4', file: FIXTURES.noAudio, expected: 'ok', note: '无音轨' },
    { name: 'portrait.mp4', file: FIXTURES.portrait, expected: 'ok', note: '竖屏 360×640' },
    {
      name: 'rotated.mp4',
      file: FIXTURES.rotated,
      expected: 'ok',
      note: '旋转元数据,应显示 360×640'
    },
    { name: 'tiny.mp4', file: FIXTURES.tiny, expected: 'ok', note: '0.3 秒极短视频' },
    { name: 'audio-only.mp3', file: FIXTURES.audioOnly, expected: 'ok', note: '纯音频' },
    { name: 'cover-art.mp3', file: FIXTURES.coverArt, expected: 'ok', note: '带封面的 mp3' },
    {
      name: 'corrupt-random.mp4',
      file: FIXTURES.corruptRandom,
      expected: /损坏|不完整/,
      note: '随机字节伪装成 mp4'
    },
    {
      name: 'truncated.mp4',
      file: FIXTURES.truncated,
      expected: /损坏|不完整/,
      note: 'mp4 被截断'
    },
    { name: 'empty.mp4', file: FIXTURES.empty, expected: /空的/, note: '0 字节' },
    { name: 'notes.txt', file: FIXTURES.textFile, expected: /不是视频|不支持/, note: '文本文件' },
    {
      name: 'fake-video.mp4',
      file: FIXTURES.textAsMp4,
      expected: /损坏|不完整/,
      note: '文本改名 .mp4'
    },
    { name: 'picture.png', file: FIXTURES.picture, expected: /图片/, note: 'PNG 图片' },
    {
      name: 'folder.mp4',
      file: FIXTURES.directoryNamedMp4,
      expected: /文件夹/,
      note: '名叫 .mp4 的文件夹'
    },
    {
      name: 'does-not-exist.mp4',
      file: FIXTURES.missing,
      expected: /找不到/,
      note: '文件不存在(模拟导入后被删除)'
    }
  ]

  await importViaDialog(cases.map((c) => c.file))
  await expect(rows()).toHaveCount(cases.length)
  await waitAllSettled()

  const observed: string[] = []
  for (const c of cases) {
    const row = rowOf(c.name)
    await expect(row, `${c.name} 应当只有一行`).toHaveCount(1)
    if (c.expected === 'ok') {
      await expect(row).toHaveAttribute('data-status', 'ready')
      await expect(row.getByTestId('file-duration')).not.toHaveText('—')
      await expectThumbLoaded(row)
      const facts = [
        await row.getByTestId('file-duration').innerText(),
        await row.getByTestId('file-resolution').innerText(),
        await row.getByTestId('file-size').innerText()
      ].join(' | ')
      observed.push(`OK   ${c.name.padEnd(24)} ${facts}   (${c.note})`)
    } else {
      await expect(row).toHaveAttribute('data-status', 'error')
      const text = await row.getByTestId('file-error').innerText()
      expect(text).toMatch(c.expected)
      // 人话:不能出现堆栈、错误类名、ffmpeg 原始输出
      expect(text).not.toMatch(/Error:|at .*\(|\bffprobe\b|\.js:\d+|Invalid data|moov atom/)
      observed.push(`ERR  ${c.name.padEnd(24)} ${text.trim()}   (${c.note})`)
    }
  }
  console.log('\n导入现象一览:\n' + observed.join('\n'))

  // 个别细节
  await expect(rowOf('rotated.mp4').getByTestId('file-resolution')).toHaveText('360×640')
  await expect(rowOf('portrait.mp4').getByTestId('file-resolution')).toHaveText('360×640')
  await expect(rowOf('audio-only.mp3').getByTestId('file-resolution')).toHaveText('仅音频')
  await expect(rowOf('cover-art.mp3').getByTestId('file-thumb')).toHaveAttribute(
    'data-kind',
    'cover'
  )
  await expect(rowOf('audio-only.mp3').getByTestId('file-thumb')).toHaveAttribute(
    'data-kind',
    'placeholder'
  )
})

test('主界面截图:多个视频的列表', async () => {
  await importViaDialog([
    FIXTURES.colorBands,
    FIXTURES.chinesePath,
    FIXTURES.portrait,
    FIXTURES.noAudio,
    FIXTURES.audioOnly
  ])
  await expect(rows()).toHaveCount(5)
  await waitAllSettled()
  await expect(page.getByTestId('file-thumb')).toHaveCount(5)
  await page.screenshot({ path: screenshotPath('p4-main-list.png') })
})

test('点开一行 → 右侧信息面板显示完整信息;再次点击或关闭按钮可收起', async () => {
  await importViaDialog([FIXTURES.normal])
  await waitAllSettled()
  await expect(page.getByTestId('detail-panel')).toHaveCount(0)

  await rowOf('normal.mp4').click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('detail-name')).toHaveText('normal.mp4')

  const general = panel.getByTestId('section-general')
  await expect(general).toContainText('容器格式')
  await expect(general).toContainText('MP4')
  await expect(general).toContainText('时长')
  await expect(general).toContainText('0:03')
  await expect(general).toContainText('normal.mp4')

  const video = panel.getByTestId('section-video-0')
  await expect(video).toContainText('H.264')
  await expect(video).toContainText('640×360')
  await expect(video).toContainText('25 fps')

  const audio = panel.getByTestId('section-audio-0')
  await expect(audio).toContainText('AAC')
  await expect(audio).toContainText('声道')
  await expect(audio).toContainText('采样率')

  await expectThumbLoaded(panel)
  await page.screenshot({ path: screenshotPath('p4-detail-panel.png') })

  await panel.getByTestId('detail-close').click()
  await expect(page.getByTestId('detail-panel')).toHaveCount(0)

  await rowOf('normal.mp4').click()
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  await rowOf('normal.mp4').click() // 再点一次收起
  await expect(page.getByTestId('detail-panel')).toHaveCount(0)
})

test('无视频流/无音轨/旋转的信息面板文案', async () => {
  await importViaDialog([FIXTURES.audioOnly, FIXTURES.noAudio, FIXTURES.rotated])
  await waitAllSettled()

  await rowOf('audio-only.mp3').click()
  await expect(page.getByTestId('section-video-none')).toContainText('纯音频')

  await rowOf('no-audio.mp4').click()
  await expect(page.getByTestId('section-audio-none')).toContainText('无声')

  await rowOf('rotated.mp4').click()
  await expect(page.getByTestId('section-video-0')).toContainText('存储分辨率')
  await expect(page.getByTestId('section-video-0')).toContainText('640×360')
})

test('错误状态:人话提示 + 信息面板里有原因和折叠的技术细节;截图', async () => {
  await importViaDialog([
    FIXTURES.normal,
    FIXTURES.corruptRandom,
    FIXTURES.textFile,
    FIXTURES.missing,
    FIXTURES.picture
  ])
  await expect(rows()).toHaveCount(5)
  await waitAllSettled()

  await rowOf('corrupt-random.mp4').click()
  const panel = page.getByTestId('detail-panel')
  await expect(panel.getByTestId('detail-error')).toContainText('损坏')
  // 技术细节默认折叠
  const details = panel.locator('details.tech-detail')
  await expect(details).toHaveCount(1)
  await expect(details).not.toHaveAttribute('open', '')
  await page.screenshot({ path: screenshotPath('p4-error-state.png') })

  // 错误行也可以被移除
  await rowOf('notes.txt').getByTestId('remove-button').click()
  await expect(rowOf('notes.txt')).toHaveCount(0)
  await expect(rows()).toHaveCount(4)
})

test('移除单个文件:只移除那一个;移除当前选中的,面板一并关闭', async () => {
  await importViaDialog([FIXTURES.normal, FIXTURES.noAudio, FIXTURES.portrait])
  await expect(rows()).toHaveCount(3)
  await waitAllSettled()

  await rowOf('no-audio.mp4').getByTestId('remove-button').click()
  await expect(rows()).toHaveCount(2)
  await expect(rowOf('no-audio.mp4')).toHaveCount(0)
  await expect(rowOf('normal.mp4')).toHaveCount(1)
  await expect(rowOf('portrait.mp4')).toHaveCount(1)

  await rowOf('normal.mp4').click()
  await expect(page.getByTestId('detail-panel')).toBeVisible()
  await rowOf('normal.mp4').getByTestId('remove-button').click()
  await expect(page.getByTestId('detail-panel')).toHaveCount(0)
  await expect(rows()).toHaveCount(1)

  // 全部移除后回到空状态
  await rowOf('portrait.mp4').getByTestId('remove-button').click()
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('重复导入同一个文件会被跳过并提示;取消对话框什么都不会发生', async () => {
  await mockOpenDialog(app, { canceled: true, filePaths: [] })
  await page.getByTestId('add-button').click()
  await page.waitForTimeout(300)
  await expect(page.getByTestId('empty-state')).toBeVisible()

  await importViaDialog([FIXTURES.normal])
  await expect(rows()).toHaveCount(1)
  await waitAllSettled()

  await importViaDialog([FIXTURES.normal, FIXTURES.noAudio])
  await expect(rows()).toHaveCount(2)
  await expect(page.getByText('跳过 1 个已在列表中的文件')).toBeVisible()
})

test('清空列表需要确认', async () => {
  await importViaDialog([FIXTURES.normal, FIXTURES.noAudio])
  await expect(rows()).toHaveCount(2)
  await page.getByTestId('clear-button').click()
  await page.getByRole('button', { name: '清 空' }).click()
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

/**
 * 模拟"从资源管理器拖进窗口"。
 * 真实的系统级拖拽无法被 Playwright 驱动,所以:用 setInputFiles 得到一个"真实磁盘文件支撑"的
 * File 对象(与系统拖拽得到的是同一类对象),再放进 DataTransfer 并派发 drag/drop 事件。
 * 之后的 webUtils.getPathForFile → 主进程 → ffprobe 全是真实链路。
 */
async function dropFilesFromDisk(paths: string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.id = '__e2e_file_source'
    document.body.appendChild(input)
  })
  await page.locator('#__e2e_file_source').setInputFiles(paths)

  const fire = (type: string): Promise<void> =>
    page.evaluate((t) => {
      const input = document.getElementById('__e2e_file_source') as HTMLInputElement
      const dt = new DataTransfer()
      for (const file of Array.from(input.files ?? [])) dt.items.add(file)
      window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, type)

  await fire('dragenter')
  await fire('dragover')
  await expect(page.getByTestId('drop-overlay')).toBeVisible()
  await fire('drop')
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0)
}

test('拖拽导入:经 webUtils.getPathForFile 取得真实路径(含中文路径与多文件)', async () => {
  await dropFilesFromDisk([FIXTURES.chinesePath, FIXTURES.normal])
  await expect(rows()).toHaveCount(2)
  await waitAllSettled()

  const row = rowOf('视频 样本 (1).mp4')
  await expect(row).toHaveAttribute('data-status', 'ready')
  await expect(row.getByTestId('file-resolution')).toHaveText('640×360')
  await expectThumbLoaded(row, 320)
  await expect(rowOf('normal.mp4')).toHaveAttribute('data-status', 'ready')
})

test('拖拽拿不到磁盘路径的文件(如网页图片)时,给出提示而不是静默失败', async () => {
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'from-browser.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    )
  })
  await expect(page.getByText('没有读到文件的位置')).toBeVisible()
  await expect(rows()).toHaveCount(0)
})

test('拖入窗口的文件不会导致页面被导航走(默认行为被拦截)', async () => {
  const urlBefore = page.url()
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1])], 'x.mp4'))
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(prevented).toBe(true)
  expect(page.url()).toBe(urlBefore)
})

test('IPC 校验层生效:设备路径和含空字符的路径只有校验层会拦,必须被拒绝且立刻返回', async () => {
  const started = Date.now()
  const results = await page.evaluate(async () => {
    const device = await window.api.media.probe('\\\\.\\COM1')
    const pipe = await window.api.media.probe('\\\\.\\pipe\\vc-test')
    const nul = await window.api.media.probe('C:\\temp\\a.mp4\0.txt')
    const thumb = await window.api.media.thumbnail('\\\\.\\COM1')
    return { device, pipe, nul, thumb }
  })
  for (const r of [results.device, results.pipe, results.nul]) {
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_PATH')
  }
  expect(results.thumb.kind).toBe('placeholder')
  expect(Date.now() - started).toBeLessThan(3000)
})

test('渲染层传入非法路径:相对路径/空路径被主进程拒绝,返回人话错误而不是抛异常', async () => {
  const results = await page.evaluate(async () => {
    const relative = await window.api.media.probe('relative/path.mp4')
    const empty = await window.api.media.probe('')
    const thumb = await window.api.media.thumbnail('relative/path.mp4')
    return { relative, empty, thumb }
  })
  expect(results.relative.ok).toBe(false)
  if (!results.relative.ok) expect(results.relative.error.code).toBe('INVALID_PATH')
  expect(results.empty.ok).toBe(false)
  if (!results.empty.ok) expect(results.empty.error.code).toBe('INVALID_PATH')
  expect(results.thumb.kind).toBe('placeholder')
})
