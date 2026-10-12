import { describe, expect, it } from 'vitest'
import { buildThumbnailArgs } from '../../src/core/thumbnail'
import { parseProbeOutput } from '../../src/core/probe-parser'
import { probeFile } from '../../src/main/services/probe-service'
import { runProcess } from '../../src/main/services/process-runner'
import { generateThumbnail } from '../../src/main/services/thumbnail-service'
import type { Thumbnail, VideoInfo } from '../../src/shared/types'
import {
  averageColor,
  dataUrlToBytes,
  ffmpegPath,
  ffprobePath,
  fixtures,
  jpegSize
} from './helpers'

const deps = { ffmpegPath }

/** 走完整链路:先探测,再生成缩略图。 */
async function thumbnailOf(path: string): Promise<Thumbnail> {
  const probed = await probeFile(path, { ffprobePath })
  if (!probed.ok) throw new Error(`探测失败: ${probed.error.code}`)
  return generateThumbnail(path, probed.info, deps)
}

/** 用一份"撒谎"的信息驱动缩略图服务,模拟元数据与实际内容不一致的情况。 */
const fakeInfo = (overrides: Partial<VideoInfo>): VideoInfo => ({
  ...parseProbeOutput({}),
  hasVideo: true,
  ...overrides
})

describe('generateThumbnail · 视频帧', () => {
  it('常规视频:取 10% 处(0.3s)一帧,JPEG,宽度缩放到 320', async () => {
    const t = await thumbnailOf(fixtures.normal)
    expect(t.kind).toBe('frame')
    expect(t.reason).toBeNull()
    expect(t.timestampSec).toBeCloseTo(0.3, 2)

    const jpeg = dataUrlToBytes(t.dataUrl, 'image/jpeg')
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]) // JPEG 魔数
    expect(jpegSize(jpeg)).toEqual({ width: 320, height: 180 })
  })

  it('取帧位置真的是 10%:10 秒视频(0~0.5s 红,之后绿)取到的是绿色,而第 0 帧是红色', async () => {
    const t = await thumbnailOf(fixtures.colorBands)
    // concat 拼出的实际时长是 10.04s,所以 10% 处是 ≈1.004 秒(而不是整 1 秒)
    expect(t.timestampSec).toBeCloseTo(1, 1)
    const picked = await averageColor(dataUrlToBytes(t.dataUrl, 'image/jpeg'))
    // ffmpeg 的 green 是 (0,128,0) 而不是 (0,255,0),所以不写死阈值,改为判断绿色通道明显占主导
    expect(picked.g).toBeGreaterThan(picked.r + 80)
    expect(picked.g).toBeGreaterThan(picked.b + 80)

    // 对照组:直接取第 0 帧确实是红色。证明上面的断言能区分"取对了位置"和"取到了第 0 帧"
    const first = await runProcess(
      ffmpegPath,
      buildThumbnailArgs({ inputPath: fixtures.colorBands, timestampSec: null }),
      {
        stdout: 'buffer'
      }
    ).result
    const firstColor = await averageColor(first.stdoutBuffer!)
    expect(firstColor.r).toBeGreaterThan(firstColor.g + 80)
    expect(firstColor.r).toBeGreaterThan(firstColor.b + 80)
  })

  it('极短视频(0.3 秒):取第 0 帧', async () => {
    const t = await thumbnailOf(fixtures.tiny)
    expect(t.kind).toBe('frame')
    expect(t.timestampSec).toBe(0)
    expect(jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg')).width).toBe(320)
  })

  it('竖屏 360×640 缩小到 320 宽:保持比例,高度为偶数(不放大的情况见封面图用例)', async () => {
    const t = await thumbnailOf(fixtures.portrait)
    const { width, height } = jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg'))
    expect(width).toBe(320) // 360 → 320,缩小
    expect(height).toBeGreaterThan(width)
    expect(Math.abs(height - 569)).toBeLessThanOrEqual(2) // 保持 9:16,且高度为偶数
    expect(height % 2).toBe(0)
  })

  it('带旋转元数据的视频:缩略图方向正确(显示为竖屏,而不是被压扁的横屏)', async () => {
    const t = await thumbnailOf(fixtures.rotated)
    const { width, height } = jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg'))
    expect(width).toBe(320)
    expect(height).toBeGreaterThan(width)
  })

  it('路径含中文和空格', async () => {
    const t = await thumbnailOf(fixtures.chinesePath)
    expect(t.kind).toBe('frame')
    expect(jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg')).width).toBe(320)
  })

  it("路径含 ' [ ] % & 等特殊字符", async () => {
    const t = await thumbnailOf(fixtures.specialChars)
    expect(t.kind).toBe('frame')
  })

  it('无音轨视频同样可以', async () => {
    const t = await thumbnailOf(fixtures.noAudio)
    expect(t.kind).toBe('frame')
  })
})

describe('generateThumbnail · 没有视频流', () => {
  it('纯音频:返回占位图(SVG),原因是"没有可视内容"', async () => {
    const t = await thumbnailOf(fixtures.audioOnly)
    expect(t.kind).toBe('placeholder')
    expect(t.reason).toBe('no-visual')
    expect(t.timestampSec).toBeNull()
    expect(t.dataUrl.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(t.dataUrl)).toContain('<svg')
  })

  it('带封面的 mp3:使用封面图作为缩略图', async () => {
    const t = await thumbnailOf(fixtures.coverArt)
    expect(t.kind).toBe('cover')
    expect(jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg')).width).toBe(300) // 封面原图 300 宽,不放大
  })
})

describe('generateThumbnail · 异常情况永远不抛异常,而是给占位图', () => {
  it('元数据声称很长,但实际文件很短(seek 到文件之外):退回第 0 帧', async () => {
    // 声称 1000 秒 → 目标 100 秒,而真实视频只有 3 秒
    const t = await generateThumbnail(fixtures.normal, fakeInfo({ durationSec: 1000 }), deps)
    expect(t.kind).toBe('frame')
    expect(t.timestampSec).toBe(0)
    expect(jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg')).width).toBe(320)
  })

  it('损坏文件:占位图,原因是 extract-failed', async () => {
    const t = await generateThumbnail(fixtures.corruptRandom, fakeInfo({ durationSec: 3 }), deps)
    expect(t.kind).toBe('placeholder')
    expect(t.reason).toBe('extract-failed')
  })

  it('文件不存在:占位图', async () => {
    const t = await generateThumbnail(fixtures.missing, fakeInfo({ durationSec: 3 }), deps)
    expect(t.kind).toBe('placeholder')
    expect(t.reason).toBe('extract-failed')
  })

  it('ffmpeg 无法运行:占位图,不抛异常', async () => {
    const t = await generateThumbnail(fixtures.normal, fakeInfo({ durationSec: 3 }), {
      ffmpegPath: 'F:\\no\\such\\ffmpeg.exe'
    })
    expect(t.kind).toBe('placeholder')
    expect(t.reason).toBe('extract-failed')
  })

  it('占位图按内容类型区分:有视频流用播放图标,没有则用音符', async () => {
    const video = await generateThumbnail(fixtures.missing, fakeInfo({ hasVideo: true }), deps)
    const audio = await generateThumbnail(
      fixtures.missing,
      fakeInfo({ hasVideo: false, hasAudio: true }),
      deps
    )
    expect(video.dataUrl).not.toBe(audio.dataUrl)
  })

  it('速度:一张缩略图在 5 秒内完成', async () => {
    const started = Date.now()
    await thumbnailOf(fixtures.normal)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
