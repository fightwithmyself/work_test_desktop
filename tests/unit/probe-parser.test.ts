import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FFPROBE_JSON_ARGS,
  normalizeRotation,
  parseClockDuration,
  parseProbeOutput
} from '../../src/core/probe-parser'

// ---------- 样本加载:tests/fixtures/ffprobe 下是本机 ffprobe 的真实输出 ----------

const fixtureDir = fileURLToPath(new URL('../fixtures/ffprobe/', import.meta.url))
// 样本是外部工具的原始 JSON,测试里需要随意下钻访问,这里有意放宽类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadFixture = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(`${fixtureDir}${name}.json`, 'utf8'))
const parseFixture = (name: string) => parseProbeOutput(loadFixture(name))

// ---------- 手工构造样本的小工具(用于本机造不出来的异常情况) ----------

type Rec = Record<string, unknown>
const videoStream = (extra: Rec = {}): Rec => ({
  index: 0,
  codec_type: 'video',
  codec_name: 'h264',
  width: 1920,
  height: 1080,
  avg_frame_rate: '25/1',
  r_frame_rate: '25/1',
  ...extra
})
const audioStream = (extra: Rec = {}): Rec => ({
  index: 1,
  codec_type: 'audio',
  codec_name: 'aac',
  channels: 2,
  sample_rate: '48000',
  ...extra
})
const probe = (streams: unknown[], format: Rec = {}) => parseProbeOutput({ streams, format })

describe('FFPROBE_JSON_ARGS', () => {
  it('与样本生成脚本使用同一组参数(避免样本与产品代码的探测方式不一致)', () => {
    expect(FFPROBE_JSON_ARGS).toEqual([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams'
    ])
    const script = readFileSync(
      fileURLToPath(new URL('../../scripts/gen-probe-fixtures.mjs', import.meta.url)),
      'utf8'
    )
    for (const arg of FFPROBE_JSON_ARGS) expect(script).toContain(`'${arg}'`)
  })
})

describe('真实 ffprobe 样本', () => {
  it('所有样本都能解析,且至少识别出音频或视频(防止新增样本后被漏测)', () => {
    const names = readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
    expect(names.length).toBeGreaterThanOrEqual(12)
    for (const name of names) {
      const info = parseFixture(name)
      expect(info.hasVideo || info.hasAudio, name).toBe(true)
      expect(info.sizeBytes, name).toBeGreaterThan(0)
    }
  })

  it('【常规】H.264 + AAC 的 MP4', () => {
    const info = parseFixture('mp4-h264-aac')
    expect(info.formatName).toBe('mov,mp4,m4a,3gp,3g2,mj2')
    expect(info.durationSec).toBeCloseTo(3, 2)
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.hasCoverArt).toBe(false)
    expect(info.rotation).toBe(0)
    expect(info.bitRate).toBeGreaterThan(0)

    const v = info.videoStreams[0]!
    expect(v).toMatchObject({
      codec: 'h264',
      width: 640,
      height: 360,
      displayWidth: 640,
      displayHeight: 360,
      rotation: 0
    })
    expect(v.frameRate).toBe(25)
    expect(v.pixelFormat).toBe('yuv420p')

    const a = info.audioStreams[0]!
    expect(a).toMatchObject({ codec: 'aac', channels: 1, sampleRate: 44100 })
    expect(a.language).toBeNull() // mp4 里的 "und" 被归一为 null
  })

  it('【无音轨】只有视频流', () => {
    const info = parseFixture('mp4-no-audio')
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(false)
    expect(info.audioStreams).toEqual([])
  })

  it('【纯音频】mp3:没有视频流,也没有封面', () => {
    const info = parseFixture('mp3-audio-only')
    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(true)
    expect(info.hasCoverArt).toBe(false)
    expect(info.videoStreams).toEqual([])
    expect(info.rotation).toBe(0)
    expect(info.audioStreams[0]).toMatchObject({ codec: 'mp3', bitRate: 128000 })
  })

  it('【封面图】mp3 的 attached_pic 不算视频流,只标记 hasCoverArt', () => {
    const raw = loadFixture('mp3-cover-art')
    // 先确认样本里确实有一条 mjpeg 视频流且 attached_pic=1,否则这个测试就没意义
    const cover = raw.streams.find((s: Rec) => s.codec_type === 'video')
    expect(cover.disposition.attached_pic).toBe(1)

    const info = parseProbeOutput(raw)
    expect(info.hasVideo).toBe(false)
    expect(info.videoStreams).toEqual([])
    expect(info.hasCoverArt).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.durationSec).toBeCloseTo(3.03, 2)
  })

  it('【旋转·side_data】ffprobe 报 rotation=90(逆时针)⇒ 顺时针 270,且宽高互换', () => {
    const raw = loadFixture('mp4-rotated-display-matrix')
    expect(raw.streams[0].side_data_list[0].rotation).toBe(90) // 样本本身的原始值
    const info = parseProbeOutput(raw)
    expect(info.rotation).toBe(270)
    expect(info.videoStreams[0]).toMatchObject({
      width: 640,
      height: 360,
      displayWidth: 360,
      displayHeight: 640,
      rotation: 270
    })
  })

  it('【多音轨】MKV:顺序、语言、标题都保留;流时长从 tags.DURATION 回退', () => {
    const info = parseFixture('mkv-multi-audio')
    expect(info.formatName).toBe('matroska,webm')
    expect(info.audioStreams).toHaveLength(2)
    expect(info.audioStreams.map((a) => a.language)).toEqual(['eng', 'zho'])
    expect(info.audioStreams.map((a) => a.title)).toEqual(['English', '国语'])
    expect(info.audioStreams.map((a) => a.index)).toEqual([1, 2])
    // 样本里这些流没有 duration 字段,时长只能来自 tags.DURATION
    expect(loadFixture('mkv-multi-audio').streams[0].duration).toBeUndefined()
    expect(info.videoStreams[0]!.durationSec).toBeCloseTo(3.0, 2)
    expect(info.audioStreams[0]!.durationSec).toBeCloseTo(3.023, 3)
  })

  it('【时长缺失·真实】裸 H.264 码流:容器没有时长和码率,解析为 null 而不是 0/NaN', () => {
    const raw = loadFixture('h264-raw-stream')
    expect(raw.format.duration).toBeUndefined() // 确认样本确实缺失
    const info = parseProbeOutput(raw)
    expect(info.durationSec).toBeNull()
    expect(info.bitRate).toBeNull() // 没有时长就无法估算
    expect(info.hasVideo).toBe(true)
    expect(info.videoStreams[0]!.frameRate).toBe(25)
  })

  it('【帧率】NTSC 30000/1001 解析为 ≈29.97', () => {
    const v = parseFixture('mp4-ntsc-2997').videoStreams[0]!
    expect(loadFixture('mp4-ntsc-2997').streams[0].avg_frame_rate).toBe('30000/1001')
    expect(v.frameRate).toBeCloseTo(29.97003, 4)
  })

  it('【字幕轨】被计数,但不影响视频/音频判断', () => {
    const info = parseFixture('mp4-with-subtitle')
    expect(info.subtitleStreamCount).toBe(1)
    expect(info.videoStreams).toHaveLength(1)
    expect(info.hasAudio).toBe(false)
  })

  it('【其他容器】WebM(VP9+Opus)、GIF、片段化 MP4', () => {
    const webm = parseFixture('webm-vp9-opus')
    expect(webm.videoStreams[0]!.codec).toBe('vp9')
    expect(webm.audioStreams[0]!.codec).toBe('opus')
    expect(webm.durationSec).toBeGreaterThan(0)

    const gif = parseFixture('gif-animated')
    expect(gif.videoStreams[0]).toMatchObject({ codec: 'gif', frameRate: 10 })
    expect(gif.hasAudio).toBe(false)

    const frag = parseFixture('mp4-fragmented')
    expect(frag.hasVideo).toBe(true)
    expect(frag.durationSec).toBeCloseTo(3, 1)
  })
})

describe('手工构造:时长缺失 / N/A', () => {
  it('format.duration 为 "N/A" → 回退到流时长', () => {
    const info = probe([videoStream({ duration: '12.5' })], { duration: 'N/A' })
    expect(info.durationSec).toBe(12.5)
  })

  it('format.duration 缺失 → 回退到流中最长的时长', () => {
    const info = probe([videoStream({ duration: '10' }), audioStream({ duration: '10.4' })], {})
    expect(info.durationSec).toBe(10.4)
  })

  it('format 与 stream 都没有 duration 字段,但流 tags 有 DURATION → 解析 tags', () => {
    const info = probe([videoStream({ tags: { DURATION: '00:01:02.500000000' } })], {})
    expect(info.durationSec).toBe(62.5)
  })

  it('所有来源都是 N/A 或缺失 → null', () => {
    const info = probe([videoStream({ duration: 'N/A', tags: { DURATION: 'N/A' } })], {
      duration: 'N/A'
    })
    expect(info.durationSec).toBeNull()
  })

  it('duration 为 0 或负数视为"未知"(不会显示 0:00)', () => {
    expect(probe([videoStream()], { duration: '0.000000' }).durationSec).toBeNull()
    expect(probe([videoStream()], { duration: '-5' }).durationSec).toBeNull()
  })

  it('封面图流的时长不参与整体时长计算', () => {
    const cover = videoStream({ duration: '999', disposition: { attached_pic: 1 } })
    const info = probe([audioStream({ duration: '3' }), cover], {})
    expect(info.durationSec).toBe(3)
  })
})

describe('手工构造:码率与大小', () => {
  it('format.bit_rate 缺失时用 大小 / 时长 估算', () => {
    const info = probe([videoStream()], { size: '1000000', duration: '10' })
    expect(info.bitRate).toBe(800000)
  })

  it('format.bit_rate 为 N/A 同样触发估算;有真实值时优先用真实值', () => {
    expect(
      probe([videoStream()], { size: '1000000', duration: '10', bit_rate: 'N/A' }).bitRate
    ).toBe(800000)
    expect(
      probe([videoStream()], { size: '1000000', duration: '10', bit_rate: '500000' }).bitRate
    ).toBe(500000)
  })

  it('缺大小或缺时长则无法估算 → null', () => {
    expect(probe([videoStream()], { duration: '10' }).bitRate).toBeNull()
    expect(probe([videoStream()], { size: '1000' }).bitRate).toBeNull()
  })

  it('size:数字、数字字符串都可以;N/A、负数、乱码 → null', () => {
    expect(probe([], { size: 2048 }).sizeBytes).toBe(2048)
    expect(probe([], { size: '2048' }).sizeBytes).toBe(2048)
    expect(probe([], { size: 'N/A' }).sizeBytes).toBeNull()
    expect(probe([], { size: '-1' }).sizeBytes).toBeNull()
    expect(probe([], { size: 'big' }).sizeBytes).toBeNull()
  })
})

describe('手工构造:帧率 0/0', () => {
  it('avg_frame_rate 为 0/0 时回退到 r_frame_rate', () => {
    const v = probe([videoStream({ avg_frame_rate: '0/0', r_frame_rate: '25/1' })]).videoStreams[0]!
    expect(v.frameRate).toBe(25)
  })

  it('两个都是 0/0 → frameRate 为 null(不是 0,也不是 NaN)', () => {
    const v = probe([videoStream({ avg_frame_rate: '0/0', r_frame_rate: '0/0' })]).videoStreams[0]!
    expect(v.frameRate).toBeNull()
  })

  it('字段完全缺失 → null', () => {
    const stream = videoStream()
    delete stream['avg_frame_rate']
    delete stream['r_frame_rate']
    expect(probe([stream]).videoStreams[0]!.frameRate).toBeNull()
  })
})

describe('手工构造:旋转', () => {
  const rotationOf = (extra: Rec) => probe([videoStream(extra)])

  it('手机竖屏常见值:side_data rotation=-90 ⇒ 顺时针 90,1920×1080 显示为 1080×1920', () => {
    const info = rotationOf({
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }]
    })
    expect(info.rotation).toBe(90)
    expect(info.videoStreams[0]).toMatchObject({ displayWidth: 1080, displayHeight: 1920 })
  })

  it.each([
    [0, 0],
    [90, 270],
    [-90, 90],
    [180, 180],
    [-180, 180],
    [270, 90],
    [-270, 270],
    [360, 0],
    [-90.0000001, 90] // 浮点噪声
  ])('side_data rotation=%s(逆时针)⇒ 顺时针 %s', (ccw, expected) => {
    expect(rotationOf({ side_data_list: [{ rotation: ccw }] }).rotation).toBe(expected)
  })

  it('旧式 tags.rotate 是顺时针角度,直接使用', () => {
    expect(rotationOf({ tags: { rotate: '90' } }).rotation).toBe(90)
    expect(rotationOf({ tags: { rotate: '270' } }).rotation).toBe(270)
    expect(rotationOf({ tags: { ROTATE: '180' } }).rotation).toBe(180) // 键名大小写不敏感
    const info = rotationOf({ tags: { rotate: '90' } })
    expect(info.videoStreams[0]).toMatchObject({ displayWidth: 1080, displayHeight: 1920 })
  })

  it('side_data 与 tags 同时存在时,以 side_data 为准', () => {
    const info = rotationOf({ side_data_list: [{ rotation: -90 }], tags: { rotate: '180' } })
    expect(info.rotation).toBe(90)
  })

  it('side_data_list 里有别的条目(没有 rotation 字段)时跳过,继续找到旋转或回退', () => {
    const info = rotationOf({
      side_data_list: [{ side_data_type: 'Mastering display metadata' }, { rotation: -90 }]
    })
    expect(info.rotation).toBe(90)
    expect(
      rotationOf({ side_data_list: [{ side_data_type: 'Mastering display metadata' }] }).rotation
    ).toBe(0)
  })

  it('非 90 的倍数(元数据异常)或乱码 → 按 0 处理,宽高不互换', () => {
    expect(rotationOf({ side_data_list: [{ rotation: 45 }] }).rotation).toBe(0)
    expect(rotationOf({ tags: { rotate: 'abc' } }).rotation).toBe(0)
    expect(rotationOf({ tags: { rotate: '' } }).rotation).toBe(0)
  })

  it('180° 不互换宽高', () => {
    const v = rotationOf({ side_data_list: [{ rotation: 180 }] }).videoStreams[0]!
    expect(v).toMatchObject({ displayWidth: 1920, displayHeight: 1080 })
  })

  it('没有视频流时 rotation 为 0', () => {
    expect(probe([audioStream()]).rotation).toBe(0)
  })

  it('normalizeRotation 直接测试', () => {
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(-0)).toBe(0)
    expect(normalizeRotation(Number.NaN)).toBe(0)
  })
})

describe('手工构造:纯音频、封面图、多音轨', () => {
  it('纯音频(没有 video 流)', () => {
    const info = probe([audioStream({ index: 0 })], { duration: '200' })
    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(true)
    expect(info.rotation).toBe(0)
  })

  it('attached_pic 为 1 的视频流是封面;为 0 的 mjpeg 视频流仍然是真正的视频', () => {
    const cover = videoStream({ codec_name: 'mjpeg', disposition: { attached_pic: 1 } })
    const motionJpeg = videoStream({ codec_name: 'mjpeg', disposition: { attached_pic: 0 } })
    expect(probe([cover]).hasVideo).toBe(false)
    expect(probe([cover]).hasCoverArt).toBe(true)
    expect(probe([motionJpeg]).hasVideo).toBe(true)
    expect(probe([motionJpeg]).hasCoverArt).toBe(false)
  })

  it('封面 + 真视频同时存在:只有真视频被计入,封面只设标志', () => {
    const info = probe([
      videoStream({ index: 0 }),
      videoStream({ index: 1, disposition: { attached_pic: 1 } })
    ])
    expect(info.videoStreams).toHaveLength(1)
    expect(info.hasCoverArt).toBe(true)
  })

  it('3 条音轨:保持原顺序,保留各自的 index、语言、标题;und 和空标题归一为 null', () => {
    const info = probe([
      videoStream({ index: 0 }),
      audioStream({ index: 3, tags: { language: 'jpn', title: '日语' } }),
      audioStream({ index: 5, tags: { language: 'und', title: '  ' } }),
      audioStream({ index: 7 })
    ])
    expect(info.audioStreams.map((a) => a.index)).toEqual([3, 5, 7])
    expect(info.audioStreams.map((a) => a.language)).toEqual(['jpn', null, null])
    expect(info.audioStreams.map((a) => a.title)).toEqual(['日语', null, null])
  })

  it('流缺少 index 字段时用它在数组中的位置', () => {
    const noIndex = audioStream()
    delete noIndex['index']
    expect(probe([videoStream({ index: 0 }), noIndex]).audioStreams[0]!.index).toBe(1)
  })
})

describe('手工构造:字段缺失 / 类型错误不得抛异常', () => {
  const EMPTY = {
    formatName: null,
    formatLongName: null,
    durationSec: null,
    sizeBytes: null,
    bitRate: null,
    videoStreams: [],
    audioStreams: [],
    subtitleStreamCount: 0,
    hasCoverArt: false,
    hasVideo: false,
    hasAudio: false,
    rotation: 0
  }

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['空对象', {}],
    ['数组', []],
    ['字符串', 'not json object'],
    ['数字', 42],
    ['布尔', true],
    ['streams / format 类型错误', { streams: 'oops', format: 5 }],
    ['streams 与 format 为 null', { streams: null, format: null }],
    ['空 streams', { streams: [], format: {} }]
  ])('顶层输入 %s → 返回空结果,不抛异常', (_name, input) => {
    expect(() => parseProbeOutput(input)).not.toThrow()
    expect(parseProbeOutput(input)).toEqual(EMPTY)
  })

  it('streams 里混入 null / 数字 / 字符串 / 数组 → 跳过,不影响正常的流', () => {
    const info = parseProbeOutput({
      streams: [null, 1, 'x', [], undefined, videoStream()],
      format: {}
    })
    expect(info.videoStreams).toHaveLength(1)
  })

  it('未知或缺失的 codec_type(data、attachment、没有该字段)→ 忽略', () => {
    const info = probe([
      { codec_type: 'data' },
      { codec_type: 'attachment' },
      {},
      { codec_type: 5 }
    ])
    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(false)
    expect(info.subtitleStreamCount).toBe(0)
  })

  it('各字段类型全部错误 → 全部降级为 null / 默认值', () => {
    const info = probe(
      [
        {
          codec_type: 'video',
          codec_name: 123,
          width: {},
          height: [],
          avg_frame_rate: 25,
          duration: {},
          bit_rate: 'fast',
          tags: 'not an object',
          disposition: null,
          side_data_list: 'not an array',
          index: 'zero'
        },
        { codec_type: 'audio', channels: 'two', sample_rate: null, tags: [] }
      ],
      { duration: [], size: {}, bit_rate: false, format_name: 7 }
    )
    expect(info.videoStreams[0]).toMatchObject({
      index: 0,
      codec: 'unknown',
      width: null,
      height: null,
      displayWidth: null,
      displayHeight: null,
      bitRate: null,
      durationSec: null,
      rotation: 0
    })
    // avg_frame_rate 是数字 25:不是字符串,按"缺失"处理 → 回退 r_frame_rate(也缺失)→ null
    expect(info.videoStreams[0]!.frameRate).toBeNull()
    expect(info.audioStreams[0]).toMatchObject({
      codec: 'unknown',
      channels: null,
      sampleRate: null,
      language: null,
      title: null
    })
    expect(info.durationSec).toBeNull()
    expect(info.sizeBytes).toBeNull()
    expect(info.formatName).toBeNull()
  })

  it('宽高为 0 或字符串 "N/A" → null,而不是 0', () => {
    const v = probe([videoStream({ width: 0, height: 'N/A' })]).videoStreams[0]!
    expect(v).toMatchObject({ width: null, height: null, displayWidth: null, displayHeight: null })
  })

  it('旋转 90° 但宽高缺失时,不会因为互换而出错', () => {
    const v = probe([
      videoStream({ width: undefined, height: 1080, side_data_list: [{ rotation: -90 }] })
    ]).videoStreams[0]!
    expect(v).toMatchObject({ displayWidth: 1080, displayHeight: null })
  })

  it('返回的对象不会共享引用:连续解析互不影响', () => {
    const a = probe([audioStream()])
    const b = probe([audioStream()])
    a.audioStreams.pop()
    expect(b.audioStreams).toHaveLength(1)
  })
})

describe('parseClockDuration', () => {
  it.each([
    ['00:00:03.000000000', 3],
    ['00:01:02.5', 62.5],
    ['01:00:00', 3600],
    ['10:30:15.250', 37815.25]
  ])('%s → %s', (input, expected) => {
    expect(parseClockDuration(input)).toBe(expected)
  })

  it.each([null, '', 'N/A', '3.5', '1:2', 'aa:bb:cc', '00:00:00.000000000'])(
    '无效或为 0 的 %j → null',
    (input) => {
      expect(parseClockDuration(input)).toBeNull()
    }
  )
})
