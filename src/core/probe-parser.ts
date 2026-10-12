import type { AudioStreamInfo, Rotation, VideoInfo, VideoStreamInfo } from '../shared/types'
import { parseFrameRate } from './format-utils'

/** 探测时传给 ffprobe 的参数(不含文件路径)。probe-service 与测试样本生成脚本都应与它保持一致。 */
export const FFPROBE_JSON_ARGS = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams'
] as const

type Rec = Record<string, unknown>

// ---------- 宽容的取值工具:任何输入都不会抛异常 ----------

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const asRecord = (v: unknown): Rec => (isRecord(v) ? v : {})
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 数字或数字字符串 → number;"N/A"、空串、非数字、Infinity 一律 null。 */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const text = v.trim()
  if (text === '' || text.toUpperCase() === 'N/A') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** 严格大于 0 的数,用于时长、码率、采样率、宽高等"0 就等于没有"的字段。 */
function toPositive(v: unknown): number | null {
  const n = toNumber(v)
  return n !== null && n > 0 ? n : null
}

function toNonNegativeInt(v: unknown): number | null {
  const n = toNumber(v)
  return n !== null && n >= 0 ? Math.trunc(n) : null
}

/** 非空字符串 → 去首尾空白;"N/A" 视为没有。 */
function toStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const text = v.trim()
  return text === '' || text.toUpperCase() === 'N/A' ? null : text
}

/** 大小写不敏感地读取 tags(MKV 用 DURATION,其他容器可能是 duration)。 */
function tagValue(tags: unknown, name: string): string | null {
  const rec = asRecord(tags)
  const target = name.toLowerCase()
  for (const key of Object.keys(rec)) {
    if (key.toLowerCase() === target) return toStr(rec[key])
  }
  return null
}

/** 解析 "HH:MM:SS.fffffffff"(MKV/WebM 流 tags 里的 DURATION)。 */
export function parseClockDuration(text: string | null): number | null {
  if (text === null) return null
  const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return null
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

// ---------- 旋转 ----------

/** 任意角度 → 0/90/180/270;非 90 倍数(元数据异常)按 0 处理。 */
export function normalizeRotation(clockwiseDegrees: number): Rotation {
  const rounded = Math.round(clockwiseDegrees)
  const mod = ((rounded % 360) + 360) % 360
  return mod === 90 || mod === 180 || mod === 270 ? mod : 0
}

/**
 * 读取"为了正确显示需要顺时针旋转的角度"。
 *
 * 已用 ffmpeg 自动旋转的实际输出逐像素比对验证(见 DECISIONS D-014):
 * - side_data_list 里的 rotation 是【逆时针】角度(ffprobe 报 90 ⇒ 画面需逆时针转 90°),取反换算为顺时针
 * - 旧式 tags.rotate 是【顺时针】角度,直接使用
 */
function readRotation(stream: Rec): Rotation {
  for (const item of asArray(stream['side_data_list'])) {
    const ccw = toNumber(asRecord(item)['rotation'])
    if (ccw !== null) return normalizeRotation(-ccw)
  }
  const tag = toNumber(tagValue(stream['tags'], 'rotate'))
  return tag !== null ? normalizeRotation(tag) : 0
}

// ---------- 流解析 ----------

const isAttachedPic = (stream: Rec): boolean =>
  Number(asRecord(stream['disposition'])['attached_pic']) === 1

function readStreamDuration(stream: Rec): number | null {
  return toPositive(stream['duration']) ?? parseClockDuration(tagValue(stream['tags'], 'DURATION'))
}

function parseVideoStream(stream: Rec, position: number): VideoStreamInfo {
  const width = toPositive(stream['width'])
  const height = toPositive(stream['height'])
  const rotation = readRotation(stream)
  const swap = rotation === 90 || rotation === 270
  return {
    index: toNonNegativeInt(stream['index']) ?? position,
    codec: toStr(stream['codec_name']) ?? 'unknown',
    codecLongName: toStr(stream['codec_long_name']),
    profile: toStr(stream['profile']),
    pixelFormat: toStr(stream['pix_fmt']),
    width,
    height,
    displayWidth: swap ? height : width,
    displayHeight: swap ? width : height,
    frameRate:
      parseFrameRate(toStr(stream['avg_frame_rate'])) ??
      parseFrameRate(toStr(stream['r_frame_rate'])),
    bitRate: toPositive(stream['bit_rate']),
    durationSec: readStreamDuration(stream),
    rotation
  }
}

function parseAudioStream(stream: Rec, position: number): AudioStreamInfo {
  const language = tagValue(stream['tags'], 'language')
  return {
    index: toNonNegativeInt(stream['index']) ?? position,
    codec: toStr(stream['codec_name']) ?? 'unknown',
    codecLongName: toStr(stream['codec_long_name']),
    channels: toPositive(stream['channels']),
    channelLayout: toStr(stream['channel_layout']),
    sampleRate: toPositive(stream['sample_rate']),
    bitRate: toPositive(stream['bit_rate']),
    durationSec: readStreamDuration(stream),
    language: language === null || language.toLowerCase() === 'und' ? null : language,
    title: tagValue(stream['tags'], 'title')
  }
}

// ---------- 入口 ----------

/**
 * 把 `ffprobe -print_format json -show_format -show_streams` 的输出解析为 VideoInfo。
 *
 * 保证:任何输入(包括 null、数组、字段类型错误)都不会抛异常,拿不到的字段为 null / 空数组。
 * 注意:本函数不判断"这是不是一个有效视频",调用方应检查 hasVideo || hasAudio。
 */
export function parseProbeOutput(raw: unknown): VideoInfo {
  const root = asRecord(raw)
  const format = asRecord(root['format'])

  const videoStreams: VideoStreamInfo[] = []
  const audioStreams: AudioStreamInfo[] = []
  let subtitleStreamCount = 0
  let hasCoverArt = false

  asArray(root['streams']).forEach((item, position) => {
    if (!isRecord(item)) return
    switch (item['codec_type']) {
      case 'video':
        // 封面图(attached_pic)技术上是视频流,但不是用户眼中的"视频"
        if (isAttachedPic(item)) hasCoverArt = true
        else videoStreams.push(parseVideoStream(item, position))
        break
      case 'audio':
        audioStreams.push(parseAudioStream(item, position))
        break
      case 'subtitle':
        subtitleStreamCount++
        break
      default:
        break // data / attachment 等流忽略
    }
  })

  // 时长:容器 → 流(取最长) → null
  const streamDurations = [...videoStreams, ...audioStreams]
    .map((s) => s.durationSec)
    .filter((d): d is number => d !== null)
  const durationSec =
    toPositive(format['duration']) ??
    (streamDurations.length > 0 ? Math.max(...streamDurations) : null)

  const sizeBytes = toNonNegativeInt(format['size'])

  // 总码率:容器给了就用;没有则用 大小 / 时长 估算
  let bitRate = toPositive(format['bit_rate'])
  if (bitRate === null && sizeBytes !== null && sizeBytes > 0 && durationSec !== null) {
    bitRate = Math.round((sizeBytes * 8) / durationSec)
  }

  return {
    formatName: toStr(format['format_name']),
    formatLongName: toStr(format['format_long_name']),
    durationSec,
    sizeBytes,
    bitRate,
    videoStreams,
    audioStreams,
    subtitleStreamCount,
    hasCoverArt,
    hasVideo: videoStreams.length > 0,
    hasAudio: audioStreams.length > 0,
    rotation: videoStreams[0]?.rotation ?? 0
  }
}
