import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LocatorError, locateBinaries, verifyBinary } from '../../src/main/services/ffmpeg-locator'
import { bins, ffmpegPath, ffprobePath } from './helpers'

const sandbox = mkdtempSync(join(tmpdir(), 'vc-locator-'))
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

const touch = (path: string, content = 'fake'): string => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

describe('内置二进制', () => {
  it('找得到 ffmpeg 与 ffprobe,来源为 bundled,文件真实存在', () => {
    expect(bins.ffmpeg.source).toBe('bundled')
    expect(bins.ffprobe.source).toBe('bundled')
    expect(bins.ffmpeg.path).toMatch(/ffmpeg(\.exe)?$/)
    expect(bins.ffprobe.path).toMatch(/ffprobe(\.exe)?$/)
  })

  it('两个二进制都真的能运行,并返回版本号', async () => {
    const ffmpeg = await verifyBinary(ffmpegPath, 'ffmpeg')
    const ffprobe = await verifyBinary(ffprobePath, 'ffprobe')
    expect(ffmpeg.version).toMatch(/^\d+\.\d+|^N-|^\d{4}-/)
    expect(ffprobe.version.length).toBeGreaterThan(0)
  })
})

describe('自定义路径', () => {
  it('自定义的 ffmpeg 路径优先于内置,来源为 custom', () => {
    const located = locateBinaries({ customFfmpegPath: ffmpegPath })
    expect(located.ffmpeg).toEqual({ path: ffmpegPath, source: 'custom' })
    expect(located.ffprobe.source).toBe('bundled') // 没自定义的那个仍用内置
  })

  it('路径两侧的空白会被忽略;空字符串视为"没有自定义"', () => {
    expect(locateBinaries({ customFfmpegPath: `  ${ffmpegPath}  ` }).ffmpeg.path).toBe(ffmpegPath)
    expect(locateBinaries({ customFfmpegPath: '   ', customFfprobePath: '' }).ffmpeg.source).toBe(
      'bundled'
    )
  })

  it('自定义路径不存在 → 明确报错,而不是悄悄回退到内置版本', () => {
    const missing = join(sandbox, 'nowhere', 'ffmpeg.exe')
    expect(() => locateBinaries({ customFfmpegPath: missing })).toThrow(LocatorError)
    try {
      locateBinaries({ customFfmpegPath: missing })
    } catch (err) {
      expect(err).toMatchObject({ code: 'BINARY_NOT_FOUND', binary: 'ffmpeg' })
      expect((err as Error).message).toContain(missing)
    }
  })

  it('自定义路径指向的是目录而不是文件 → 报错', () => {
    expect(() => locateBinaries({ customFfmpegPath: sandbox })).toThrow(LocatorError)
  })

  it('只自定义了 ffmpeg 时,优先使用它同目录下的 ffprobe(版本更可能匹配)', () => {
    const exe = process.platform === 'win32' ? '.exe' : ''
    const customFfmpeg = touch(join(sandbox, 'custom-bin', `ffmpeg${exe}`))
    const siblingFfprobe = touch(join(sandbox, 'custom-bin', `ffprobe${exe}`))
    const located = locateBinaries({ customFfmpegPath: customFfmpeg })
    expect(located.ffprobe).toEqual({ path: siblingFfprobe, source: 'custom' })
  })

  it('同目录没有 ffprobe 时,回退到内置的 ffprobe', () => {
    const exe = process.platform === 'win32' ? '.exe' : ''
    const customFfmpeg = touch(join(sandbox, 'lonely-bin', `ffmpeg${exe}`))
    expect(locateBinaries({ customFfmpegPath: customFfmpeg }).ffprobe.source).toBe('bundled')
  })
})

describe('打包后 app.asar → app.asar.unpacked 的路径替换(风险 R-04)', () => {
  it('内置路径指向 asar 内部时,实际使用的是 asar.unpacked 里的文件', () => {
    const exe = process.platform === 'win32' ? '.exe' : ''
    // 模拟打包后的目录:真正的文件只存在于 app.asar.unpacked 里,app.asar 里没有
    const resources = join(sandbox, 'resources')
    const unpackedFfmpeg = touch(
      join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', `ffmpeg${exe}`)
    )
    const unpackedFfprobe = touch(
      join(resources, 'app.asar.unpacked', 'node_modules', 'ffprobe', `ffprobe${exe}`)
    )

    const located = locateBinaries({
      resolveBundled: () => ({
        ffmpeg: join(resources, 'app.asar', 'node_modules', 'ffmpeg-static', `ffmpeg${exe}`),
        ffprobe: join(resources, 'app.asar', 'node_modules', 'ffprobe', `ffprobe${exe}`)
      })
    })

    expect(located.ffmpeg.path).toBe(unpackedFfmpeg)
    expect(located.ffprobe.path).toBe(unpackedFfprobe)
  })

  it('如果打包时忘了 asarUnpack(unpacked 里没有文件),报错信息里能看出实际查找的是 unpacked 路径', () => {
    const resources = join(sandbox, 'resources-broken')
    try {
      locateBinaries({
        resolveBundled: () => ({
          ffmpeg: join(resources, 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
          ffprobe: join(resources, 'app.asar', 'node_modules', 'ffprobe', 'ffprobe.exe')
        })
      })
      expect.unreachable('应该抛出 LocatorError')
    } catch (err) {
      expect(err).toBeInstanceOf(LocatorError)
      expect((err as Error).message).toContain('app.asar.unpacked')
    }
  })

  it('当前平台没有内置二进制(解析结果为 null)→ 提示去设置里指定', () => {
    expect(() =>
      locateBinaries({ resolveBundled: () => ({ ffmpeg: null, ffprobe: null }) })
    ).toThrow(/设置中指定路径/)
  })
})

describe('verifyBinary:运行一次确认它真的是 ffmpeg/ffprobe', () => {
  it('不存在的路径 → BINARY_NOT_RUNNABLE', async () => {
    await expect(verifyBinary(join(sandbox, 'nope.exe'), 'ffmpeg')).rejects.toMatchObject({
      code: 'BINARY_NOT_RUNNABLE'
    })
  })

  it('一个文本文件冒充 ffmpeg → BINARY_NOT_RUNNABLE', async () => {
    const fake = touch(join(sandbox, 'fake-ffmpeg.exe'), 'not an executable')
    await expect(verifyBinary(fake, 'ffmpeg')).rejects.toMatchObject({
      code: 'BINARY_NOT_RUNNABLE'
    })
  })

  it('能运行但不是 ffmpeg(这里用 node)→ BINARY_NOT_RUNNABLE', async () => {
    await expect(verifyBinary(process.execPath, 'ffmpeg')).rejects.toMatchObject({
      code: 'BINARY_NOT_RUNNABLE'
    })
  })

  it('把 ffprobe 当成 ffmpeg 传入 → 被识别出来并拒绝', async () => {
    await expect(verifyBinary(ffprobePath, 'ffmpeg')).rejects.toMatchObject({
      code: 'BINARY_NOT_RUNNABLE'
    })
  })
})
