/**
 * 纯格式化与解析函数,无副作用,不依赖 Electron / Node。
 * 约定:拿不到或不合法的输入统一返回 PLACEHOLDER("—"),界面不需要再做判断。
 */

export const PLACEHOLDER = '—'

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 去掉小数末尾多余的 0:1.50 → "1.5",2.00 → "2" */
function trimZeros(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString()
}

/**
 * 时长 → "m:ss" 或 "h:mm:ss"。
 * 四舍五入到秒;大于 0 但不足 1 秒的显示为 "0:01",避免出现一个明明有内容却是 "0:00" 的文件。
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return PLACEHOLDER
  let total = Math.round(seconds)
  if (total === 0 && seconds > 0) total = 1
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 文件大小,按 1024 进制(与 Windows 资源管理器一致)。 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!isFiniteNumber(bytes) || bytes < 0) return PLACEHOLDER
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  // 数值越小保留的小数越多,保证约 3 位有效数字
  const digitsFor = (v: number): number => (v < 10 ? 2 : v < 100 ? 1 : 0)
  // 进位边界:1048575 B ≈ 1023.999 KB,四舍五入后会变成 "1024 KB",应该直接显示为 "1.00 MB"
  if (Number(value.toFixed(digitsFor(value))) >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(digitsFor(value))} ${SIZE_UNITS[unit]}`
}

/** 码率(bit/s),按 1000 进制(行业惯例):128000 → "128 kbps"。 */
export function formatBitrate(bitsPerSecond: number | null | undefined): string {
  if (!isFiniteNumber(bitsPerSecond) || bitsPerSecond <= 0) return PLACEHOLDER
  // 999_500 起四舍五入到 kbps 会得到 1000,所以提前切换到 Mbps
  if (bitsPerSecond >= 999_500) return `${trimZeros(bitsPerSecond / 1_000_000, 2)} Mbps`
  if (bitsPerSecond >= 1000) return `${Math.round(bitsPerSecond / 1000)} kbps`
  return `${Math.round(bitsPerSecond)} bps`
}

/**
 * 解析 ffprobe 的帧率字符串,如 "30000/1001"、"25/1"、"25"。
 * 分母为 0("0/0")、非数字、负数、0 都视为"未知",返回 null。
 */
export function parseFrameRate(raw: string | number | null | undefined): number | null {
  if (isFiniteNumber(raw)) return raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '' || text.toUpperCase() === 'N/A') return null

  const slash = text.indexOf('/')
  if (slash === -1) {
    const n = Number(text)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const num = Number(text.slice(0, slash))
  const den = Number(text.slice(slash + 1))
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  const value = num / den
  return value > 0 ? value : null
}

/** 帧率显示:最多 3 位小数并去掉多余的 0。30000/1001 → "29.97 fps",25 → "25 fps"。 */
export function formatFrameRate(raw: string | number | null | undefined): string {
  const fps = parseFrameRate(raw)
  return fps === null ? PLACEHOLDER : `${trimZeros(fps, 3)} fps`
}

export function formatResolution(
  width: number | null | undefined,
  height: number | null | undefined
): string {
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    return PLACEHOLDER
  }
  return `${width}×${height}`
}

export function formatSampleRate(hz: number | null | undefined): string {
  if (!isFiniteNumber(hz) || hz <= 0) return PLACEHOLDER
  return `${trimZeros(hz / 1000, 1)} kHz`
}

export function formatChannels(channels: number | null | undefined): string {
  if (!isFiniteNumber(channels) || channels <= 0) return PLACEHOLDER
  switch (channels) {
    case 1:
      return '单声道'
    case 2:
      return '立体声'
    case 6:
      return '5.1 声道'
    case 8:
      return '7.1 声道'
    default:
      return `${channels} 声道`
  }
}

const CONTAINER_LABELS: Array<[RegExp, string]> = [
  [/(^|,)mp4(,|$)/, 'MP4 / MOV'],
  [/(^|,)matroska(,|$)/, 'MKV / WebM'],
  [/(^|,)avi(,|$)/, 'AVI'],
  [/(^|,)flv(,|$)/, 'FLV'],
  [/(^|,)mpegts(,|$)/, 'MPEG-TS'],
  [/(^|,)mpeg(,|$)/, 'MPEG-PS'],
  [/(^|,)gif(,|$)/, 'GIF'],
  [/(^|,)mp3(,|$)/, 'MP3'],
  [/(^|,)ogg(,|$)/, 'Ogg'],
  [/(^|,)wav(,|$)/, 'WAV'],
  [/(^|,)flac(,|$)/, 'FLAC'],
  [/(^|,)h264(,|$)/, 'H.264 裸流'],
  [/(^|,)hevc(,|$)/, 'H.265 裸流']
]

/** 把 ffprobe 的 format_name(逗号分隔的别名列表)转成用户看得懂的容器名。 */
export function formatContainerName(formatName: string | null | undefined): string {
  if (typeof formatName !== 'string' || formatName.trim() === '') return PLACEHOLDER
  const name = formatName.trim().toLowerCase()
  for (const [pattern, label] of CONTAINER_LABELS) {
    if (pattern.test(name)) return label
  }
  const first = name.split(',')[0] ?? name
  return first.toUpperCase()
}

const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'H.265 (HEVC)',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  mjpeg: 'MJPEG',
  gif: 'GIF',
  prores: 'ProRes',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  alac: 'ALAC',
  wmav2: 'WMA'
}

/** 编码名友好化:h264 → "H.264";PCM 家族统一显示为 "PCM";未知编码原样大写。 */
export function formatCodecName(codec: string | null | undefined): string {
  if (typeof codec !== 'string' || codec.trim() === '') return PLACEHOLDER
  const key = codec.trim().toLowerCase()
  if (key.startsWith('pcm_')) return 'PCM'
  return CODEC_LABELS[key] ?? key.toUpperCase()
}
