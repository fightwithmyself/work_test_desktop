import type { ProbeError, ProbeErrorCode } from '../shared/types'
import { isMediaExtension, sniffMediaHeader } from './media-sniff'

/** 每种错误面向用户的说明。文案集中放这里,界面层不用再拼。 */
const MESSAGES: Record<ProbeErrorCode, string> = {
  INVALID_PATH: '文件路径无效。',
  FILE_NOT_FOUND: '找不到这个文件,它可能已被移动或删除。',
  NOT_A_FILE: '这是一个文件夹,不是视频文件。',
  EMPTY_FILE: '这个文件是空的(0 字节),无法读取。',
  NO_PERMISSION: '没有权限读取这个文件,请检查文件是否被占用或权限设置。',
  NOT_MEDIA: '这不是视频或音频文件,或者它的格式暂不支持。',
  CORRUPT: '这个文件已损坏或不完整,无法读取视频信息。',
  TIMEOUT: '读取文件信息超时。如果文件在网络位置或移动硬盘上,请复制到本地后重试。',
  FFPROBE_UNAVAILABLE: '视频分析组件无法运行,请检查设置中的 ffmpeg 路径,或重新安装应用。',
  UNKNOWN: '读取视频信息时出现未知错误。'
}

const DETAIL_MAX = 400

export function makeProbeError(code: ProbeErrorCode, detail: string | null = null): ProbeError {
  const trimmed = detail?.trim() ?? ''
  return {
    code,
    message: MESSAGES[code],
    detail: trimmed === '' ? null : trimmed.slice(-DETAIL_MAX)
  }
}

export interface FailureEvidence {
  filePath: string
  stderr: string
  /** 文件开头的若干字节;读不到时为 null */
  header: Uint8Array | null
}

/**
 * ffprobe 失败(或读到了但什么流都没有)时,判断到底是"不是媒体文件"还是"文件损坏"。
 *
 * 规则:
 * 1. 明确的权限 / 不存在错误优先
 * 2. 文件头像音视频,或者扩展名是音视频扩展名 → 损坏
 *    (例如写满随机字节的 .mp4:用户眼里它就是"一个坏掉的视频")
 * 3. 其余 → 不是媒体文件(例如 .txt、.docx)
 */
export function classifyReadFailure(evidence: FailureEvidence): ProbeError {
  const { filePath, stderr, header } = evidence
  if (/permission denied|access is denied/i.test(stderr))
    return makeProbeError('NO_PERMISSION', stderr)
  if (/no such file or directory/i.test(stderr)) return makeProbeError('FILE_NOT_FOUND', stderr)

  const looksLikeMedia = (header !== null && sniffMediaHeader(header)) || isMediaExtension(filePath)
  return makeProbeError(looksLikeMedia ? 'CORRUPT' : 'NOT_MEDIA', stderr)
}

/** 单张图片(jpg/png/bmp 等)ffprobe 也能读出来,但它不是用户要转换的"视频"。 */
export function isStillImageFormat(formatName: string | null): boolean {
  if (formatName === null) return false
  return formatName
    .split(',')
    .some((name) => name === 'image2' || name === 'ico' || name.endsWith('_pipe'))
}
