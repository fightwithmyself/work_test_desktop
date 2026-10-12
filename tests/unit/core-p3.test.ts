import { describe, expect, it } from 'vitest'
import { toUnpackedPath } from '../../src/core/asar-path'
import { createLineSplitter } from '../../src/core/line-splitter'
import { isMediaExtension, sniffMediaHeader } from '../../src/core/media-sniff'
import {
  classifyReadFailure,
  isStillImageFormat,
  makeProbeError
} from '../../src/core/probe-errors'
import {
  buildThumbnailArgs,
  looksLikeJpeg,
  pickThumbnailTime,
  placeholderDataUrl
} from '../../src/core/thumbnail'

/** 把若干数据块依次喂给切行器,返回得到的行。 */
function split(...chunks: string[]): string[] {
  const lines: string[] = []
  const splitter = createLineSplitter((l) => lines.push(l))
  for (const c of chunks) splitter.push(c)
  splitter.flush()
  return lines
}

describe('createLineSplitter', () => {
  it('一个块里有多行', () => {
    expect(split('a\nb\nc\n')).toEqual(['a', 'b', 'c'])
  })

  it('一行被拆成多个块', () => {
    expect(split('he', 'llo\nwor', 'ld\n')).toEqual(['hello', 'world'])
  })

  it('末尾没有换行符的最后一行,在 flush 时输出', () => {
    expect(split('a\nb')).toEqual(['a', 'b'])
  })

  it('\\r\\n、\\n、单独的 \\r 都是行结束符', () => {
    expect(split('a\r\nb\nc\rd\n')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('\\r 与 \\n 被块边界隔开:算一个换行,不产生多余空行', () => {
    expect(split('a\r', '\nb\n')).toEqual(['a', 'b'])
  })

  it('真正的空行会保留', () => {
    expect(split('a\n\nb\n')).toEqual(['a', '', 'b'])
  })

  it('空输入不产生任何行;只有换行符产生一个空行', () => {
    expect(split('')).toEqual([])
    expect(split('', '')).toEqual([])
    expect(split('\n')).toEqual([''])
  })

  it('flush 之后可以继续使用,且不会重复输出', () => {
    const lines: string[] = []
    const s = createLineSplitter((l) => lines.push(l))
    s.push('a')
    s.flush()
    s.flush()
    s.push('b\n')
    expect(lines).toEqual(['a', 'b'])
  })

  it('结尾恰好是 \\r 时,flush 不会把 \\r 当作内容输出', () => {
    expect(split('abc\r')).toEqual(['abc'])
  })
})

describe('toUnpackedPath', () => {
  it('把 app.asar 换成 app.asar.unpacked(Windows 反斜杠)', () => {
    expect(
      toUnpackedPath(
        'C:\\Program Files\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      )
    ).toBe(
      'C:\\Program Files\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    )
  })

  it('正斜杠同样处理', () => {
    expect(toUnpackedPath('/opt/app/resources/app.asar/node_modules/x/ffmpeg')).toBe(
      '/opt/app/resources/app.asar.unpacked/node_modules/x/ffmpeg'
    )
  })

  it('已经是 unpacked 路径:不会重复替换成 app.asar.unpacked.unpacked', () => {
    const p = 'C:\\app\\resources\\app.asar.unpacked\\node_modules\\ffmpeg.exe'
    expect(toUnpackedPath(p)).toBe(p)
  })

  it('开发环境(路径里没有 asar):原样返回', () => {
    const p = 'F:\\agent_study\\work_test\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    expect(toUnpackedPath(p)).toBe(p)
  })

  it('目录名只是长得像(my.asar-tools)不会被误伤', () => {
    const p = 'C:\\tools\\my.asar-tools\\ffmpeg.exe'
    expect(toUnpackedPath(p)).toBe(p)
  })
})

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))

describe('isMediaExtension', () => {
  it.each(['a.mp4', 'a.MP4', 'C:\\x\\a.MkV', 'a.b.webm', 'song.mp3', 'a.mov'])(
    '%s 是媒体扩展名',
    (p) => {
      expect(isMediaExtension(p)).toBe(true)
    }
  )

  it.each([
    'a.txt',
    'a.docx',
    'a.png',
    'noext',
    'a.',
    '',
    'C:\\folder.mp4\\readme',
    'C:\\dir.mp4/file'
  ])('%j 不是媒体扩展名', (p) => {
    expect(isMediaExtension(p)).toBe(false)
  })
})

describe('sniffMediaHeader', () => {
  it('MP4:偏移 4 处是 ftyp', () => {
    expect(sniffMediaHeader(bytes(0, 0, 0, 0x20, ...ascii('ftypisom')))).toBe(true)
  })

  it('MKV/WebM:EBML 魔数', () => {
    expect(sniffMediaHeader(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01))).toBe(true)
  })

  it('AVI 与 WAV:RIFF + 子类型', () => {
    expect(sniffMediaHeader(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('AVI ')))).toBe(true)
    expect(sniffMediaHeader(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBe(true)
  })

  it('RIFF 但子类型不是音视频(如 WEBP 图片)→ 不算', () => {
    expect(sniffMediaHeader(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe(false)
  })

  it.each(['FLV', 'OggS', 'ID3', 'fLaC', 'GIF8'])('%s 开头', (magic) => {
    expect(sniffMediaHeader(bytes(...ascii(magic), 0, 0, 0))).toBe(true)
  })

  it('MPEG-TS:0x47 每隔 188 字节重复', () => {
    const ts = new Uint8Array(400)
    ts[0] = 0x47
    ts[188] = 0x47
    expect(sniffMediaHeader(ts)).toBe(true)
    ts[188] = 0
    expect(sniffMediaHeader(ts)).toBe(false)
  })

  it('文本、随机字节、太短的数据 → 不算', () => {
    expect(sniffMediaHeader(bytes(...ascii('this is plain text')))).toBe(false)
    expect(sniffMediaHeader(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8))).toBe(false)
    expect(sniffMediaHeader(bytes())).toBe(false)
    expect(sniffMediaHeader(bytes(1, 2, 3))).toBe(false)
  })
})

describe('classifyReadFailure:损坏 还是 不是视频', () => {
  const text = bytes(...ascii('hello world, plain text'))
  const mp4Head = bytes(0, 0, 0, 0x20, ...ascii('ftypisom'))

  it('文件头像 mp4,但读不出来 → CORRUPT(即使扩展名被改过)', () => {
    expect(
      classifyReadFailure({
        filePath: 'C:\\a\\x.dat',
        stderr: 'moov atom not found',
        header: mp4Head
      }).code
    ).toBe('CORRUPT')
  })

  it('扩展名是 .mp4,内容却无法识别 → CORRUPT', () => {
    expect(
      classifyReadFailure({ filePath: 'C:\\a\\x.mp4', stderr: 'Invalid data', header: text }).code
    ).toBe('CORRUPT')
  })

  it('扩展名和内容都不像媒体 → NOT_MEDIA', () => {
    expect(
      classifyReadFailure({ filePath: 'C:\\a\\notes.txt', stderr: 'Invalid data', header: text })
        .code
    ).toBe('NOT_MEDIA')
  })

  it('读不到文件头(null)时只看扩展名', () => {
    expect(classifyReadFailure({ filePath: 'a.mkv', stderr: '', header: null }).code).toBe(
      'CORRUPT'
    )
    expect(classifyReadFailure({ filePath: 'a.txt', stderr: '', header: null }).code).toBe(
      'NOT_MEDIA'
    )
  })

  it('权限错误、文件不存在的报错优先于"像不像媒体"', () => {
    expect(
      classifyReadFailure({
        filePath: 'a.mp4',
        stderr: 'a.mp4: Permission denied',
        header: mp4Head
      }).code
    ).toBe('NO_PERMISSION')
    expect(
      classifyReadFailure({
        filePath: 'a.mp4',
        stderr: 'x: No such file or directory',
        header: mp4Head
      }).code
    ).toBe('FILE_NOT_FOUND')
  })

  it('detail 只保留 stderr 末尾 400 个字符,且去掉首尾空白;为空时是 null', () => {
    const long = 'x'.repeat(1000) + 'END'
    const err = makeProbeError('UNKNOWN', `  ${long}  `)
    expect(err.detail!.length).toBe(400)
    expect(err.detail!.endsWith('END')).toBe(true)
    expect(makeProbeError('UNKNOWN', '   ').detail).toBeNull()
    expect(makeProbeError('UNKNOWN').detail).toBeNull()
  })

  it('每种错误码都有非空的中文提示', () => {
    const codes = [
      'INVALID_PATH',
      'FILE_NOT_FOUND',
      'NOT_A_FILE',
      'EMPTY_FILE',
      'NO_PERMISSION',
      'NOT_MEDIA',
      'CORRUPT',
      'TIMEOUT',
      'FFPROBE_UNAVAILABLE',
      'UNKNOWN'
    ] as const
    const messages = codes.map((c) => makeProbeError(c).message)
    expect(messages.every((m) => /[\u4e00-\u9fa5]/.test(m))).toBe(true)
    expect(new Set(messages).size).toBe(codes.length) // 没有两个错误共用同一句话
  })
})

describe('isStillImageFormat', () => {
  it.each(['png_pipe', 'jpeg_pipe', 'bmp_pipe', 'webp_pipe', 'image2', 'ico'])(
    '%s 是图片',
    (name) => {
      expect(isStillImageFormat(name)).toBe(true)
    }
  )

  it.each(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm', 'gif', 'mp3', null])(
    '%s 不是图片',
    (name) => {
      expect(isStillImageFormat(name)).toBe(false)
    }
  )
})

describe('pickThumbnailTime', () => {
  it.each([
    [null, 0], // 时长未知 → 第 0 帧
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [0, 0],
    [0.3, 0], // 极短
    [0.999, 0],
    [1, 0.1], // 刚好 1 秒:开始取 10% 处
    [3, 0.3],
    [10.04, 1.004],
    [600, 60],
    [7200, 720]
  ])('时长 %s → 取帧 %s 秒', (duration, expected) => {
    expect(pickThumbnailTime(duration)).toBe(expected)
  })
})

describe('buildThumbnailArgs', () => {
  const args = buildThumbnailArgs({ inputPath: 'C:\\视频 目录\\a b.mp4', timestampSec: 5.5 })

  it('-ss 放在 -i 之前(输入级 seek,速度快)', () => {
    expect(args.indexOf('-ss')).toBeGreaterThanOrEqual(0)
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('5.5')
  })

  it('路径作为独立的一个参数原样传入,不拼接、不加引号', () => {
    expect(args[args.indexOf('-i') + 1]).toBe('C:\\视频 目录\\a b.mp4')
  })

  it('只抽一帧、宽度 320 且不放大、输出 JPEG 到 stdout、不读 stdin', () => {
    expect(args).toContain('-nostdin')
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1')
    expect(args[args.indexOf('-vf') + 1]).toContain('min(320,iw)')
    expect(args[args.indexOf('-vf') + 1]).toContain('h=-2')
    expect(args.slice(-3)).toEqual(['-f', 'mjpeg', 'pipe:1'])
  })

  it('取第 0 帧(0 或 null)时不加 -ss', () => {
    expect(buildThumbnailArgs({ inputPath: 'x.mp4', timestampSec: 0 })).not.toContain('-ss')
    expect(buildThumbnailArgs({ inputPath: 'x.mp4', timestampSec: null })).not.toContain('-ss')
  })

  it('可以自定义宽度', () => {
    const a = buildThumbnailArgs({ inputPath: 'x.mp4', timestampSec: 0, width: 160 })
    expect(a[a.indexOf('-vf') + 1]).toContain('min(160,iw)')
  })
})

describe('缩略图辅助', () => {
  it('looksLikeJpeg:以 FFD8 开头且不是空壳', () => {
    const jpeg = new Uint8Array(500)
    jpeg[0] = 0xff
    jpeg[1] = 0xd8
    expect(looksLikeJpeg(jpeg)).toBe(true)
    expect(looksLikeJpeg(jpeg.subarray(0, 50))).toBe(false) // 太短
    expect(looksLikeJpeg(new Uint8Array(500))).toBe(false) // 没有魔数
    expect(looksLikeJpeg(null)).toBe(false)
  })

  it('placeholderDataUrl:是合法的 SVG data URL,音频与视频图标不同', () => {
    const video = placeholderDataUrl('video')
    const audio = placeholderDataUrl('audio')
    expect(video.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(video)).toContain('<svg')
    expect(video).not.toBe(audio)
  })
})
