import {
  buildThumbnailArgs,
  looksLikeJpeg,
  pickThumbnailTime,
  placeholderDataUrl
} from '../../core/thumbnail'
import type { Thumbnail, VideoInfo } from '../../shared/types'
import { runProcess } from './process-runner'

export interface ThumbnailDeps {
  ffmpegPath: string
  /** 单次抽帧的超时,默认 20 秒 */
  timeoutMs?: number
}

const toJpegDataUrl = (bytes: Uint8Array): string =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`

/** 尝试在指定位置抽一帧。拿不到像样的 JPEG 就返回 null(不抛异常)。 */
async function extractFrame(
  filePath: string,
  timestampSec: number | null,
  deps: ThumbnailDeps
): Promise<Uint8Array | null> {
  try {
    const run = await runProcess(
      deps.ffmpegPath,
      buildThumbnailArgs({ inputPath: filePath, timestampSec }),
      {
        stdout: 'buffer',
        timeoutMs: deps.timeoutMs ?? 20_000
      }
    ).result
    // 注意:seek 到文件末尾之外时 ffmpeg 可能退出码为 0 但什么都没输出,所以要检查内容而不只是退出码
    if (run.exitCode === 0 && looksLikeJpeg(run.stdoutBuffer)) return run.stdoutBuffer
    return null
  } catch {
    return null
  }
}

/**
 * 生成缩略图。永远返回一个可显示的结果,不会抛异常也不会返回失败:
 *
 * - 有视频流:取时长 10% 处的帧(极短视频取第 0 帧);该位置取不到则退回第 0 帧
 * - 只有封面图的音频(如带专辑封面的 mp3):取封面
 * - 其他(纯音频、没有可视内容):占位图
 * - 以上任何一种抽取失败:占位图,reason 为 extract-failed
 */
export async function generateThumbnail(
  filePath: string,
  info: VideoInfo,
  deps: ThumbnailDeps
): Promise<Thumbnail> {
  const placeholder = (reason: 'no-visual' | 'extract-failed'): Thumbnail => ({
    kind: 'placeholder',
    dataUrl: placeholderDataUrl(info.hasVideo ? 'video' : 'audio'),
    timestampSec: null,
    reason
  })

  if (info.hasVideo) {
    const target = pickThumbnailTime(info.durationSec)
    let bytes = await extractFrame(filePath, target, deps)
    let usedTime = target
    if (bytes === null && target > 0) {
      bytes = await extractFrame(filePath, 0, deps)
      usedTime = 0
    }
    if (bytes === null) return placeholder('extract-failed')
    return { kind: 'frame', dataUrl: toJpegDataUrl(bytes), timestampSec: usedTime, reason: null }
  }

  if (info.hasCoverArt) {
    const bytes = await extractFrame(filePath, null, deps)
    if (bytes === null) return placeholder('extract-failed')
    return { kind: 'cover', dataUrl: toJpegDataUrl(bytes), timestampSec: null, reason: null }
  }

  return placeholder('no-visual')
}
