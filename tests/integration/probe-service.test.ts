import { describe, expect, it } from 'vitest'
import { probeFile } from '../../src/main/services/probe-service'
import type { ProbeError, ProbeResult } from '../../src/shared/types'
import { ffprobePath, fixtures } from './helpers'

const deps = { ffprobePath }

/** 断言探测成功并返回信息。 */
async function expectOk(path: string) {
  const result = await probeFile(path, deps)
  if (!result.ok)
    throw new Error(
      `期望成功,实际失败: ${result.error.code} ${result.error.message} | ${result.error.detail}`
    )
  return result.info
}

/** 断言探测失败并返回错误。 */
async function expectFail(path: string, code: ProbeError['code']): Promise<ProbeError> {
  const result: ProbeResult = await probeFile(path, deps)
  if (result.ok) throw new Error(`期望失败(${code}),实际成功了`)
  expect(result.error.code).toBe(code)
  expect(result.error.message.length).toBeGreaterThan(0)
  return result.error
}

describe('probeFile · 正常文件', () => {
  it('常规 MP4:容器、时长、分辨率、帧率、编码、音轨都正确', async () => {
    const info = await expectOk(fixtures.normal)
    expect(info.formatName).toContain('mp4')
    expect(info.durationSec).toBeCloseTo(3, 1)
    expect(info.sizeBytes).toBeGreaterThan(10_000)
    expect(info.hasVideo && info.hasAudio).toBe(true)
    expect(info.videoStreams[0]).toMatchObject({
      codec: 'h264',
      width: 640,
      height: 360,
      frameRate: 25,
      rotation: 0
    })
    expect(info.audioStreams[0]).toMatchObject({ codec: 'aac', sampleRate: 44100 })
  })

  it('无音轨视频', async () => {
    const info = await expectOk(fixtures.noAudio)
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(false)
  })

  it('真正的竖屏(360×640 像素):不是靠旋转元数据', async () => {
    const info = await expectOk(fixtures.portrait)
    expect(info.rotation).toBe(0)
    expect(info.videoStreams[0]).toMatchObject({
      width: 360,
      height: 640,
      displayWidth: 360,
      displayHeight: 640
    })
  })

  it('带旋转元数据的"竖屏":存储 640×360,显示 360×640', async () => {
    const info = await expectOk(fixtures.rotated)
    expect(info.rotation).toBe(270)
    expect(info.videoStreams[0]).toMatchObject({
      width: 640,
      height: 360,
      displayWidth: 360,
      displayHeight: 640
    })
  })

  it('极短视频(0.3 秒)', async () => {
    const info = await expectOk(fixtures.tiny)
    expect(info.durationSec).toBeGreaterThan(0.2)
    expect(info.durationSec).toBeLessThan(0.5)
    expect(info.hasVideo).toBe(true)
  })

  it('纯音频 mp3:没有视频,也没有封面', async () => {
    const info = await expectOk(fixtures.audioOnly)
    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(true)
    expect(info.hasCoverArt).toBe(false)
  })

  it('带封面的 mp3:封面不算视频流', async () => {
    const info = await expectOk(fixtures.coverArt)
    expect(info.hasVideo).toBe(false)
    expect(info.hasCoverArt).toBe(true)
    expect(info.hasAudio).toBe(true)
  })
})

describe('probeFile · 特殊路径', () => {
  it('路径含中文和空格', async () => {
    expect(fixtures.chinesePath).toMatch(/中文 目录 with space/)
    const info = await expectOk(fixtures.chinesePath)
    expect(info.durationSec).toBeCloseTo(3, 1)
    expect(info.videoStreams[0]).toMatchObject({ width: 640, height: 360 })
  })

  it("路径含 ' [ ] % & 等特殊字符", async () => {
    expect(fixtures.specialChars).toContain("'")
    expect(fixtures.specialChars).toContain('%')
    const info = await expectOk(fixtures.specialChars)
    expect(info.durationSec).toBeCloseTo(3, 1)
  })
})

describe('probeFile · 失败要被"分别区分"', () => {
  it('不存在的文件 → FILE_NOT_FOUND', async () => {
    await expectFail(fixtures.missing, 'FILE_NOT_FOUND')
  })

  it('目录 → NOT_A_FILE(哪怕目录名以 .mp4 结尾)', async () => {
    await expectFail(fixtures.directoryNamedMp4, 'NOT_A_FILE')
  })

  it('0 字节文件 → EMPTY_FILE', async () => {
    await expectFail(fixtures.empty, 'EMPTY_FILE')
  })

  it('损坏文件:.mp4 里写满随机字节 → CORRUPT', async () => {
    const error = await expectFail(fixtures.corruptRandom, 'CORRUPT')
    expect(error.detail).toBeTruthy() // 保留 ffprobe 的原始报错,方便排查
  })

  it('损坏文件:真实 mp4 被截断(缺少 moov)→ CORRUPT', async () => {
    const error = await expectFail(fixtures.truncated, 'CORRUPT')
    expect(error.detail).toMatch(/moov atom not found|Invalid data/i)
  })

  it('不是视频:普通文本文件 .txt → NOT_MEDIA', async () => {
    await expectFail(fixtures.textFile, 'NOT_MEDIA')
  })

  it('文本内容但扩展名是 .mp4 → CORRUPT(用户眼里它就是个坏掉的视频)', async () => {
    await expectFail(fixtures.textAsMp4, 'CORRUPT')
  })

  it('一张 PNG 图片 → NOT_MEDIA,并明确说是图片', async () => {
    const error = await expectFail(fixtures.picture, 'NOT_MEDIA')
    expect(error.message).toContain('图片')
  })

  it('相对路径 → INVALID_PATH(不会因为工作目录不同而指向不同文件)', async () => {
    await expectFail('relative/video.mp4', 'INVALID_PATH')
    await expectFail('', 'INVALID_PATH')
  })

  it('入参类型错误也不会抛异常', async () => {
    const result = await probeFile(123 as unknown as string, deps)
    expect(result.ok).toBe(false)
  })

  it('ffprobe 本身无法运行 → FFPROBE_UNAVAILABLE', async () => {
    const result = await probeFile(fixtures.normal, { ffprobePath: 'F:\\no\\such\\ffprobe.exe' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FFPROBE_UNAVAILABLE')
  })

  it('超时 → TIMEOUT', async () => {
    const result = await probeFile(fixtures.normal, { ffprobePath, timeoutMs: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT')
  })

  it('"不存在 / 损坏 / 不是视频"三种情况的提示语各不相同', async () => {
    const messages = await Promise.all(
      [fixtures.missing, fixtures.corruptRandom, fixtures.textFile].map(async (p) => {
        const r = await probeFile(p, deps)
        return r.ok ? '' : r.error.message
      })
    )
    expect(new Set(messages).size).toBe(3)
    expect(messages.every((m) => m !== '')).toBe(true)
  })
})
