import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { locateBinaries, type LocatedBinaries } from '../../src/main/services/ffmpeg-locator'
import { createMediaService } from '../../src/main/services/media-service'
import { runningProcessCount } from '../../src/main/services/process-runner'
import { bins, dataUrlToBytes, fixtures, jpegSize, sleep } from './helpers'

const tmp = mkdtempSync(join(tmpdir(), 'vc-media-service-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const real = (): LocatedBinaries => locateBinaries()

describe('createMediaService · 基本流程', () => {
  const media = createMediaService({ locate: real })

  it('probe 正常文件', async () => {
    const result = await media.probe(fixtures.normal)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.info.videoStreams[0]?.width).toBe(640)
  })

  it('thumbnail:渲染层只传路径,主进程自己找到探测结果,取到 320 宽的 JPEG', async () => {
    const t = await media.thumbnail(fixtures.normal)
    expect(t.kind).toBe('frame')
    expect(jpegSize(dataUrlToBytes(t.dataUrl, 'image/jpeg')).width).toBe(320)
  })

  it('没有先 probe 就直接要缩略图也能工作(会自己探测)', async () => {
    const fresh = createMediaService({ locate: real })
    const t = await fresh.thumbnail(fixtures.portrait)
    expect(t.kind).toBe('frame')
  })

  it('不存在的文件:probe 给出 FILE_NOT_FOUND,thumbnail 给出占位图,都不抛异常', async () => {
    const p = await media.probe(fixtures.missing)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error.code).toBe('FILE_NOT_FOUND')
    const t = await media.thumbnail(fixtures.missing)
    expect(t.kind).toBe('placeholder')
    expect(t.reason).toBe('extract-failed')
  })

  it('损坏文件:占位图', async () => {
    const t = await media.thumbnail(fixtures.corruptRandom)
    expect(t.kind).toBe('placeholder')
  })

  it('路径含中文和空格', async () => {
    const t = await media.thumbnail(fixtures.chinesePath)
    expect(t.kind).toBe('frame')
  })
})

describe('createMediaService · 探测结果缓存', () => {
  it('缓存命中:同一文件第二次要缩略图时不会再运行 ffprobe', async () => {
    const realBins = real()
    let ffprobeLookups = 0
    // 每次读取 ffprobe 路径就计数;第二次起给一个不存在的路径。
    // 如果缓存没有命中而重新探测,就会得到 FFPROBE_UNAVAILABLE → 占位图
    const media = createMediaService({
      locate: () => ({
        ffmpeg: realBins.ffmpeg,
        get ffprobe() {
          ffprobeLookups += 1
          return ffprobeLookups === 1
            ? realBins.ffprobe
            : { path: join(tmp, 'no-such-ffprobe.exe'), source: 'custom' as const }
        }
      })
    })
    const probed = await media.probe(fixtures.normal)
    expect(probed.ok).toBe(true)
    const t = await media.thumbnail(fixtures.normal)
    expect(t.kind).toBe('frame')
  })

  it('文件被替换后缓存失效:不会拿旧信息给新文件取缩略图', async () => {
    const media = createMediaService({ locate: real })
    const target = join(tmp, 'changing.mp4')
    copyFileSync(fixtures.normal, target)

    expect((await media.probe(target)).ok).toBe(true)
    const before = await media.thumbnail(target)
    expect(before.kind).toBe('frame')
    expect(before.timestampSec).toBeCloseTo(0.3, 2) // 3 秒视频的 10%

    // 同一路径换成另一个有效视频(10 秒)。如果还在用旧的探测结果,取帧时间点会仍然是 0.3 秒;
    // 缓存正确失效后会重新探测,时间点应当是新文件时长的 10%(≈1 秒)。
    // 注意:换成"损坏文件"测不出缓存问题,因为无论缓存是否过期,取帧都会失败。
    copyFileSync(fixtures.colorBands, target)
    const after = await media.thumbnail(target)
    expect(after.kind).toBe('frame')
    expect(after.timestampSec).toBeCloseTo(1, 1)
  })

  it('同一路径换成损坏文件:探测与缩略图都如实失败', async () => {
    const media = createMediaService({ locate: real })
    const target = join(tmp, 'corrupted-later.mp4')
    copyFileSync(fixtures.normal, target)
    expect((await media.probe(target)).ok).toBe(true)
    writeFileSync(target, Buffer.alloc(4096, 7))
    expect((await media.thumbnail(target)).kind).toBe('placeholder')
    expect((await media.probe(target)).ok).toBe(false)
  })

  it('文件被删除后缓存失效', async () => {
    const media = createMediaService({ locate: real })
    const target = join(tmp, 'deleted.mp4')
    copyFileSync(fixtures.normal, target)
    expect((await media.probe(target)).ok).toBe(true)
    rmSync(target)
    expect((await media.thumbnail(target)).kind).toBe('placeholder')
  })
})

describe('createMediaService · 找不到 ffmpeg/ffprobe', () => {
  it('定位失败:probe 给出 FFPROBE_UNAVAILABLE(人话),thumbnail 给出占位图,且只尝试定位一次', async () => {
    let calls = 0
    const media = createMediaService({
      locate: () => {
        calls += 1
        throw new Error('找不到 ffprobe')
      }
    })
    const p = await media.probe(fixtures.normal)
    expect(p.ok).toBe(false)
    if (!p.ok) {
      expect(p.error.code).toBe('FFPROBE_UNAVAILABLE')
      expect(p.error.detail).toContain('找不到 ffprobe')
    }
    expect((await media.thumbnail(fixtures.normal)).kind).toBe('placeholder')
    expect(calls).toBe(1)
  })
})

describe('createMediaService · 并发限制', () => {
  it('一次探测 10 个文件,同时存在的子进程不超过设定的并发数,且全部成功', async () => {
    const limit = 2
    const media = createMediaService({ locate: real, concurrency: limit })
    let peak = 0
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, runningProcessCount())
        await sleep(2)
      }
    })()

    const results = await Promise.all(
      Array.from({ length: 10 }, () => media.probe(fixtures.normal))
    )
    sampling = false
    await sampler

    expect(results.every((r) => r.ok)).toBe(true)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(limit)
  })

  it('probe 与 thumbnail 共用同一个并发额度', async () => {
    const limit = 2
    const media = createMediaService({ locate: real, concurrency: limit })
    let peak = 0
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, runningProcessCount())
        await sleep(2)
      }
    })()
    await Promise.all([
      ...Array.from({ length: 6 }, () => media.probe(fixtures.normal)),
      ...Array.from({ length: 6 }, () => media.thumbnail(fixtures.noAudio))
    ])
    sampling = false
    await sampler
    expect(peak).toBeLessThanOrEqual(limit)
  })
})

describe('二进制来源', () => {
  it('测试用的是内置 ffmpeg/ffprobe(bundled)', () => {
    expect(bins.ffmpeg.source).toBe('bundled')
    expect(bins.ffprobe.source).toBe('bundled')
  })
})
