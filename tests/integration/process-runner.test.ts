import { afterEach, describe, expect, it } from 'vitest'
import {
  killAllRunning,
  runningProcessCount,
  runProcess,
  SpawnError
} from '../../src/main/services/process-runner'
import { countProcessesWithMarker, ffmpegPath, isPidAlive, sleep } from './helpers'

const NODE = process.execPath

/** 一个会运行 60 秒的 ffmpeg(-re 按实时速度处理),用来测试取消/超时。 */
const longFfmpegArgs = (extra: string[] = []): string[] => [
  '-v',
  'error',
  '-re',
  '-f',
  'lavfi',
  '-i',
  'testsrc=duration=60:rate=25',
  ...extra,
  '-f',
  'null',
  '-'
]

afterEach(async () => {
  // 任何一个测试失败都不应该给后面的测试留下孤儿进程
  await killAllRunning()
})

describe('runProcess 基本行为', () => {
  it('运行 ffmpeg -version:拿到退出码、stdout 全文,以及按行回调', async () => {
    const lines: string[] = []
    const run = await runProcess(ffmpegPath, ['-version'], { onStdoutLine: (l) => lines.push(l) })
      .result

    expect(run.exitCode).toBe(0)
    expect(run.timedOut).toBe(false)
    expect(run.canceled).toBe(false)
    expect(run.stdout).toMatch(/^ffmpeg version \S+/)
    expect(lines[0]).toMatch(/^ffmpeg version \S+/)
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.every((l) => !l.includes('\n'))).toBe(true)
  })

  it('可执行文件不存在 → 抛出 SpawnError(ENOENT),而不是挂起或崩溃', async () => {
    const promise = runProcess('F:\\no\\such\\ffmpeg.exe', ['-version']).result
    await expect(promise).rejects.toBeInstanceOf(SpawnError)
    await expect(promise).rejects.toMatchObject({ code: 'ENOENT' })
    expect(runningProcessCount()).toBe(0) // 失败的进程不能留在追踪表里
  })

  it('不经过 shell:参数里的 & | > $() % 引号 中文 空格 都原样传到目标程序', async () => {
    const nasty = [
      'a & b | c > d',
      '$(whoami) `id`',
      'say "hello" world',
      "it's 100% %PATH% ^caret",
      '中文 参数 with space',
      'C:\\some dir\\' // 以反斜杠结尾:Windows 参数转义的经典坑
    ]
    const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))'
    const run = await runProcess(NODE, ['-e', script, ...nasty]).result

    expect(run.exitCode).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual(nasty)
  })

  it('按行读取:一行被拆成多个数据块、混用 \\n 与 \\r\\n,仍能得到完整的行', async () => {
    const script = `
      process.stdout.write('al')
      setTimeout(() => process.stdout.write('pha\\nbe'), 60)
      setTimeout(() => process.stdout.write('ta\\r'), 120)
      setTimeout(() => process.stdout.write('\\ngamma'), 180)
      process.stderr.write('err-1\\nerr-')
      setTimeout(() => process.stderr.write('2\\n'), 90)
    `
    const out: string[] = []
    const err: string[] = []
    const run = await runProcess(NODE, ['-e', script], {
      onStdoutLine: (l) => out.push(l),
      onStderrLine: (l) => err.push(l)
    }).result

    expect(run.exitCode).toBe(0)
    expect(out).toEqual(['alpha', 'beta', 'gamma']) // 没有多余的空行,最后一行(无换行结尾)也被冲刷
    expect(err).toEqual(['err-1', 'err-2'])
  })

  it('多字节字符(中文)在数据块边界被切开,也不会出现乱码', async () => {
    // "中文" 的 UTF-8 是 E4 B8 AD E6 96 87,故意在 "中" 的中间切开
    const script = `
      process.stdout.write(Buffer.from([0xE4, 0xB8]))
      setTimeout(() => process.stdout.write(Buffer.from([0xAD, 0xE6, 0x96, 0x87, 0x0A])), 80)
    `
    const lines: string[] = []
    const run = await runProcess(NODE, ['-e', script], { onStdoutLine: (l) => lines.push(l) })
      .result
    expect(lines).toEqual(['中文'])
    expect(run.stdout).toBe('中文\n')
  })

  it('stdout 为 buffer 模式时返回原始二进制,不经过字符串转换', async () => {
    const script = 'process.stdout.write(Buffer.from([0xFF, 0xD8, 0x00, 0x80, 0xFE]))'
    const run = await runProcess(NODE, ['-e', script], { stdout: 'buffer' }).result
    expect([...run.stdoutBuffer!]).toEqual([0xff, 0xd8, 0x00, 0x80, 0xfe])
  })

  it('退出码非 0 时如实返回,stderr 保留末尾内容', async () => {
    const run = await runProcess(NODE, ['-e', "console.error('boom'); process.exit(3)"]).result
    expect(run.exitCode).toBe(3)
    expect(run.stderr).toContain('boom')
  })
})

describe('超时与取消', () => {
  it('超时:杀掉进程并标记 timedOut,不会一直挂着', async () => {
    const proc = runProcess(NODE, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 400 })
    const run = await proc.result

    expect(run.timedOut).toBe(true)
    expect(run.canceled).toBe(false)
    expect(run.elapsedMs).toBeLessThan(8000)
    expect(isPidAlive(proc.pid!)).toBe(false)
  })

  it('cancel():正在运行的 ffmpeg 很快被杀掉,进程确实不存在了', async () => {
    const proc = runProcess(ffmpegPath, longFfmpegArgs())
    expect(isPidAlive(proc.pid!)).toBe(true)
    await sleep(600) // 让它真的跑起来
    expect(isPidAlive(proc.pid!)).toBe(true) // 还在跑,说明不是自己结束的

    const started = Date.now()
    await proc.cancel()
    const run = await proc.result

    expect(run.canceled).toBe(true)
    expect(run.timedOut).toBe(false)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(isPidAlive(proc.pid!)).toBe(false)
    expect(runningProcessCount()).toBe(0)
  })

  it('AbortSignal 触发取消,效果与 cancel() 相同', async () => {
    const controller = new AbortController()
    const proc = runProcess(ffmpegPath, longFfmpegArgs(), { signal: controller.signal })
    await sleep(500)
    controller.abort()
    const run = await proc.result
    expect(run.canceled).toBe(true)
    expect(isPidAlive(proc.pid!)).toBe(false)
  })

  it('信号在启动前就已 abort:进程立刻被取消', async () => {
    const controller = new AbortController()
    controller.abort()
    const proc = runProcess(ffmpegPath, longFfmpegArgs(), { signal: controller.signal })
    const run = await proc.result
    expect(run.canceled).toBe(true)
    expect(isPidAlive(proc.pid!)).toBe(false)
  })

  it('进程已经结束后再 cancel():什么都不做,也不会把结果改成 canceled', async () => {
    const proc = runProcess(NODE, ['-e', 'process.exit(0)'])
    const run = await proc.result
    await proc.cancel()
    expect(run.exitCode).toBe(0)
    expect(run.canceled).toBe(false)
  })

  it('向 ffmpeg 的 stdin 写入 q 可以让它优雅退出(退出码 0,不是被杀)——P6 取消流程依赖这一点', async () => {
    const proc = runProcess(ffmpegPath, longFfmpegArgs(), { stdin: 'pipe' })
    await sleep(700)
    expect(proc.writeStdin('q')).toBe(true)
    const run = await proc.result

    expect(run.exitCode).toBe(0)
    expect(run.canceled).toBe(false)
    expect(run.elapsedMs).toBeLessThan(10_000)
  })

  it('stdin 为 ignore 时 writeStdin 返回 false 而不是抛异常', async () => {
    const proc = runProcess(NODE, ['-e', 'setTimeout(() => {}, 300)'])
    expect(proc.writeStdin('x')).toBe(false)
    await proc.result
  })

  it('killAllRunning():一次结束所有存活的子进程,追踪表清零', async () => {
    const procs = [1, 2, 3].map(() => runProcess(ffmpegPath, longFfmpegArgs()))
    await sleep(600)
    expect(runningProcessCount()).toBe(3)

    await killAllRunning()
    await Promise.all(procs.map((p) => p.result))

    for (const p of procs) expect(isPidAlive(p.pid!)).toBe(false)
    expect(runningProcessCount()).toBe(0)
  })
})

describe.runIf(process.platform === 'win32')('进程树(Windows)', () => {
  it('cancel() 杀掉整棵树:父进程 cmd.exe 和孙进程 ffmpeg.exe 都不残留', async () => {
    // 用 cmd.exe 当"中间层",ffmpeg 就成了孙进程。只杀直接子进程的话 ffmpeg 会变成孤儿继续跑。
    const marker = `VCMARK${Date.now()}`
    const args = ['/c', ffmpegPath, ...longFfmpegArgs(['-metadata', `title=${marker}`])]
    const proc = runProcess('cmd.exe', args)

    // 先确认测试本身有效:此刻应该能看到 cmd.exe 和 ffmpeg.exe 两个进程
    let before = 0
    for (let i = 0; i < 20 && before < 2; i++) {
      await sleep(300)
      before = await countProcessesWithMarker(marker)
    }
    expect(before).toBeGreaterThanOrEqual(2)

    await proc.cancel()
    await proc.result

    await sleep(500)
    expect(await countProcessesWithMarker(marker)).toBe(0)
  })
})
