/**
 * 根据"扩展名"和"文件头"判断一个文件"看起来像不像媒体文件"。
 *
 * 用途:ffprobe 读取失败时,区分
 * - 看起来是视频/音频但读不出来 → 文件损坏(CORRUPT)
 * - 压根就不是视频/音频          → 不是媒体文件(NOT_MEDIA)
 */

const MEDIA_EXTENSIONS = new Set([
  // 视频
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'flv',
  'wmv',
  'asf',
  'ts',
  'm2ts',
  'mts',
  'mpg',
  'mpeg',
  'vob',
  '3gp',
  '3g2',
  'ogv',
  'mxf',
  'rm',
  'rmvb',
  'gif',
  // 音频
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'opus',
  'wma',
  'ac3',
  'amr'
])

export function isMediaExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return false
  // 扩展名之后不能再有路径分隔符,否则是 "目录.mp4/文件" 这种情况
  const ext = filePath.slice(dot + 1)
  if (/[\\/]/.test(ext)) return false
  return MEDIA_EXTENSIONS.has(ext.toLowerCase())
}

const startsWith = (bytes: Uint8Array, offset: number, signature: number[]): boolean =>
  signature.every((b, i) => bytes[offset + i] === b)

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))

/** 文件头是否匹配常见音视频容器的魔数。只是"像",不保证完整可播放。 */
export function sniffMediaHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  // MP4 / MOV / 3GP:偏移 4 处是 "ftyp"(部分旧 MOV 是 moov / mdat / wide / free)
  if (bytes.length >= 8) {
    for (const tag of ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip']) {
      if (startsWith(bytes, 4, ascii(tag))) return true
    }
  }
  if (startsWith(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return true // Matroska / WebM (EBML)
  if (startsWith(bytes, 0, ascii('RIFF')) && bytes.length >= 12) {
    if (startsWith(bytes, 8, ascii('AVI ')) || startsWith(bytes, 8, ascii('WAVE'))) return true
  }
  if (startsWith(bytes, 0, ascii('FLV'))) return true
  if (startsWith(bytes, 0, ascii('OggS'))) return true
  if (startsWith(bytes, 0, ascii('ID3'))) return true // MP3 的 ID3 标签
  if (startsWith(bytes, 0, ascii('fLaC'))) return true
  if (startsWith(bytes, 0, ascii('GIF8'))) return true
  if (startsWith(bytes, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return true // ASF/WMV
  if (startsWith(bytes, 0, [0x00, 0x00, 0x01, 0xba])) return true // MPEG-PS
  if (startsWith(bytes, 0, [0x00, 0x00, 0x01, 0xb3])) return true // MPEG 视频序列
  // MPEG-TS:同步字节 0x47 每 188 字节重复
  if (bytes.length > 188 && bytes[0] === 0x47 && bytes[188] === 0x47) return true
  return false
}
