/**
 * 视频信息领域类型。
 *
 * 约定:
 * - 所有"拿不到/不可信"的数值一律用 null 表示,而不是 0 或 NaN,界面据此显示 "—"。
 * - 时间单位为秒,码率单位为 bit/s,大小单位为字节。
 */

/** 为了正确显示需要"顺时针"旋转的角度。 */
export type Rotation = 0 | 90 | 180 | 270

export interface VideoStreamInfo {
  /** 流在容器里的序号(ffmpeg 的 -map 0:<index> 用) */
  index: number
  codec: string
  codecLongName: string | null
  profile: string | null
  pixelFormat: string | null
  /** 编码层面的原始宽高(未考虑旋转) */
  width: number | null
  height: number | null
  /** 考虑旋转后,用户实际看到的宽高 */
  displayWidth: number | null
  displayHeight: number | null
  frameRate: number | null
  bitRate: number | null
  durationSec: number | null
  rotation: Rotation
}

export interface AudioStreamInfo {
  index: number
  codec: string
  codecLongName: string | null
  channels: number | null
  channelLayout: string | null
  sampleRate: number | null
  bitRate: number | null
  durationSec: number | null
  /** ISO 639 语言码;"und"(未定义)会被归一为 null */
  language: string | null
  title: string | null
}

export interface VideoInfo {
  /** ffprobe 的 format_name,如 "mov,mp4,m4a,3gp,3g2,mj2" */
  formatName: string | null
  formatLongName: string | null
  /** 总时长。容器没有给出时,依次回退到流时长、流 tags 里的 DURATION */
  durationSec: number | null
  sizeBytes: number | null
  /** 总码率。容器没有给出时,若大小和时长都有则估算 */
  bitRate: number | null

  /** 真正的视频流(不含封面图) */
  videoStreams: VideoStreamInfo[]
  audioStreams: AudioStreamInfo[]
  subtitleStreamCount: number

  /** 存在封面图流(attached_pic),例如 mp3/m4a 的专辑封面 */
  hasCoverArt: boolean
  hasVideo: boolean
  hasAudio: boolean
  /** 主视频流(第一条真正的视频流)的旋转角度,没有视频时为 0 */
  rotation: Rotation
}

// ---------- 探测错误(可序列化,会通过 IPC 传给渲染层)----------

export type ProbeErrorCode =
  | 'INVALID_PATH' // 不是绝对路径
  | 'FILE_NOT_FOUND'
  | 'NOT_A_FILE' // 是目录等
  | 'EMPTY_FILE' // 0 字节
  | 'NO_PERMISSION'
  | 'NOT_MEDIA' // 不是音视频文件(文本、图片、其他格式)
  | 'CORRUPT' // 看起来是音视频文件,但已损坏或不完整
  | 'TIMEOUT'
  | 'FFPROBE_UNAVAILABLE' // ffprobe 本身无法运行
  | 'UNKNOWN'

export interface ProbeError {
  code: ProbeErrorCode
  /** 给用户看的人话 */
  message: string
  /** 给开发者排错用的原始信息(ffprobe stderr 的末尾),可能为 null */
  detail: string | null
}

export type ProbeResult = { ok: true; info: VideoInfo } | { ok: false; error: ProbeError }

// ---------- 缩略图 ----------

export type ThumbnailKind =
  | 'frame' // 从视频里抽出的一帧
  | 'cover' // 音频文件的内嵌封面
  | 'placeholder' // 占位图

export interface Thumbnail {
  kind: ThumbnailKind
  /** 可直接用于 <img src> 的 data URL(JPEG 或 SVG) */
  dataUrl: string
  /** 抽帧位置(秒);封面和占位图为 null */
  timestampSec: number | null
  /** 为什么是占位图:没有可视内容 / 抽帧失败 */
  reason: 'no-visual' | 'extract-failed' | null
}
