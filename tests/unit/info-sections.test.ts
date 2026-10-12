import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildInfoSections, type InfoSection } from '../../src/core/info-sections'
import { parseProbeOutput } from '../../src/core/probe-parser'
import type { VideoInfo } from '../../src/shared/types'

const dir = fileURLToPath(new URL('../fixtures/ffprobe/', import.meta.url))

function load(name: string): VideoInfo {
  const parsed = parseProbeOutput(JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')))
  if (!parsed) throw new Error(`样本 ${name} 解析失败`)
  return parsed
}

const file = { name: 'sample.mp4', path: 'C:\\videos\\sample.mp4' }
const section = (sections: InfoSection[], id: string): InfoSection => {
  const found = sections.find((s) => s.id === id)
  if (!found) throw new Error(`没有分组 ${id};现有:${sections.map((s) => s.id).join(',')}`)
  return found
}
const value = (s: InfoSection, label: string): string | undefined =>
  s.rows.find((r) => r.label === label)?.value

describe('buildInfoSections · 常规 MP4(H.264 + AAC)', () => {
  const sections = buildInfoSections(load('mp4-h264-aac'), file)

  it('分组顺序:常规 → 视频 → 音频', () => {
    expect(sections.map((s) => s.id)).toEqual(['general', 'video-0', 'audio-0'])
    expect(sections.map((s) => s.title)).toEqual(['常规', '视频', '音频'])
  })

  it('常规:文件名、位置、容器、时长、大小、总码率都有值', () => {
    const general = section(sections, 'general')
    expect(value(general, '文件名')).toBe('sample.mp4')
    expect(value(general, '位置')).toBe('C:\\videos\\sample.mp4')
    expect(value(general, '容器格式')).toMatch(/MP4/)
    expect(value(general, '时长')).toMatch(/^\d+:\d{2}$/)
    expect(value(general, '文件大小')).toMatch(/\d/)
    expect(value(general, '总码率')).toMatch(/bps$/)
  })

  it('视频:编码、分辨率、帧率、码率、像素格式', () => {
    const video = section(sections, 'video-0')
    expect(value(video, '编码')).toMatch(/H\.264/)
    expect(value(video, '分辨率')).toMatch(/^\d+×\d+$/)
    expect(value(video, '帧率')).toMatch(/fps$/)
    expect(video.rows.map((r) => r.label)).toEqual(['编码', '分辨率', '帧率', '码率', '像素格式'])
  })

  it('音频:编码、声道、采样率、码率、语言', () => {
    const audio = section(sections, 'audio-0')
    expect(value(audio, '编码')).toMatch(/AAC/)
    expect(value(audio, '声道')).toBeTruthy()
    expect(value(audio, '采样率')).toMatch(/kHz$/)
    expect(audio.rows.map((r) => r.label)).toEqual(['编码', '声道', '采样率', '码率', '语言'])
  })

  it('所有行的值都不是空字符串/undefined/NaN', () => {
    for (const s of sections) {
      for (const row of s.rows) {
        expect(row.value, `${s.id}/${row.label}`).toBeTruthy()
        expect(row.value).not.toMatch(/NaN|undefined|null/)
      }
    }
  })
})

describe('buildInfoSections · 边界情况', () => {
  it('没有音轨:音频分组提示"无声",而不是空白', () => {
    const sections = buildInfoSections(load('mp4-no-audio'), file)
    expect(sections.map((s) => s.id)).toEqual(['general', 'video-0', 'audio-none'])
    expect(section(sections, 'audio-none').rows[0]?.value).toContain('无声')
  })

  it('纯音频:视频分组提示"纯音频文件"', () => {
    const sections = buildInfoSections(load('mp3-audio-only'), file)
    expect(sections.map((s) => s.id)).toEqual(['general', 'video-none', 'audio-0'])
    expect(section(sections, 'video-none').rows[0]?.value).toContain('纯音频')
  })

  it('带封面的 mp3:封面不算视频流,但常规里会标出"封面图"', () => {
    const sections = buildInfoSections(load('mp3-cover-art'), file)
    expect(sections.some((s) => s.id === 'video-0')).toBe(false)
    expect(value(section(sections, 'general'), '封面图')).toBe('有')
  })

  it('多条音轨:分组标题带序号并分别展示', () => {
    const sections = buildInfoSections(load('mkv-multi-audio'), file)
    const audio = sections.filter((s) => s.id.startsWith('audio-'))
    expect(audio.length).toBeGreaterThan(1)
    expect(audio.map((s) => s.title)).toEqual(audio.map((_, i) => `音频流 ${i + 1}`))
  })

  it('旋转视频:显示分辨率是旋转后的,并额外给出存储分辨率与旋转角度', () => {
    const info = load('mp4-rotated-display-matrix')
    const video = section(buildInfoSections(info, file), 'video-0')
    const stream = info.videoStreams[0]!
    expect(stream.rotation).not.toBe(0)
    expect(value(video, '分辨率')).toBe(`${stream.displayWidth}×${stream.displayHeight}`)
    expect(value(video, '存储分辨率')).toContain(`${stream.width}×${stream.height}`)
    expect(value(video, '存储分辨率')).toContain(`${stream.rotation}°`)
  })

  it('没旋转的视频不出现"存储分辨率"行', () => {
    const video = section(buildInfoSections(load('mp4-h264-aac'), file), 'video-0')
    expect(value(video, '存储分辨率')).toBeUndefined()
  })

  it('有字幕轨道:常规里显示条数;没有则不显示这一行', () => {
    const withSubs = section(buildInfoSections(load('mp4-with-subtitle'), file), 'general')
    expect(value(withSubs, '字幕轨道')).toMatch(/^\d+ 条$/)
    const without = section(buildInfoSections(load('mp4-h264-aac'), file), 'general')
    expect(value(without, '字幕轨道')).toBeUndefined()
  })

  it('字段缺失(null)时显示占位符"—",不出现 null/NaN', () => {
    const empty: VideoInfo = {
      formatName: null,
      formatLongName: null,
      durationSec: null,
      sizeBytes: null,
      bitRate: null,
      videoStreams: [
        {
          index: 0,
          codec: 'h264',
          codecLongName: null,
          profile: null,
          pixelFormat: null,
          width: null,
          height: null,
          displayWidth: null,
          displayHeight: null,
          frameRate: null,
          bitRate: null,
          durationSec: null,
          rotation: 0
        }
      ],
      audioStreams: [],
      subtitleStreamCount: 0,
      hasCoverArt: false,
      hasVideo: true,
      hasAudio: false,
      rotation: 0
    }
    const sections = buildInfoSections(empty, file)
    const video = section(sections, 'video-0')
    expect(value(video, '分辨率')).toBe('—')
    expect(value(video, '帧率')).toBe('—')
    expect(value(video, '像素格式')).toBe('—')
    expect(value(section(sections, 'general'), '时长')).toBe('—')
    expect(JSON.stringify(sections)).not.toMatch(/NaN|undefined|"null"/)
  })
})
