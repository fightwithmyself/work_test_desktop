import { stat } from 'node:fs/promises'
import { createLimiter } from '../../core/limiter'
import { makeProbeError } from '../../core/probe-errors'
import { placeholderDataUrl } from '../../core/thumbnail'
import type { ProbeResult, Thumbnail, VideoInfo } from '../../shared/types'
import { locateBinaries, type LocatedBinaries } from './ffmpeg-locator'
import { probeFile } from './probe-service'
import { generateThumbnail } from './thumbnail-service'

export interface MediaService {
  probe(filePath: string): Promise<ProbeResult>
  thumbnail(filePath: string): Promise<Thumbnail>
}

export interface MediaServiceOptions {
  /** 定位 ffmpeg/ffprobe;默认用内置版本。测试可注入。 */
  locate?: () => LocatedBinaries
  /** 同时运行的 ffprobe/ffmpeg 进程数上限 */
  concurrency?: number
}

interface CacheEntry {
  sizeBytes: number
  mtimeMs: number
  info: VideoInfo
}

const CACHE_LIMIT = 500

/**
 * 面向 IPC 的媒体服务:把定位二进制、并发限制、探测结果缓存组合在一起。
 *
 * - 并发限制:一次拖入几十个文件时,同时最多跑 N 个子进程,界面和磁盘都不会被拖垮
 * - 缓存:缩略图需要 VideoInfo(时长、旋转等),渲染层不必(也不应该)把 info 传回主进程;
 *   主进程按 路径+大小+修改时间 缓存探测结果,文件被改动后自动失效
 * - 永不抛异常:所有失败都变成结构化结果
 */
export function createMediaService(options: MediaServiceOptions = {}): MediaService {
  const locate = options.locate ?? ((): LocatedBinaries => locateBinaries())
  const limit = createLimiter(options.concurrency ?? 3)
  const cache = new Map<string, CacheEntry>()

  let binaries: LocatedBinaries | null = null
  let locateError: string | null = null

  const getBinaries = (): LocatedBinaries | null => {
    if (binaries) return binaries
    if (locateError !== null) return null
    try {
      binaries = locate()
      return binaries
    } catch (err) {
      locateError = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  const fileKey = async (
    filePath: string
  ): Promise<{ sizeBytes: number; mtimeMs: number } | null> => {
    try {
      const s = await stat(filePath)
      return s.isFile() ? { sizeBytes: s.size, mtimeMs: s.mtimeMs } : null
    } catch {
      return null
    }
  }

  const remember = (
    filePath: string,
    key: { sizeBytes: number; mtimeMs: number },
    info: VideoInfo
  ): void => {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(filePath, { ...key, info })
  }

  const cachedInfo = async (filePath: string): Promise<VideoInfo | null> => {
    const hit = cache.get(filePath)
    if (!hit) return null
    const key = await fileKey(filePath)
    if (key && key.sizeBytes === hit.sizeBytes && key.mtimeMs === hit.mtimeMs) return hit.info
    cache.delete(filePath)
    return null
  }

  const probe = (filePath: string): Promise<ProbeResult> =>
    limit(async (): Promise<ProbeResult> => {
      const bins = getBinaries()
      if (!bins) return { ok: false, error: makeProbeError('FFPROBE_UNAVAILABLE', locateError) }

      const key = await fileKey(filePath)
      const result = await probeFile(filePath, { ffprobePath: bins.ffprobe.path })
      if (result.ok && key) remember(filePath, key, result.info)
      return result
    })

  const fallback = (reason: 'no-visual' | 'extract-failed'): Thumbnail => ({
    kind: 'placeholder',
    dataUrl: placeholderDataUrl('video'),
    timestampSec: null,
    reason
  })

  const thumbnail = async (filePath: string): Promise<Thumbnail> => {
    let info = await cachedInfo(filePath)
    if (!info) {
      const probed = await probe(filePath)
      if (!probed.ok) return fallback('extract-failed')
      info = probed.info
    }
    const knownInfo = info
    return limit(async () => {
      const bins = getBinaries()
      if (!bins) return fallback('extract-failed')
      return generateThumbnail(filePath, knownInfo, { ffmpegPath: bins.ffmpeg.path })
    })
  }

  return { probe, thumbnail }
}
