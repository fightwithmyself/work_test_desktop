/** 缩略图相关的纯逻辑:取帧时间、ffmpeg 参数、占位图。 */

export const THUMBNAIL_WIDTH = 320
/** 短于这个时长的视频直接取第 0 帧:太短时 10% 处可能已经接近结尾,seek 容易拿不到帧。 */
export const SHORT_VIDEO_SECONDS = 1
export const THUMBNAIL_POSITION = 0.1

/**
 * 决定从哪一秒取帧:
 * - 时长未知或极短(< 1 秒)→ 第 0 帧
 * - 否则取时长的 10% 处,避开常见的黑屏片头
 */
export function pickThumbnailTime(durationSec: number | null): number {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec < SHORT_VIDEO_SECONDS) {
    return 0
  }
  return Math.round(durationSec * THUMBNAIL_POSITION * 1000) / 1000
}

export interface ThumbnailArgsInput {
  inputPath: string
  /** 抽帧位置;为 0 或 null 时不加 -ss */
  timestampSec: number | null
  width?: number
}

/**
 * 构建抽取一帧 JPEG 并写到 stdout 的 ffmpeg 参数(不含可执行文件本身)。
 *
 * - `-ss` 放在 `-i` 之前:输入级 seek,直接跳到附近的关键帧,比放在后面快得多
 * - 缩放用 min(width, iw):原视频比 320 窄时不放大
 * - 高度用 -2:保持比例且为偶数;ffmpeg 会先按旋转元数据自动旋转,所以竖屏视频显示方向正确
 * - format=yuvj420p:保证 10-bit 等源也能输出标准 JPEG
 * - 全程数组参数,不经过 shell
 */
export function buildThumbnailArgs(input: ThumbnailArgsInput): string[] {
  const width = input.width ?? THUMBNAIL_WIDTH
  const args = ['-hide_banner', '-v', 'error', '-nostdin']
  if (input.timestampSec !== null && input.timestampSec > 0) {
    args.push('-ss', String(input.timestampSec))
  }
  args.push(
    '-i',
    input.inputPath,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-frames:v',
    '1',
    '-vf',
    `scale=w='min(${width},iw)':h=-2,format=yuvj420p`,
    '-q:v',
    '3',
    '-f',
    'mjpeg',
    'pipe:1'
  )
  return args
}

/** 一段输出是不是一个像样的 JPEG(以 FFD8 开头,且不是几十字节的空壳)。 */
export function looksLikeJpeg(bytes: Uint8Array | null): bytes is Uint8Array {
  return bytes !== null && bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8
}

/** 没有可视内容(音频)或抽帧失败时显示的占位图,内联 SVG,不需要任何外部资源。 */
export function placeholderDataUrl(kind: 'audio' | 'video'): string {
  const icon =
    kind === 'audio'
      ? // 音符
        '<circle cx="146" cy="116" r="14" fill="#bfbfbf"/><circle cx="188" cy="104" r="14" fill="#bfbfbf"/>' +
        '<rect x="156" y="58" width="6" height="58" fill="#bfbfbf"/><rect x="198" y="46" width="6" height="58" fill="#bfbfbf"/>' +
        '<path d="M156 58 L204 46 L204 62 L156 74 Z" fill="#bfbfbf"/>'
      : // 播放三角
        '<path d="M140 56 L204 90 L140 124 Z" fill="#bfbfbf"/>'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="180" viewBox="0 0 ${THUMBNAIL_WIDTH} 180">` +
    `<rect width="100%" height="100%" fill="#f0f0f0"/>${icon}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
