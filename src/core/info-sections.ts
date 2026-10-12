import type { AudioStreamInfo, VideoInfo, VideoStreamInfo } from '../shared/types'
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
  formatSampleRate
} from './format-utils'

export interface InfoRow {
  label: string
  value: string
}

export interface InfoSection {
  /** 稳定的标识,给界面做 key 和测试选择器用 */
  id: string
  title: string
  rows: InfoRow[]
}

function videoSection(stream: VideoStreamInfo, index: number, total: number): InfoSection {
  const codec = formatCodecName(stream.codec)
  const rows: InfoRow[] = [
    { label: '编码', value: stream.profile ? `${codec}(${stream.profile})` : codec },
    {
      label: '分辨率',
      value: formatResolution(stream.displayWidth, stream.displayHeight)
    }
  ]
  if (stream.rotation !== 0) {
    rows.push({
      label: '存储分辨率',
      value: `${formatResolution(stream.width, stream.height)}(旋转 ${stream.rotation}° 后显示)`
    })
  }
  rows.push(
    { label: '帧率', value: formatFrameRate(stream.frameRate) },
    { label: '码率', value: formatBitrate(stream.bitRate) },
    { label: '像素格式', value: stream.pixelFormat ?? PLACEHOLDER }
  )
  return { id: `video-${index}`, title: total > 1 ? `视频流 ${index + 1}` : '视频', rows }
}

function audioSection(stream: AudioStreamInfo, index: number, total: number): InfoSection {
  const channels = formatChannels(stream.channels)
  const rows: InfoRow[] = [
    { label: '编码', value: formatCodecName(stream.codec) },
    {
      label: '声道',
      value: stream.channelLayout ? `${channels}(${stream.channelLayout})` : channels
    },
    { label: '采样率', value: formatSampleRate(stream.sampleRate) },
    { label: '码率', value: formatBitrate(stream.bitRate) },
    { label: '语言', value: stream.language ?? PLACEHOLDER }
  ]
  if (stream.title) rows.push({ label: '标题', value: stream.title })
  return { id: `audio-${index}`, title: total > 1 ? `音频流 ${index + 1}` : '音频', rows }
}

/**
 * 把 VideoInfo 整理成"信息面板"要展示的分组。
 * 放在 core 里是为了让文案和边界(没有视频流、没有音轨、多音轨、旋转)可以直接单测。
 */
export function buildInfoSections(
  info: VideoInfo,
  file: { name: string; path: string }
): InfoSection[] {
  const general: InfoRow[] = [
    { label: '文件名', value: file.name },
    { label: '位置', value: file.path },
    { label: '容器格式', value: formatContainerName(info.formatName) },
    { label: '时长', value: formatDuration(info.durationSec) },
    { label: '文件大小', value: formatFileSize(info.sizeBytes) },
    { label: '总码率', value: formatBitrate(info.bitRate) }
  ]
  if (info.subtitleStreamCount > 0) {
    general.push({ label: '字幕轨道', value: `${info.subtitleStreamCount} 条` })
  }
  if (info.hasCoverArt) general.push({ label: '封面图', value: '有' })

  const sections: InfoSection[] = [{ id: 'general', title: '常规', rows: general }]

  if (info.videoStreams.length === 0) {
    sections.push({
      id: 'video-none',
      title: '视频',
      rows: [{ label: '视频流', value: '没有(这是一个纯音频文件)' }]
    })
  } else {
    info.videoStreams.forEach((stream, i) =>
      sections.push(videoSection(stream, i, info.videoStreams.length))
    )
  }

  if (info.audioStreams.length === 0) {
    sections.push({
      id: 'audio-none',
      title: '音频',
      rows: [{ label: '音频流', value: '没有(这个视频是无声的)' }]
    })
  } else {
    info.audioStreams.forEach((stream, i) =>
      sections.push(audioSection(stream, i, info.audioStreams.length))
    )
  }

  return sections
}
