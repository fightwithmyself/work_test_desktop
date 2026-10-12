import { describe, expect, it } from 'vitest'
import { createLimiter } from '../../src/core/limiter'
import { fileNameFromPath, pathKey } from '../../src/core/path-utils'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createLimiter', () => {
  it('同时运行的任务数不超过上限,且所有任务最终都完成', async () => {
    const limit = createLimiter(3)
    let running = 0
    let peak = 0
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          running += 1
          peak = Math.max(peak, running)
          await new Promise((r) => setTimeout(r, i % 4))
          running -= 1
          return i
        })
      )
    )
    expect(peak).toBe(3)
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('超出上限的任务排队,先进先出', async () => {
    const limit = createLimiter(1)
    const order: string[] = []
    const gate = deferred()
    const first = limit(async () => {
      order.push('a:start')
      await gate.promise
      order.push('a:end')
    })
    const second = limit(async () => void order.push('b'))
    const third = limit(async () => void order.push('c'))

    await tick()
    expect(order).toEqual(['a:start']) // b、c 在排队
    gate.resolve()
    await Promise.all([first, second, third])
    expect(order).toEqual(['a:start', 'a:end', 'b', 'c'])
  })

  it('任务抛异常:调用方拿到异常,名额被释放,后面的任务不受影响', async () => {
    const limit = createLimiter(1)
    const failing = limit(async () => {
      throw new Error('boom')
    })
    const after = limit(async () => 'still works')
    await expect(failing).rejects.toThrow('boom')
    await expect(after).resolves.toBe('still works')
  })

  it('任务同步抛异常也一样', async () => {
    const limit = createLimiter(1)
    const failing = limit(() => {
      throw new Error('sync boom')
    })
    await expect(failing).rejects.toThrow('sync boom')
    await expect(limit(async () => 1)).resolves.toBe(1)
  })

  it('空闲时立即开始,不会无谓等待', async () => {
    const limit = createLimiter(2)
    let started = false
    const p = limit(async () => {
      started = true
    })
    await tick()
    expect(started).toBe(true)
    await p
  })

  it.each([0, -1, 1.5, Number.NaN])('非法并发数 %s 抛出 RangeError', (n) => {
    expect(() => createLimiter(n)).toThrow(RangeError)
  })
})

describe('fileNameFromPath', () => {
  it.each([
    ['C:\\videos\\a.mp4', 'a.mp4'],
    ['C:/videos/a.mp4', 'a.mp4'],
    ['/home/me/a.mp4', 'a.mp4'],
    ['D:\\中文 目录\\视频 样本 (1).mp4', '视频 样本 (1).mp4'],
    ['\\\\nas\\share\\clip.mkv', 'clip.mkv'],
    ['C:\\videos\\folder\\', 'folder'],
    ['C:\\mixed/separators\\a.mp4', 'a.mp4'],
    ['a.mp4', 'a.mp4']
  ])('%s → %s', (input, expected) => {
    expect(fileNameFromPath(input)).toBe(expected)
  })

  it('取不到文件名时退回原字符串', () => {
    expect(fileNameFromPath('')).toBe('')
    expect(fileNameFromPath('\\\\')).toBe('\\\\')
  })
})

describe('pathKey', () => {
  it('Windows 路径:大小写与斜杠方向不同也是同一个文件', () => {
    expect(pathKey('C:/Videos/A.mp4')).toBe(pathKey('c:\\videos\\a.MP4'))
    expect(pathKey('\\\\NAS\\Share\\a.mp4')).toBe(pathKey('\\\\nas\\share\\A.mp4'))
  })

  it('不同的 Windows 文件键不同', () => {
    expect(pathKey('C:\\a.mp4')).not.toBe(pathKey('C:\\b.mp4'))
    expect(pathKey('C:\\a.mp4')).not.toBe(pathKey('D:\\a.mp4'))
  })

  it('POSIX 路径区分大小写,保持原样', () => {
    expect(pathKey('/home/me/A.mp4')).toBe('/home/me/A.mp4')
    expect(pathKey('/home/me/A.mp4')).not.toBe(pathKey('/home/me/a.mp4'))
  })
})
