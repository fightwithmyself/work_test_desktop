import { describe, expect, it } from 'vitest'
import {
  PLACEHOLDER,
  formatBitrate,
  formatChannels,
  formatCodecName,
  formatContainerName,
  formatDuration,
  formatFileSize,
  formatFrameRate,
  formatResolution,
  formatSampleRate,
  parseFrameRate
} from '../../src/core/format-utils'

const BAD_NUMBERS = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [3, '0:03'],
    [59, '0:59'],
    [61, '1:01'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3723.4, '1:02:03'],
    [36000, '10:00:00']
  ])('%s 秒 → %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })

  it('四舍五入到秒,浮点误差不会少一秒(2.9999999 → 0:03)', () => {
    expect(formatDuration(2.9999999)).toBe('0:03')
    expect(formatDuration(59.6)).toBe('1:00')
  })

  it('大于 0 但不足 1 秒的显示 0:01,而不是 0:00', () => {
    expect(formatDuration(0.3)).toBe('0:01')
  })

  it.each(BAD_NUMBERS)('非法输入 %s → 占位符', (input) => {
    expect(formatDuration(input)).toBe(PLACEHOLDER)
  })
})

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [51236, '50.0 KB'],
    [1024 * 1024, '1.00 MB'],
    [123 * 1024 * 1024, '123 MB'],
    [5 * 1024 ** 3, '5.00 GB'],
    [2 * 1024 ** 4, '2.00 TB']
  ])('%s 字节 → %s', (input, expected) => {
    expect(formatFileSize(input)).toBe(expected)
  })

  it('进位边界:差 1 字节满 1 MB 时显示 1.00 MB,而不是 1024 KB', () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1.00 MB')
    expect(formatFileSize(1024 ** 3 - 1)).toBe('1.00 GB')
  })

  it('超过最大单位时不越界', () => {
    expect(formatFileSize(1024 ** 5)).toBe('1024 TB')
  })

  it.each(BAD_NUMBERS)('非法输入 %s → 占位符', (input) => {
    expect(formatFileSize(input)).toBe(PLACEHOLDER)
  })
})

describe('formatBitrate', () => {
  it.each([
    [800, '800 bps'],
    [128_000, '128 kbps'],
    [136_629, '137 kbps'],
    [999_400, '999 kbps'],
    [1_000_000, '1 Mbps'],
    [2_500_000, '2.5 Mbps'],
    [8_123_456, '8.12 Mbps']
  ])('%s bps → %s', (input, expected) => {
    expect(formatBitrate(input)).toBe(expected)
  })

  it('进位边界:999999 bps 显示 1 Mbps,而不是 1000 kbps', () => {
    expect(formatBitrate(999_999)).toBe('1 Mbps')
  })

  it.each([...BAD_NUMBERS, 0])('非法或为 0 的输入 %s → 占位符', (input) => {
    expect(formatBitrate(input)).toBe(PLACEHOLDER)
  })
})

describe('parseFrameRate', () => {
  it('分数形式:30000/1001 ≈ 29.97', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97003, 4)
    expect(parseFrameRate('24000/1001')).toBeCloseTo(23.976, 3)
  })

  it('整数分数、纯数字、数字类型、带空白', () => {
    expect(parseFrameRate('25/1')).toBe(25)
    expect(parseFrameRate('25')).toBe(25)
    expect(parseFrameRate(25)).toBe(25)
    expect(parseFrameRate(' 50/1 ')).toBe(50)
  })

  it.each([
    '0/0', // ffprobe 对"没有帧率"的流(如音频)返回的值
    '25/0', // 分母为 0
    '0/1', // 结果为 0
    '-25/1',
    'N/A',
    '',
    'abc',
    'abc/def',
    '1/2/3'
  ])('无效字符串 %j → null', (input) => {
    expect(parseFrameRate(input)).toBeNull()
  })

  it.each([null, undefined, Number.NaN, 0, -5])('无效值 %s → null', (input) => {
    expect(parseFrameRate(input)).toBeNull()
  })
})

describe('formatFrameRate', () => {
  it.each([
    ['30000/1001', '29.97 fps'],
    ['24000/1001', '23.976 fps'],
    ['60000/1001', '59.94 fps'],
    ['25/1', '25 fps'],
    ['10/3', '3.333 fps'],
    [29.97, '29.97 fps'],
    ['0/0', PLACEHOLDER],
    [null, PLACEHOLDER]
  ])('%j → %s', (input, expected) => {
    expect(formatFrameRate(input)).toBe(expected)
  })
})

describe('其他展示格式', () => {
  it('formatResolution', () => {
    expect(formatResolution(1920, 1080)).toBe('1920×1080')
    expect(formatResolution(0, 1080)).toBe(PLACEHOLDER)
    expect(formatResolution(null, 1080)).toBe(PLACEHOLDER)
    expect(formatResolution(1920, undefined)).toBe(PLACEHOLDER)
  })

  it('formatSampleRate', () => {
    expect(formatSampleRate(44100)).toBe('44.1 kHz')
    expect(formatSampleRate(48000)).toBe('48 kHz')
    expect(formatSampleRate(8000)).toBe('8 kHz')
    expect(formatSampleRate(0)).toBe(PLACEHOLDER)
    expect(formatSampleRate(null)).toBe(PLACEHOLDER)
  })

  it('formatChannels', () => {
    expect(formatChannels(1)).toBe('单声道')
    expect(formatChannels(2)).toBe('立体声')
    expect(formatChannels(6)).toBe('5.1 声道')
    expect(formatChannels(8)).toBe('7.1 声道')
    expect(formatChannels(3)).toBe('3 声道')
    expect(formatChannels(0)).toBe(PLACEHOLDER)
    expect(formatChannels(null)).toBe(PLACEHOLDER)
  })

  it('formatContainerName:把 ffprobe 的别名列表转成人话', () => {
    expect(formatContainerName('mov,mp4,m4a,3gp,3g2,mj2')).toBe('MP4 / MOV')
    expect(formatContainerName('matroska,webm')).toBe('MKV / WebM')
    expect(formatContainerName('avi')).toBe('AVI')
    expect(formatContainerName('mp3')).toBe('MP3')
    expect(formatContainerName('gif')).toBe('GIF')
    expect(formatContainerName('mpegts')).toBe('MPEG-TS')
    expect(formatContainerName('h264')).toBe('H.264 裸流')
    expect(formatContainerName('xyz,abc')).toBe('XYZ') // 未知格式:取第一个别名大写
    expect(formatContainerName('')).toBe(PLACEHOLDER)
    expect(formatContainerName(null)).toBe(PLACEHOLDER)
  })

  it('formatCodecName', () => {
    expect(formatCodecName('h264')).toBe('H.264')
    expect(formatCodecName('H264')).toBe('H.264') // 大小写不敏感
    expect(formatCodecName('hevc')).toBe('H.265 (HEVC)')
    expect(formatCodecName('aac')).toBe('AAC')
    expect(formatCodecName('pcm_s16le')).toBe('PCM')
    expect(formatCodecName('pcm_s24le')).toBe('PCM')
    expect(formatCodecName('somethingnew')).toBe('SOMETHINGNEW')
    expect(formatCodecName('')).toBe(PLACEHOLDER)
    expect(formatCodecName(null)).toBe(PLACEHOLDER)
  })
})
